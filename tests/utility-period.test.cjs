const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadAppEnv() {
  const context = {
    URLSearchParams: class { get() { return null; } },
    location: { search: '', protocol: 'http:', hostname: 'localhost' },
    navigator: {},
    window: { addEventListener: () => {} },
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      createElement: () => ({ rel: '', href: '' }),
      head: { appendChild: () => {} }
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console
  };
  vm.createContext(context);
  const coreCode = fs.readFileSync(require.resolve('../assets/core.js'), 'utf8');
  vm.runInContext(coreCode, context);
  const billingCode = fs.readFileSync(require.resolve('../assets/billing.js'), 'utf8');
  vm.runInContext(billingCode, context);
  const appCode = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  vm.runInContext(appCode, context);
  return context;
}

test('utility period calculation matches historic settlement billing rules', () => {
  const env = loadAppEnv();
  // 9월 정산 시 전기(24일 기준): 2026.08.24 ~ 2026.09.23 (사용기간 종료월 = 정산월, lag=0)
  const elecSep = env.utilityPeriodForSettlement('2026-09', 24, 1, false, 0);
  assert.equal(elecSep.start, '2026-08-24');
  assert.equal(elecSep.end, '2026-09-23');
  assert.equal(elecSep.day, 24);
  assert.equal(elecSep.span, 1);
  assert.equal(env.calcElectricityPeriod(24, 2026, 9), '08/24~09/23');

  // 8월 정산 시 전기(24일 기준): 2026.07.24 ~ 2026.08.23
  const elecAug = env.utilityPeriodForSettlement('2026-08', 24, 1, false, 0);
  assert.equal(elecAug.start, '2026-07-24');
  assert.equal(elecAug.end, '2026-08-23');
  assert.equal(elecAug.day, 24);
  assert.equal(elecAug.span, 1);
  assert.equal(env.calcElectricityPeriod(24, 2026, 8), '07/24~08/23');

  // 9월 정산 시 수도(20일 기준 격월): 2026.06.21 ~ 2026.08.20 (전월 마감, lag=1)
  const waterSep = env.utilityPeriodForSettlement('2026-09', 20, 2, true, 1);
  assert.equal(waterSep.start, '2026-06-21');
  assert.equal(waterSep.end, '2026-08-20');
  assert.equal(waterSep.day, 20);
  assert.equal(waterSep.span, 2);
  const waterCalc = env.calcWaterPeriod({period_water_day: 20, period_water_odd: 'odd'}, 2026, 9);
  assert.equal(waterCalc.period, '06/21~08/20');
  assert.equal(waterCalc.active, true);
});
