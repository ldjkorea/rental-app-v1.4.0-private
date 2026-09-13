/* Monetary and payment rules. No DOM, network, or persistence dependencies. */
(function (root) {
  'use strict';
  const won = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) throw new Error('금액은 0 이상의 원 단위 정수로 입력해주세요.');
    return n;
  };
  const withVat = value => Number(value || 0) + Math.round(Number(value || 0) / 10);
  const floorOf = unit => { const n = Number(String(unit || '').match(/^\d+/)?.[0] || 0); return n >= 100 ? Math.floor(n / 100) : n; };
  function distribute(total, weights) {
    total = won(total);
    if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0) || weights.reduce((a,b) => a+b,0) <= 0)
      throw new Error('배분 대상과 비율을 확인해주세요.');
    const sum = weights.reduce((a,b) => a+b,0);
    const exact = weights.map(w => total * w / sum);
    const amounts = exact.map(Math.floor);
    const order = exact.map((v,i) => ({i, rest: v-amounts[i]})).sort((a,b) => b.rest-a.rest || a.i-b.i);
    let left = total - amounts.reduce((a,b) => a+b,0);
    for (let i=0; i<left; i++) amounts[order[i % order.length].i]++;
    return amounts;
  }
  function calculate(tenants, inputs, ratio) {
    if (!tenants.length) throw new Error('세입자를 먼저 등록해주세요.');
    const elec = won(inputs.elec), water = won(inputs.waterTotal), elev = won(inputs.elev), waste = won(inputs.waste);
    if (!elec && !water && !elev && !waste) throw new Error('최소 한 항목을 입력해주세요.');
    const rows = tenants.map(t => ({id:t.id, name:t.biz||t.name, unit:t.unit, floor:floorOf(t.unit), elec:null, water:null, elev:null, waste:0}));
    const floors = new Map();
    for (const row of rows) {
      if (row.floor < 1 || row.floor > 4 || floors.has(row.floor)) throw new Error('현재 배분 기준은 1~4층, 층별 세입자 1명입니다. 호수를 확인해주세요.');
      floors.set(row.floor, row);
    }
    if (elec) {
      if (![2,3,4].every(f => floors.has(f))) throw new Error('전기 배분에는 2·3·4층 세입자가 필요합니다.');
      if (elec < 70000) throw new Error('전기 공급가가 70,000원보다 작습니다. 2·3층 고정액과 원본 청구서를 확인해주세요.');
      rows.forEach(r => r.elec = r.floor === 2 || r.floor === 3 ? 35000 : r.floor === 4 ? elec-70000 : 0);
    }
    if (water) {
      const usage = Number(inputs.waterUsage), first = Number(inputs.waterF1);
      if (![1,2,3,4].every(f => floors.has(f))) throw new Error('수도 배분에는 1~4층 세입자가 필요합니다.');
      if (!Number.isFinite(usage) || usage <= 0 || !Number.isFinite(first) || first < 0 || first > usage)
        throw new Error('건물 총 사용량과 1층 사용량을 확인해주세요.');
      const firstAmount = Math.round(water * first / usage);
      const amounts = distribute(water-firstAmount, [ratio.r2,ratio.r3,ratio.r4].map(Number));
      floors.get(1).water = firstAmount;
      [2,3,4].forEach((f,i) => floors.get(f).water = amounts[i]);
    }
    const elevatorTotal = inputs.elevMode === 'net' ? withVat(elev) : elev;
    if (elev) {
      const eligible = rows.filter(r => r.floor > 1).sort((a,b) => a.floor-b.floor);
      const amounts = distribute(elevatorTotal, eligible.map(() => 1));
      rows.forEach(r => r.elev = 0);
      eligible.forEach((r,i) => r.elev = amounts[i]);
    }
    if (waste) {
      const sorted = [...rows].sort((a,b) => a.floor-b.floor);
      const amounts = distribute(waste, sorted.map(() => 1));
      sorted.forEach((r,i) => r.waste = amounts[i]);
    }
    return {rows, expected:{elec:elec ? withVat(elec):0, water, elev:elevatorTotal, waste}};
  }
  function reconcile(result) {
    const totals = {elec:0, water:0, elev:0, waste:0};
    result.rows.forEach(row => {
      for (const key of Object.keys(totals)) {
        const value = row[key] === null ? 0 : won(row[key]);
        totals[key] += key === 'elec' ? withVat(value) : value;
      }
    });
    return {totals, balanced:Object.keys(totals).every(key => totals[key] === result.expected[key])};
  }
  function charges(tenant, bill = {}) {
    const firstFloor = floorOf(bill.unitSnapshot ?? tenant.unit) === 1;
    return {
      pay_rent:withVat(bill.rent ?? tenant.rent), pay_mgmt:withVat(bill.mgmt ?? tenant.mgmt),
      pay_elec:bill.electricityNA?0:withVat(bill.electricity), pay_water:bill.waterNA?0:Number(bill.water||0),
      pay_elev:firstFloor?0:bill.elevatorTotal!=null?Number(bill.elevatorTotal):withVat(bill.elevator??tenant.elevator),
      pay_waste:bill.wasteNA?0:Number(bill.waste||0),
    };
  }
  const itemKeys = ['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'];
  const naFields = {pay_elec:'electricityNA',pay_water:'waterNA',pay_waste:'wasteNA'};
  function payment(tenant, bill = {}, asOf = new Date(), year) {
    const amounts=charges(tenant,bill), items={}, cutoff=asOfKey(asOf);
    const paymentYear=year || Number(bill.monthSnapshot?.slice(0,4)) || Number(cutoff.slice(0,4));
    let total=0,received=0,exempt=0;
    for(const [key,amount] of Object.entries(amounts)) {
      const item=bill.paid?.[key]||{},rent=key==='pay_rent';
      const stamped=(rent?bill.stampedRent:bill.stampedMgmt)===true;
      const stampDate=rent?bill.stampedRentDate:bill.stampedMgmtDate;
      const rawDate=stamped?stampDate||item.date||'':item.date||'';
      const iso=dateISO(rawDate,paymentYear);
      const na=item.na===true || bill[naFields[key]]===true || amount===0;
      const paid=!na && ((stamped&&!rawDate) || (!!iso&&iso<=cutoff));
      items[key]={amount,paid,na,date:paid?(iso?iso.replaceAll('-','.'): '날짜 미지정'):rawDate,
        undated:paid&&!iso};
      total+=amount;
      if(na)exempt+=amount;else if(paid)received+=amount;
    }
    const due=total-exempt;
    const groups={};
    for(const group of ['rent','mgmt']) {
      const keys=group==='rent'?['pay_rent']:itemKeys.filter(k=>k!=='pay_rent');
      const payable=keys.map(k=>items[k]).filter(i=>!i.na);
      const amount=payable.reduce((sum,i)=>sum+i.amount,0);
      const paidAmount=payable.filter(i=>i.paid).reduce((sum,i)=>sum+i.amount,0);
      groups[group]={total:amount,received:paidAmount,unpaid:amount-paidAmount,
        complete:amount>0&&amount===paidAmount,exempt:amount===0,
        dates:[...new Set(payable.filter(i=>i.paid).map(i=>i.date))]};
    }
    return {items,groups,total:due,received,unpaid:Math.max(0,due-received),exempt,complete:due>0&&due===received};
  }
  function materializeGroup(tenant,bill,key) {
    const flag=key==='pay_rent'?'stampedRent':'stampedMgmt';
    if(!bill[flag])return;
    const state=payment(tenant,bill);
    bill.paid??={};
    for(const itemKey of itemKeys.filter(k=>(k==='pay_rent')===(key==='pay_rent'))) {
      const item=state.items[itemKey];
      // Preserve dated confirmations for unchanged items. Undated legacy groups require review.
      if(item.paid&&!item.undated)bill.paid[itemKey]={...bill.paid[itemKey],date:item.date};
    }
    bill[flag]=false;delete bill[flag+'Date'];
  }
  function invalidateChangedPayments(tenant,before,after) {
    const oldState=payment(tenant,before),newState=payment(tenant,after),changed=[];
    for(const key of itemKeys) {
      const old=oldState.items[key],next=newState.items[key];
      if(old.amount===next.amount&&old.na===next.na)continue;
      changed.push(key);
      materializeGroup(tenant,after,key);
      if(after.paid?.[key])delete after.paid[key].date;
    }
    if(changed.length)after.invoiceIssued=false;
    return changed;
  }
  const snapshotFields=['name','biz','contract','contract_first','payday','renew','paytype',
    'period_mgmt','period_rent','period_elec','period_elev','period_waste','period_water_day','period_water_odd'];
  function freezeBill(tenant,bill,month,legacy=false) {
    const estimated=new Set(bill.snapshotEstimated||[]);
    for(const key of ['rent','mgmt','elevator'])if(bill[key]==null) {
      bill[key]=Number(tenant[key])||0;if(legacy)estimated.add(key);
    }
    if(bill.unitSnapshot==null){bill.unitSnapshot=tenant.unit||'';if(legacy)estimated.add('unit');}
    if(bill.paydaySnapshot==null){bill.paydaySnapshot=tenant.payday||'';if(legacy)estimated.add('payday');}
    bill.tenantSnapshot??={};
    for(const key of snapshotFields)if(!Object.hasOwn(bill.tenantSnapshot,key)) {
      bill.tenantSnapshot[key]=String(tenant[key]??'');if(legacy)estimated.add(key);
    }
    if(month)bill.monthSnapshot=month;
    if(estimated.size)bill.snapshotEstimated=[...estimated];
    return bill;
  }
  function effectiveTenant(tenant,bill={}) {
    return {...tenant,...bill.tenantSnapshot,unit:bill.unitSnapshot??tenant.unit,
      payday:bill.paydaySnapshot??tenant.payday,rent:bill.rent??tenant.rent,
      mgmt:bill.mgmt??tenant.mgmt,elevator:bill.elevator??tenant.elevator,
      mgmtItems:bill.mgmtItems??tenant.mgmtItems};
  }
  function dateISO(value, year = new Date().getFullYear()) {
    if(!/^(?:\d{4}[./-])?\d{1,2}[./-]\d{1,2}$/.test(String(value||'')))return '';
    const parts = String(value||'').split(/[./-]/).map(Number);
    if (parts.length === 2) parts.unshift(year);
    if (parts.length !== 3) return '';
    const [y,m,d] = parts;
    if (!Number.isInteger(y)||y<1900||y>2200||!Number.isInteger(m)||m<1||m>12||!Number.isInteger(d)||d<1||d>new Date(y,m,0).getDate()) return '';
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function period(day, year, month, span = 1) {
    day = Number(day);
    if (!Number.isInteger(day)||day<1||day>31) return '';
    const endStart = new Date(year,month-1,Math.min(day,new Date(year,month,0).getDate()));
    const startMonth = new Date(year,month-1-span,1);
    const start = new Date(startMonth.getFullYear(),startMonth.getMonth(),Math.min(day,new Date(startMonth.getFullYear(),startMonth.getMonth()+1,0).getDate()));
    const end = new Date(endStart); end.setDate(end.getDate()-1);
    const format = d => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    return `${format(start)}~${format(end)}`;
  }
  function monthKey(year, month) {
    const y = Number(year), m = Number(month);
    if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) return '';
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function dateKey(year, month, day) {
    const mk = monthKey(year, month);
    if (!mk) return '';
    const last = new Date(Number(year), Number(month), 0).getDate();
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > last) return '';
    return `${mk}-${String(d).padStart(2, '0')}`;
  }
  function asOfKey(value = new Date()) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return dateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    return dateISO(value);
  }
  function paydayOf(tenant) {
    const raw=String(tenant?.payday??'').trim();
    if(/^(?:매월\s*|매달\s*)?(?:말일|월말)$/.test(raw))return 31;
    const match=raw.match(/^(?:매월\s*|매달\s*)?([1-9]|[12]\d|3[01])\s*일?$/);
    const day=match?Number(match[1]):0;
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 0;
  }
  function dueDate(tenant, itemKey, year, month) {
    if (itemKey === 'pay_rent') {
      const day = paydayOf(tenant);
      return day ? dateKey(year, month, Math.min(day, new Date(Number(year), Number(month), 0).getDate())) : '';
    }
    const mk = monthKey(year, month);
    return mk ? dateKey(year, month, new Date(Number(year), Number(month), 0).getDate()) : '';
  }
  function historicalPayment(tenant, bill = {}, year, month, asOf = new Date()) {
    const base = payment(tenant,bill,asOf,year);
    tenant=effectiveTenant(tenant,bill);
    const cutoff = asOfKey(asOf);
    const items = {};
    let notDue = 0, overdue = 0, paid = 0, exempt = 0, unknownDue = 0;
    for (const [key, item] of Object.entries(base.items)) {
      const itemDueDate = dueDate(tenant, key, year, month);
      let status;
      if (item.na) {
        status = 'exempt';
        exempt += item.amount;
      } else if (item.paid) {
        status = 'paid';
        paid += item.amount;
      } else if (!itemDueDate || !cutoff || itemDueDate >= cutoff) {
        // 지급일이 설정되지 않은 월세도 임의로 체납으로 만들지 않는다.
        status = 'notDue';
        notDue += item.amount;
        if(!itemDueDate)unknownDue+=item.amount;
      } else {
        status = 'overdue';
        overdue += item.amount;
      }
      items[key] = {...item, status, dueDate: itemDueDate};
    }
    return {...base, items, notDue, overdue, paid, received:paid, exempt, unknownDue,
      due: paid + overdue, unpaid: notDue + overdue,
      complete: base.total > 0 && notDue === 0 && overdue === 0};
  }
  function arrears(tenants = [], bills = {}, asOf = new Date()) {
    const cutoff = asOfKey(asOf);
    const cutoffMonth = cutoff.slice(0, 7);
    const byTenant = new Map();
    const months = new Set();
    for (const [mk, rows] of Object.entries(bills || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mk) || (cutoffMonth && mk > cutoffMonth) || !rows || typeof rows !== 'object') continue;
      const [year, month] = mk.split('-').map(Number);
      for (const [id,bill] of Object.entries(rows)) {
        const tenant=tenants.find(t=>t.id===id)||{id,name:bill?.tenantSnapshot?.name||'세입자 정보 없음 ('+id+')',unit:bill?.unitSnapshot||'',rent:0,mgmt:0,elevator:0};
        if (!bill || typeof bill !== 'object' || Array.isArray(bill) || !Object.keys(bill).length) continue;
        const state = historicalPayment(tenant, bill, year, month, asOf);
        if (state.overdue <= 0) continue;
        const current = byTenant.get(tenant.id) || {
          id: tenant.id, name: effectiveTenant(tenant,bill).biz || effectiveTenant(tenant,bill).name, unit: bill.unitSnapshot??tenant.unit, overdue: 0, months: []
        };
        const items = Object.entries(state.items)
          .filter(([, item]) => item.status === 'overdue' && item.amount > 0)
          .map(([key]) => key);
        current.overdue += state.overdue;
        current.months.push({month: mk, amount: state.overdue, items});
        byTenant.set(tenant.id, current);
        months.add(mk);
      }
    }
    const tenantRows = [...byTenant.values()]
      .map(row => ({...row, months: row.months.sort((a, b) => b.month.localeCompare(a.month))}))
      .sort((a, b) => b.overdue - a.overdue || String(a.name).localeCompare(String(b.name)));
    return {
      total: tenantRows.reduce((sum, row) => sum + row.overdue, 0),
      tenantCount: tenantRows.length,
      monthCount: months.size,
      tenants: tenantRows,
    };
  }
  root.RentalBilling = {won, withVat, floorOf, distribute, calculate, reconcile, charges, payment,
    dateISO, period, dueDate, historicalPayment, arrears, itemKeys, naFields,
    materializeGroup, invalidateChangedPayments, freezeBill, effectiveTenant};
  if (typeof module !== 'undefined') module.exports = root.RentalBilling;
})(globalThis);
