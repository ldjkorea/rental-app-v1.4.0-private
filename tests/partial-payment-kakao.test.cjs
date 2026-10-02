const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadAppEnv() {
  const storage = {};
  const mockLocalStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const context = {
    URLSearchParams: class {
      constructor(s) { this.s = s; }
      get(k) { return k === 'demo' ? '1' : null; }
    },
    location: { search: '?demo=1', protocol: 'http:', hostname: 'localhost' },
    navigator: { locks: { request: (name, cb) => cb() }, onLine: true },
    window: { addEventListener: () => {} },
    document: {
      documentElement: { setAttribute: () => {}, getAttribute: () => null },
      addEventListener: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({ rel: '', href: '' }),
      head: { appendChild: () => {} }
    },
    localStorage: mockLocalStorage,
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    structuredClone: (obj) => JSON.parse(JSON.stringify(obj)),
    console
  };
  vm.createContext(context);
  const coreCode = fs.readFileSync(require.resolve('../assets/core.js'), 'utf8');
  vm.runInContext(coreCode, context);
  const billingCode = fs.readFileSync(require.resolve('../assets/billing.js'), 'utf8');
  vm.runInContext(billingCode, context);
  const appCode = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  vm.runInContext(appCode, context);
  const enhancementsCode = fs.readFileSync(require.resolve('../assets/enhancements.js'), 'utf8');
  vm.runInContext(enhancementsCode, context);
  return context;
}

test('partial payment stamping and intelligent kakao notice message generation', async () => {
  const env = loadAppEnv();

  // demo2(이예시, 온유 스튜디오) 세입자 테스트
  const tenant = env.findTenant('demo2');
  assert.ok(tenant);

  const date = new Date();
  const currentMonthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  env.switchTab = () => {};
  env.goToHistory('demo2');

  let currentStampDate = '2026-04-07';
  let kakaoTextContent = '';

  const makeDummyEl = (props = {}) => ({
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    replaceChildren: () => {},
    appendChild: () => {},
    focus: () => {},
    children: [],
    innerText: '',
    textContent: '',
    ...props
  });

  const kakaoTextEl = makeDummyEl();
  Object.defineProperty(kakaoTextEl, 'innerText', {
    get() { return kakaoTextContent; },
    set(v) { kakaoTextContent = v; },
    configurable: true
  });

  env.document.getElementById = (id) => {
    if (id === 'bill-total-display') return null;
    if (id === 'stamp-date') return makeDummyEl({ value: currentStampDate });
    if (id === 'stamp-remove') return makeDummyEl({ hidden: false });
    if (id === 'stamp-title') return makeDummyEl({ textContent: '' });
    if (id === 'kakao-msg-wrap') return makeDummyEl({ innerHTML: '' });
    if (id === 'kakao-text') return kakaoTextEl;
    if (id === 'kakao-template-textarea') return makeDummyEl({ value: '' });
    return makeDummyEl();
  };

  // 1. 기본 관리비 완납 처리 (4월 7일)
  currentStampDate = '2026-04-07';
  env.stampBill('pay_mgmt');
  await env.saveStamp(false);

  const bills = env.currentData().bills;
  assert.equal(bills[currentMonthKey].demo2.paid.pay_mgmt.date, '2026.04.07');
  assert.equal(bills[currentMonthKey].demo2.stampedMgmt, false); // 세부 항목 중 수도 등이 남아있으므로 일괄완납은 false

  // 2. 공용전기 완납 처리 (4월 7일)
  env.stampBill('pay_elec');
  await env.saveStamp(false);
  assert.equal(bills[currentMonthKey].demo2.paid.pay_elec.date, '2026.04.07');

  // 월세 완납 처리 (4월 5일)
  currentStampDate = '2026-04-05';
  env.stampBill('rent');
  await env.saveStamp(false);
  assert.equal(bills[currentMonthKey].demo2.stampedRentDate, '2026.04.05');

  // 3. 카카오 메시지 생성 검증
  env.goToHistory('demo2');
  await env.previewKakao();

  const fmtN = (n) => (Number(n) || 0).toLocaleString();
  const generatedSimple = kakaoTextContent;

  // 1) 기본 관리비와 공용전기 상태에 완납 및 날짜 표기 확인
  assert.ok(generatedSimple.includes('완납 · 2026.04.07 입금 확인'));
  assert.ok(generatedSimple.includes('총 입금 요청금액: 50,000원'));
  assert.ok(generatedSimple.includes('승강기 유지관리비 50,000원만 추가 입금 부탁드립니다.'));

  // 2) 사용자 정확 요청 시나리오 검증:
  // "기본 관리비 및 공용전기는 4월 7일 입금 확인되었습니다. 수도요금 정산분 48,000원만 추가 입금 부탁드립니다."
  // 월세는 이미 완료/면제, 승강기 유지비도 완료/면제, 기본 관리비 & 공용전기만 4월 7일 입금, 수도요금 48,000원 미납 상태
  bills[currentMonthKey].demo2.paid = bills[currentMonthKey].demo2.paid || {};
  bills[currentMonthKey].demo2.paid.pay_rent = { date: '', na: true }; // 월세 면제/정산제외
  bills[currentMonthKey].demo2.paid.pay_elev = { date: '', na: true }; // 승강기 제외
  bills[currentMonthKey].demo2.paid.pay_mgmt = { date: '2026.04.07', na: false };
  bills[currentMonthKey].demo2.paid.pay_elec = { date: '2026.04.07', na: false };
  bills[currentMonthKey].demo2.water = 48000;
  bills[currentMonthKey].demo2.paid.pay_water = { date: '', na: false };

  // 홀수월 수도 정산 대응 (현재 월이 짝수월이면 직전 홀수월에도 동일 수도금액 반영)
  const currentMonthNum = Number(currentMonthKey.split('-')[1]);
  if (currentMonthNum % 2 === 0) {
    const prevOddKey = `${date.getFullYear()}-${String(currentMonthNum - 1).padStart(2, '0')}`;
    bills[prevOddKey] = bills[prevOddKey] || {};
    bills[prevOddKey].demo2 = bills[prevOddKey].demo2 || {};
    bills[prevOddKey].demo2.water = 48000;
    bills[prevOddKey].demo2.paid = bills[prevOddKey].demo2.paid || {};
    bills[prevOddKey].demo2.paid.pay_water = { date: '', na: false };
  }

  await env.previewKakao();
  const scenarioMsg = kakaoTextContent;

  // 요청 문구 정확 일치 검증:
  // "기본 관리비 및 공용전기는 4월 7일 입금 확인되었습니다. 수도요금 정산분 48,000원만 추가 입금 부탁드립니다."
  assert.ok(scenarioMsg.includes('기본 관리비 및 공용전기는 4월 7일 입금 확인되었습니다. 수도요금 정산분 48,000원만 추가 입금 부탁드립니다.'));
  assert.ok(scenarioMsg.includes('총 입금 요청금액: 48,000원'));

  // 3) 수도요금까지 완납 처리 시
  currentStampDate = '2026-04-10';
  bills[currentMonthKey].demo2.paid.pay_water = { date: '2026.04.10', na: false };
  if (currentMonthNum % 2 === 0) {
    const prevOddKey = `${date.getFullYear()}-${String(currentMonthNum - 1).padStart(2, '0')}`;
    bills[prevOddKey].demo2.paid.pay_water = { date: '2026.04.10', na: false };
  }

  await env.previewKakao();
  const allPaidMsg = kakaoTextContent;

  assert.ok(allPaidMsg.includes('총 입금 요청금액: 0원'));
  assert.ok(allPaidMsg.includes('전액 입금 확인되었습니다'));
});
