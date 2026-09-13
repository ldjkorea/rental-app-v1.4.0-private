/* Shared, dependency-free data validation and local persistence. */
(function (root) {
  'use strict';
  const STATE_KEY = 'rentalApp.state.v1';
  const BACKUP_KEY = 'rentalApp.recovery.v1';
  const KEYS = ['tenants', 'bills', 'loans', 'expenses', 'renewalDone', 'settInputs', 'waterRatio'];
  const empty = () => ({tenants: [], bills: {}, loans: [], expenses: {}, renewalDone: {},
    settInputs: {}, waterRatio: {r2: 19, r3: 10, r4: 5}});
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };
  const record = (value, label) => isObject(value) || fail(`${label}: 객체 형식이 필요합니다.`);
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    && !['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'].includes(value);
  const month = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  function number(value, label, integer = false) {
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12 || (integer && !Number.isSafeInteger(Number(value))))
      fail(`${label}: 0 이상의 유효한 숫자가 필요합니다.`);
  }
  function date(value, year) {
    if (typeof value !== 'string') return false;
    if (value === '') return true;
    const match = /^(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2})$/.exec(value);
    if (!match) return false;
    const y = Number(match[1] || year), m = Number(match[2]), d = Number(match[3]);
    return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y,m,0).getDate();
  }
  function flags(value, keys, label) {
    keys.forEach(key => { if (value[key] != null && typeof value[key] !== 'boolean') fail(`${label}.${key}: 참/거짓 값이 필요합니다.`); });
  }
  function inspect(value, depth = 0) {
    if (depth > 15) fail('데이터 중첩이 너무 깊습니다.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('유효하지 않은 숫자입니다.');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('허용되지 않는 데이터 키입니다.');
        inspect(child, depth + 1);
      }
    }
  }
  function validateList(list, label, numericFields = []) {
    if (!Array.isArray(list)) fail(`${label}: 목록 형식이 필요합니다.`);
    const ids = new Set();
    list.forEach(item => {
      record(item, label);
      if (!id(item.id) || ids.has(item.id)) fail(`${label}: 식별자가 잘못되었거나 중복됩니다.`);
      ids.add(item.id);
      if (typeof item.name !== 'string') fail(`${label}: 이름을 확인해주세요.`);
      numericFields.forEach(key => { if (item[key] != null) number(item[key], `${label}.${key}`, key !== 'rate'); });
    });
  }
  function validateMgmtItems(items) {
    if (!Array.isArray(items)) fail('관리비 항목이 올바르지 않습니다.');
    const seen = new Set();
    items.forEach(item => {
      record(item, '관리비 항목');
      if (!/^m([1-9]|1[0-9])$/.test(item.key) || seen.has(item.key)) fail('관리비 항목 키를 확인해주세요.');
      seen.add(item.key);
      if (item.amount != null) number(item.amount, '관리비', true);
      if (item.name != null && typeof item.name !== 'string') fail('관리비 이름을 확인해주세요.');
      if (item.status != null && !['active', 'actual', 'na', 'inactive'].includes(item.status)) fail('관리비 상태를 확인해주세요.');
    });
  }
  function validateData(input) {
    record(input, '백업');
    inspect(input);
    if (input.schemaVersion !== undefined && input.schemaVersion !== 1) fail('지원하지 않는 백업 버전입니다.');
    if (!Object.hasOwn(input, 'tenants') || !Object.hasOwn(input, 'bills')) fail('세입자와 고지서 데이터가 필요합니다.');
    const data = empty();
    KEYS.forEach(key => { if (Object.hasOwn(input, key)) data[key] = JSON.parse(JSON.stringify(input[key])); });
    validateList(data.tenants, '세입자', ['rent', 'mgmt', 'elevator', 'elecFixed']);
    data.tenants.forEach(t => {
      flags(t, ['archived'], '세입자');
      if (typeof t.unit !== 'string') fail('세입자 호수를 확인해주세요.');
      for (const key of ['biz', 'contract', 'contract_first', 'payday', 'renew', 'paytype']) {
        if (t[key] != null && typeof t[key] !== 'string') fail(`세입자.${key}: 문자열이 필요합니다.`);
      }
      if (t.mgmtItems !== undefined) {
        validateMgmtItems(t.mgmtItems);
      }
      if (t.waterHistory !== undefined) {
        if (!Array.isArray(t.waterHistory)) fail('수도 이력이 올바르지 않습니다.');
        const meterMonths = new Set();
        t.waterHistory.forEach(w => {
          record(w, '수도 이력');
          if (!month(w.mk) || !date(w.date, Number(w.mk.slice(0,4))) || !w.date || meterMonths.has(w.mk)) fail('수도 이력 날짜 또는 중복 월을 확인해주세요.');
          meterMonths.add(w.mk);
          number(w.val, '계량기 수치');
        });
      }
    });
    validateList(data.loans, '대출', ['principal', 'rate']);
    for (const key of ['bills', 'expenses', 'settInputs']) {
      record(data[key], key);
      Object.entries(data[key]).forEach(([mk, value]) => {
        if (!month(mk)) fail(`${key}: 월 형식은 YYYY-MM이어야 합니다.`);
        if (key === 'expenses') validateList(value, '지출', ['amount']);
        else record(value, key);
        if (key === 'settInputs') {
          flags(value, ['confirmed','waterActive'], '정산');
          for (const field of ['elec', 'waterTotal', 'waterUsage', 'waterF1', 'elev', 'waste']) {
            if (value[field] != null) number(value[field], `정산.${field}`, !['waterUsage','waterF1'].includes(field));
          }
        }
      });
    }
    Object.entries(data.bills).forEach(([billMonth, rows]) => Object.entries(rows).forEach(([tenantId, bill]) => {
      if (!id(tenantId)) fail('고지서 식별자를 확인해주세요.');
      record(bill, '고지서');
      if (bill.mgmtItems != null) validateMgmtItems(bill.mgmtItems);
      for (const key of ['rent', 'mgmt', 'elevator', 'elevatorTotal', 'electricity', 'water', 'waste', 'waterMeter']) {
        if (bill[key] != null) number(bill[key], `고지서.${key}`, key !== 'waterMeter');
      }
      flags(bill, ['stampedRent','stampedMgmt','electricityNA','waterNA','wasteNA','invoiceIssued'], '고지서');
      for (const key of ['stampedRentDate','stampedMgmtDate','waterMeterDate']) {
        if (bill[key] != null && !date(bill[key], Number(billMonth.slice(0,4)))) fail(`고지서.${key}: 실제 날짜가 필요합니다.`);
      }
      if (bill.paid !== undefined) {
        record(bill.paid, '납부 확인');
        Object.entries(bill.paid).forEach(([key,p]) => {
          if (!['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'].includes(key)) fail('납부 항목 키를 확인해주세요.');
          record(p, '납부 항목'); flags(p, ['na'], '납부 항목');
          if (p.date != null && !date(p.date, Number(billMonth.slice(0,4)))) fail('입금일은 실제 날짜여야 합니다.');
        });
      }
      if (bill.unitSnapshot != null && typeof bill.unitSnapshot !== 'string') fail('고지서 호수를 확인해주세요.');
      if (bill.tenantSnapshot != null) {
        record(bill.tenantSnapshot, '계약 snapshot');
        Object.values(bill.tenantSnapshot).forEach(value => { if (typeof value !== 'string') fail('계약 snapshot 문자열을 확인해주세요.'); });
      }
      if (bill.paydaySnapshot != null && typeof bill.paydaySnapshot !== 'string') fail('고지서 납기일을 확인해주세요.');
      if (bill.snapshotEstimated != null && (!Array.isArray(bill.snapshotEstimated) || bill.snapshotEstimated.some(x => typeof x !== 'string'))) fail('snapshot 보완 이력을 확인해주세요.');
      if (bill.audit != null) {
        if(!Array.isArray(bill.audit))fail('변경 이력 형식을 확인해주세요.');
        bill.audit.forEach(entry=>{
          record(entry,'변경 이력');
          if(!['at','action','detail'].every(key=>typeof entry[key]==='string'))fail('변경 이력 항목을 확인해주세요.');
        });
      }
    }));
    record(data.renewalDone, '갱신 상태');
    record(data.waterRatio, '수도 비율');
    for (const key of ['r2', 'r3', 'r4']) {
      number(data.waterRatio[key], '수도 비율');
      data.waterRatio[key] = Number(data.waterRatio[key]);
    }
    if (['r2', 'r3', 'r4'].reduce((sum, key) => sum + data.waterRatio[key], 0) <= 0) fail('수도 비율 합계는 0보다 커야 합니다.');
    return JSON.parse(JSON.stringify(data));
  }
  function envelope(data) {
    return {schemaVersion: 1, exportedAt: new Date().toISOString(), ...validateData(data)};
  }
  function load(storage) {
    try {
      const current = storage.getItem(STATE_KEY);
      if (current !== null) { const parsed = JSON.parse(current); return {data: validateData(parsed), meta: isObject(parsed.localMeta) ? parsed.localMeta : {}, error: null}; }
      const data = empty();
      KEYS.forEach(key => {
        const raw = storage.getItem(key);
        if (raw !== null) data[key] = JSON.parse(raw);
      });
      return {data: validateData(data), error: null};
    } catch (error) {
      // Do not overwrite the original values when a legacy key or snapshot is damaged.
      return {data: empty(), error};
    }
  }
  function persist(storage, data, meta = {}) {
    // A single setItem is atomic: no partial writes across separate collections.
    storage.setItem(STATE_KEY, JSON.stringify({...envelope(data), localMeta: meta}));
  }
  function storageToken(storage) {
    const raw = storage.getItem(STATE_KEY);
    return raw === null ? JSON.stringify(KEYS.map(key => storage.getItem(key))) : raw;
  }
  function persistChecked(storage, data, expectedToken, meta = {}) {
    if (storageToken(storage) !== expectedToken) fail('다른 창에서 저장한 데이터가 있습니다. 새로고침 후 다시 편집해주세요.');
    persist(storage, data, meta);
    return storageToken(storage);
  }
  function backup(storage, data, reason) {
    const snapshot = {reason, ...envelope(data)};
    storage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  function validMeterDate(value, year) {
    const match = /^(\d{1,2})\/(\d{1,2})$/.exec(value);
    if (!match) return false;
    const m = Number(match[1]), d = Number(match[2]);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(year, m, 0).getDate();
  }
  root.RentalCore = {STATE_KEY, BACKUP_KEY, KEYS, empty, validateData, envelope, load, persist,
    backup, escapeHtml, validMeterDate, storageToken, persistChecked};
  if (typeof module !== 'undefined') module.exports = root.RentalCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
