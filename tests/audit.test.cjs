const test=require('node:test'),assert=require('node:assert/strict');
const b=require('../assets/billing.js'),c=require('../assets/core.js');
const tenant={id:'t1',name:'원래 업체',biz:'원래 상호',unit:'201',payday:'15일',rent:100000,mgmt:10000,elevator:0};
const fixture=()=>({...c.empty(),tenants:[{...tenant}],bills:{'2026-09':{t1:{rent:100000,mgmt:10000}}}});
function storage(){const map=new Map();return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v)};}
test('rent and month-end management become overdue only on the next calendar day',()=>{
 for(const [day,status] of [[14,'notDue'],[15,'notDue'],[16,'overdue']])
  assert.equal(b.historicalPayment(tenant,{rent:100000},2026,9,'2026-09-'+day).items.pay_rent.status,status);
 assert.equal(b.historicalPayment(tenant,{},2024,2,'2024-02-29').items.pay_mgmt.status,'notDue');
 assert.equal(b.historicalPayment(tenant,{},2024,2,'2024-03-01').items.pay_mgmt.status,'overdue');
});
test('historical receipt is counted only on and after the actual receipt date',()=>{
 const bill={paid:{pay_rent:{date:'2026.10.01'}}};
 assert.equal(b.historicalPayment(tenant,bill,2026,9,'2026-09-20').overdue,110000);
 assert.equal(b.historicalPayment(tenant,bill,2026,9,'2026-10-01').received,110000);
 assert.equal(b.historicalPayment(tenant,bill,2026,9,'2026-10-01').overdue,11000);
});
test('short legacy dates are interpreted in the bill year',()=>{
 const bill={stampedRent:true,stampedRentDate:'09/02',monthSnapshot:'2025-09'};
 assert.equal(b.historicalPayment(tenant,bill,2025,9,'2025-09-01').items.pay_rent.paid,false);
 assert.equal(b.historicalPayment(tenant,bill,2025,9,'2026-01-01').items.pay_rent.date,'2025.09.02');
});
test('blank and malformed payday text does not create invented arrears',()=>{
 for(const payday of ['','2026/09/15','115일','0일','32일','15 또는 20일'])
  assert.equal(b.dueDate({payday},'pay_rent',2026,9),'');
 assert.equal(b.historicalPayment({...tenant,payday:''},{},2026,9,'2026-10-01').unknownDue,110000);
});
test('saved contract, amounts, unit and due date survive current tenant changes',()=>{
 const bill=b.freezeBill(tenant,{},'2026-09');
 const changed={...tenant,name:'다른 이름',rent:900000,mgmt:20000,unit:'101',payday:'28일'};
 assert.equal(b.historicalPayment(changed,bill,2026,9,'2026-09-20').overdue,110000);
 assert.equal(b.effectiveTenant(changed,bill).name,'원래 업체');
 assert.equal(b.charges(changed,bill).pay_rent,110000);
});
test('legacy snapshot fills are marked as estimates and not overwritten later',()=>{
 const bill=b.freezeBill(tenant,{rent:80000},'2025-09',true);
 assert.ok(!bill.snapshotEstimated.includes('rent'));
 assert.ok(bill.snapshotEstimated.includes('mgmt'));
 b.freezeBill({...tenant,mgmt:50000},bill,'2025-09',true);
 assert.equal(bill.mgmt,10000);
});
test('NA fields and line exemption flags agree across payment groups',()=>{
 const state=b.payment(tenant,{electricity:35000,electricityNA:true,paid:{pay_rent:{na:true}}},'2026-09-20');
 assert.equal(state.items.pay_elec.na,true);
 assert.equal(state.groups.rent.total,0);
 assert.equal(state.groups.mgmt.total,11000);
 assert.equal(state.total,11000);
});
test('changing one confirmed charge clears only that receipt and tax-invoice flag',()=>{
 const before={electricity:35000,water:10000,stampedMgmt:true,stampedMgmtDate:'2026.09.01',invoiceIssued:true};
 const after=structuredClone(before);after.water=20000;
 assert.deepEqual(b.invalidateChangedPayments(tenant,before,after),['pay_water']);
 const state=b.payment(tenant,after,'2026-09-20');
 assert.equal(state.items.pay_water.paid,false);
 assert.equal(state.items.pay_elec.paid,true);
 assert.equal(state.items.pay_mgmt.paid,true);
 assert.equal(after.stampedMgmt,false);assert.equal(after.invoiceIssued,false);
});
test('unchanged bill edits retain stamps and individual dates',()=>{
 const before={stampedRent:true,stampedRentDate:'2026.09.01',water:500};
 const after={...before,waterMeter:42};
 assert.deepEqual(b.invalidateChangedPayments(tenant,before,after),[]);
 assert.equal(after.stampedRent,true);
});
test('individual override can retain other dated group confirmations',()=>{
 const bill={water:500,stampedMgmt:true,stampedMgmtDate:'2026.09.01'};
 b.materializeGroup(tenant,bill,'pay_water');bill.paid.pay_water.date='2026.08.31';
 const state=b.payment(tenant,bill,'2026-09-20');
 assert.equal(state.items.pay_water.date,'2026.08.31');
 assert.equal(state.items.pay_mgmt.date,'2026.09.01');
 assert.equal(state.groups.mgmt.complete,true);
});
test('archived and orphan saved bills remain in arrears totals',()=>{
 const bill=b.freezeBill(tenant,{rent:100000,mgmt:10000},'2026-08');
 assert.equal(b.arrears([{...tenant,archived:true}],{'2026-08':{t1:bill}},'2026-09-20').total,121000);
 assert.equal(b.arrears([],{'2026-08':{t1:bill}},'2026-09-20').total,121000);
});
test('payment conservation holds for every exemption and confirmation combination',()=>{
 for(let mask=0;mask<64;mask++) {
  const bill={electricity:35000,water:17,waste:31,elevatorTotal:50001,paid:{}};
  b.itemKeys.forEach((key,i)=>bill.paid[key]={na:!!(mask&(1<<i)),date:i%2?'2026.09.01':''});
  const state=b.payment(tenant,bill,'2026-09-20');
  assert.equal(state.total,state.received+state.unpaid);
  assert.equal(state.total,state.groups.rent.total+state.groups.mgmt.total);
  assert.equal(state.received,state.groups.rent.received+state.groups.mgmt.received);
 }
});
test('bill boolean flags and payment dates are validated before loading',()=>{
 for(const fragment of [{stampedRent:'false'},{electricityNA:'true'},{paid:{pay_rent:{date:'2026-02-30'}}},{paid:{pay_elec:{na:1}}},{paid:{unknown:{date:'09/01'}}}]){
  const data=fixture();data.bills['2026-09'].t1=fragment;assert.throws(()=>c.validateData(data));
 }
});
test('monetary values reject fractional and unsafe amounts but meters and rates allow decimals',()=>{
 for(const amount of [1.5,Number.MAX_SAFE_INTEGER,-1]){
  const data=fixture();data.tenants[0].rent=amount;assert.throws(()=>c.validateData(data));
 }
 const data=fixture();data.bills['2026-09'].t1.waterMeter=3.5;data.loans=[{id:'l1',name:'대출',principal:100000,rate:3.25}];
 assert.doesNotThrow(()=>c.validateData(data));
});
test('duplicate meter months and impossible meter dates are rejected',()=>{
 for(const rows of [[{mk:'2026-09',date:'09/20',val:1},{mk:'2026-09',date:'09/21',val:2}],[{mk:'2026-02',date:'02/30',val:1}]]){
  const data=fixture();data.tenants[0].waterHistory=rows;assert.throws(()=>c.validateData(data));
 }
});
test('validation does not mutate imported numeric string ratios',()=>{
 const data=fixture();data.waterRatio.r2='19';c.validateData(data);assert.equal(data.waterRatio.r2,'19');
});
test('stale write is rejected even before a storage event arrives',()=>{
 const s=storage(),token=c.storageToken(s);c.persistChecked(s,fixture(),token,{cloudPending:true});
 assert.throws(()=>c.persistChecked(s,c.empty(),token),/다른 창/);
 assert.equal(c.load(s).data.tenants.length,1);
});
test('pending cloud metadata and domain data persist together in one write',()=>{
 const s=storage();let writes=0,original=s.setItem;s.setItem=(...args)=>{writes++;original(...args)};
 c.persistChecked(s,fixture(),c.storageToken(s),{cloudPending:true,cloudBaseRevision:'r1'});
 assert.equal(writes,1);assert.equal(c.load(s).meta.cloudPending,true);assert.equal(c.load(s).meta.cloudBaseRevision,'r1');
});
test('backups preserve optional compatibility fields on bill and tenant records',()=>{
 const data=fixture();data.tenants[0].archived=true;data.bills['2026-09'].t1.customLegacyField='keep';
 assert.equal(c.validateData(c.envelope(data)).bills['2026-09'].t1.customLegacyField,'keep');
});
test('legacy tenants default to active lease only at the display boundary',()=>{
 const data=fixture(),validated=c.validateData(data);
 assert.equal(c.leaseStatus(validated.tenants[0]),'임대중');
 assert.equal(Object.hasOwn(validated.tenants[0],'leaseStatus'),false);
});
test('tenant lease status, deposit and compatible audit changes are validated and preserved',()=>{
 const data=fixture();data.tenants[0].leaseStatus='명도소송중';data.tenants[0].deposit=50000000;
 data.tenants[0].audit=[{at:'2026-09-17T00:00:00.000Z',action:'임차인 정보 변경',detail:'임대상태 변경',changes:{leaseStatus:{from:'임대중',to:'명도소송중'}}}];
 const validated=c.validateData(data);assert.equal(validated.tenants[0].leaseStatus,'명도소송중');assert.equal(validated.tenants[0].deposit,50000000);assert.equal(validated.tenants[0].audit[0].changes.leaseStatus.to,'명도소송중');
 for(const invalid of ['퇴거예정','',null]){const copy=fixture();copy.tenants[0].leaseStatus=invalid;assert.throws(()=>c.validateData(copy));}
 const fractional=fixture();fractional.tenants[0].deposit=1.5;assert.throws(()=>c.validateData(fractional));
});
test('leap-year and year transition amounts exclude future unissued months',()=>{
 const bills={'2024-02':{t1:{rent:100000,mgmt:10000}},'2027-01':{t1:{rent:900000}}};
 assert.equal(b.arrears([{...tenant,payday:'말일'}],bills,'2024-02-29').total,0);
 assert.equal(b.arrears([{...tenant,payday:'말일'}],bills,'2024-03-01').total,121000);
});

