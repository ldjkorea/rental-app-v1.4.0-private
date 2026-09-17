/* One-way contract calendar sync. Event IDs stay in Script Properties, never in rental DB data. */
var CONTRACT_CALENDAR_MAP_PROPERTY = 'RENTAL_CONTRACT_CALENDAR_EVENTS_V1';

function contractCalendarTarget_() {
  var props = PropertiesService.getScriptProperties();
  var calendarId = String(props.getProperty('RENTAL_CALENDAR_ID') || '').trim();
  var calendar = calendarId ? CalendarApp.getCalendarById(calendarId) : CalendarApp.getDefaultCalendar();
  if (!calendar) throw new Error('연동할 Google Calendar를 찾을 수 없습니다.');
  return calendar;
}

function contractCalendarRows_(data) {
  var leaseStatuses = ['임대중','재계약예정','계약종료예정','명도소송중','강제집행중','공실(정리중)','임대모집중'];
  return (data.tenants || []).filter(function(tenant) {
    return tenant && !tenant.archived;
  }).map(function(tenant) {
    var status = leaseStatuses.indexOf(tenant.leaseStatus) >= 0 ? tenant.leaseStatus : '임대중';
    if (status === '공실(정리중)' || status === '임대모집중') return null;
    var endDate = RentalBilling.contractEndDate(tenant.contract);
    if (!endDate) return null;
    return {
      key:tenant.id,
      floor:RentalBilling.floorOf(tenant.unit),
      name:String(tenant.name || '').trim(),
      biz:String(tenant.biz || '').trim(),
      status:status,
      endDate:endDate
    };
  }).filter(function(row) { return row !== null; });
}

function contractCalendarDate_(iso) {
  var parts = iso.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function contractCalendarLabel_(row) {
  return row.biz || row.name || '임차인';
}

function contractCalendarTitle_(row) {
  return '[임대관리] ' + (row.floor ? row.floor + '층 ' : '') + contractCalendarLabel_(row) + ' 계약 만료';
}

function contractCalendarDescription_(row) {
  return [
    '층: ' + (row.floor ? row.floor + '층' : '-'),
    '임차인: ' + (row.name || '-'),
    '상호: ' + (row.biz || '-'),
    '계약 종료일: ' + row.endDate,
    '현재 임대상태: ' + row.status,
    '',
    '임대관리앱에서 최신 계약정보를 확인하세요.'
  ].join('\n');
}

function contractCalendarMap_(props) {
  var raw = props.getProperty(CONTRACT_CALENDAR_MAP_PROPERTY);
  if (!raw) return {};
  var parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Calendar 일정 연결정보 형식 오류');
  var clean = {};
  Object.keys(parsed).forEach(function(key) {
    if (/^[a-zA-Z0-9_-]{1,100}$/.test(key) && ['__proto__','constructor','prototype'].indexOf(key) < 0 &&
        typeof parsed[key] === 'string' && parsed[key]) clean[key] = parsed[key];
  });
  return clean;
}

function saveContractCalendarMap_(props, map) {
  props.setProperty(CONTRACT_CALENDAR_MAP_PROPERTY, JSON.stringify(map));
}

function syncContractCalendar_(data, revision) {
  var props = PropertiesService.getScriptProperties();
  var calendar = contractCalendarTarget_();
  var map = contractCalendarMap_(props);
  var rows = contractCalendarRows_(data);
  var created = 0, updated = 0;
  var items = [];
  rows.forEach(function(row) {
    var event = map[row.key] ? calendar.getEventById(map[row.key]) : null;
    var title = contractCalendarTitle_(row), description = contractCalendarDescription_(row);
    var result;
    if (event) {
      event.setTitle(title);
      event.setDescription(description);
      event.setAllDayDate(contractCalendarDate_(row.endDate));
      updated++;
      result = 'updated';
    } else {
      event = calendar.createAllDayEvent(title, contractCalendarDate_(row.endDate), {description:description});
      map[row.key] = event.getId();
      // Persist after every create so a later failure does not cause a duplicate on retry.
      saveContractCalendarMap_(props, map);
      created++;
      result = 'created';
    }
    items.push({tenantId:row.key, title:title, date:row.endDate, result:result});
  });
  saveContractCalendarMap_(props, map);
  return {
    status:'ok', revision:revision, created:created, updated:updated,
    skipped:(data.tenants || []).filter(function(tenant) { return tenant && !tenant.archived; }).length - rows.length,
    total:rows.length, items:items, updatedAt:new Date().toISOString()
  };
}
