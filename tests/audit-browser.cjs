/* Operational regressions use disposable browser contexts and mock cloud responses. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../assets/core.js');
const billing=require('../assets/billing.js');
const TEST_URL=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4173/';
const out=path.resolve(__dirname,'../test-results');
fs.mkdirSync(out,{recursive:true});
const results=[];
const day=new Date(),year=day.getFullYear(),month=day.getMonth()+1;
const key=`${year}-${String(month).padStart(2,'0')}`;
const past=`${year-1}-02`;
const receipt=`${year-1}.02.15`;
const tenant={id:'audit1',name:'감사 세입자',biz:'검증 업체',unit:'201호',payday:'15일',rent:100000,mgmt:10000,elevator:0};
const sample=()=>({...core.empty(),tenants:[{...tenant}],bills:{[past]:{audit1:billing.freezeBill(tenant,{electricity:35000,water:10000},past)}}});
let browser,runtimeErrors=[];
const cases=[];
const test=(name,fn)=>cases.push({name,fn});
async function open(data=sample(),options={}) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000},...options});
  context.setDefaultTimeout(10000);
  context.on('page',page=>page.on('pageerror',e=>runtimeErrors.push(e.message)));
  const errors=[],requests=[];
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(TEST_URL))return route.continue();
    requests.push({url:route.request().url(),method:route.request().method()});return route.abort();
  });
  await context.addInitScript(({data,stateKey,origin})=>{
    if(location.origin!==origin||!['http:','https:'].includes(location.protocol))return;
    if(!localStorage.getItem(stateKey))localStorage.setItem(stateKey,JSON.stringify(data));
  },{data,stateKey:core.STATE_KEY,origin:new URL(TEST_URL).origin});
  const page=await context.newPage();
  page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(TEST_URL);await page.locator('#section-home.active').waitFor();
  return {page,context,errors,requests};
}
async function history(page,id='audit1',billMonth=past,edit=false) {
  await page.evaluate(({id,billMonth})=>goToBill(id,billMonth),{id,billMonth});
  if(edit)await page.evaluate(()=>editThisMonth());
  await page.locator(edit?'#bill-total-display':'#hist-content').waitFor();
}
async function exportBackup(page) {
  const pending=page.waitForEvent('download');await page.evaluate(()=>exportData());
  const file=await pending;return JSON.parse(fs.readFileSync(await file.path(),'utf8'));
}
async function failStorage(page,storageKey) {
  await page.evaluate(storageKey=>{
    window.originalStorageWrite=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key===storageKey)throw new DOMException('test quota','QuotaExceededError');
      return window.originalStorageWrite.call(this,key,value);
    };
  },storageKey);
}
test('failed bill save preserves committed data and exports unsaved input',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  const before=await page.evaluate(()=>localStorage.getItem(RentalCore.STATE_KEY));
  await page.locator('#bill-electricity').fill('45678');await failStorage(page,core.STATE_KEY);
  await page.evaluate(()=>saveBill());
  assert.equal(await page.evaluate(()=>localStorage.getItem(RentalCore.STATE_KEY)),before);
  assert.equal(await page.evaluate(past=>bills[past].audit1.electricity,past),35000);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'45678');
  assert.equal((await exportBackup(page)).bills[past].audit1.electricity,45678);
  assert.match(await page.locator('#data-notice').innerText(),/저장하지 못해/);
});
test('reset and recovery round trip retains unfinished bill drafts',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('65432');
  await page.evaluate(()=>flushBillDraft());await page.evaluate(()=>resetAllData());
  await page.evaluate(()=>restoreRecovery());await history(page,'audit1',past,true);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'65432');
});
test('imported drafts remain exportable and warning visible when draft storage fails',async()=>{
  const {page}=await open();
  const draftKey=past+':audit1';
  const baseline=await page.evaluate(past=>JSON.stringify(bills[past].audit1),past);
  const drafts={[draftKey]:{fields:{electricity:'54321'},baseline,updatedAt:new Date().toISOString()}};
  await failStorage(page,'rentalApp.billDrafts.v1');
  await page.evaluate(({drafts})=>replaceData(currentData(),'test import',drafts),{drafts});
  assert.match(await page.locator('#data-notice').innerText(),/초안/);
  assert.equal((await exportBackup(page)).localDrafts[draftKey].fields.electricity,'54321');
});
test('cloud import recovery retains the local draft it replaced',async()=>{
  const {page,context}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('77777');await page.evaluate(()=>flushBillDraft());
  await context.route('https://script.google.com/**',r=>r.fulfill({json:{status:'ok',data:core.empty()}}));
  await page.evaluate(()=>syncFromSheet());await page.evaluate(()=>restoreRecovery());
  await history(page,'audit1',past,true);assert.equal(await page.locator('#bill-electricity').inputValue(),'77777');
});
test('orphan historical bill supports receipt confirmation and reload',async()=>{
  const data=sample();data.tenants=[];const {page}=await open(data);
  await history(page);await page.evaluate(()=>stampBill('rent'));
  await page.locator('#stamp-date').fill(receipt.replaceAll('.','-'));await page.evaluate(()=>saveStamp());
  assert.equal(await page.evaluate(past=>bills[past].audit1.stampedRent,past),true);
  await page.reload();assert.equal(await page.evaluate(past=>bills[past].audit1.stampedRentDate,past),receipt);
});
test('re-settlement invalidates changed receipts but retains unaffected payments',async()=>{
  const data=sample();data.bills[key]={audit1:billing.freezeBill(tenant,{water:10000,electricity:35000,elevatorTotal:50000,waste:1000,stampedMgmt:true,stampedMgmtDate:receipt,stampedRent:true,stampedRentDate:receipt,invoiceIssued:true},key)};
  const {page}=await open(data);await page.locator('#nav-settlement').click();
  await page.locator('#sett-elev').fill('60000');await page.locator('#sett-waste').fill('1000');
  await page.evaluate(()=>calcSettlement());await page.evaluate(()=>confirmSettlement());
  const state=await page.evaluate(()=>RentalBilling.payment(tenants[0],bills[mk()].audit1));
  assert.equal(state.items.pay_elev.paid,false);assert.equal(state.items.pay_elec.paid,true,JSON.stringify(state));
  assert.equal(state.items.pay_mgmt.paid,true,JSON.stringify(state));assert.equal(state.items.pay_rent.paid,true);
  assert.equal(await page.evaluate(()=>bills[mk()].audit1.invoiceIssued),false);
  assert.equal(await page.evaluate(()=>settInputs[mk()].confirmed),true);
});
test('individual payment edit under group stamp preserves other receipt dates',async()=>{
  const data=sample();Object.assign(data.bills[past].audit1,{stampedMgmt:true,stampedMgmtDate:receipt});
  const {page}=await open(data);await history(page,'audit1',past,true);
  const earlier=`${year-1}.02.14`;
  await page.evaluate(date=>updatePay('pay_water','date',date),earlier);
  const state=await page.evaluate(past=>RentalBilling.payment(tenants[0],bills[past].audit1),past);
  assert.equal(state.items.pay_water.date,earlier);assert.equal(state.items.pay_elec.date,receipt);
  await page.reload();assert.equal(await page.evaluate(past=>bills[past].audit1.paid.pay_water.date,past),earlier);
});
test('archiving retains historical totals and excludes tenant from new settlements',async()=>{
  const {page}=await open();const total=await page.evaluate(()=>RentalBilling.arrears(tenants,bills).total);
  await page.evaluate(()=>deleteTenant('audit1'));assert.equal(await page.evaluate(()=>activeTenants().length),0);
  assert.equal(await page.evaluate(()=>RentalBilling.arrears(tenants,bills).total),total);
  await history(page);assert.match(await page.locator('#hist-content').innerText(),/검증 업체/);
  await page.reload();assert.equal(await page.evaluate(()=>tenants[0].archived),true);
});
test('legacy cloud server blocks POST without losing local changes',async()=>{
  const {page,context}=await open();const methods=[];
  await context.route('https://script.google.com/**',r=>{methods.push(r.request().method());return r.fulfill({json:{status:'ok',data:sample()}});});
  await page.evaluate(async()=>{setCloudEnabled(true);tenants[0].name='local retained';await save();await manualSync();});
  assert.deepEqual(methods,['GET']);assert.match(await page.locator('#data-notice').innerText(),/버전 비교/);
  await page.reload();assert.equal(await page.evaluate(()=>tenants[0].name),'local retained');
  assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('remote revision conflict blocks POST and retains pending state across reload',async()=>{
  const data=sample();data.localMeta={cloudPending:true,cloudBaseRevision:'r1'};
  const {page,context}=await open(data);const methods=[];
  await context.route('https://script.google.com/**',r=>{methods.push(r.request().method());return r.fulfill({json:{status:'ok',data:sample(),revision:'r2',capabilities:{conditionalWrite:true}}});});
  await page.evaluate(async()=>{setCloudEnabled(true);await manualSync();});
  assert.deepEqual(methods,['GET']);assert.match(await page.locator('#data-notice').innerText(),/다른 기기/);
  await page.reload();assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('unverified cloud acknowledgement never reports saved',async()=>{
  const data=sample();data.localMeta={cloudPending:true,cloudBaseRevision:'r1'};
  const {page,context}=await open(data);
  await context.route('https://script.google.com/**',r=>r.fulfill({json:r.request().method()==='GET'?{status:'ok',data:sample(),revision:'r1',capabilities:{conditionalWrite:true}}:{status:'ok',revision:'r2',requestId:'wrong-id',capabilities:{conditionalWrite:true}}}));
  await page.evaluate(async()=>{setCloudEnabled(true);await manualSync();});
  assert.match(await page.locator('#data-notice').innerText(),/검증하지 못/);
  assert.equal(await page.evaluate(()=>cloudDirty),true);await page.reload();assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('cloud response cannot replace an unsaved form edited during download',async()=>{
  const {page,context}=await open();await history(page,'audit1',past,true);
  let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  await context.route('https://script.google.com/**',async r=>{entered();await wait;await r.fulfill({json:{status:'ok',data:core.empty()}});});
  await page.evaluate(()=>{void syncFromSheet();});await started;
  await page.locator('#bill-electricity').fill('88888');release();
  await page.waitForFunction(()=>!syncBusy);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'88888');
  assert.equal(await page.evaluate(()=>tenants.length),1);assert.match(await page.locator('#data-notice').innerText(),/편집/);
});
test('simultaneous tab saves accept one writer and retain the losing candidate for export',async()=>{
  const {page,context}=await open(),other=await context.newPage();other.on('dialog',d=>d.accept());
  await other.goto(TEST_URL);await other.locator('#section-home.active').waitFor();
  const result=await Promise.all([page.evaluate(async()=>{tenants[0].name='writer A';return save();}),other.evaluate(async()=>{tenants[0].name='writer B';return save();})]);
  assert.equal(result.filter(Boolean).length,1);
  const loser=result[0]?other:page;const expected=result[0]?'writer B':'writer A';
  assert.equal((await exportBackup(loser)).tenants[0].name,expected);
});
test('stale drafts are retained for export without overwriting newer saved bills',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('99999');await page.evaluate(()=>flushBillDraft());
  await page.evaluate(async past=>{bills[past].audit1.electricity=22222;await save();},past);
  await page.reload();await history(page,'audit1',past,true);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'22222');
  assert.match(await page.locator('#bill-draft-state').innerText(),/자동 적용하지/);
  assert.equal((await exportBackup(page)).localDrafts[past+':audit1'].fields.electricity,'99999');
});
test('failed receipt date save restores the receipt field and keeps amount input',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('45678');await failStorage(page,core.STATE_KEY);
  const input=page.locator('input[onchange*="pay_water"]');
  await input.fill(receipt);await input.press('Tab');
  await page.waitForFunction(()=>!persistenceBusy&&!!storageFault);
  assert.equal(await input.inputValue(),'');
  assert.equal(await page.locator('#bill-electricity').inputValue(),'45678');
});
test('failed receipt invoice save restores the visible checkbox',async()=>{
  const {page}=await open();await history(page);await failStorage(page,core.STATE_KEY);
  const input=page.locator('.invoice-check input');await input.check();
  await page.waitForFunction(()=>!persistenceBusy&&!!storageFault);
  assert.equal(await input.isChecked(),false);
});
test('CSV escapes formula-like tenant names and uses historical identity',async()=>{
  const data=sample();data.tenants[0].name='=2+3';data.tenants[0].biz='';
  data.bills[key]={audit1:billing.freezeBill(data.tenants[0],{rent:100000,mgmt:10000},key)};
  const {page}=await open(data);await page.evaluate(()=>{tenants[0].name='changed';});
  const pending=page.waitForEvent('download');await page.evaluate(()=>exportMonthCsv());
  const file=await pending;const csv=fs.readFileSync(await file.path(),'utf8');
  assert.ok(csv.includes('"\'=2+3"'));assert.ok(!csv.includes('changed'));assert.ok(csv.includes('110000'));
});
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    for(const {name,fn} of cases.filter(c=>!process.env.RENTAL_CASE||c.name.includes(process.env.RENTAL_CASE))){
      runtimeErrors=[];
      try{await fn();assert.deepEqual(runtimeErrors,[]);results.push({name,status:'pass'});console.log('PASS '+name);}
      catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}
      finally{await Promise.all(browser.contexts().map(c=>c.close()));}
    }
  } finally {
    await browser.close();fs.writeFileSync(path.join(out,'audit-browser-results.json'),JSON.stringify(results,null,2));
  }
  if(results.some(r=>r.status==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
