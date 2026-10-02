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

test('water meter inspection dates and previous meter lookup across billing cycles', () => {
  const env = loadAppEnv();
  vm.runInContext("tenants = [{ id: 't1', unit: '101호', period_water_day: 20, period_elec: 24, leaseStatus: 'active' }];", env);
  // 9월 정산 시 수도 사용기간: 06/21 ~ 08/20 -> 직전 검침: 6/20, 이번 검침: 8/20
  const pSep = env.settlementUsagePeriods('2026-09', true);
  const sDate = new Date(pSep.water.start);
  sDate.setDate(sDate.getDate() - 1);
  const prevDate = `${sDate.getMonth() + 1}/${sDate.getDate()}`;
  const eDate = new Date(pSep.water.end);
  const curDate = `${eDate.getMonth() + 1}/${eDate.getDate()}`;
  assert.equal(prevDate, '6/20');
  assert.equal(curDate, '8/20');

  // 7월 정산 시 수도 사용기간: 04/21 ~ 06/20 -> 직전 검침: 4/20, 이번 검침: 6/20
  const pJul = env.settlementUsagePeriods('2026-07', true);
  const sDateJul = new Date(pJul.water.start);
  sDateJul.setDate(sDateJul.getDate() - 1);
  const prevDateJul = `${sDateJul.getMonth() + 1}/${sDateJul.getDate()}`;
  const eDateJul = new Date(pJul.water.end);
  const curDateJul = `${eDateJul.getMonth() + 1}/${eDateJul.getDate()}`;
  assert.equal(prevDateJul, '4/20');
  assert.equal(curDateJul, '6/20');

  // 중간에 수도를 안 한 8월 정산 데이터가 있어도 7월 검침값을 올바르게 찾아오는지 검증
  vm.runInContext(`
    settInputs['2026-07'] = {
      waterFloors: {
        1: { prevMeter: 1200, curMeter: 1250, usage: 50 },
        2: { prevMeter: 300, curMeter: 325, usage: 25 }
      },
      usagePeriods: { water: { end: '2026-06-20' } }
    };
    settInputs['2026-08'] = {
      waterFloors: {
        1: { prevMeter: '', curMeter: '', usage: '' },
        2: { prevMeter: '', curMeter: '', usage: '' }
      }
    };
  `, env);

  const prevF1 = env.getPreviousWaterMeter(1, '2026-09');
  assert.equal(prevF1, 1250);
  const prevInfoF1 = env.getPreviousWaterMeterInfo(1, '2026-09');
  assert.equal(prevInfoF1.val, 1250);
  assert.equal(prevInfoF1.sourceMonth, '2026-07');
  assert.equal(prevInfoF1.date, '06/20');

  const prevF2 = env.getPreviousWaterMeter(2, '2026-09');
  assert.equal(prevF2, 325);
  const prevInfoF2 = env.getPreviousWaterMeterInfo(2, '2026-09');
  assert.equal(prevInfoF2.val, 325);
  assert.equal(prevInfoF2.sourceMonth, '2026-07');
});


