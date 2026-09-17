/* rental-sync-v2: keep the existing deployment and its access settings. */
var SYNC_FORMAT = 'rental-sync-storage-v2';
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function validate_(data) {
  function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function walk(v, depth) {
    if (depth > 30) throw new Error('자료 중첩 깊이 초과');
    if (typeof v === 'number' && !isFinite(v)) throw new Error('유효하지 않은 숫자');
    if (v && typeof v === 'object') Object.keys(v).forEach(function(k) {
      if (['__proto__','constructor','prototype'].indexOf(k) >= 0) throw new Error('안전하지 않은 자료 키');
      walk(v[k], depth + 1);
    });
  }
  if (!object(data) || !Array.isArray(data.tenants) || !object(data.bills)) throw new Error('임대 자료 형식 오류');
  ['loans'].forEach(function(k) { if (data[k] !== undefined && !Array.isArray(data[k])) throw new Error(k + ' 형식 오류'); });
  ['expenses','renewalDone','settInputs','waterRatio'].forEach(function(k) {
    if (data[k] !== undefined && !object(data[k])) throw new Error(k + ' 형식 오류');
  });
  var ids = {};
  data.tenants.forEach(function(t) {
    if (!object(t) || typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(t.id) || ids[t.id]) throw new Error('세입자 ID 오류');
    ids[t.id] = true;
  });
  Object.keys(data.bills).forEach(function(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !object(data.bills[month])) throw new Error('고지서 월 형식 오류');
    Object.keys(data.bills[month]).forEach(function(id) { if (!object(data.bills[month][id])) throw new Error('고지서 형식 오류'); });
  });
  walk(data, 0);
  return data; // Do not normalize or discard historical fields.
}
function locked_(operation) {
  var lock = LockService.getScriptLock(), acquired = false;
  try {
    acquired = lock.tryLock(10000);
    if (!acquired) return json_({status:'busy', message:'다른 저장이 진행 중입니다. 잠시 후 다시 시도해주세요.'});
    return json_(operation());
  } catch (err) { return json_({status:'error', message:String(err.message || err)}); }
  finally { if (acquired) lock.releaseLock(); }
}
function source_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('연결된 스프레드시트를 찾을 수 없습니다.');
  var props = PropertiesService.getScriptProperties(), saved = props.getProperty('RENTAL_SYNC_SHEET_ID');
  var sheet = saved === null ? book.getActiveSheet() : book.getSheetById(Number(saved));
  if (!sheet) throw new Error('기존 저장 시트를 찾을 수 없습니다. 자동 생성하지 않습니다.');
  if (saved === null) props.setProperty('RENTAL_SYNC_SHEET_ID', String(sheet.getSheetId()));
  return {book:book, sheet:sheet};
}
function read_(sheet) {
  var raw = '';
  var lastRow = typeof sheet.getLastRow === 'function' ? sheet.getLastRow() : 1;
  if (lastRow <= 1) {
    raw = String(sheet.getRange(1,1).getValue() || '');
  } else {
    var range = sheet.getRange(1, 1, lastRow, 1);
    if (typeof range.getValues === 'function') {
      raw = range.getValues().map(function(row) { return String(row[0] || ''); }).join('');
    } else {
      raw = String(range.getValue() || '');
    }
  }
  var stored = raw ? JSON.parse(raw) : {tenants:[], bills:{}};
  var envelope = stored && stored.format === SYNC_FORMAT;
  var data = validate_(envelope ? stored.data : stored);
  if (envelope && (!Array.isArray(stored.receipts) || typeof stored.version !== 'string')) throw new Error('서버 저장 메타데이터 오류');
  return {raw:raw, data:data, revision:'sha256-' + hash_(raw), receipts:envelope ? stored.receipts : []};
}
function doGet(e) {
  return locked_(function() {
    var state = read_(source_().sheet);
    return {status:'ok', data:state.data, revision:state.revision, capabilities:{conditionalWrite:true}, protocol:'rental-sync-v2'};
  });
}
function doPost(e) {
  return locked_(function() {
    var req = JSON.parse(e && e.postData && e.postData.contents || '{}');
    if (req.protocol !== 'rental-sync-v2' || typeof req.expectedRevision !== 'string' || !req.expectedRevision ||
        typeof req.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(req.requestId)) {
      return {status:'unsupported', message:'버전 비교 저장 요청이 필요합니다. 최신 앱에서 다시 불러온 뒤 저장해주세요.'};
    }
    validate_(req.data);
    var target = source_(), state = read_(target.sheet);
    var fingerprint = hash_(JSON.stringify({expectedRevision:req.expectedRevision, data:req.data}));
    var duplicate = state.receipts.filter(function(r) { return r.id === req.requestId; })[0];
    if (duplicate) {
      if (duplicate.hash !== fingerprint) return {status:'error', message:'동일 요청 ID의 내용이 다릅니다.'};
      if (state.receipts[state.receipts.length - 1].id !== req.requestId || JSON.stringify(state.data) !== JSON.stringify(req.data)) return {status:'conflict', message:'후속 저장이 존재합니다. 다시 불러와 확인해주세요.'};
      return {status:'ok', revision:state.revision, requestId:req.requestId, capabilities:{conditionalWrite:true}, duplicate:true};
    }
    if (req.expectedRevision !== state.revision) return {status:'conflict', message:'다른 기기에서 변경된 자료입니다. 현재 자료를 유지합니다.'};
    var receipts = state.receipts.slice(-15).concat([{id:req.requestId, hash:fingerprint}]);
    var raw = JSON.stringify({format:SYNC_FORMAT, version:Utilities.getUuid(), data:req.data, receipts:receipts});
    if (raw.length > 5000000) throw new Error('자료 크기가 안전 한도(5MB)를 초과했습니다.');
    
    var chunks = [];
    for (var i = 0; i < raw.length; i += 35000) {
      chunks.push([raw.slice(i, i + 35000)]);
    }
    if (chunks.length === 0) chunks.push(['']);

    // Recovery must be durable before touching storage. Never clear the source sheet.
    var backup = target.book.getSheetByName('_RentalSyncRecovery');
    if (!backup) backup = target.book.insertSheet('_RentalSyncRecovery');
    if (backup.getSheetId() === target.sheet.getSheetId()) throw new Error('복원 시트가 저장 시트와 같습니다.');
    backup.appendRow([new Date().toISOString(), state.revision, state.raw.slice(0, 45000)]);
    SpreadsheetApp.flush();

    var r1 = target.sheet.getRange(1, 1, chunks.length, 1);
    if (typeof r1.setValues === 'function') {
      var prevLastRow = typeof target.sheet.getLastRow === 'function' ? target.sheet.getLastRow() : 1;
      r1.setValues(chunks);
      if (prevLastRow > chunks.length && typeof target.sheet.getRange === 'function') {
        var clearRange = target.sheet.getRange(chunks.length + 1, 1, prevLastRow - chunks.length, 1);
        if (typeof clearRange.clearContent === 'function') clearRange.clearContent();
      }
    } else {
      target.sheet.getRange(1, 1).setValue(raw);
    }
    SpreadsheetApp.flush();
    var verified = read_(target.sheet);
    if (verified.raw !== raw) throw new Error('저장 후 재확인 실패. 다시 불러와 확인해주세요.');
    return {status:'ok', revision:'sha256-' + hash_(raw), requestId:req.requestId, capabilities:{conditionalWrite:true}};
  });
}
