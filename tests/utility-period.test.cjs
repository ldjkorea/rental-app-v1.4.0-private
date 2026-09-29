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

test('water meter reading auto deduction and upper floors kitchen usage proportional allocation', () => {
  const env = loadAppEnv();
  const tenants = [
    { id: 't1', unit: '101호', name: '1층 모닝 브루', biz: '모닝 브루' },
    { id: 't2', unit: '201호', name: '2층 온유 스튜디오', biz: '온유 스튜디오' },
    { id: 't3', unit: '301호', name: '3층 오술차', biz: '오술차' },
    { id: 't4', unit: '401호', name: '4층 메이플', biz: '메이플' }
  ];

  // 총 300,000원, 총 100톤
  // 1층: 직전 1200, 이번 1250 -> 50톤 (50%) -> 150,000원
  // 잔여 150,000원, 잔여 50톤
  // 2층: 25톤 (50%) -> 75,000원
  // 3층: 15톤 (30%) -> 45,000원
  // 4층: 10톤 (20%) -> 30,000원
  const inputs = {
    elec: 0,
    elev: 0,
    waste: 0,
    waterTotal: 300000,
    waterUsage: 100,
    waterFloors: {
      1: { prevMeter: 1200, curMeter: 1250, usage: 50 },
      2: { prevMeter: 300, curMeter: 325, usage: 25 },
      3: { prevMeter: 150, curMeter: 165, usage: 15 },
      4: { prevMeter: 80, curMeter: 90, usage: 10 }
    }
  };

  const result = env.RentalBilling.calculate(tenants, inputs, { r2: 1, r3: 1, r4: 1 });
  const rowMap = Object.fromEntries(result.rows.map(r => [r.floor, r]));

  assert.equal(rowMap[1].water, 150000);
  assert.equal(rowMap[2].water, 75000);
  assert.equal(rowMap[3].water, 45000);
  assert.equal(rowMap[4].water, 30000);

  const reconcile = env.RentalBilling.reconcile(result);
  assert.equal(reconcile.balanced, true);
  assert.equal(reconcile.totals.water, 300000);

  // 관리자가 4층 금액을 35,000원으로 올리고 2층을 70,000원으로 조정한 경우
  rowMap[4].water = 35000;
  rowMap[2].water = 70000;
  const reconcileAdjusted = env.RentalBilling.reconcile(result);
  assert.equal(reconcileAdjusted.balanced, true);
  assert.equal(reconcileAdjusted.totals.water, 300000);
});

