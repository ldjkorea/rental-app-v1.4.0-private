const TEST_URL=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4173/';
/* Run against npm start. Uses an existing Playwright installation; no runtime dependency. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../assets/core.js');
const out = path.resolve(__dirname, '../test-results'); fs.mkdirSync(out, {recursive: true});
const results = [];
const sample = () => ({...core.empty(), tenants: [
  {id: 't1', name: '김테스트', biz: '샘플 스튜디오', unit: '201호', rent: '1000000', mgmt: '100000', elevator: '30000', contract: ''},
  {id: 't2', name: '이테스트', biz: '샘플 사무실', unit: '301호', rent: '1200000', mgmt: '100000', elevator: '30000', contract: ''}
], loans: [{id: 'l1', name: '샘플 대출', principal: 100000000, rate: 4}], expenses: {}});
let browser;
async function pageFor(data = sample(), options = {}) {
  const context = await browser.newContext({serviceWorkers:'block',viewport: {width: 1280, height: 1000}, ...options});
  const requests = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(TEST_URL)) return route.continue();
    requests.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(({data, stateKey}) => {
    if (!sessionStorage.getItem('test-seeded')) {
      localStorage.setItem(stateKey, JSON.stringify(data)); sessionStorage.setItem('test-seeded', 'true');
    }
  }, {data, stateKey: core.STATE_KEY});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(TEST_URL);
  await page.locator('#section-home.active').waitFor();
  return {page, context, requests, errors};
}
async function run(name, fn) {
  try { await fn(); results.push({name, status: 'pass'}); console.log('PASS ' + name); }
  catch (error) { results.push({name, status: 'fail', error: error.stack}); console.error('FAIL ' + name + ': ' + error.message); }
}
async function state(page) { return page.evaluate(() => currentData()); }
(async () => {
  browser = await chromium.launch({headless: true, executablePath: process.env.RENTAL_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  await run('home, navigation, desktop/mobile layout and script health', async () => {
    const {page, context, errors} = await pageFor();
    assert.equal(await page.locator('#home-bill-list .t-item').count(), 2);
    for (const tab of ['tenants', 'history', 'settlement', 'settings', 'home']) {
      await page.locator('#nav-' + tab).click(); assert.ok(await page.locator('#section-' + tab).isVisible());
    }
    await page.screenshot({path: path.join(out, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    for (const tab of ['home', 'tenants', 'settings']) {
      await page.locator('#nav-' + tab).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.locator('#nav-home').click(); await page.screenshot({path: path.join(out, 'mobile.png'), fullPage: true});
    assert.deepEqual(errors, []); await context.close();
  });
  await run('bill edits retain amounts across NA switches and preserve existing metadata', async () => {
    const {page, context, errors} = await pageFor();
    await page.evaluate(() => { bills[mk()] = {t1: {rent: 900000, customField: 'preserve', stampedRent: true, stampedRentDate: '09/01'}}; goToHistory('t1'); });
    await page.waitForTimeout(100); await page.getByRole('button', {name: '✏️ 수정', exact: true}).click();
    await page.locator('#bill-electricity').fill('12345'); await page.locator('#bill-water').fill('4321');
    await page.evaluate(() => toggleWasteNA());
    assert.equal(await page.locator('#bill-electricity').inputValue(), '12345');
    assert.equal(await page.locator('#bill-water').inputValue(), '4321');
    await page.evaluate(() => saveBill());
    const bill = await page.evaluate(() => bills[mk()].t1);
    assert.equal(bill.rent, 900000); assert.equal(bill.customField, 'preserve'); assert.equal(bill.stampedRent, true);
    assert.equal(bill.electricity, 12345); assert.deepEqual(errors, []); await context.close();
  });
  await run('zero water ratio survives save and reload without default substitution', async () => {
    const {page, context} = await pageFor(); await page.locator('#nav-settings').click();
    await page.locator('#wr2').fill('0'); await page.evaluate(() => saveWaterRatio());
    await page.reload(); assert.equal((await state(page)).waterRatio.r2, 0); await context.close();
  });
  await run('meter records accept zero, sort historical entries and retain full history', async () => {
    const {page, context} = await pageFor(); await page.evaluate(() => { goToHistory('t1'); }); await page.waitForTimeout(100);
    await page.locator('#bill-water-meter').fill('0'); await page.locator('#bill-water-date').fill('09/20');
    await page.evaluate(() => saveWaterMeter());
    const data = await state(page); assert.equal(data.tenants[0].waterHistory[0].val, 0);
    assert.equal(Object.values(data.bills)[0].t1.waterMeter, 0);
    await page.evaluate(() => { tenants[0].waterHistory = Array.from({length: 13}, (_, i) => ({mk: `${2024+Math.floor(i/12)}-${String(i % 12 + 1).padStart(2,'0')}`, date: '01/20', val: i})); });
    await page.locator('#bill-water-meter').fill('100'); await page.evaluate(() => saveWaterMeter());
    assert.equal((await state(page)).tenants[0].waterHistory.length, 14); await context.close();
  });
  await run('reset affects only app data and recovery restores it', async () => {
    const {page, context} = await pageFor();
    await page.evaluate(async () => { localStorage.setItem('otherApp', 'keep'); await resetAllData(); });
    assert.equal((await state(page)).tenants.length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('otherApp')), 'keep');
    await page.evaluate(() => restoreRecovery()); assert.equal((await state(page)).tenants.length, 2); await context.close();
  });
  await run('legacy import replaces optional collections and malformed import preserves data', async () => {
    const {page, context} = await pageFor();
    await page.locator('#import-file').setInputFiles({name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({tenants: [], bills: {}}))});
    await page.waitForTimeout(100); assert.equal((await state(page)).loans.length, 0);
    const before = await state(page);
    await page.locator('#import-file').setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"tenants":{},"bills":[]}')});
    await page.waitForTimeout(100); assert.deepEqual(await state(page), before); await context.close();
  });
  await run('text injection displays literal text without running HTML', async () => {
    const data = sample(); data.tenants[0].name = '<img src=x onerror="window.injected=1">'; data.tenants[0].biz = '';
    data.loans[0].name = '<svg onload="window.injected=2">';
    const {page, context, errors} = await pageFor(data);
    assert.equal(await page.locator('#home-bill-list img').count(), 0);
    assert.equal(await page.locator('#loan-list svg').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.ok((await page.locator('#home-bill-list').innerText()).includes('<img'));
    assert.deepEqual(errors, []); await context.close();
  });
  await run('development copy never uploads on normal edits', async () => {
    const {page, context, requests} = await pageFor();
    await page.evaluate(() => save()); await page.waitForTimeout(2200);
    assert.equal(requests.filter(url => url.includes('script.google.com')).length, 0); await context.close();
  });
  await run('cloud import makes no writeback and refreshes ratio controls', async () => {
    const {page, context} = await pageFor();
    const remote = sample(); remote.waterRatio.r2 = 0;
    const methods = [];
    await context.route('https://script.google.com/**', route => {
      methods.push(route.request().method()); return route.fulfill({json: {status: 'ok', data: remote}});
    });
    await page.evaluate(() => syncFromSheet()); await page.waitForTimeout(2200);
    assert.deepEqual(methods, ['GET']); assert.equal((await state(page)).waterRatio.r2, 0);
    assert.equal(await page.locator('#wr2').inputValue(), '0'); await context.close();
  });
  await run('conditional cloud uploads deliver the newest edit after an in-flight save', async () => {
    const {page,context}=await pageFor();const uploaded=[];
    let remote=sample(),remoteRevision='r0';
    await context.route('https://script.google.com/**',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{status:'ok',data:remote,revision:remoteRevision,capabilities:{conditionalWrite:true}}});
      const body=route.request().postDataJSON();uploaded.push(body);
      assert.equal(body.expectedRevision,remoteRevision);
      await new Promise(resolve=>setTimeout(resolve,150));
      remote=body.data;remoteRevision='r'+uploaded.length;
      return route.fulfill({json:{status:'ok',revision:remoteRevision,requestId:body.requestId,capabilities:{conditionalWrite:true}}});
    });
    await page.evaluate(async()=>{setCloudEnabled(true);tenants[0].name='first';await save();void manualSync();});
    await page.waitForTimeout(60);
    await page.evaluate(async()=>{tenants[0].name='last';await save();});
    await page.waitForTimeout(2600);
    assert.equal(uploaded.length,2);assert.equal(uploaded.at(-1).data.tenants[0].name,'last');await context.close();
  });
  await run('cloud import cannot overwrite edits made while waiting', async () => {
    const {page, context} = await pageFor();
    await context.route('https://script.google.com/**', async route => {
      await new Promise(r => setTimeout(r, 200)); await route.fulfill({json: {status: 'ok', data: core.empty()}});
    });
    await page.evaluate(() => { syncFromSheet(); }); await page.waitForTimeout(50);
    await page.evaluate(() => { tenants[0].name = 'keep edit'; save(); }); await page.waitForTimeout(300);
    assert.equal((await state(page)).tenants[0].name, 'keep edit'); await context.close();
  });
  await run('corrupted startup remains usable and raw storage is untouched', async () => {
    const {page, context, errors} = await pageFor({tenants: {}, bills: []});
    assert.ok(await page.locator('#data-notice').isVisible());
    await page.evaluate(() => save());
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(RentalCore.STATE_KEY)).tenants instanceof Array), false);
    assert.deepEqual(errors, []); await context.close();
  });
  await run('keyboard modal and zero-interest loan input', async () => {
    const {page, context, errors} = await pageFor();
    await page.evaluate(() => openAddLoan()); await page.locator('#inp-loan-name').fill('무이자');
    await page.locator('#inp-loan-principal').fill('100000'); await page.locator('#inp-loan-rate').fill('0');
    await page.evaluate(() => saveLoan()); assert.equal((await state(page)).loans.length, 2);
    await page.evaluate(() => openAddLoan()); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal-loan').isVisible(), false); assert.deepEqual(errors, []); await context.close();
  });
  await run('waste-only settlement and negative input rejection', async () => {
    const {page, context, errors} = await pageFor(); await page.locator('#nav-settlement').click();
    await page.locator('#sett-waste').fill('-10'); await page.evaluate(() => calcSettlement());
    assert.equal(await page.locator('#sett-step2').isVisible(), false);
    await page.locator('#sett-waste').fill('10000'); await page.evaluate(() => calcSettlement());
    assert.ok(await page.locator('#sett-step2').isVisible());
    await page.evaluate(() => confirmSettlement());
    assert.equal(Object.values((await state(page)).bills)[0].t1.waste, 5000); assert.deepEqual(errors, []); await context.close();
  });
  await run('saved bill charges survive tenant edits in summary, editor and message', async () => {
    const {page, context, errors} = await pageFor();
    await page.evaluate(() => goToHistory('t1')); await page.waitForTimeout(100);
    await page.evaluate(() => saveBill());
    const total = await page.evaluate(() => calcSaved(tenants[0], bills[mk()].t1));
    await page.evaluate(() => { tenants[0].rent = 2000000; tenants[0].mgmt = 200000; tenants[0].elevator = 60000; return save().then(()=>renderHistContent()); });
    assert.equal(await page.evaluate(() => calcSaved(tenants[0], bills[mk()].t1)), total);
    assert.ok((await page.locator('#hist-content').innerText()).includes('1,100,000'));
    await page.evaluate(() => editThisMonth());
    assert.ok((await page.locator('#bill-total-display').innerText()).includes('1,243,000'));
    await page.evaluate(() => previewKakao());
    assert.ok((await page.locator('#kakao-text').innerText()).includes('월세 : 1,100,000원'));
    assert.deepEqual(errors, []); await context.close();
  });
  await run('settlement elevator allocation is actually saved to each bill', async () => {
    const {page, context, errors} = await pageFor(); await page.locator('#nav-settlement').click();
    await page.locator('#sett-elev').fill('150000'); await page.evaluate(() => { calcSettlement(); return confirmSettlement(); });
    assert.equal(Object.values((await state(page)).bills)[0].t1.elevatorTotal, 75000);
    await page.evaluate(() => goToHistory('t1')); await page.waitForTimeout(100);
    assert.ok((await page.locator('#hist-content').innerText()).includes('75,000'));
    assert.deepEqual(errors, []); await context.close();
  });
  await run('another tab changing app data blocks stale writes', async () => {
    const {page, context} = await pageFor();
    const other = await context.newPage(); await other.goto(TEST_URL);
    await other.evaluate(() => { tenants[0].name = 'newer tab'; return save(); });
    await page.waitForTimeout(50); await page.evaluate(() => { tenants[0].name = 'stale tab'; return save(); });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(RentalCore.STATE_KEY)).tenants[0].name), 'newer tab');
    assert.ok(await page.locator('#data-notice').isVisible()); await context.close();
  });
  await run('storage quota failure leaves prior data and a persistent notice', async () => {
    const {page, context} = await pageFor();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === RentalCore.STATE_KEY) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
      tenants[0].name = 'unsaved'; return save();
    });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(RentalCore.STATE_KEY)).tenants[0].name), '김테스트');
    assert.ok(await page.locator('#data-notice').isVisible()); await context.close();
  });
  await run('tenant add, edit, delete and recovery preserve the full record', async () => {
    const {page, context, errors} = await pageFor(core.empty());
    await page.locator('#nav-tenants').click(); await page.getByRole('button', {name: '＋ 세입자 추가'}).click();
    await page.locator('#inp-name').fill('새 세입자'); await page.locator('#inp-unit').fill('401호');
    await page.locator('#inp-biz').fill('연구실 & 스튜디오'); await page.locator('#inp-rent').fill('1500000');
    await page.evaluate(() => saveTenant());
    let data = await state(page); assert.equal(data.tenants.length, 1); const id = data.tenants[0].id;
    await page.evaluate(id => editTenant(id), id); await page.locator('#inp-biz').fill('수정 연구실');
    await page.evaluate(() => saveTenant()); data = await state(page);
    assert.equal(data.tenants[0].id, id); assert.equal(data.tenants[0].biz, '수정 연구실');
    await page.evaluate(id => deleteTenant(id), id); assert.equal((await state(page)).tenants.length, 0);
    await page.evaluate(() => restoreRecovery()); assert.deepEqual((await state(page)).tenants, data.tenants);
    assert.deepEqual(errors, []); await context.close();
  });
  await run('changing tenants never carries the previous draft into displayed total', async () => {
    const {page, context} = await pageFor(); await page.evaluate(() => goToHistory('t1')); await page.waitForTimeout(100);
    await page.locator('#bill-electricity').fill('900000');
    await page.evaluate(() => selectHistTenant('t2'));
    assert.equal(await page.locator('#bill-electricity').inputValue(), '');
    assert.ok((await page.locator('#bill-total-display').innerText()).includes('1,463,000')); await context.close();
  });
  await browser.close();
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
  if (results.some(r => r.status === 'fail')) process.exitCode = 1;
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exitCode = 1; });
