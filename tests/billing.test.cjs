const test=require('node:test'),assert=require('node:assert/strict');
const b=require('../assets/billing.js');
const tenants=[1,2,3,4].map(f=>({id:'t'+f,name:'층'+f,unit:f+'01호',rent:1000000,mgmt:100000,elevator:50000}));
const input={elec:115000,waterTotal:300000,waterUsage:177,waterF1:41,elev:150001,elevMode:'gross',waste:100003};
const ratio={r2:19,r3:10,r4:5};
test('electricity preserves 35000 supply +3500 VAT for floors 2 and 3',()=>{
 const r=b.calculate(tenants,input,ratio);assert.deepEqual(r.rows.map(x=>x.elec),[0,35000,35000,45000]);assert.equal(b.withVat(r.rows[1].elec),38500);
});
test('all allocations equal original actual expenses down to the last won',()=>{
 const r=b.calculate(tenants,input,ratio);assert.equal(b.reconcile(r).balanced,true);assert.equal(r.rows.reduce((s,r)=>s+r.elev,0),150001);assert.equal(r.rows.reduce((s,r)=>s+r.waste,0),100003);
});
test('no lost won across many equal and weighted allocations',()=>{
 for(let total=0;total<10000;total+=7)for(const weights of [[1,1,1],[1,1,1,1],[19,10,5],[0,10,5]])assert.equal(b.distribute(total,weights).reduce((a,b)=>a+b,0),total);
});
test('elevator supply input explicitly adds tax, gross input does not',()=>{
 assert.equal(b.calculate(tenants,{...input,elev:150000,elevMode:'net'},ratio).expected.elev,165000);assert.equal(b.calculate(tenants,{...input,elev:150000},ratio).expected.elev,150000);
});
test('mismatched manual allocation prevents finalization',()=>{const r=b.calculate(tenants,input,ratio);r.rows[1].elev++;assert.equal(b.reconcile(r).balanced,false);});
test('invalid floors, fractional won and electricity below fixed totals are rejected',()=>{
 assert.throws(()=>b.calculate(tenants,{...input,elec:60000},ratio));assert.throws(()=>b.calculate([...tenants,tenants[0]],input,ratio));assert.throws(()=>b.won(1.5));
});
test('payment stamps settle their groups using selected dates',()=>{
 const s=b.payment(tenants[1],{stampedRent:true,stampedRentDate:'2026.09.02',stampedMgmt:true,stampedMgmtDate:'2026.09.07',electricity:35000,elevatorTotal:50001,water:19000,waste:12500});
 assert.equal(s.unpaid,0);assert.equal(s.items.pay_elev.date,'2026.09.07');assert.equal(s.items.pay_rent.date,'2026.09.02');
});
test('legacy elevator supply and new elevator actual totals remain compatible',()=>{
 assert.equal(b.charges(tenants[1],{elevator:50000}).pay_elev,55000);assert.equal(b.charges(tenants[1],{elevatorTotal:50000}).pay_elev,50000);
});
test('real dates, leap days and monthly boundary periods',()=>{
 assert.equal(b.dateISO('2024.02.29'),'2024-02-29');assert.equal(b.dateISO('2026-02-29'),'');assert.equal(b.period(1,2026,1),'12/01~12/31');assert.equal(b.period(31,2026,3),'02/28~03/30');
});
test('contract deadlines use date-only boundaries for every warning threshold',()=>{
 const today='2026-09-17',contract=days=>`2026/01/01 ~ ${new Date(Date.UTC(2026,8,17+days)).toISOString().slice(0,10)}`;
 for(const [days,level,label] of [[100,'none','D-100'],[45,'check','D-45'],[44,'check','D-44'],[30,'imminent','D-30'],[1,'imminent','D-1'],[0,'imminent','오늘 만료'],[-1,'overdue','D+1 경과']]){
   assert.deepEqual(b.contractDeadline(contract(days),today),{endDate:contract(days).split(' ~ ')[1],days,label,level});
 }
 assert.equal(b.contractDeadline('',today),null);assert.equal(b.contractDeadline('잘못된 계약',today),null);
 // A renewed current contract replaces the old period, so its new end date does not warn.
 assert.equal(b.contractDeadline(contract(100),today).level,'none');
});
test('due dates clamp rent payday to month length and management to month end',()=>{
 const tenant={payday:'매월 31일'};
 assert.equal(b.dueDate(tenant,'pay_rent',2026,2),'2026-02-28');
 assert.equal(b.dueDate(tenant,'pay_mgmt',2024,2),'2024-02-29');
 assert.equal(b.dueDate({},'pay_rent',2026,9),'');
 assert.equal(b.dueDate({payday:'월말'},'pay_rent',2024,2),'2024-02-29');
});
test('historical payment separates not-due, overdue, paid and exempt amounts',()=>{
 const tenant={id:'due1',name:'지급일 테스트',unit:'101호',payday:'매월 15일',rent:100000,mgmt:10000,elevator:0};
 const bill={rent:100000,mgmt:10000,electricity:30000,water:10000,
   paid:{pay_elec:{date:'2026.09.10'},pay_water:{na:true}}};
 const before=b.historicalPayment(tenant,bill,2026,9,new Date(2026,8,14));
 assert.equal(before.items.pay_rent.status,'notDue');assert.equal(before.items.pay_mgmt.status,'notDue');
 assert.equal(before.items.pay_elec.status,'paid');assert.equal(before.items.pay_water.status,'exempt');
 assert.equal(before.overdue,0);assert.equal(before.notDue,b.withVat(100000)+b.withVat(10000));
 const after=b.historicalPayment(tenant,bill,2026,9,new Date(2026,9,1));
 assert.equal(after.items.pay_rent.status,'overdue');assert.equal(after.items.pay_mgmt.status,'overdue');
 assert.equal(after.overdue,b.withVat(100000)+b.withVat(10000));
});
test('arrears aggregates only saved past bills and excludes future months',()=>{
 const tenants=[{id:'a',name:'A',biz:'상점 A',unit:'101호',payday:'15일',rent:100000,mgmt:10000},
   {id:'b',name:'B',unit:'201호',payday:'15일',rent:100000,mgmt:10000}];
 const bills={
   '2026-08':{a:{rent:100000,mgmt:10000}},
   '2026-09':{a:{rent:100000,mgmt:10000,stampedRent:true,stampedRentDate:'2026.09.15'}},
   '2026-10':{a:{rent:100000,mgmt:10000}}
 };
 const result=b.arrears(tenants,bills,new Date(2026,8,30));
 assert.equal(result.total,121000); // September charges are not overdue on their due date.
 assert.equal(b.arrears(tenants,bills,new Date(2026,9,1)).total,132000);
 assert.equal(result.tenantCount,1);assert.equal(result.monthCount,1);
 assert.equal(result.tenants[0].id,'a');assert.deepEqual(result.tenants[0].months.map(x=>x.month),['2026-08']);
});
test('collection status derives all four labels from saved bills and due dates',()=>{
 const tenant={id:'status',name:'상태',unit:'201호',payday:'15일',rent:100000,mgmt:10000,elevator:0};
 const base={'2026-09':{status:{rent:100000,mgmt:10000,electricity:30000,water:10000}}};
 assert.equal(b.collectionStatus(tenant,base,'2026-09-15').status,'정상');
 assert.equal(b.collectionStatus(tenant,base,'2026-10-01').status,'월차임·공과금 연체');
 const rentPaid=structuredClone(base);rentPaid['2026-09'].status.paid={pay_rent:{date:'2026.09.15'}};
 assert.equal(b.collectionStatus(tenant,rentPaid,'2026-10-01').status,'공과금 연체');
 const utilitiesPaid=structuredClone(base);utilitiesPaid['2026-09'].status.stampedMgmt=true;utilitiesPaid['2026-09'].status.stampedMgmtDate='2026.09.30';
 assert.equal(b.collectionStatus(tenant,utilitiesPaid,'2026-10-01').status,'월차임 연체');
});
test('collection status keeps unknown due amounts out of arrears and reports recent payment',()=>{
 const tenant={id:'status2',name:'상태2',unit:'301호',payday:'',rent:100000,mgmt:10000,elevator:0};
 const bills={'2026-08':{status2:{rent:100000,mgmt:10000,paid:{pay_mgmt:{date:'2026.09.03'}}}},'2026-11':{status2:{rent:900000}}};
 const result=b.collectionStatus(tenant,bills,'2026-09-20');
 assert.equal(result.status,'정상');assert.equal(result.overdueRent,0);assert.equal(result.unknownDue,110000);
 assert.equal(result.lastPaymentDate,'2026-09-03');assert.equal(result.billCount,1);
});
