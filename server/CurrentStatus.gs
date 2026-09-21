/* Human-readable projection of the verified DB; never writes rental data. */
var STATUS_TITLE = '임대관리_현재현황'; // Display heading only; never used to locate the document.
var STATUS_DOCUMENT_ID = '1-HZYrBDD8HPZYO8sNCy33Q298DJ91LJIJAWRuWdQgFI';
var STATUS_BEGIN = '[RENTAL_CURRENT_STATUS_BEGIN]';
var STATUS_END = '[RENTAL_CURRENT_STATUS_END]';

function statusText_(value, fallback) {
  var text = value === undefined || value === null ? '' : String(value);
  return text.replace(/[\r\n\u2028\u2029]/g, ' ').trim() || fallback || '미입력';
}
function statusWon_(value) {
  if (value === undefined || value === null || value === '') return '미입력';
  var amount = Number(value);
  return Number.isFinite(amount) ? String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원' : '확인 필요';
}
function statusLines_(data, revision, now) {
  if (typeof RentalBilling === 'undefined' || typeof RentalBilling.collectionStatus !== 'function')
    throw new Error('공통 수납 계산 파일 Billing.gs를 함께 배포해주세요.');
  var asOf = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  var lines = [
    {text:STATUS_TITLE, heading:'HEADING1'},
    {text:'최종 갱신: ' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') + ' (한국시간)'},
    {text:'기준: 저장 완료된 임대관리 DB · 납기일 다음 날부터 연체'},
    {text:'총 미납금액에는 납기 전 금액도 포함됩니다. 보증금 미입력은 0원과 구분합니다.'}
  ];
  var tenants = data.tenants.filter(function(tenant) { return tenant.archived !== true; }).sort(function(a, b) {
    return RentalBilling.floorOf(a.unit) - RentalBilling.floorOf(b.unit) || String(a.unit || '').localeCompare(String(b.unit || ''));
  });
  if (!tenants.length) lines.push({text:'등록된 임차인이 없습니다.'});
  tenants.forEach(function(tenant) {
    var collection = RentalBilling.collectionStatus(tenant, data.bills, asOf);
    var lease = LEASE_STATUSES.indexOf(tenant.leaseStatus) >= 0 ? tenant.leaseStatus : '임대중';
    lines.push({text:statusText_(tenant.unit, '층/호수 미입력') + ' · ' + statusText_(tenant.biz || tenant.name), heading:'HEADING2'});
    lines.push({text:'임차인: ' + statusText_(tenant.name) + (tenant.biz ? ' / 상호: ' + statusText_(tenant.biz) : '')});
    lines.push({text:'임대상태: ' + lease});
    lines.push({text:'수납상태: ' + collection.status + ' (자동 계산)'});
    lines.push({text:'계약기간: ' + statusText_(tenant.contract)});
    lines.push({text:'보증금: ' + statusWon_(tenant.deposit)});
    lines.push({text:'월차임: ' + statusWon_(tenant.rent) + ' / 관리비: ' + statusWon_(tenant.mgmt) + ' (입력 공급가 기준)'});
    lines.push({text:'총 미납금액: ' + statusWon_(collection.totalUnpaid) + ' / 연체금액: ' + statusWon_(collection.totalOverdue)});
    lines.push({text:'월차임 연체: ' + statusWon_(collection.overdueRent) + ' / 공과금 연체: ' + statusWon_(collection.overdueUtilities)});
    lines.push({text:'납기 전·납기일 미확정 금액: ' + statusWon_(collection.notDue)});
    if (collection.unknownDue > 0) lines.push({text:'확인 필요: 납기일이 없어 연체 판단에서 제외한 금액 ' + statusWon_(collection.unknownDue)});
    lines.push({text:'최근 납부일: ' + statusText_(collection.lastPaymentDate, '날짜 기록 없음')});
  });
  lines.push({text:'자동생성 영역: 앱에 저장된 임차인·월별 고지서를 기준으로 작성됩니다. 메모는 영역 밖에 작성해주세요.'});
  return lines;
}
function statusDocument_(props) {
  var id = (props.getProperty('RENTAL_STATUS_DOCUMENT_ID') || '').trim();
  if (!id) {
    id = STATUS_DOCUMENT_ID;
    props.setProperty('RENTAL_STATUS_DOCUMENT_ID', id);
  }
  try {
    return DocumentApp.openById(id);
  } catch (err) {
    throw new Error('현재현황 문서를 열 수 없습니다. RENTAL_STATUS_DOCUMENT_ID를 확인하세요 (' + id + '): ' + String(err.message || err));
  }
}
function statusBodies_(doc) {
  if (typeof doc.getTabs !== 'function') return [doc.getBody()];
  var bodies = [];
  function visit(tab) {
    if (tab.getType() === DocumentApp.TabType.DOCUMENT_TAB) bodies.push(tab.asDocumentTab().getBody());
    tab.getChildTabs().forEach(visit);
  }
  doc.getTabs().forEach(visit);
  if (!bodies.length) throw new Error('현재현황을 작성할 문서 탭이 없습니다.');
  return bodies;
}
function statusRegion_(doc, props, create) {
  var bodies = statusBodies_(doc), begins = [], ends = [];
  bodies.forEach(function(body) {
    for (var i = 0; i < body.getNumChildren(); i++) {
      var child = body.getChild(i), text = typeof child.getText === 'function' ? child.getText().trim() : '';
      if (text.indexOf(STATUS_BEGIN) < 0 && text.indexOf(STATUS_END) < 0) continue;
      if (child.getType() !== DocumentApp.ElementType.PARAGRAPH || (text !== STATUS_BEGIN && text !== STATUS_END))
        throw new Error('현재현황 영역 표시는 단독 문단이어야 합니다. 문서를 확인해주세요.');
      (text === STATUS_BEGIN ? begins : ends).push({body:body, index:i});
    }
  });
  if (!begins.length && !ends.length && create) {
    if (props.getProperty('RENTAL_STATUS_REGION_INITIALIZED') === doc.getId())
      throw new Error('기존 자동생성 영역 표시가 없어졌습니다. 문서의 BEGIN/END 표시를 복구해주세요.');
    var body = bodies[0], start = body.getNumChildren();
    body.appendParagraph(STATUS_BEGIN);
    body.appendParagraph(STATUS_END);
    return {body:body, start:start, end:start + 1};
  }
  if (begins.length !== 1 || ends.length !== 1 || begins[0].body !== ends[0].body || begins[0].index >= ends[0].index)
    throw new Error('자동생성 BEGIN/END 영역이 누락·중복되었거나 순서가 다릅니다. 문서를 확인해주세요.');
  return {body:begins[0].body, start:begins[0].index, end:ends[0].index};
}
function generateCurrentStatus_(data, revision) {
  var now = new Date(), lines = statusLines_(data, revision, now);
  var props = PropertiesService.getScriptProperties(), doc = statusDocument_(props);
  var region = statusRegion_(doc, props, true), body = region.body;
  // Insert all fresh paragraphs before removing the prior generated content.
  // No body.clear/setText, tab deletion, or edits outside these markers.
  lines.forEach(function(line, offset) {
    var paragraph = body.insertParagraph(region.start + 1 + offset, line.text);
    if (line.heading) paragraph.setHeading(DocumentApp.ParagraphHeading[line.heading]);
  });
  for (var index = region.end - 1; index > region.start; index--)
    body.removeChild(body.getChild(index + lines.length));
  props.setProperty('RENTAL_STATUS_REGION_INITIALIZED', doc.getId());
  var id = doc.getId(), url = doc.getUrl();
  doc.saveAndClose();
  var saved = DocumentApp.openById(id), checked = statusRegion_(saved, props, false), contents = [];
  for (var i = checked.start + 1; i < checked.end; i++) contents.push(checked.body.getChild(i).getText());
  saved.saveAndClose();
  if (JSON.stringify(contents) !== JSON.stringify(lines.map(function(line) { return line.text; })))
    throw new Error('현재현황 문서 저장 후 재확인 실패. 다시 생성해주세요.');
  return {status:'ok', documentId:id, url:url, updatedAt:now.toISOString(), revision:revision};
}
