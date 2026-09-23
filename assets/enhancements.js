/* Workspace summaries, exports, and locally retained bill drafts. */
function renderDashboardMetrics() {
  const today=new Date(),key=mk();
  const states=tenantsForMonth(key).map(t=>{
    const bill=bills[key]?.[t.id]||{};
    const payment=RentalBilling.payment(t,bill);
    const timing=Object.keys(bill).length?RentalBilling.historicalPayment(t,bill,cY,cM,today):{overdue:0,complete:false};
    return {payment,timing};
  });
  const total=states.reduce((sum,s)=>sum+s.payment.total,0),received=states.reduce((sum,s)=>sum+s.payment.received,0);
  const currentOverdue=states.reduce((sum,s)=>sum+s.timing.overdue,0);
  const currentOverdueTenants=states.filter(s=>s.timing.overdue>0).length;
  const accumulated=RentalBilling.arrears(tenants,bills,today);
  const cards=[['총 청구액',fmt(total),'선택 월 청구 예정 포함','neutral'],['입금 확인',fmt(received),`${states.filter(s=>s.timing.complete).length}곳 완납`,'green'],
    ['선택 월 체납',fmt(currentOverdue),currentOverdue?`${currentOverdueTenants}곳 기한 경과`:'아직 기한 경과 없음',currentOverdue?'red':'neutral'],
    ['누적 체납',fmt(accumulated.total),accumulated.total?`${accumulated.tenantCount}곳 · ${accumulated.monthCount}개월`:'과거 고지서 기준 없음',accumulated.total?'red':'neutral'],
    ['등록 세입자',`${activeTenants().length}<small> 곳</small>`,'층별 계약 관리','neutral']];
  document.getElementById('dashboard-metrics').innerHTML=cards.map(([label,value,detail,tone])=>`<div class="metric-card ${tone}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('');
  document.getElementById('onboarding').innerHTML=tenants.length?'':`<div class="onboarding"><div><strong>내 건물의 첫 기록을 시작하세요.</strong><p>기존 앱의 JSON 백업을 가져오거나 세입자를 등록할 수 있습니다.</p></div><div><button class="btn btn-primary" onclick="document.getElementById('import-file').click()">기존 백업 가져오기</button><a class="btn btn-secondary" href="?demo=1">예시로 둘러보기</a></div></div>`;
}
function exportMonthCsv() {
  const rows=[['기준월','호수','상호','세입자','월세','관리비','전기','수도','엘리베이터','오물비','미부과 차감','총 청구액','입금 확인','미확인','월세 완납일','관리비 완납일']];
  tenantsForMonth().forEach(t=>{
    const bill=bills[mk()]?.[t.id]||{},s=RentalBilling.payment(t,bill),c=RentalBilling.charges(t,bill);
    const identity=billTenant(t,bill);
    rows.push([mk(),identity.unit,identity.biz||'',identity.name,...['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'].map(k=>c[k]),s.exempt,s.total,s.received,s.unpaid,bill.stampedRent?bill.stampedRentDate||'':'',bill.stampedMgmt?bill.stampedMgmtDate||'':'']);
  });
  const cell=value=>{
    let text=String(value??'');
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`임대관리_월별내역_${mk()}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast('월별 내역 다운로드를 시작했습니다.');
}

const DRAFT_KEY='rentalApp.billDrafts.v1';
let draftTimer=null,pendingBillDraft=null,draftVersion=0;
// Keep imported drafts recoverable if the separate draft storage write fails.
let retainedBillDrafts=null;
const billSignature=()=>JSON.stringify(bills[activeMk()]?.[selTenantId]||{});
function validateDrafts(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const [key,draft] of Object.entries(value)){
    if(!/^\d{4}-(0[1-9]|1[0-2]):[a-zA-Z0-9_-]{1,100}$/.test(key)||!draft?.fields||typeof draft.fields!=='object')continue;
    const fields={};
    for(const field of ['electricity','water','waste','water-meter','water-date'])
      if(typeof draft.fields[field]==='string'&&draft.fields[field].length<1000)fields[field]=draft.fields[field];
    result[key]={fields,updatedAt:typeof draft.updatedAt==='string'?draft.updatedAt:'',baseline:typeof draft.baseline==='string'?draft.baseline:null};
  }
  return result;
}
function discardBillDraft(){
  clearBillDraft();editThisMonth();showToast('초안을 지우고 저장된 고지서를 표시합니다.');
}

function readBillDrafts() {
  if(retainedBillDrafts!==null)return validateDrafts(retainedBillDrafts);
  try { const value=JSON.parse(appStorage.getItem(DRAFT_KEY)||'{}');return validateDrafts(value); }
  catch { return {}; }
}
function collectBillDrafts() {
  return {...readBillDrafts(),...(pendingBillDraft?{[pendingBillDraft.key]:pendingBillDraft.value}:{})};
}
function storeBillDrafts(drafts) {
  retainedBillDrafts=validateDrafts(drafts);
  try {
    appStorage.setItem(DRAFT_KEY,JSON.stringify(retainedBillDrafts));
    retainedBillDrafts=null;return true;
  } catch {return false;}
}
function flushBillDraft() {
  clearTimeout(draftTimer);
  if(!pendingBillDraft||storageFault||conflictingTab)return;
  try {
    const drafts=readBillDrafts();drafts[pendingBillDraft.key]=pendingBillDraft.value;
    if(!storeBillDrafts(drafts))throw new Error('Draft storage failed');
    pendingBillDraft=null;
    const label=document.getElementById('bill-draft-state');if(label)label.textContent='작성 중인 내용이 이 기기에 임시 보관되었습니다.';
  } catch { showDataNotice('고지서 초안을 임시 저장하지 못했습니다. 저장 버튼으로 내용을 저장하고 저장 공간을 확인해주세요.'); }
}
function clearBillDraft(month=activeMk(),id=selTenantId) {
  const key=`${month}:${id}`;
  if(pendingBillDraft?.key===key)pendingBillDraft=null;
  const drafts=readBillDrafts();delete drafts[key];
  if(!storeBillDrafts(drafts))showDataNotice('초안 저장소를 갱신하지 못했습니다. 백업을 내보낸 뒤 저장 공간을 확인해주세요.');
}
function applyBillDraft() {
  const key=`${activeMk()}:${selTenantId}`;
  const draft=pendingBillDraft?.key===key?pendingBillDraft.value:readBillDrafts()[key];
  const stale=draft&&draft.baseline!==billSignature();
  if(draft&&!stale&&draft.fields){
    for(const field of ['electricity','water','waste','water-meter','water-date']){
      const input=document.getElementById('bill-'+field);
      if(input&&typeof draft.fields[field]==='string')input.value=draft.fields[field];
    }
    updateBillTotal();
  }
  const form=document.getElementById('bill-total-display');
  if(form&&!document.getElementById('bill-draft-state')){
    const label=document.createElement('p');label.id='bill-draft-state';label.className='draft-state';
    label.textContent=stale?'저장된 고지서가 바뀌어 이전 초안을 자동 적용하지 않았습니다. 백업으로 초안을 보관할 수 있습니다.':draft?'이 기기에 보관된 초안을 복원했습니다. 저장하면 고지서에 반영됩니다.':'입력 중인 내용은 이 기기에 임시 보관됩니다.';
    if(draft){const button=document.createElement('button');button.className='btn btn-secondary';button.textContent='초안 버리기';button.onclick=discardBillDraft;label.append(button);}
    form.closest('.bill-total-box').before(label);
  }
}
document.addEventListener('input',event=>{
  const input=event.target;
  if(!input.closest('#hist-content')||!document.getElementById('bill-total-display')||!selTenantId)return;
  const fields={};
  for(const field of ['electricity','water','waste','water-meter','water-date']){
    const el=document.getElementById('bill-'+field);if(el)fields[field]=el.value;
  }
  pendingBillDraft={key:`${activeMk()}:${selTenantId}`,value:{fields,baseline:billSignature(),updatedAt:new Date().toISOString()}};
  clearTimeout(draftTimer);draftTimer=setTimeout(flushBillDraft,300);
});
window.addEventListener('pagehide',flushBillDraft);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushBillDraft();});

for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches('input:not([type=file]),select,textarea'))draftVersion++;});

/* ───────────────────────────────────────
   테마 모드 제어 (토스 스타일 라이트/다크)
─────────────────────────────────────── */
function initTheme() {
  let theme = 'light';
  try {
    const saved = localStorage.getItem('rental_app_theme');
    const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = saved || (prefersDark ? 'dark' : 'light');
  } catch (e) {}
  applyTheme(theme, false);
}

function applyTheme(theme, notify = true) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  const text = document.getElementById('theme-text');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (text) text.textContent = theme === 'dark' ? '라이트' : '다크';
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    const label = theme === 'dark' ? '라이트모드로 전환' : '다크모드로 전환';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#111317' : '#f5f5f0');
  try { localStorage.setItem('rental_app_theme', theme); } catch (e) {}
  if (notify && typeof showToast === 'function') {
    showToast(theme === 'dark' ? '🌙 다크모드로 변경되었습니다.' : '☀️ 라이트모드로 변경되었습니다.');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

if (typeof document !== 'undefined') {
  initTheme();
  document.addEventListener('DOMContentLoaded', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current, false);
  });
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      try {
        if (!localStorage.getItem('rental_app_theme')) {
          applyTheme(e.matches ? 'dark' : 'light', false);
        }
      } catch (err) {}
    });
  }
}

