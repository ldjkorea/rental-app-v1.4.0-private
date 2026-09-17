/* ════════════════════════════════════════
   전역 상태
════════════════════════════════════════ */
let cY=new Date().getFullYear(), cM=new Date().getMonth()+1;
const esc = RentalCore.escapeHtml;
const isDemo = new URLSearchParams(location.search).get('demo') === '1';
const appStorage = {
  getItem:key=>localStorage.getItem((isDemo?'rentalDemo.':'')+key),
  setItem:(key,value)=>localStorage.setItem((isDemo?'rentalDemo.':'')+key,value),
  removeItem:key=>localStorage.removeItem((isDemo?'rentalDemo.':'')+key),
};
if(isDemo) {
  try {
    if(!appStorage.getItem(RentalCore.STATE_KEY)) {
      const data=RentalCore.empty(),date=new Date(),month=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      data.tenants=[
        {id:'demo1',name:'김예시',biz:'모닝 브루',unit:'101호',rent:1800000,mgmt:200000,elevator:0},
        {id:'demo2',name:'이예시',biz:'온유 스튜디오',unit:'201호',rent:1200000,mgmt:200000,elevator:50000},
        {id:'demo3',name:'박예시',biz:'스페이스 오피스',unit:'301호',rent:1400000,mgmt:200000,elevator:50000},
        {id:'demo4',name:'정예시',biz:'메이플 디자인',unit:'401호',rent:1300000,mgmt:200000,elevator:50000},
      ];
      data.bills[month]=Object.fromEntries(data.tenants.map((t,i)=>[t.id,{rent:t.rent,mgmt:t.mgmt,electricity:i===0?0:i===3?45000:35000,water:15000+i*3000,elevatorTotal:i===0?0:50000,waste:12500,stampedRent:i<3,stampedRentDate:month.replace('-','.')+'.05',stampedMgmt:i===0,stampedMgmtDate:month.replace('-','.')+'.07'}]));
      data.loans=[{id:'demoLoan',name:'건물 담보대출',principal:180000000,rate:3.8}];
      data.expenses[month]=[{id:'demoExpense',name:'공용부 조명 교체',date:month+'/03',amount:80000,memo:'LED 조명 교체'}];
      RentalCore.persist(appStorage,data);
    }
  }catch{}
}

let loadedState;
try { loadedState = RentalCore.load(appStorage); }
catch (error) { loadedState = {data: RentalCore.empty(), error}; }
let {tenants, bills, loans, expenses, renewalDone, settInputs, waterRatio} = loadedState.data;
let storageFault = loadedState.error;
let conflictingTab = false;
let revision = 0;
let syncBusy = false;
let syncController = null;
let cloudDirty=false;
try{cloudDirty=loadedState.meta?.cloudPending ?? (appStorage.getItem('rentalApp.cloudPending')==='true');}catch{}
let cloudBaseRevision=typeof loadedState.meta?.cloudBaseRevision==='string'?loadedState.meta.cloudBaseRevision:null;
let expectedStorageToken;try{expectedStorageToken=RentalCore.storageToken(appStorage);}catch{}
let lastCommitted=JSON.parse(JSON.stringify(loadedState.data)), failedSaveData=null, persistenceBusy=false;
const productionSite = location.hostname === 'ldjkorea.github.io' && location.pathname.startsWith('/rental-app/');
let cloudEnabled = false;
try { cloudEnabled = appStorage.getItem('rentalApp.cloudEnabled') === 'true'; }
catch { cloudEnabled = false; }
if(isDemo)cloudEnabled=false;

let sensitiveOn  = false;
let editTenantId = null;
let editLoanId   = null;
let editExpId    = null;
let expenseMonth = null;
let mgmtEdited=false;
let selTenantId  = null; // 고지서 탭 선택 세입자
let histY=cY, histM=cM;
let settCalcResult = null;

const SHEET_URL='https://script.google.com/macros/s/AKfycbzZ5g7ljLVaqGSrd-BnkYAouhXjAGpiHhlbdoThlZP45nUGP-a7lvWyrxR-Qr9Cafv9/exec';

/* 관리비 항목 (2026.05.12 관리비 공개 기준) */
const ALL_MGMT_ITEMS=[
  {key:'m1', no:'1-1', cat:'일반관리비',  name:'건물 관리 운영비',        defaultAmt:40000,  type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m2', no:'1-2', cat:'일반관리비',  name:'세무 행정 관리비',        defaultAmt:130000, type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m3', no:'2-1', cat:'청소비',      name:'청소 용역비',             defaultAmt:60000,  type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m4', no:'2-2', cat:'청소비',      name:'건물 환경 관리비',        defaultAmt:10000,  type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m5', no:'3',   cat:'경비비',      name:'경비비',                  defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m6', no:'4',   cat:'소독비',      name:'소독비',                  defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m7', no:'5',   cat:'승강기 유지비',name:'승강기 유지비',           defaultAmt:0,      type:'actual', defaultStatus:'actual', desc:''},
  {key:'m8', no:'6',   cat:'냉난방',      name:'냉난방비 및 급탕비',      defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m9', no:'7-1', cat:'수선유지비',  name:'소방 안전 관리비',        defaultAmt:10000,  type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m10',no:'7-2', cat:'수선유지비',  name:'시설 유지 관리비',        defaultAmt:50000,  type:'fixed',  defaultStatus:'active', desc:''},
  {key:'m11',no:'7-3', cat:'수선유지비',  name:'보안 방범 관리비',        defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m12',no:'7-4', cat:'수선유지비',  name:'냉방 시설 청소비',        defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m13',no:'8',   cat:'위탁관리수수료',name:'위탁관리 수수료',         defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m14',no:'9',   cat:'전기료',      name:'전기료',                  defaultAmt:0,      type:'actual', defaultStatus:'actual', desc:''},
  {key:'m15',no:'10',  cat:'수도료',      name:'수도료',                  defaultAmt:0,      type:'actual', defaultStatus:'actual', desc:''},
  {key:'m16',no:'11',  cat:'가스사용료',  name:'가스 사용료',             defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m17',no:'12',  cat:'정화조',      name:'정화조 오물처리 수수료',  defaultAmt:0,      type:'actual', defaultStatus:'actual', desc:''},
  {key:'m18',no:'13',  cat:'폐기물',      name:'폐기물 처리 수수료',      defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
  {key:'m19',no:'14',  cat:'건물보험료',  name:'건물 보험료',             defaultAmt:0,      type:'na',     defaultStatus:'na',     desc:''},
];
const DEFAULT_MGMT_ITEMS=ALL_MGMT_ITEMS;

function getMgmtItems(t){
  const base=ALL_MGMT_ITEMS.map(d=>({key:d.key,status:d.defaultStatus,amount:d.defaultAmt}));
  if(!t||!t.mgmtItems||!t.mgmtItems.length)return base;
  return ALL_MGMT_ITEMS.map(d=>{
    const saved=t.mgmtItems.find(x=>x.key===d.key);
    if(saved&&saved.status!==undefined)return saved;
    // 구버전 호환 (active 필드)
    if(saved&&saved.active!==undefined)return{key:d.key,status:saved.active?'active':'inactive',amount:saved.amount};
    return{key:d.key,status:d.defaultStatus,amount:d.defaultAmt};
  });
}

function renderMgmtItemsModal(items){
  const wrap=document.getElementById('mgmt-items-wrap');
  if(!wrap)return;
  const cats=[...new Set(ALL_MGMT_ITEMS.map(d=>d.cat))];
  let html='';
  cats.forEach(cat=>{
    const catItems=ALL_MGMT_ITEMS.filter(d=>d.cat===cat);
    html+=`<div style="font-size:10px;font-weight:700;color:var(--text2);letter-spacing:1px;margin:12px 0 4px;padding-bottom:3px;border-bottom:1px solid var(--border2);">${cat}</div>`;
    catItems.forEach(d=>{
      const item=items.find(x=>x.key===d.key)||{status:d.defaultStatus,amount:d.defaultAmt};
      const s=item.status||d.defaultStatus;
      const isActive=s==='active';
      const isActual=s==='actual';
      const isNa=s==='na';
      const statusColor=isActive?'var(--green)':isActual?'var(--gold2)':'var(--text2)';
      // 금액 입력은 '운영중'일 때만 (실비정산·미운영은 입력 없음)
      const showAmount=isActive;
      html+=`<div id="mi-row-${d.key}" style="padding:6px 0;border-bottom:1px solid var(--border);opacity:${isNa?'0.5':'1'};">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:5px;">
              <span style="font-size:10px;color:var(--text2);font-family:'DM Mono',monospace;flex-shrink:0;">${d.no}</span>
              <input type="text" id="mi-name-${d.key}" value="${esc(item.name!==undefined?item.name:'')}" placeholder="${d.name}"
                style="flex:1;min-width:0;padding:4px 7px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:12px;font-weight:500;font-family:'Noto Sans KR',sans-serif;">
              ${isActual?`<span style="font-size:10px;color:var(--gold2);background:var(--goldbg2);padding:2px 6px;border-radius:8px;flex-shrink:0;">실비</span>`:''}
            </div>
          </div>
          <select id="mi-sel-${d.key}" onchange="onMgmtStatusChange('${d.key}',this.value)"
            style="padding:5px 7px;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;
            color:${statusColor};font-size:10px;font-weight:700;font-family:'Noto Sans KR',sans-serif;
            flex-shrink:0;cursor:pointer;min-width:80px;">
            <option value="active" ${isActive?'selected':''}>운영중</option>
            <option value="actual" ${isActual?'selected':''}>실비정산</option>
            <option value="na"     ${isNa    ?'selected':''}>미운영</option>
          </select>
        </div>
        ${showAmount?`
        <div style="display:flex;align-items:center;gap:6px;margin-top:5px;padding-left:18px;">
          <span style="font-size:10px;color:var(--text2);">금액 (원/월)</span>
          <input type="number" id="mi-amt-${d.key}" value="${esc(item.amount||'')}" placeholder="${d.defaultAmt||0}"
            oninput="updateMgmtTotal()"
            style="flex:1;padding:6px 8px;background:var(--surface3);border:1px solid var(--border2);
            border-radius:6px;color:var(--text);font-size:12px;font-family:'DM Mono',monospace;text-align:right;">
        </div>`:`<input type="hidden" id="mi-amt-${d.key}" value="${esc(item.amount||0)}">`}
      </div>`;
    });
  });
  wrap.innerHTML=html;
  updateMgmtTotal();
}

function onMgmtStatusChange(key,status){
  const items=readMgmtItemsFromModal();
  const it=items.find(x=>x.key===key);
  if(it)it.status=status;
  renderMgmtItemsModal(items);
}

function updateMgmtTotal(){
  // '운영중'(고정금액) 항목만 합산. 실비정산·미운영 제외
  const total=ALL_MGMT_ITEMS.reduce((s,d)=>{
    const sel=document.getElementById(`mi-sel-${d.key}`);
    if(!sel||sel.value!=='active')return s;
    return s+(Number(document.getElementById(`mi-amt-${d.key}`)?.value)||0);
  },0);
  const el=document.getElementById('mgmt-total-preview');
  if(el)el.textContent=fmt(total);
}

function mgmtItemName(t,def){
  const it=getMgmtItems(t).find(x=>x.key===def.key);
  return (it&&it.name)?it.name:def.name;
}
function readMgmtItemsFromModal(){
  return ALL_MGMT_ITEMS.map(d=>{
    const customName=document.getElementById(`mi-name-${d.key}`)?.value?.trim();
    return{
      key:d.key,
      status:document.getElementById(`mi-sel-${d.key}`)?.value||d.defaultStatus,
      amount:Number(document.getElementById(`mi-amt-${d.key}`)?.value)||0,
      // 기본 이름과 다를 때만 저장 (빈칸이면 기본 이름 사용)
      ...(customName&&customName!==d.name?{name:customName}:{}),
    };
  });
}

function calcMgmtTotal(mgmtItems){
  // 고정 관리비 = '운영중' 항목 합계만 (실비정산은 변동금액에서 별도 청구)
  return (mgmtItems||[]).reduce((s,x)=>{
    if(x.status!=='active')return s;
    return s+(Number(x.amount)||0);
  },0);
}

function buildMgmtBreakdownHtml(t){
  const items=getMgmtItems(t);
  const total=calcMgmtTotal(items);
  if((Array.isArray(t.mgmtItems)&&!t.mgmtItems.length)||total!==Number(t.mgmt||0))return '<p class="data-warning">저장된 고정 관리비 공급가 '+fmt(t.mgmt)+' · 세부 항목 합계 '+fmt(total)+'가 일치하지 않습니다. 과거 원본 확인이 필요합니다.</p>';
  const rows=ALL_MGMT_ITEMS.map(d=>{
    const it=items.find(x=>x.key===d.key);
    const s=it?it.status:d.defaultStatus;
    const isActive=s==='active';
    const isActual=s==='actual';
    const isNa=s==='na';
    const amt=isActive?(it.amount>0?fmtN(it.amount)+'원':'0원'):isActual?'실비':'0원';
    const badge=isActive
      ?`<span style="font-size:10px;color:var(--green);background:rgba(76,175,125,.16);padding:2px 6px;border-radius:8px;flex-shrink:0;">운영중</span>`
      :isActual
        ?`<span style="font-size:10px;color:var(--gold2);background:var(--goldbg2);padding:2px 6px;border-radius:8px;flex-shrink:0;">실비정산</span>`
        :`<span style="font-size:10px;color:var(--text2);background:var(--surface3);padding:2px 6px;border-radius:8px;flex-shrink:0;">미운영</span>`;
    const dim=isNa;
    return`<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:3px 0;opacity:${dim?0.5:1};">
      <div style="display:flex;align-items:center;gap:5px;min-width:0;flex:1;">
        <span style="font-size:10px;color:var(--text2);font-family:'DM Mono',monospace;flex-shrink:0;">${d.no}</span>
        ${badge}
        <span style="color:${isActive||isActual?'var(--text2)':'var(--text3)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((it&&it.name)||d.name)}</span>
      </div>
      <span style="font-family:'DM Mono',monospace;color:${isActive&&it.amount>0?'var(--text)':isActual?'var(--gold2)':'var(--text3)'};flex-shrink:0;margin-left:6px;">${amt}</span>
    </div>`;
  }).join('');
  return`<div style="margin-top:6px;padding:8px 10px;background:var(--surface2);border-radius:8px;">
    ${rows}
    <div style="border-top:1px solid var(--border);margin-top:5px;padding-top:5px;display:flex;justify-content:space-between;font-size:12px;">
      <span style="color:var(--text2);font-weight:700;">고정 관리비 소계</span>
      <span style="font-family:'DM Mono',monospace;color:var(--gold);">${fmtN(total)}</span>
    </div>
    <div style="font-size:10px;color:var(--text2);margin-top:4px;line-height:1.5;">※ 실비정산 항목(전기·수도·승강기 등)은 변동금액에서 별도 청구됩니다</div>
    <div style="font-size:10px;color:var(--text2);margin-top:6px;line-height:1.6;padding-top:6px;border-top:1px solid var(--border);">※ 미운영 항목은 현재 관리비에 포함되어 있지 않으며 비용을 부과하지 않습니다. 향후 건물 운영 여건, 법령 변경 또는 공용시설 운영 필요에 따라 해당 항목이 신설·운영될 수 있으며, 이 경우 관련 법령 및 임대차계약에 따라 사전에 안내 후 적용될 수 있습니다.</div>
  </div>`;
}

const PAY_ITEMS=[
  {key:'pay_mgmt',label:'관리비',short:'관리비'},
  {key:'pay_rent',label:'월세',short:'월세'},
  {key:'pay_elec',label:'공용전기세',short:'전기'},
  {key:'pay_elev',label:'엘리베이터',short:'엘베'},
  {key:'pay_water',label:'수도요금',short:'수도'},
  {key:'pay_waste',label:'오물처리비',short:'오물'},
];
const withVat=RentalBilling.withVat;
const vatOf=n=>withVat(n)-(Number(n)||0);
const mk=()=>`${cY}-${String(cM).padStart(2,'0')}`;
const fmt=n=>'₩'+(Number(n)||0).toLocaleString();
const fmtN=n=>(Number(n)||0).toLocaleString();

/* history 탭 여부에 따른 활성 월 키 */
const activeMk=()=>{
  const isHist=document.getElementById('section-history')?.classList.contains('active');
  return (isHist&&selTenantId)?`${histY}-${String(histM).padStart(2,'0')}`:mk();
};
const activeY=()=>{const isHist=document.getElementById('section-history')?.classList.contains('active');return(isHist&&selTenantId)?histY:cY;};
const activeM=()=>{const isHist=document.getElementById('section-history')?.classList.contains('active');return(isHist&&selTenantId)?histM:cM;};

/* 층 감지 */
const getFloor=RentalBilling.floorOf;
const activeTenants=()=>tenants.filter(t=>!t.archived);
function findTenant(id,month=activeMk()) {
  const found=tenants.find(t=>t.id===id);if(found)return found;
  const bill=bills[month]?.[id]||Object.values(bills).map(rows=>rows[id]).find(Boolean);
  return bill?{id,name:bill.tenantSnapshot?.name||'세입자 정보 없음 ('+id+')',biz:bill.tenantSnapshot?.biz||'',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0,archived:true,orphan:true}:null;
}
function tenantsForMonth(month=mk()) {
  const result=tenants.filter(t=>!t.archived||bills[month]?.[t.id]);
  for(const id of Object.keys(bills[month]||{}))if(!result.some(t=>t.id===id))result.push(findTenant(id,month));
  return result;
}
function historyTenants() {
  const result=[...tenants];
  for(const rows of Object.values(bills))for(const id of Object.keys(rows))
    if(!result.some(t=>t.id===id))result.push(findTenant(id));
  return result;
}
let saveTimer=null;

function currentData() { return {tenants, bills, loans, expenses, renewalDone, settInputs, waterRatio}; }
function assignData(data) {
  ({tenants, bills, loans, expenses, renewalDone, settInputs, waterRatio} = data);
  selTenantId = null;
  settCalcResult = null;
  revision++;
  clearTimeout(draftTimer);pendingBillDraft=null;
}
function refreshDataViews() {
  loadWaterRatioInputs(); renderAll(); renderHistChips();
  document.getElementById('hist-content').innerHTML = '<div class="empty">세입자를 선택해주세요.</div>';
  document.getElementById('hist-nav').style.display = 'none';
  if (document.getElementById('section-settlement').classList.contains('active')) renderSettTab();
}
function showDataNotice(message) {
  const el = document.getElementById('data-notice');
  if (el) { el.hidden = !message; el.textContent = message || ''; }
}
function withStorageLock(action) {
  if (!navigator.locks?.request) throw new Error('안전한 저장에는 HTTPS 또는 localhost의 최신 브라우저가 필요합니다.');
  return navigator.locks.request((isDemo?'rentalDemo.':'')+'rentalApp.write', action);
}
function assertCurrentStorage() {
  if (conflictingTab || RentalCore.storageToken(appStorage)!==expectedStorageToken) {
    conflictingTab=true;
    throw new Error('다른 창에서 데이터가 변경됐습니다. 현재 작업을 내보낸 뒤 새로고침해주세요.');
  }
}
async function writeLocal(data, dirty, baseRevision, beforeWrite) {
  return withStorageLock(() => {
    assertCurrentStorage();
    const validated=RentalCore.validateData(data);
    if(beforeWrite)beforeWrite();
    expectedStorageToken=RentalCore.persistChecked(appStorage,validated,expectedStorageToken,
      {cloudPending:dirty,cloudBaseRevision:baseRevision});
    lastCommitted=JSON.parse(JSON.stringify(validated));
    return validated;
  });
}
async function save() {
  clearTimeout(saveTimer);
  const candidate=JSON.parse(JSON.stringify(currentData()));
  if(persistenceBusy)return false;
  persistenceBusy=true;
  try {
    if(loadedState.error)throw loadedState.error;
    await writeLocal(candidate,true,cloudBaseRevision);
    revision++; cloudDirty=true; storageFault=null; failedSaveData=null;
    showDataNotice('');
    syncUI(cloudEnabled ? 'pending' : 'local');
    if(cloudEnabled)saveTimer=setTimeout(doSync,2000);
    return true;
  } catch(error) {
    failedSaveData=candidate;
    ({tenants,bills,loans,expenses,renewalDone,settInputs,waterRatio}=JSON.parse(JSON.stringify(lastCommitted)));
    storageFault=error;
    syncUI('localError');renderAll();
    showDataNotice('저장하지 못해 직전 저장 상태를 유지했습니다. '+error.message+' 입력 내용은 백업 버튼으로 내보낼 수 있습니다.');
    return false;
  } finally {persistenceBusy=false;}
}
for(const eventType of ['click','change'])document.addEventListener(eventType,event=>{
  if(persistenceBusy){event.preventDefault();event.stopImmediatePropagation();showToast('저장 완료 후 다시 실행해주세요.');}
},true);

async function cloudRequest(options = {}) {
  const controller=new AbortController();
  syncController=controller;
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(SHEET_URL,{...options,cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('서버 응답 오류');
    const result=await response.json();
    if(result.status==='conflict')throw new Error('다른 기기의 변경이 있습니다. 업로드하지 않았습니다.');
    if(result.status!=='ok')throw new Error(result.message||'서버 저장 확인 실패');
    return result;
  } finally {clearTimeout(timeout);if(syncController===controller)syncController=null;}
}
function supportsSafeSync(result) {
  return result.capabilities?.conditionalWrite===true && typeof result.revision==='string' && !!result.revision;
}

async function doSync(options = {}) {
  if(!cloudEnabled || storageFault || conflictingTab || persistenceBusy || syncBusy)return;
  if(!navigator.onLine){syncUI('offline');return;}
  syncBusy=true;
  let success=false;
  try {
    assertCurrentStorage();syncUI('saving');
    const remote=await cloudRequest();
    const remoteData=RentalCore.validateData(remote.data);
    if(!supportsSafeSync(remote))throw new Error('기존 서버가 버전 비교 저장을 지원하지 않아 업로드를 차단했습니다. 불러오기는 가능합니다.');
    if(!cloudBaseRevision) {
      if(!options.manual)throw new Error('구글 기준 버전이 없습니다. 먼저 불러오거나 수동 저장에서 자료를 대조해주세요.');
      if(!confirm('구글 세입자 '+remoteData.tenants.length+'명 / 고지서 '+Object.keys(remoteData.bills).length+'개월을 현재 기기 자료로 교체할까요? 서버 자료를 이 기기에 별도 보관한 뒤 버전을 비교하여 저장합니다.'))return;
      appStorage.setItem('rentalApp.cloudRecovery.v1',JSON.stringify(RentalCore.envelope(remoteData)));
      cloudBaseRevision=remote.revision;
    }
    if(remote.revision!==cloudBaseRevision)throw new Error('구글 자료가 다른 기기에서 변경됐습니다. 로컬 백업을 내보낸 뒤 불러오기와 대조가 필요합니다.');
    if(!cloudEnabled)throw new Error('동기화가 꺼졌습니다.');
    assertCurrentStorage();
    const sentRevision=revision, data=RentalCore.validateData(currentData());
    const requestId=crypto.randomUUID();
    const result=await cloudRequest({method:'POST',body:JSON.stringify({protocol:'rental-sync-v2',expectedRevision:cloudBaseRevision,requestId,data})});
    if(!supportsSafeSync(result)||result.requestId!==requestId)throw new Error('조건부 저장 결과를 검증하지 못했습니다. 다시 불러와 확인해주세요.');
    cloudBaseRevision=result.revision;
    // Acknowledgement and the pending marker share the same atomic state write.
    await withStorageLock(()=>{
      assertCurrentStorage();
      cloudDirty=revision!==sentRevision;
      expectedStorageToken=RentalCore.persistChecked(appStorage,currentData(),expectedStorageToken,
        {cloudPending:cloudDirty,cloudBaseRevision});
      lastCommitted=JSON.parse(JSON.stringify(currentData()));
    });
    success=true;showDataNotice('');
    syncUI(!cloudEnabled?'local':cloudDirty?'pending':'saved');
  } catch(error) {syncUI(cloudEnabled?'error':'local');showDataNotice(error.message);}
  finally {
    syncBusy=false;
    if(success&&cloudDirty&&cloudEnabled)saveTimer=setTimeout(doSync,2000);
  }
}

async function manualSync() {
  clearTimeout(saveTimer);
  if (!cloudEnabled) { showToast('구글 동기화를 먼저 켜주세요. 현재는 이 기기에 저장합니다.'); return; }
  if (syncBusy) { showToast('진행 중인 동기화가 끝난 뒤 다시 시도해주세요.'); return; }
  await doSync({manual:true});
}
async function syncFromSheet() {
  if(isDemo){showToast('예시 모드에서는 구글 저장소에 연결하지 않습니다.');return;}
  if(syncBusy||persistenceBusy||storageFault||conflictingTab){showToast('저장 상태를 확인한 뒤 다시 시도해주세요.');return;}
  if(!confirm('구글 데이터를 불러와 현재 데이터를 교체할까요? 교체 전 복원 지점을 남깁니다.'))return;
  clearTimeout(saveTimer);
  const startedRevision=revision, startedDraft=draftVersion;
  syncBusy=true;
  try {
    syncUI('loading');
    const result=await cloudRequest(), data=RentalCore.validateData(result.data);
    if(revision!==startedRevision||draftVersion!==startedDraft)throw new Error('불러오는 동안 편집이 발생했습니다. 현재 데이터를 유지합니다.');
    persistenceBusy=true;
    const base=supportsSafeSync(result)?result.revision:null;
    await writeLocal(data,false,base,()=>backupCurrentData('구글 불러오기 전'));
    assignData(data);cloudDirty=false;cloudBaseRevision=base;
    const draftsSaved=storeBillDrafts({});
    refreshDataViews();syncUI('local');
    showDataNotice(!draftsSaved?'자료는 불러왔으나 초안 저장소를 갱신하지 못했습니다. 백업을 내보낸 뒤 저장 공간을 확인해주세요.':base?'':'불러오기 완료. 이 서버는 버전 비교 저장을 지원하지 않아 업로드는 차단됩니다.');
    showToast('불러오기 완료 ✓');
  } catch(error){syncUI('error');showDataNotice('불러오기 실패: '+error.message);}
  finally{clearTimeout(saveTimer);syncBusy=false;persistenceBusy=false;}
}

function setCloudEnabled(enabled) {
  if(isDemo){document.getElementById('cloud-enabled').checked=false;return;}
  if (enabled && !confirm('구글 연결을 켤까요? 버전 비교 저장을 지원하는 서버만 업로드할 수 있습니다. 기존 자료는 먼저 불러와 대조해주세요.')) {
    document.getElementById('cloud-enabled').checked = cloudEnabled;
  document.getElementById('cloud-enabled').disabled=isDemo;
  document.getElementById('demo-banner').hidden=!isDemo; return;
  }
  try { appStorage.setItem('rentalApp.cloudEnabled', String(enabled)); }
  catch { showToast('동기화 설정을 저장하지 못했습니다.'); document.getElementById('cloud-enabled').checked = cloudEnabled;
  document.getElementById('cloud-enabled').disabled=isDemo;
  document.getElementById('demo-banner').hidden=!isDemo; return; }
  cloudEnabled = enabled;
  clearTimeout(saveTimer);
  if (!enabled) syncController?.abort();
  syncUI(enabled ? 'ready' : 'local');
}
function syncUI(state) {
  const map = {
    local: ['✓ 이 기기에 저장', 'var(--green)'],
    ready: ['구글 동기화 켜짐 · 다음 변경부터 저장', 'var(--text2)'],
    pending: ['✓ 기기 저장 · 구글 저장 대기', 'var(--gold)'],
    saving: ['⟳ 구글에 저장 중', 'var(--text2)'],
    loading: ['⟳ 구글에서 불러오는 중', 'var(--text2)'],
    saved: ['✓ 구글 저장 확인 ' + new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'}), 'var(--green)'],
    error: ['⚠ 구글 동기화 실패 · 기기 데이터 유지', 'var(--red)'],
    localError: ['⚠ 기기 저장 확인 필요', 'var(--red)'],
    offline: ['오프라인 · 이 기기에 저장', 'var(--gold)'],
  };
  const entry = map[storageFault || conflictingTab ? 'localError' : state];
  if (!entry) return;
  for (const id of ['sync-dot', 'sync-status-detail']) {
    const el = document.getElementById(id);
    if (el) { el.textContent = entry[0]; el.style.color = entry[1]; }
  }
}
window.addEventListener('online', () => { if (cloudEnabled && cloudDirty) doSync(); });
window.addEventListener('offline', () => syncUI('offline'));
window.addEventListener('storage', event => {
  if (event.key === (isDemo?'rentalDemo.':'')+RentalCore.STATE_KEY || event.key === null) {
    conflictingTab = true; clearTimeout(saveTimer); syncController?.abort(); syncUI('localError');
    showDataNotice('다른 창에서 데이터가 변경됐습니다. 이 창의 덮어쓰기를 막았습니다. 새로고침 후 계속해주세요.');
  }
});
window.addEventListener('beforeunload', event => {
  if (persistenceBusy || storageFault || conflictingTab || failedSaveData || retainedBillDrafts !== null || (cloudEnabled && cloudDirty)) { event.preventDefault(); event.returnValue = ''; }
});

function changeMonth(d){
  if(typeof flushBillDraft==='function')flushBillDraft();
  cM+=d;
  if(cM>12){cM=1;cY++;}if(cM<1){cM=12;cY--;}
  // 히스토리 탭 월도 함께 동기화
  histY=cY; histM=cM;
  updateMonthLabel();
  renderAll();
  // 현재 활성 탭에 따라 콘텐츠 재렌더
  const isHist=document.getElementById('section-history')?.classList.contains('active');
  const isSett=document.getElementById('section-settlement')?.classList.contains('active');
  if(isHist && selTenantId){ renderHistChips(); renderHistContent(); }
  if(isSett){ renderSettTab(); }
}
function updateMonthLabel(){
  const lbl=`${cY}년 ${cM}월`;
  ['currentMonth','home-month-title'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=lbl;});
  const settT=document.getElementById('sett-title');if(settT)settT.textContent=`${cY}년 ${cM}월 정산`;
}
function openMonthPicker(){
  document.getElementById('pick-y').value=cY;
  document.getElementById('pick-m').value=cM;
  const qc=document.getElementById('quick-chips');
  if(qc){let h='';for(let i=0;i<6;i++){let m=cM-i,y=cY;if(m<=0){m+=12;y--;}h+=`<div class="chip" style="cursor:pointer;" onclick="quickPick(${y},${m})">${y}년 ${m}월</div>`;}qc.innerHTML=h;}
  openModal('modal-month');
}
function quickPick(y,m){
  flushBillDraft();cY=y;cM=m;histY=y;histM=m;
  updateMonthLabel();renderAll();
  const isHist=document.getElementById('section-history')?.classList.contains('active');
  const isSett=document.getElementById('section-settlement')?.classList.contains('active');
  if(isHist&&selTenantId){renderHistChips();renderHistContent();}
  if(isSett)renderSettTab();
  closeModal('modal-month');
}
function applyMonthPicker(){
  const y=Number(document.getElementById('pick-y').value);
  const m=Number(document.getElementById('pick-m').value);
  if(!Number.isInteger(y)||y<1900||y>2200||!Number.isInteger(m)||m<1||m>12){showToast('연도와 월을 확인해주세요.');return;}
  flushBillDraft();cY=y;cM=m;histY=y;histM=m;
  updateMonthLabel();renderAll();
  const isHist=document.getElementById('section-history')?.classList.contains('active');
  const isSett=document.getElementById('section-settlement')?.classList.contains('active');
  if(isHist&&selTenantId){renderHistChips();renderHistContent();}
  if(isSett)renderSettTab();
  closeModal('modal-month');
}

/* ════════════════════════════════════════
   탭 전환
════════════════════════════════════════ */
const TABS=['home','history','tenants','settlement','settings'];
function switchTab(tab){
  if(typeof flushBillDraft==='function')flushBillDraft();
  document.body.dataset.tab=tab;
  document.getElementById('page-title').textContent=({home:'이번 달 한눈에',tenants:'세입자 관리',history:'월별 고지서',settlement:'공용 비용 정산',settings:'설정과 데이터'})[tab];
  const pill=document.querySelector('.pill-nav');
  const hdr=document.getElementById('main-header');
  const deco=document.getElementById('home-deco');

  // 어떤 탭이든 선택하면: pill 하단 고정, 헤더 표시, 시작화면 데코 숨김
  if(pill)pill.classList.add('pill-bottom');
  if(hdr)hdr.style.display='flex';
  if(deco)deco.style.display='none';

  TABS.forEach(t=>{
    const s=document.getElementById(`section-${t}`);if(s)s.classList.toggle('active',t===tab);
    const n=document.getElementById(`nav-${t}`);if(n)n.classList.toggle('active',t===tab);
  });

  if(tab==='home')renderHome();
  if(tab==='settlement')renderSettTab();
  if(tab==='history'){renderHistChips();if(selTenantId)renderHistContent();}
  TABS.forEach(t=>document.getElementById('nav-'+t)?.setAttribute('aria-current', t===tab?'page':'false'));
}
function renderAll(){renderHome();renderTenants();renderLoanList();renderExpenseList();}

/* ════════════════════════════════════════
   민감정보 토글
════════════════════════════════════════ */
function toggleSensitive(){
  sensitiveOn=!sensitiveOn;
  const el=document.getElementById('home-total');
  if(el)el.classList.toggle('blur-it',!sensitiveOn);
  const btn=document.getElementById('reveal-icon');
  if(btn)btn.textContent=sensitiveOn?'🙈':'👁';
}

/* ════════════════════════════════════════
   홈 렌더링
════════════════════════════════════════ */
function calcSaved(t,b){ return RentalBilling.payment(t,b).total; }
function calcInterest(){return loans.reduce((s,l)=>s+Math.round(Number(l.principal)*(Number(l.rate)/100)/12),0);}

function renderHome(){
  const key=mk();let total=0,html='';
  const today=new Date();
  const accumulated=RentalBilling.arrears(tenants,bills,today);

  // 알림
  let aHtml='';
  if(accumulated.total>0){
    const detail=accumulated.tenants.map(row=>`${esc(row.name)} ${fmt(row.overdue)}`).join(' · ');
    aHtml+=`<div class="status-bar warn">⚠️ <strong>누적 체납 ${fmt(accumulated.total)}</strong><span style="margin-left:8px;">${detail}</span></div>`;
  }
  activeTenants().forEach(t=>{
    const r=calcRenewPeriod(t.contract);if(!r)return;
    const contractEndStr=t.contract?.split('~')[1]?.trim();
    const done=renewalDone[t.id]; // 'agreed'=협의완료, 계약종료일문자열=갱신완료

    if(done===contractEndStr){
      // 갱신완료 → 흰색
      aHtml+=`<div class="status-bar" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);color:var(--text);">✅ <strong>${esc(t.biz||t.name)}</strong> 계약갱신 완료!</div>`;
    } else if(done==='agreed_'+contractEndStr){
      // 협의완료 → 초록색
      aHtml+=`<div class="status-bar done">🤝 <strong>${esc(t.biz||t.name)}</strong> 계약갱신필요 (협의완료)</div>`;
    } else if(today>=r.warnStart){
      // 만료 1달 전 이후 → 빨간색 "계약갱신기간 경과!"
      aHtml+=`<div class="status-bar warn">🚨 <strong>${esc(t.biz||t.name)}</strong> 계약갱신기간 경과! (${esc(contractEndStr)} 만료)
        <button onclick="agreeRenewal('${t.id}')" style="margin-left:8px;font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(192,57,43,.5);background:var(--redbg);color:var(--red);cursor:pointer;">협의완료</button>
        <button onclick="completeRenewal('${t.id}')" style="margin-left:4px;font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(76,175,125,.4);background:rgba(76,175,125,.1);color:var(--green);cursor:pointer;">갱신완료</button>
      </div>`;
    } else if(today>=r.start){
      // 만료 6개월 전 ~ 1달 전 → 노란색 협상 가능 기간
      aHtml+=`<div class="status-bar pending">⚠️ <strong>${esc(t.biz||t.name)}</strong> 재계약 협상 기간 (${r.str})
        <button onclick="agreeRenewal('${t.id}')" style="margin-left:8px;font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(201,168,76,.4);background:var(--goldbg);color:var(--gold);cursor:pointer;">협의완료</button>
        <button onclick="completeRenewal('${t.id}')" style="margin-left:4px;font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(76,175,125,.4);background:rgba(76,175,125,.1);color:var(--green);cursor:pointer;">갱신완료</button>
      </div>`;
    }
  });
  let unknown=0,estimated=0,orphans=0;
  for(const [month,rows] of Object.entries(bills))for(const [id,bill] of Object.entries(rows)){
    if(bill.snapshotEstimated?.length)estimated++;
    if(!tenants.some(t=>t.id===id))orphans++;
    const [y,m]=month.split('-').map(Number);
    unknown+=RentalBilling.historicalPayment(findTenant(id,month),bill,y,m,today).unknownDue;
  }
  if(estimated||orphans)aHtml+='<div class="status-bar pending">자료 확인: 과거 정보 보완 '+estimated+'건 · 세입자 연결 누락 '+orphans+'건. 고지서에서 확인해주세요.</div>';
  if(unknown)aHtml+='<div class="status-bar pending">월세 납기 확인 필요: '+fmt(unknown)+' (체납 합계에 임의 포함하지 않음)</div>';
  if(accumulated.total>0)aHtml+='<details class="card"><summary>누적 체납 월별 내역</summary>'+accumulated.tenants.map(row=>row.months.map(month=>'<div class="charge-row"><span>'+esc(row.name)+' · '+month.month+'</span><strong>'+fmt(month.amount)+'</strong><button class="btn btn-secondary" data-bill-id="'+esc(row.id)+'" data-bill-month="'+month.month+'" onclick="goToBill(this.dataset.billId,this.dataset.billMonth)">고지서</button></div>').join('')).join('')+'</details>';
  const aEl=document.getElementById('home-alerts');if(aEl)aEl.innerHTML=aHtml;

  // 정산 상태
  const si=settInputs[key]||{};
  const ssEl=document.getElementById('home-sett-status');
  if(ssEl)ssEl.innerHTML=si.confirmed
    ?`<div class="status-bar done">✅ ${cY}년 ${cM}월 정산 완료</div>`
    :`<div class="status-bar pending">⏳ 정산 미완료 — <a onclick="switchTab('settlement')">정산 입력하기 →</a></div>`;

  tenantsForMonth(key).forEach(t=>{
    const b=(bills[key]||{})[t.id]||{};
    const sum=calcSaved(t,b);total+=sum;
    const has=Object.keys(b).length>0;
    const payment=RentalBilling.payment(t,b);
    const timing=has?RentalBilling.historicalPayment(t,b,cY,cM,today):null;
    t=billTenant(t,b);
    const floor=getFloor(t.unit),floorLabel=floor>0?`${floor}F`:'?F';
    const tagLabel=timing?.unknownDue>0?'납기 확인 필요':timing?.overdue>0?`체납 ${fmt(timing.overdue)}`:timing?.notDue>0&&timing?.paid===0?'지급기일 전':payment.complete?'완납':payment.received>0?'일부 확인':'입금 미확인';
    const stampTag=has?`<span class="tag ${timing?.overdue>0?'tag-pending':payment.complete?'tag-ok':'tag-pending'}">${tagLabel}</span>`:'';
    html+=`<div class="t-item" onclick="goToHistory('${t.id}')">
      <div class="t-avatar" style="font-size:12px;letter-spacing:-.5px;">${floorLabel}</div>
      <div class="t-info">
        <div class="t-name">${esc(t.biz||t.name)}
          ${!has?'<span class="tag tag-new">미입력</span>':''}
          ${stampTag}
        </div>
        <div class="t-unit">${esc(t.name)} · ${esc(t.unit)}</div>
      </div>
      <div class="t-amount"><div class="label">청구액</div>${fmt(sum)}</div>
    </div>`;
  });
  document.getElementById('home-bill-list').innerHTML=html?html
    :`<div class="empty"><div class="empty-icon">📋</div><div style="font-size:13px;">세입자를 추가해보세요</div></div>`;
  document.getElementById('home-total').textContent=fmt(total);

  renderDashboardMetrics();renderRenewalChecklist();renderLoanInterestSummary();renderExpenseList();
}

/* ════════════════════════════════════════
   정산 탭
════════════════════════════════════════ */
function renderSettTab(){
  settlementReview=null;settCalcResult=null;
  const key=mk();const si=settInputs[key]||{};
  const done=si.confirmed===true;
  // 설정 탭 내 embed 영역에 정산 HTML 삽입
  const embed=document.getElementById('settings-sett-embed');
  if(embed){
    embed.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <div style="font-size:16px;font-weight:700;" id="sett-title">${cY}년 ${cM}월 정산</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;" id="sett-sub">${done?'정산 완료. 재정산하려면 값 수정 후 다시 계산하세요.':'공용 비용을 입력하고 배분 계산을 실행하세요.'}</div>
      </div>
      <div id="sett-badge">${done
        ?`<span style="font-size:11px;padding:4px 10px;border-radius:50px;background:rgba(76,175,125,.15);color:var(--green);border:1px solid rgba(76,175,125,.3);">✅ 완료</span>`
        :`<span style="font-size:11px;padding:4px 10px;border-radius:50px;background:var(--goldbg2);color:var(--gold);border:1px solid rgba(201,168,76,.3);">⏳ 미완료</span>`}
      </div>
    </div>
    <div class="step-row">
      <div class="step-node"><div class="step-dot active" id="sdot1">1</div><div class="step-lbl active" id="slbl1">비용입력</div></div>
      <div class="step-line" id="sline1"></div>
      <div class="step-node"><div class="step-dot" id="sdot2">2</div><div class="step-lbl" id="slbl2">배분결과</div></div>
      <div class="step-line" id="sline2"></div>
      <div class="step-node"><div class="step-dot" id="sdot3">3</div><div class="step-lbl" id="slbl3">확정저장</div></div>
    </div>
    <div id="sett-step1">
      <div class="card">
        <div class="card-header"><div><div class="card-title">⚡ 공용전기세</div><div class="card-sub">2·3층 각 35,000원 고정 / 4층 나머지</div></div></div>
        <div class="field"><label>총 공급가 (원, 부가세 제외)</label><input type="number" id="sett-elec" placeholder="예: 115,000" value="${esc(si.elec||'')}"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">💧 수도요금 <span style="font-size:10px;color:var(--gold);background:var(--goldbg);padding:2px 7px;border-radius:50px;">격월</span></div></div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text2);">
            <input type="checkbox" id="sett-water-chk" onchange="toggleWaterFields()" style="accent-color:var(--gold);" ${si.waterActive?'checked':''}>이번 달 청구
          </label>
        </div>
        <div id="sett-water-fields" style="display:${si.waterActive?'block':'none'};">
          <div class="field-row">
            <div class="field"><label>총 청구금액</label><input type="number" id="sett-water-total" placeholder="예: 300,000" value="${esc(si.waterTotal||'')}"></div>
            <div class="field"><label>건물 총 사용량(톤)</label><input type="number" id="sett-water-usage" placeholder="예: 177" value="${esc(si.waterUsage||'')}"></div>
          </div>
          <div class="field"><label>1층 사용량(톤)</label><input type="number" id="sett-water-f1" placeholder="예: 41" value="${esc(si.waterF1||'')}"></div>
        </div>
        <div id="sett-water-off" style="display:${si.waterActive?'none':'block'};font-size:12px;color:var(--text2);padding:4px 0;">이번 달 수도요금 청구 없음</div>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">🛗 엘리베이터</div><div class="card-sub">2·3·4층 실비 배분 · 원 단위 잔액 보존</div></div></div>
        <div class="field"><label for="sett-elev-mode">청구서 금액 기준</label><select id="sett-elev-mode"><option value="gross" ${si.elevMode==='net'||(si.elev&&!si.elevMode)?'':'selected'}>최종 청구액 · 부가세 포함</option><option value="net" ${si.elevMode==='net'||(si.elev&&!si.elevMode)?'selected':''}>공급가 · 부가세 별도</option></select></div><div class="field"><label>실제 청구서 금액 (원)</label><input type="number" id="sett-elev" placeholder="예: 150,000" value="${esc(si.elev||'')}"></div>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">🗑️ 오물처리비</div><div class="card-sub">입력 시에만 부과</div></div></div>
        <div class="field"><label>총 금액 (원) — 비워두면 미부과</label><input type="number" id="sett-waste" placeholder="비워두면 미부과" value="${esc(si.waste||'')}"></div>
      </div>
      <button class="btn-sett" onclick="calcSettlement()">🧮 배분 계산하기</button>
    </div>
    <div id="sett-step2" style="display:none;">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">📊 배분 결과</div><div class="card-sub" id="sett-result-sub"></div></div>
          <button onclick="backToStep1()" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);padding:5px 11px;border-radius:8px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;">← 재입력</button>
        </div>
        <div style="overflow-x:auto;">
          <table class="result-tbl"><thead><tr>
            <th>세입자</th><th>전기</th><th>수도</th><th>엘베</th><th>오물</th><th>소계</th>
          </tr></thead>
          <tbody id="sett-tbody"></tbody></table>
        </div>
        <div id="sett-note" style="margin-top:8px;font-size:10px;color:var(--text3);"></div>
      </div>
      <button id="confirm-settlement" class="btn-sett" onclick="confirmSettlement()" style="background:linear-gradient(135deg,#2d6a4f,#1b4332);color:var(--gold3);">✅ 확정하고 저장</button>
      <button class="btn" onclick="backToStep1()" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);width:100%;justify-content:center;margin-top:8px;">← 다시 입력</button>
    </div>`;
  }
  goSettStep(1);
}
function toggleWaterFields(){
  const on=document.getElementById('sett-water-chk')?.checked;
  const f=document.getElementById('sett-water-fields');
  const o=document.getElementById('sett-water-off');
  if(f)f.style.display=on?'block':'none';
  if(o)o.style.display=on?'none':'block';
}
let settlementReview = null;
function calcSettlement() {
  if (!validateNumbers('settings-sett-embed')) return;
  const value = id => Number(document.getElementById(id)?.value || 0);
  const waterActive = document.getElementById('sett-water-chk').checked;
  const inputs = {elec:value('sett-elec'), waterTotal:waterActive?value('sett-water-total'):0,
    waterUsage:value('sett-water-usage'), waterF1:value('sett-water-f1'), waterActive,
    elev:value('sett-elev'), elevMode:document.getElementById('sett-elev-mode').value, waste:value('sett-waste')};
  try {
    const result = RentalBilling.calculate(activeTenants(), inputs, waterRatio);
    settlementReview = {...result, month:mk(), inputs, tenantSignature:JSON.stringify(activeTenants().map(t=>[t.id,t.unit]))};
    settCalcResult = Object.fromEntries(result.rows.map(r=>[r.id,r]));
    renderSettlementReview(); goSettStep(2);
  } catch(error) { showToast(error.message); }
}
function renderSettlementReview() {
  const result = settlementReview;
  if (!result) return;
  const {totals,balanced} = RentalBilling.reconcile(result);
  document.getElementById('sett-tbody').innerHTML = result.rows.map((row,index) => {
    const values = ['elec','water','elev','waste'].map(key => row[key]===null?null:key==='elec'?withVat(row[key]):row[key]);
    const cells = values.map((value,i) => {
      const key=['elec','water','elev','waste'][i];
      if(value===null)return '<td class="na-cell">—</td>';
      if((key==='elev'&&row.floor>1)||key==='waste')return `<td><input aria-label="${esc(row.unit)} ${key==='elev'?'엘리베이터':'오물비'} 배분액" class="allocation-input" type="number" min="0" step="1" value="${value}" onchange="adjustAllocation(${index},'${key}',this.value)"></td>`;
      return `<td>${fmtN(value)}</td>`;
    }).join('');
    return `<tr><td><strong>${esc(row.unit)}</strong><small>${esc(row.name)}</small></td>${cells}<td class="row-total">${fmtN(values.reduce((a,b)=>a+(b||0),0))}</td></tr>`;
  }).join('') + `<tr class="sum-row"><td>배분 합계</td>${Object.values(totals).map(n=>`<td>${fmtN(n)}</td>`).join('')}<td>${fmtN(Object.values(totals).reduce((a,b)=>a+b,0))}</td></tr>`;
  document.getElementById('sett-result-sub').textContent = `${result.month} · ${result.rows.length}명 · 최종 청구액 기준`;
  document.getElementById('sett-note').innerHTML = `<div class="reconcile ${balanced?'balanced':'unbalanced'}">${balanced?'✓ 입력 실비와 배분 합계가 일치합니다.':'합계 차이가 있습니다. 배분액을 조정해주세요.'}</div>` +
    `<div class="reconcile-details">${Object.keys(totals).map((key,i)=>`${['전기','수도','엘리베이터','오물비'][i]}: ${fmt(totals[key])} / ${fmt(result.expected[key])}`).join(' · ')}</div>` +
    '<p class="card-sub">엘리베이터·오물비는 반올림하지 않습니다. 원 단위 잔액은 낮은 층부터 1원씩 배분하며 위 금액을 직접 조정할 수 있습니다.</p>';
  document.getElementById('confirm-settlement').disabled = !balanced;
}
function adjustAllocation(index, key, value) {
  if (!settlementReview || !['elev','waste'].includes(key)) return;
  try { if(value==='')throw new Error('배분액을 입력해주세요.'); settlementReview.rows[index][key]=RentalBilling.won(value); }
  catch(error) { showToast(error.message); }
  renderSettlementReview();
}
async function confirmSettlement() {
  if (!settlementReview || settlementReview.month!==mk() || settlementReview.tenantSignature!==JSON.stringify(activeTenants().map(t=>[t.id,t.unit]))) {
    showToast('월 또는 세입자 정보가 바뀌었습니다. 다시 계산해주세요.'); return;
  }
  if (!RentalBilling.reconcile(settlementReview).balanced) { showToast('입력 실비와 배분 합계를 맞춰주세요.'); return; }
  const key=mk();
  if(settInputs[key]?.confirmed && !confirm('확정된 정산을 새 배분액으로 바꿀까요? 기존 자료는 복원 지점에 보관합니다.'))return;
  if(!makeRecovery('정산 확정 전'))return;
  bills[key] ??= {};
  for(const row of settlementReview.rows) {
    const bill=bills[key][row.id] ??= {};
    const tenant=findTenant(row.id,key),before=structuredClone(bill);
    snapshotBill(tenant,bill,key);
    if(row.elec!==null){bill.electricity=row.elec;bill.electricityNA=false;if(bill.paid?.pay_elec)bill.paid.pay_elec.na=false;}
    if(row.water!==null){bill.water=row.water;bill.waterNA=false;if(bill.paid?.pay_water)bill.paid.pay_water.na=false;}
    else if(!settlementReview.inputs.waterActive){bill.waterNA=true;if(bill.paid?.pay_water)bill.paid.pay_water.na=true;}
    if(row.elev!==null)bill.elevatorTotal=row.elev;
    bill.waste=row.waste; bill.wasteNA=row.waste===0;
    if(bill.paid?.pay_waste)bill.paid.pay_waste.na=bill.wasteNA;
    auditChargeChange(tenant,before,bill,key);
    addBillAudit(bill,'정산 확정',`${key} 비용 배분`);
  }
  settInputs[key]={...settlementReview.inputs,confirmed:true,confirmedAt:new Date().toISOString(),allocationMode:'exact-gross-v2'};
  if(!await save())return;
  settlementReview=null;settCalcResult=null;renderAll();renderSettTab();showToast('정산 확정 완료 · 고지서에 반영했습니다.');
}
function backToStep1(){settlementReview=null;settCalcResult=null;goSettStep(1);}
function goSettStep(step){
  document.getElementById('sett-step1').style.display=step===1?'block':'none';
  document.getElementById('sett-step2').style.display=step===2?'block':'none';
  [1,2,3].forEach(n=>{
    const d=document.getElementById(`sdot${n}`);const l=document.getElementById(`slbl${n}`);
    if(!d)return;
    d.classList.remove('active','done');l.classList.remove('active');
    if(n<step){d.classList.add('done');}
    if(n===step){d.classList.add('active');l.style.color='var(--gold)';}
    else{l.style.color=n<step?'var(--green)':'var(--text3)';}
  });
  [1,2].forEach(n=>{const l=document.getElementById(`sline${n}`);if(l)l.classList.toggle('done',n<step);});
}

/* ════════════════════════════════════════
   세입자 관리
════════════════════════════════════════ */
function renderTenants(){
  const el=document.getElementById('tenant-list');
  if(!tenants.length){el.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div style="font-size:13px;">세입자가 없어요</div></div>`;return;}
  const query=(document.getElementById('tenant-search')?.value||'').trim().toLowerCase();
  el.innerHTML=tenants.map((t,i)=>{
    if(query&&![t.name,t.biz,t.unit].join(' ').toLowerCase().includes(query))return '';
    const floor=getFloor(t.unit);
    const floorLabel=floor>0?`${floor}F`:'?F';
    return`<div class="t-item" style="cursor:default;">
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
        <button onclick="moveTenant(${i},-1)" ${i===0?'disabled':''} style="background:var(--surface2);border:1px solid var(--border);color:${i===0?'var(--text3)':'var(--text2)'};width:26px;height:26px;border-radius:6px;font-size:11px;cursor:pointer;padding:0;">▲</button>
        <button onclick="moveTenant(${i},1)" ${i===tenants.length-1?'disabled':''} style="background:var(--surface2);border:1px solid var(--border);color:${i===tenants.length-1?'var(--text3)':'var(--text2)'};width:26px;height:26px;border-radius:6px;font-size:11px;cursor:pointer;padding:0;">▼</button>
      </div>
      <div class="t-avatar" style="font-size:12px;letter-spacing:-.5px;">${floorLabel}</div>
      <div class="t-info"><div class="t-name">${esc(t.biz||t.name)}</div><div class="t-unit">${esc(t.name)}·${esc(t.unit)}${esc(t.contract?' · '+t.contract:'')}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button onclick="editTenant('${t.id}')" style="background:var(--surface2);border:1px solid var(--border);color:var(--text2);padding:5px 9px;border-radius:7px;font-size:11px;cursor:pointer;">수정</button>
        <button onclick="${t.archived?'restoreTenant':'deleteTenant'}('${t.id}')" style="background:var(--redbg);border:1px solid rgba(192,57,43,.3);color:var(--red);padding:5px 9px;border-radius:7px;font-size:11px;cursor:pointer;">${t.archived?'보관 해제':'삭제 / 보관'}</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">검색 결과가 없습니다.</div>';
}
async function moveTenant(i,d){const ni=i+d;if(ni<0||ni>=tenants.length)return;[tenants[i],tenants[ni]]=[tenants[ni],tenants[i]];if(!await save())return;renderAll();}
function toggleElecFixed(){const t=document.getElementById('inp-elec-type').value;document.getElementById('elec-fixed-wrap').style.display=t==='fixed'?'block':'none';}
function updateElecPreview(){const v=Number(document.getElementById('inp-elec-fixed')?.value)||0;const e=document.getElementById('elec-preview');if(e)e.textContent=fmt(withVat(v));}
function calcRenewPeriod(s) {
  if(!s)return null;
  const parts=s.split('~').map(x=>x.trim());
  const iso=parts.length===2?RentalBilling.dateISO(parts[1]):'';
  if(!iso)return null;
  const [y,m,d]=iso.split('-').map(Number),ed=new Date(y,m-1,d);
  const subtract=span=>{const start=new Date(y,m-1-span,1);return new Date(start.getFullYear(),start.getMonth(),Math.min(d,new Date(start.getFullYear(),start.getMonth()+1,0).getDate()));};
  const st=subtract(6),ws=subtract(1);
  const fd=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('/');
  return {start:st,warnStart:ws,contractEnd:ed,str:fd(st)+' ~ '+fd(ws)};
}

function updateRenewPreview(){
  const v=document.getElementById('inp-contract')?.value;
  const w=document.getElementById('renew-preview-wrap');const e=document.getElementById('renew-preview');
  const r=calcRenewPeriod(v);
  if(r&&w&&e){w.style.display='block';e.textContent=r.str;}else if(w)w.style.display='none';
}
function openAddTenant(){
  mgmtEdited=false;editTenantId=null;document.getElementById('modal-tenant-title').textContent='세입자 추가';
  ['inp-name','inp-biz','inp-unit','inp-contract','inp-contract-first','inp-payday','inp-renew','inp-rent','inp-elevator','inp-elec-fixed','inp-pm','inp-pr','inp-pe','inp-pev','inp-pw','inp-wd'].forEach(f=>{const e=document.getElementById(f);if(e)e.value=f==='inp-renew'?'1년단위 재계약':'';});
  document.getElementById('inp-paytype').value='후불납';document.getElementById('inp-elec-type').value='none';document.getElementById('inp-wo').value='';
  document.getElementById('elec-fixed-wrap').style.display='none';document.getElementById('renew-preview-wrap').style.display='none';
  document.getElementById('elec-preview').textContent='₩0';
  // 관리비 항목 기본값으로 초기화
  renderMgmtItemsModal(getMgmtItems(null));
  openModal('modal-tenant');
}
function editTenant(id){
  const t=tenants.find(x=>x.id===id);if(!t)return;mgmtEdited=false;editTenantId=id;
  document.getElementById('modal-tenant-title').textContent='세입자 수정';
  ['name','biz','unit','contract','contract_first','payday','renew','rent','elevator'].forEach(f=>{const e=document.getElementById('inp-'+f.replace('_','-'));if(e)e.value=t[f]||t[f.replace('-','_')]||'';});
  updateRenewPreview();
  document.getElementById('inp-paytype').value=t.paytype||'후불납';
  document.getElementById('inp-elec-type').value=t.elecType||'none';
  document.getElementById('inp-elec-fixed').value=t.elecFixed||'';
  document.getElementById('elec-fixed-wrap').style.display=t.elecType==='fixed'?'block':'none';
  updateElecPreview();
  const pm={mgmt:'inp-pm',rent:'inp-pr',elec:'inp-pe',elev:'inp-pev',waste:'inp-pw',water_day:'inp-wd'};
  Object.entries(pm).forEach(([k,id])=>{const e=document.getElementById(id);if(e)e.value=t['period_'+k]||'';});
  document.getElementById('inp-wo').value=t.period_water_odd||'';
  // 관리비 항목 로드
  renderMgmtItemsModal(getMgmtItems(t));
  openModal('modal-tenant');
}
function validateNumbers(containerId) {
  const container = document.getElementById(containerId);
  for (const input of container.querySelectorAll('input[type="number"]')) {
    if (input.disabled) continue;
    const n = Number(input.value);
    const fractional=['inp-loan-rate','bill-water-meter','sett-water-usage','sett-water-f1','wr2','wr3','wr4'].includes(input.id);
    if (input.validity.badInput || !Number.isFinite(n) || n < 0 || n>1e12 || (!fractional&&!Number.isSafeInteger(n))) {
      input.focus(); showToast('금액은 0 이상의 원 단위 정수로, 계량 수치·금리는 유효한 숫자로 입력해주세요.'); return false;
    }
  }
  return true;
}
async function saveTenant(){
  if (!validateNumbers('modal-tenant')) return;
  const name=document.getElementById('inp-name').value.trim();
  const unit=document.getElementById('inp-unit').value.trim();
  if(!name||!unit){showToast('이름과 호수를 입력해주세요');return;}
  const mgmtItems=readMgmtItemsFromModal();
  const mgmtTotal=calcMgmtTotal(mgmtItems);
  const d={name,unit,
    biz:document.getElementById('inp-biz').value.trim(),
    contract:document.getElementById('inp-contract').value.trim(),
    contract_first:document.getElementById('inp-contract-first').value.trim(),
    payday:document.getElementById('inp-payday').value.trim(),
    paytype:document.getElementById('inp-paytype').value,
    renew:document.getElementById('inp-renew').value.trim(),
    rent:document.getElementById('inp-rent').value,
    mgmt:String(mgmtTotal),
    mgmtItems,
    elevator:document.getElementById('inp-elevator').value||'0',
    elecType:document.getElementById('inp-elec-type').value,
    elecFixed:document.getElementById('inp-elec-fixed').value,
    period_mgmt:document.getElementById('inp-pm').value,
    period_rent:document.getElementById('inp-pr').value,
    period_elec:document.getElementById('inp-pe').value,
    period_elev:document.getElementById('inp-pev').value,
    period_waste:document.getElementById('inp-pw').value,
    period_water_day:document.getElementById('inp-wd').value,
    period_water_odd:document.getElementById('inp-wo').value,
  };
  if(d.payday&&!RentalBilling.dueDate(d,'pay_rent',cY,cM)){showToast('월세 지급일은 1~31일 또는 말일로 입력해주세요.');return;}
  for(const field of ['period_mgmt','period_rent','period_elec','period_elev','period_waste','period_water_day'])
    if(d[field]&&(!Number.isInteger(Number(d[field]))||Number(d[field])<1||Number(d[field])>31)){showToast('사용기간 기준일은 1~31일로 입력해주세요.');return;}
  if(editTenantId){
    const previous=tenants.find(t=>t.id===editTenantId);if(!previous)return;
    for(const [month,rows] of Object.entries(bills))if(rows[editTenantId])snapshotBill(previous,rows[editTenantId],month,true);
    if(!mgmtEdited){d.mgmt=previous.mgmt||0;if(previous.mgmtItems)d.mgmtItems=previous.mgmtItems;else delete d.mgmtItems;}
    Object.assign(previous,d);
  } else tenants.push({id:crypto.randomUUID(),...d});
  if(!await save())return;closeModal('modal-tenant');renderAll();showToast(editTenantId?'수정됐어요':'세입자 추가됐어요');
}
async function deleteTenant(id) {
  const tenant=tenants.find(t=>t.id===id);if(!tenant)return;
  const hasHistory=Object.values(bills).some(rows=>rows[id]);
  if(!confirm(hasHistory?'과거 고지서와 체납 기록을 유지하면서 세입자를 보관 처리할까요?':'고지서가 없는 세입자를 삭제할까요? 복원 지점을 남깁니다.'))return;
  if(!makeRecovery('세입자 '+(hasHistory?'보관':'삭제')+' 전'))return;
  if(hasHistory){
    for(const [month,rows] of Object.entries(bills))if(rows[id])snapshotBill(tenant,rows[id],month,true);
    tenant.archived=true;tenant.archivedAt=new Date().toISOString();
  } else {tenants=tenants.filter(t=>t.id!==id);delete renewalDone[id];}
  if(!await save())return;
  refreshDataViews();showToast(hasHistory?'세입자를 보관했습니다. 과거 고지서는 유지됩니다.':'삭제됐어요');
}
async function restoreTenant(id) {
  const tenant=tenants.find(t=>t.id===id);if(!tenant)return;
  tenant.archived=false;delete tenant.archivedAt;
  if(await save()){renderAll();showToast('보관한 세입자를 복구했습니다.');}
}

function calcLoanPrev(){
  const p=Number(document.getElementById('inp-loan-principal')?.value)||0;
  const r=Number(document.getElementById('inp-loan-rate')?.value)||0;
  const el=document.getElementById('loan-prev');const ae=document.getElementById('loan-prev-amt');
  if(!el||!ae)return;
  if(p&&r){ae.textContent=fmt(Math.round(p*(r/100)/12));el.style.display='block';}else el.style.display='none';
}
function openAddLoan(){
  editLoanId=null;['inp-loan-name','inp-loan-principal','inp-loan-rate','inp-loan-maturity'].forEach(f=>{const e=document.getElementById(f);if(e)e.value='';});
  document.getElementById('loan-prev').style.display='none';document.getElementById('modal-loan-title').textContent='대출 추가';openModal('modal-loan');
}
function editLoan(id){
  const l=loans.find(x=>x.id===id);if(!l)return;editLoanId=id;
  document.getElementById('inp-loan-name').value=l.name||'';document.getElementById('inp-loan-principal').value=l.principal||'';
  document.getElementById('inp-loan-rate').value=l.rate||'';document.getElementById('inp-loan-maturity').value=l.maturity||'';
  document.getElementById('modal-loan-title').textContent='대출 수정';calcLoanPrev();openModal('modal-loan');
}
async function saveLoan(){
  if (!validateNumbers('modal-loan')) return;
  const name=document.getElementById('inp-loan-name').value.trim();
  const principal=Number(document.getElementById('inp-loan-principal').value)||0;
  const rate=Number(document.getElementById('inp-loan-rate').value)||0;
  const maturity=document.getElementById('inp-loan-maturity').value.trim();
  if(!name||principal<=0||document.getElementById('inp-loan-rate').value===''){showToast('대출명, 원금, 금리를 입력해주세요');return;}
  if(editLoanId){const l=loans.find(x=>x.id===editLoanId);if(l){l.name=name;l.principal=principal;l.rate=rate;l.maturity=maturity;}}
  else loans.push({id:crypto.randomUUID(),name,principal,rate,maturity});
  if(!await save())return;closeModal('modal-loan');renderLoanList();renderHome();showToast('저장됐어요 ✓');
}
async function deleteLoan(id){if(!confirm('이 대출을 삭제할까요?'))return;if(!makeRecovery('대출 삭제 전'))return;loans=loans.filter(l=>l.id!==id);if(!await save())return;renderLoanList();renderHome();showToast('삭제됐어요');}
function renderLoanList(){
  const el=document.getElementById('loan-list');if(!el)return;
  if(!loans.length){el.innerHTML=`<div class="empty" style="padding:14px;"><div style="font-size:12px;color:var(--text2);">대출 정보를 추가해주세요</div></div>`;return;}
  el.innerHTML=loans.map(l=>{
    const p=Number(l.principal)||0,r=Number(l.rate)||0,m=Math.round(p*(r/100)/12);
    return `<div class="loan-item">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div><div style="font-size:13px;font-weight:700;color:var(--text);">${esc(l.name)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px;">원금 ${fmtN(p)}원 · 연 ${r}%${esc(l.maturity?' · 만기 '+l.maturity:'')}</div></div>
        <div style="text-align:right;"><div style="font-size:10px;color:var(--text2);">월 이자</div>
          <div style="font-family:'DM Mono',monospace;font-size:15px;color:var(--red);">${fmt(m)}</div></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button onclick="editLoan('${l.id}')" style="flex:1;background:var(--surface2);border:1px solid var(--border2);color:var(--text2);padding:6px;border-radius:7px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;">수정</button>
        <button onclick="deleteLoan('${l.id}')" style="flex:1;background:var(--redbg);border:1px solid rgba(192,57,43,.3);color:var(--red);padding:6px;border-radius:7px;font-size:11px;cursor:pointer;font-family:'Noto Sans KR',sans-serif;">삭제</button>
      </div>
    </div>`;
  }).join('');
}
function renderLoanInterestSummary(){
  const w=document.getElementById('loan-summary');const t=document.getElementById('loan-total');const b=document.getElementById('loan-breakdown');
  if(!w||!loans.length){if(w)w.style.display='none';return;}
  w.style.display='block';const total=calcInterest();if(t)t.textContent=fmt(total);
  if(b)b.innerHTML=loans.map(l=>`${esc(l.name)}: ${fmt(Math.round(Number(l.principal)*(Number(l.rate)/100)/12))}`).join(' · ');
}

/* ════════════════════════════════════════
   재계약 체크리스트
════════════════════════════════════════ */
function renderRenewalChecklist(){
  const card=document.getElementById('renewal-card');const el=document.getElementById('renewal-list');if(!card||!el)return;
  const today=new Date();
  const items=activeTenants().filter(t=>{
    const r=calcRenewPeriod(t.contract);if(!r)return false;
    const ce=t.contract?.split('~')[1]?.trim();
    // 갱신완료는 제외, 협의완료+경과+협상기간은 표시
    if(renewalDone[t.id]===ce)return false;
    return today>=r.start||today>=r.warnStart;
  });
  if(!items.length){card.style.display='none';return;}
  card.style.display='block';
  el.innerHTML=items.map(t=>{
    const r=calcRenewPeriod(t.contract);
    const ce=t.contract?.split('~')[1]?.trim();
    const done=renewalDone[t.id];
    const isAgreed=done==='agreed_'+ce;
    const isWarn=today>=r.warnStart;
    return`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:13px;font-weight:700;color:${isWarn?'var(--red)':isAgreed?'var(--green)':'var(--gold)'};">${esc(t.biz||t.name)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;">${esc(isAgreed?'협의완료 · 갱신대기':isWarn?'🚨 갱신기간 경과 ('+ce+' 만료)':'협상가능: '+r.str)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        ${!isAgreed?`<button onclick="agreeRenewal('${t.id}')" style="background:var(--goldbg2);border:1px solid var(--gold);color:var(--gold);padding:5px 10px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;">협의완료</button>`:''}
        <button onclick="completeRenewal('${t.id}')" style="background:rgba(76,175,125,.15);border:1px solid rgba(76,175,125,.4);color:var(--green);padding:5px 10px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;">갱신완료</button>
      </div>
    </div>`;
  }).join('');
}
async function agreeRenewal(id){
  const t=tenants.find(x=>x.id===id);if(!t)return;
  const ce=t.contract?.split('~')[1]?.trim();
  renewalDone[id]='agreed_'+ce;
  if(!await save())return;renderHome();renderRenewalChecklist();showToast('협의완료 처리됐어요 🤝');
}
async function completeRenewal(id){
  const t=tenants.find(x=>x.id===id);if(!t)return;
  renewalDone[id]=t.contract?.split('~')[1]?.trim();
  if(!await save())return;renderHome();renderRenewalChecklist();showToast('계약갱신 완료 ✅');
}

/* ════════════════════════════════════════
   지출
════════════════════════════════════════ */
function openAddExpense(){
  expenseMonth=mk();editExpId=null;document.getElementById('modal-expense-title').textContent='지출 추가';
  ['inp-exp-name','inp-exp-amount','inp-exp-memo'].forEach(f=>{const e=document.getElementById(f);if(e)e.value='';});
  const today=new Date();
  document.getElementById('inp-exp-date').value=expenseMonth.replace('-','/')+'/01';
  openModal('modal-expense');
}
function editExpense(id){
  expenseMonth=mk();const key=expenseMonth;const item=(expenses[key]||[]).find(x=>x.id===id);if(!item)return;
  editExpId=id;document.getElementById('modal-expense-title').textContent='지출 수정';
  document.getElementById('inp-exp-name').value=item.name||'';document.getElementById('inp-exp-amount').value=item.amount||'';
  document.getElementById('inp-exp-date').value=item.date||'';document.getElementById('inp-exp-memo').value=item.memo||'';
  openModal('modal-expense');
}
async function saveExpense(){
  if (!validateNumbers('modal-expense')) return;
  const name=document.getElementById('inp-exp-name').value.trim();const amount=Number(document.getElementById('inp-exp-amount').value)||0;
  const date=document.getElementById('inp-exp-date').value.trim();const memo=document.getElementById('inp-exp-memo').value.trim();
  if(!name||!amount){showToast('항목명과 금액을 입력해주세요');return;}
  const key=expenseMonth||mk();
  const iso=RentalBilling.dateISO(date);
  if(!iso||iso.slice(0,7)!==key){showToast('지출 날짜는 선택한 '+key+' 월의 실제 날짜로 입력해주세요.');return;}
  if(!expenses[key])expenses[key]=[];
  if(editExpId){const idx=expenses[key].findIndex(x=>x.id===editExpId);if(idx!==-1)expenses[key][idx]={id:editExpId,name,amount,date,memo};}
  else expenses[key].push({id:crypto.randomUUID(),name,amount,date,memo});
  if(!await save())return;closeModal('modal-expense');renderExpenseList();renderHome();showToast('저장됐어요 ✓');
}
async function deleteExpense(id){if(!confirm('삭제할까요?'))return;if(!makeRecovery('지출 삭제 전'))return;const key=mk();expenses[key]=(expenses[key]||[]).filter(x=>x.id!==id);if(!await save())return;renderExpenseList();renderHome();showToast('삭제됐어요');}
function renderExpenseList(){
  const el=document.getElementById('expense-list');const tw=document.getElementById('expense-total-wrap');const te=document.getElementById('expense-total');if(!el)return;
  const key=mk();const list=expenses[key]||[];
  if(!list.length){el.innerHTML=`<div style="font-size:12px;color:var(--text2);padding:8px 0;">이달 지출 내역 없음</div>`;if(tw)tw.style.display='none';return;}
  const total=list.reduce((s,x)=>s+(Number(x.amount)||0),0);
  el.innerHTML=list.map(item=>`<div class="expense-item">
    <div><div style="font-size:13px;font-weight:700;color:var(--text);">${esc(item.name)}</div><div style="font-size:11px;color:var(--text2);margin-top:1px;">${esc(item.date||'날짜없음')}${esc(item.memo?' · '+item.memo:'')}</div></div>
    <div style="display:flex;align-items:center;gap:6px;">
      <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--red);font-weight:700;">${fmt(item.amount)}</div>
      <button onclick="editExpense('${item.id}')" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);padding:4px 7px;border-radius:6px;font-size:10px;cursor:pointer;">수정</button>
      <button onclick="deleteExpense('${item.id}')" style="background:var(--redbg);border:1px solid rgba(192,57,43,.3);color:var(--red);padding:4px 7px;border-radius:6px;font-size:10px;cursor:pointer;">삭제</button>
    </div>
  </div>`).join('');
  if(tw){tw.style.display='flex';}if(te)te.textContent=fmt(total);
}

/* ════════════════════════════════════════
   고지서 / 내역
════════════════════════════════════════ */
function renderHistChips(){
  const el=document.getElementById('hist-chips');if(!el)return;
  if(!historyTenants().length){el.innerHTML=`<div style="color:var(--text2);font-size:13px;padding:8px 0;">세입자를 먼저 추가해주세요</div>`;return;}
  el.innerHTML=historyTenants().map(t=>`<div class="chip ${selTenantId===t.id?'active':''}" onclick="selectHistTenant('${t.id}')">${esc(t.biz||t.name)}${t.archived?' · 보관':''}</div>`).join('');
}
function selectHistTenant(id){
  if(typeof flushBillDraft==='function')flushBillDraft();selTenantId=id;histY=cY;histM=cM;renderHistChips();renderHistContent();}
function historyChangeMonth(d){
  if(typeof flushBillDraft==='function')flushBillDraft();histM+=d;if(histM>12){histM=1;histY++;}if(histM<1){histM=12;histY--;}renderHistContent();}
function goToHistory(id){if(typeof flushBillDraft==='function')flushBillDraft();selTenantId=id;histY=cY;histM=cM;switchTab('history');}

function goToBill(id,month){
  goToHistory(id);[histY,histM]=month.split('-').map(Number);renderHistContent();
}
function renderHistContent() {
  const tenant=findTenant(selTenantId), con=document.getElementById('hist-content');
  if(!tenant||!con)return;
  document.getElementById('hist-nav').style.display='flex';
  document.getElementById('hist-month-lbl').textContent=`${histY}년 ${histM}월`;
  const bill=bills[`${histY}-${String(histM).padStart(2,'0')}`]?.[tenant.id];
  if(!bill&&tenant.archived){con.innerHTML='<div class="empty">보관된 세입자입니다. 고지서가 저장된 과거 월을 선택해주세요.</div>';return;}
  if(!bill){con.innerHTML=buildBillFormHtml(tenant,histY,histM);applyBillDraft();return;}
  const state=RentalBilling.payment(tenant,bill);
  const stamp=(type,label)=>{
    const group=state.groups[type],amount=group.total;
    const flag=type==='rent'?'stampedRent':'stampedMgmt';
    return `<div class="payment-card ${group.complete?'is-paid':''}"><div class="payment-heading"><span>${label}</span><span class="status-tag">${group.exempt?'미부과':group.complete?'완납':group.received>0?'일부 확인':'미확인'}</span></div><strong>${fmt(amount)}</strong><div class="payment-date">${group.dates.length?esc(group.dates.join(' · ')):'입금 날짜를 지정해주세요'}</div><button class="btn btn-secondary" onclick="stampBill('${type}')">${bill[flag]?'완납 날짜 변경':'날짜 지정 · 완납 처리'}</button></div>`;
  };
  const rows=PAY_ITEMS.map(item=>{
    const info=state.items[item.key];
    return `<div class="charge-row"><span>${item.label}</span><small class="${info.paid?'paid-text':''}">${info.na?'미부과':info.paid?esc(info.date)+' 확인':'입금 미확인'}</small><strong>${fmt(info.na?0:info.amount)}</strong></div>`;
  }).join('');
  con.innerHTML=`<article class="card bill-document"><div class="bill-heading"><div><span class="eyebrow">MONTHLY STATEMENT</span><h2>${histY}년 ${histM}월 고지서</h2><p>${esc(billTenant(tenant,bill).biz||billTenant(tenant,bill).name)} · ${esc(bill.unitSnapshot??tenant.unit)}</p></div><div class="bill-grand"><small>총 청구액</small><strong>${fmt(state.total)}</strong></div></div>
    ${bill.snapshotEstimated?.length?'<p class="data-warning">과거 원본에 없는 계약·금액 정보 일부를 현재 정보로 보완했습니다. 과거 청구서와 대조가 필요합니다.</p>':''}
    <div class="bill-balance"><span>입금 확인 <strong>${fmt(state.received)}</strong></span><span>미확인 금액 <strong>${fmt(state.unpaid)}</strong></span></div>
    <div class="charge-list">${rows}</div>
    <details class="mgmt-detail"><summary>고정 관리비 세부 항목</summary>${buildMgmtBreakdownHtml(billTenant(tenant,bill))}</details>
    <div class="payment-grid">${stamp('rent','월세')}${stamp('mgmt','관리비·공과금')}</div>
    <p class="card-sub">관리비 도장은 고정 관리비와 전기·수도·엘리베이터·오물비 전체를 완납 처리합니다. 항목별 입금 확인은 고지서 수정에서 관리할 수 있습니다.</p>
    <label class="invoice-check"><input type="checkbox" ${bill.invoiceIssued?'checked':''} onchange="setInvoiceIssued(this.checked)"> 세금계산서 발급 완료 · 안내 메시지에 반영</label>
    <div class="bill-actions"><button class="btn btn-secondary" onclick="editThisMonth()">✏️ 수정</button><button class="btn btn-primary" onclick="previewKakao()">💬 카카오</button><button class="btn btn-secondary" onclick="printCurrentBill()">인쇄 / PDF</button></div>
    ${(bill.audit||[]).length?`<details class="audit-details"><summary>변경 이력 ${(bill.audit||[]).length}건</summary>${[...bill.audit].reverse().map(entry=>`<p><time>${esc(new Date(entry.at).toLocaleString('ko-KR'))}</time> ${esc(entry.action)} · ${esc(entry.detail)}</p>`).join('')}</details>`:''}
    </article>`;
}
function editThisMonth(){const t=findTenant(selTenantId);if(!t)return;document.getElementById('hist-content').innerHTML=buildBillFormHtml(t,histY,histM);applyBillDraft();}

/* 완납 도장 (rent=월세, mgmt=관리비) */
let stampTarget = null;
function stampBill(type) {
  if(!['rent','mgmt'].includes(type)||!selTenantId)return;
  const month=`${histY}-${String(histM).padStart(2,'0')}`;
  const bill=bills[month]?.[selTenantId]||{};
  const flag=type==='rent'?'stampedRent':'stampedMgmt';
  stampTarget={type,month,id:selTenantId};
  document.getElementById('stamp-title').textContent=(type==='rent'?'월세':'관리비·공과금')+' 완납 날짜';
  const now=new Date();
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  document.getElementById('stamp-date').value=RentalBilling.dateISO(bill[flag+'Date'],histY)||today;
  document.getElementById('stamp-remove').hidden=!(bill[flag]||RentalBilling.payment(findTenant(selTenantId),bill).groups[type].received);
  openModal('modal-stamp');
}
async function saveStamp(remove=false) {
  if(!stampTarget)return;
  const date=RentalBilling.dateISO(document.getElementById('stamp-date').value);
  if(!remove&&(!date||date>localToday())){showToast('올바른 완납 날짜를 지정해주세요.');return;}
  const {type,month,id}=stampTarget;
  const tenant=findTenant(id,month);if(!tenant)return;
  bills[month]??={}; const bill=bills[month][id]??={};
  snapshotBill(tenant,bill,month);
  const flag=type==='rent'?'stampedRent':'stampedMgmt';
  const before=bill[flag+'Date']||'미지정';
  bill[flag]=!remove;
  if(remove){
    delete bill[flag+'Date'];
    for(const itemKey of RentalBilling.itemKeys.filter(k=>(k==='pay_rent')===(type==='rent')))if(bill.paid?.[itemKey])delete bill.paid[itemKey].date;
  }else bill[flag+'Date']=date.replaceAll('-','.');
  addBillAudit(bill,(type==='rent'?'월세':'관리비·공과금')+(remove?' 완납 취소':' 완납 날짜 저장'),remove?before:`${before} → ${date}`);
  if(!await save())return;
  closeModal('modal-stamp');renderAll();renderHistChips();renderHistContent();showToast(remove?'완납 처리를 취소했습니다.':'완납 날짜를 저장했습니다.');
}
function addBillAudit(bill,action,detail) {
  bill.audit=[...(bill.audit||[]),{at:new Date().toISOString(),action,detail}].slice(-100);
}
async function setInvoiceIssued(value) {
  const bill=bills[activeMk()]?.[selTenantId];if(!bill)return;
  bill.invoiceIssued=value;addBillAudit(bill,'세금계산서 상태',value?'발급 완료':'발급 미확인');
  if(!await save()){renderHistContent();return;}
}
function printCurrentBill() {
  document.body.classList.add('printing-bill');window.print();
}
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-bill'));
function buildBillFormHtml(t,year,month){
  const uy=year||cY,um=month||cM;
  const key=`${uy}-${String(um).padStart(2,'0')}`;
  const b=((bills[key]||{})[t.id])||{};
  t = billTenant(t, b);
  const wh=(t.waterHistory||[]).filter(w=>w.mk<=key).slice(-4);
  let avg2m=null;
  const awh=(t.waterHistory||[]).filter(w=>w.mk<=key);
  if(awh.length>=2){const us=[];for(let i=1;i<awh.length;i++){const diff=awh[i].val-awh[i-1].val;const[py,pm]=awh[i-1].mk.split('-').map(Number);const[cy,cm]=awh[i].mk.split('-').map(Number);const md=(cy-py)*12+(cm-pm);if(md>0&&diff>=0)us.push(diff/md*2);}if(us.length)avg2m=Math.round(us.reduce((s,v)=>s+v,0)/us.length*10)/10;}
  const wHist=wh.length?wh.map((w,i)=>`<div class="water-hist-item"><span>${esc(w.date)} · <strong>${fmtN(w.val)}</strong></span><div style="display:flex;align-items:center;gap:6px;">${i>0?`<span style="color:var(--green);font-weight:700;">+${fmtN(w.val-wh[i-1].val)} 톤</span>`:'<span style="color:var(--text3);">기준</span>'}<button onclick="deleteWaterMeter('${w.mk}')" style="background:var(--redbg);border:1px solid rgba(192,57,43,.3);color:var(--red);padding:2px 7px;border-radius:5px;font-size:10px;cursor:pointer;">삭제</button></div></div>`).join(''):`<div style="font-size:12px;color:var(--text3);padding:4px 0;">이력 없음</div>`;
  const wasteNA=b.wasteNA===true;const elevV=RentalBilling.charges(t,b).pay_elev;
  return`<div class="card">
    <div class="card-header"><div><div class="card-title">${esc(t.biz||t.name)} · ${esc(t.unit)}</div><div class="card-sub">${uy}년 ${um}월 고지서</div></div></div>
    <div class="section-label">💧 수도계량기 이력</div>
    ${wHist}${avg2m!==null?`<div style="margin-top:5px;font-size:11px;color:var(--gold2);font-weight:700;padding:5px 10px;background:var(--goldbg);border-radius:7px;display:inline-block;">📈 2개월 평균: ${avg2m}톤</div>`:''}
    <div class="water-row" style="margin-top:8px;">
      <input type="number" id="bill-water-meter" placeholder="이번 달 수치" value="${esc(b.waterMeter??'')}">
      <input type="text" id="bill-water-date" placeholder="계량일 MM/DD"
        value="${esc(b.waterMeterDate||String(um).padStart(2,'0')+'/20')}"
        style="width:90px;padding:10px 8px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--r2);color:var(--text);font-size:12px;font-family:'DM Mono',monospace;text-align:center;flex-shrink:0;">
      <button onclick="saveWaterMeter()" style="background:var(--gold);border:none;color:#0a0a0a;padding:9px 13px;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">기록</button>
    </div>
    <div class="divider"></div>
    <div class="section-label">📋 고정 관리비 목록</div>
    <div style="background:var(--surface2);border-radius:10px;padding:10px;font-size:13px;">
      <div class="ov-row"><span class="ov-label">월세</span><span class="ov-value">${fmt(withVat(Number(t.rent)||0))} <span style="font-size:10px;color:var(--text3);">VAT포함</span></span></div>
      <div>
        <div class="ov-row"><span class="ov-label">관리비</span><span class="ov-value">${fmt(withVat(Number(t.mgmt)||0))} <span style="font-size:10px;color:var(--text3);">VAT포함</span></span></div>
        ${buildMgmtBreakdownHtml(t)}
      </div>
      <div class="ov-row"><span class="ov-label">엘리베이터</span><span style="font-family:'DM Mono',monospace;font-size:13px;color:${elevV?'var(--gold)':'var(--text3)'};">${elevV?fmt(elevV)+' <span style="font-size:10px;color:var(--text3);">VAT포함</span>':'미부과'}</span></div>
    </div>
    <div class="divider"></div>
    <div class="section-label">📊 변동금액 (별도 고지)</div>

    <!-- 공용전기세 -->
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
        <label style="margin:0;">공용전기세 (공급가, VAT제외)</label>
        <button onclick="toggleFieldNA('electricity')" style="font-size:11px;padding:6px 12px;border-radius:20px;border:1.5px solid ${b.electricityNA?'var(--red)':'var(--border)'};background:${b.electricityNA?'var(--redbg)':'transparent'};color:${b.electricityNA?'var(--red)':'var(--text3)'};cursor:pointer;">${b.electricityNA?'✕ 미부과':'미부과'}</button>
      </div>
      ${b.electricityNA?`<div style="font-size:11px;color:var(--red);">이번 달 미부과</div>`:`<div><input type="number" id="bill-electricity" placeholder="0" value="${Number(b.electricity)||''}" oninput="updateBillTotal()"><div class="vat-hint">부가세: <span id="vat-electricity">${fmt(vatOf(Number(b.electricity)||0))}</span></div></div>`}
    </div>

    <!-- 수도요금 -->
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
        <label style="margin:0;">수도요금 (원)</label>
        <button onclick="toggleFieldNA('water')" style="font-size:11px;padding:6px 12px;border-radius:20px;border:1.5px solid ${b.waterNA?'var(--red)':'var(--border)'};background:${b.waterNA?'var(--redbg)':'transparent'};color:${b.waterNA?'var(--red)':'var(--text3)'};cursor:pointer;">${b.waterNA?'✕ 미부과':'미부과'}</button>
      </div>
      ${b.waterNA?`<div style="font-size:11px;color:var(--red);">이번 달 미부과</div>`:`<input type="number" id="bill-water" placeholder="0" value="${Number(b.water)||''}" oninput="updateBillTotal()">`}
    </div>

    <!-- 오물처리비 -->
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
        <label style="margin:0;">오물처리비</label>
        <button onclick="toggleWasteNA()" style="font-size:11px;padding:6px 12px;border-radius:20px;border:1.5px solid ${wasteNA?'var(--red)':'var(--border)'};background:${wasteNA?'var(--redbg)':'transparent'};color:${wasteNA?'var(--red)':'var(--text3)'};cursor:pointer;">${wasteNA?'✕ 미부과':'미부과'}</button>
      </div>
      ${wasteNA?`<div style="font-size:11px;color:var(--red);">이번 달 미부과</div>`:`<input type="number" id="bill-waste" placeholder="0" value="${Number(b.waste)||''}" oninput="updateBillTotal()">`}
    </div>

    <div class="bill-total-box"><div class="bill-total-label">이번 달 총 청구액 (VAT포함)</div><div class="bill-total-amount" id="bill-total-display">${fmt(calcSaved(t,b))}</div></div>
    <button class="btn btn-primary" onclick="saveBill()">💾 저장</button>
    <button class="btn btn-green" onclick="previewKakao()">💬 카카오톡 메시지</button>
    <div class="divider"></div>
    <div class="section-label">✅ 납부 확인</div>
    <div id="pay-check-wrap">${renderPayChecks(t,b,uy,um)}</div>
  </div>`;
}
function calcFromInput(t,b) {
  const draft={...b};
  for(const field of ['electricity','water','waste']){
    const input=document.getElementById('bill-'+field);
    if(input)draft[field]=Number(input.value)||0;
  }
  return RentalBilling.payment(t,draft).total;
}
function updateBillTotal(){
  const ev=Number(document.getElementById('bill-electricity')?.value)||0;
  const ve=document.getElementById('vat-electricity');if(ve)ve.textContent=fmt(vatOf(ev));
  const t=findTenant(selTenantId);if(!t)return;
  const b=(bills[activeMk()]||{})[t.id]||{};
  const el=document.getElementById('bill-total-display');if(el)el.textContent=fmt(calcFromInput(t,b));
}
function snapshotBill(tenant,bill,month=activeMk(),legacy=false) {
  if(!tenant)return;
  RentalBilling.freezeBill(tenant,bill,month,legacy);
  if(bill.mgmtItems==null && tenant.mgmtItems && calcMgmtTotal(getMgmtItems(tenant))===Number(bill.mgmt))
    bill.mgmtItems=structuredClone(getMgmtItems(tenant));
}
function billTenant(tenant,bill) {const value=RentalBilling.effectiveTenant(tenant,bill);if(bill.tenantSnapshot&&!bill.mgmtItems)value.mgmtItems=[];return value;}
function auditChargeChange(tenant,before,after,month) {
  const changed=RentalBilling.invalidateChangedPayments(tenant,before,after);
  if(!changed.length)return;
  const oldAmounts=RentalBilling.charges(tenant,before),newAmounts=RentalBilling.charges(tenant,after);
  addBillAudit(after,'청구 변경 · 관련 납부 재확인',changed.map(k=>k+': '+oldAmounts[k]+' → '+newAmounts[k]).join(', '));
  if(changed.some(k=>!['pay_rent','pay_mgmt'].includes(k))&&settInputs[month]?.confirmed)
    settInputs[month]={...settInputs[month],confirmed:false,needsReview:true};
}
function localToday() {
  const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
function captureBillDraft() {
  if(!selTenantId||!document.getElementById('bill-total-display'))return false;
  const key=activeMk(),tenant=findTenant(selTenantId),previous=bills[key]?.[selTenantId]||{};
  if(!tenant||(tenant.archived&&!bills[key]?.[selTenantId]))return false;
  const next=structuredClone(previous);
  snapshotBill(tenant,next,key,Object.keys(previous).length>0);
  for(const field of ['electricity','water','waste']){
    const input=document.getElementById('bill-'+field);if(input)next[field]=Number(input.value||0);
  }
  const meter=document.getElementById('bill-water-meter'),meterDate=document.getElementById('bill-water-date');
  if(meter&&meter.value!==''){
    const date=meterDate.value.trim();
    if(!RentalCore.validMeterDate(date,activeY())){showToast('계량일을 실제 날짜 MM/DD로 입력해주세요.');return false;}
    next.waterMeter=Number(meter.value);next.waterMeterDate=date;
    tenant.waterHistory=[...(tenant.waterHistory||[]).filter(w=>w.mk!==key),{mk:key,date,val:next.waterMeter}].sort((a,b)=>a.mk.localeCompare(b.mk));
  }else if(meter){
    delete next.waterMeter;delete next.waterMeterDate;
    if(tenant.waterHistory)tenant.waterHistory=tenant.waterHistory.filter(w=>w.mk!==key);
  }
  auditChargeChange(tenant,previous,next,key);
  bills[key]??={};bills[key][selTenantId]=next;
  return true;
}

async function saveBill() {
  if (!validateNumbers('hist-content')) return;
  if(!captureBillDraft())return;
  const edited=bills[activeMk()]?.[selTenantId];if(edited)addBillAudit(edited,'고지서 저장','변동 금액·납부 확인');
  if (!await save()) return;
  clearBillDraft();renderHome(); if (selTenantId) renderHistContent(); showToast('저장됐어요 ✓');
}
function toggleWasteNA() { return toggleFieldNA('waste'); }
async function deleteWaterMeter(monthKey) {
  const tenant = findTenant(selTenantId);
  if (!tenant || !confirm('이 계량기 기록을 삭제할까요? 삭제 전 복원 지점을 남깁니다.')) return;
  if (!makeRecovery('계량기 기록 삭제 전')) return;
  if(!captureBillDraft())return;
  tenant.waterHistory = (tenant.waterHistory || []).filter(w => w.mk !== monthKey);
  const bill = (bills[monthKey] || {})[selTenantId];
  if (bill) { delete bill.waterMeter; delete bill.waterMeterDate; }
  if (!await save()) return;
  clearBillDraft();
  document.getElementById('hist-content').innerHTML = buildBillFormHtml(tenant, histY, histM);
  showToast('삭제됐어요');
}
async function saveWaterMeter() {
  const tenant = findTenant(selTenantId);
  if (!tenant || !validateNumbers('hist-content')) return;
  const raw = document.getElementById('bill-water-meter')?.value;
  if (raw === '' || raw == null) { showToast('계량기 수치를 입력해주세요.'); return; }
  const key = activeMk(), year = activeY(), month = activeM();
  const date = document.getElementById('bill-water-date').value.trim();
  if (!RentalCore.validMeterDate(date, year)) { showToast('계량일을 실제 날짜 MM/DD로 입력해주세요.'); return; }
  if(!captureBillDraft())return;
  const history = (tenant.waterHistory || []).filter(w => w.mk !== key);
  history.push({mk: key, date, val: Number(raw)});
  tenant.waterHistory = history.sort((a, b) => a.mk.localeCompare(b.mk));
  if (!await save()) return;
  clearBillDraft();
  document.getElementById('hist-content').innerHTML = buildBillFormHtml(tenant, year, month);
  showToast('계량기 수치 저장 ✓');
}
function calcPeriod(day,year,month){return RentalBilling.period(day,year,month);}
function calcWaterPeriod(t,year,month) {
  if(!t.period_water_day||!t.period_water_odd)return {period:'',active:true};
  const active=month%2===(t.period_water_odd==='odd'?1:0);
  const endMonth=new Date(year,month-2,1);
  return {period:active?RentalBilling.period(t.period_water_day,endMonth.getFullYear(),endMonth.getMonth()+1,2):'',active};
}
async function toggleFieldNA(field) {
  if (!['electricity', 'water', 'waste'].includes(field) || !validateNumbers('hist-content')) return;
  if(!captureBillDraft())return;
  const key = activeMk();
  bills[key] ??= {}; bills[key][selTenantId] ??= {};
  const bill = bills[key][selTenantId];
  const before=structuredClone(bill);
  const itemKey=Object.keys(RentalBilling.naFields).find(k=>RentalBilling.naFields[k]===field+'NA');
  const target=!RentalBilling.payment(findTenant(selTenantId),bill).items[itemKey].na;
  bill[field+'NA']=target;bill.paid??={};bill.paid[itemKey]={...bill.paid[itemKey],na:target};
  auditChargeChange(findTenant(selTenantId),before,bill,key);
  if (!await save()) return;
  clearBillDraft();
  const tenant = findTenant(selTenantId);
  document.getElementById('hist-content').innerHTML = buildBillFormHtml(tenant, histY, histM);
  renderHome();
}
async function toggleNA(itemKey) {
  if(!RentalBilling.itemKeys.includes(itemKey)||!validateNumbers('hist-content')||!captureBillDraft())return;
  const key=activeMk(),bill=bills[key][selTenantId],tenant=findTenant(selTenantId),before=structuredClone(bill);
  const target=!RentalBilling.payment(tenant,bill).items[itemKey].na;
  bill.paid??={};bill.paid[itemKey]={...bill.paid[itemKey],na:target};
  const field=RentalBilling.naFields[itemKey];if(field)bill[field]=target;
  auditChargeChange(tenant,before,bill,key);
  if(!await save())return;
  clearBillDraft();document.getElementById('hist-content').innerHTML=buildBillFormHtml(tenant,histY,histM);renderHome();
}
async function updatePay(itemKey,field,value) {
  if(field!=='date'||!RentalBilling.itemKeys.includes(itemKey))return;
  const date=RentalBilling.dateISO(value,activeY());
  if(value&&(!date||date>localToday())){
    showToast('입금일은 오늘까지의 실제 날짜로 입력해주세요.');
    const tenant=findTenant(selTenantId),bill=bills[activeMk()]?.[selTenantId]||{};
    document.getElementById('pay-check-wrap').innerHTML=renderPayChecks(tenant,bill,activeY(),activeM());return;
  }
  if(!validateNumbers('hist-content')||!captureBillDraft())return;
  const bill=bills[activeMk()][selTenantId],tenant=findTenant(selTenantId);
  RentalBilling.materializeGroup(tenant,bill,itemKey);
  bill.paid??={};const before=bill.paid[itemKey]?.date||'미확인';
  bill.paid[itemKey]={...bill.paid[itemKey],date:date.replaceAll('-','.')};
  addBillAudit(bill,'항목 납부 날짜 변경',itemKey+': '+before+' → '+(date||'미확인'));
  if(!await save()){
    const savedTenant=findTenant(selTenantId),savedBill=bills[activeMk()]?.[selTenantId]||{};
    document.getElementById('pay-check-wrap').innerHTML=renderPayChecks(savedTenant,savedBill,activeY(),activeM());
    updateBillTotal();return;
  }
  clearBillDraft();document.getElementById('pay-check-wrap').innerHTML=renderPayChecks(tenant,bill,activeY(),activeM());renderHome();updateBillTotal();
}

function renderPayChecks(t,b,y,m){
  const uy=y||cY,um=m||cM,paid=b.paid||{};
  const timing=Object.keys(b).length?RentalBilling.historicalPayment(t,b,uy,um,new Date()):null;
  const ap={
    pay_mgmt:calcPeriod(t.period_mgmt,uy,um),pay_rent:calcPeriod(t.period_rent,uy,um),
    pay_elec:calcPeriod(t.period_elec,uy,um),pay_elev:calcPeriod(t.period_elev,uy,um),
    pay_waste:calcPeriod(t.period_waste,uy,um),
  };
  const wc=calcWaterPeriod(t,uy,um);
  return PAY_ITEMS.map(item=>{
    const p=paid[item.key]||{};const state=timing?.items[item.key];const isW=item.key==='pay_water';
    const autoPer=isW?wc.period:(ap[item.key]||'');
    const date=state?.date||p.date||'';const isNA=state?.na??p.na===true;
    const confirmed=state?.status==='paid';
    const statusNote=state?.status==='overdue'?`<span style="display:block;color:var(--red);margin-top:2px;">기한 경과 · ${fmt(state.amount)}</span>`:
      state?.status==='notDue'&&state.dueDate?`<span style="display:block;color:var(--text3);margin-top:2px;">지급기일 ${state.dueDate.replaceAll('-','.')}</span>`:'';
    return`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);${isNA?'opacity:.4;':''}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${item.label}</div>
        ${autoPer?`<div style="font-size:10px;color:var(--text2);margin-top:2px;font-family:'DM Mono',monospace;">${autoPer}</div>`:''}
        ${statusNote}
      </div>
      ${isNA
        ?`<button onclick="toggleNA('${item.key}')" style="font-size:10px;padding:4px 10px;border-radius:20px;border:1.5px solid var(--red);background:var(--redbg);color:var(--red);cursor:pointer;flex-shrink:0;">미부과</button>`
        :`<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <input type="text" aria-label="${esc(item.label)} 입금일" placeholder="YYYY.MM.DD" value="${esc(date)}"
            onchange="updatePay('${item.key}','date',this.value)"
            style="width:114px;padding:7px 9px;background:var(--surface2);
            border:1.5px solid ${confirmed?'var(--green)':'var(--border)'};border-radius:7px;
            color:${confirmed?'var(--green)':'var(--text)'};font-size:12px;font-family:'DM Mono',monospace;text-align:center;">
          <button onclick="toggleNA('${item.key}')" style="font-size:10px;padding:4px 8px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--text3);cursor:pointer;white-space:nowrap;">미부과</button>
        </div>`}
    </div>`;
  }).join('');
}

/* 카카오 메시지 */
async function previewKakao(){
  if(document.getElementById('bill-total-display')){if(!validateNumbers('hist-content'))return;if(!captureBillDraft())return;if(!await save())return;clearBillDraft();}
  let t=findTenant(selTenantId);if(!t)return;
  const uy=activeY(),um=activeM();const key=`${uy}-${String(um).padStart(2,'0')}`;
  const b=(bills[key]||{})[t.id]||{};const mm=String(um).padStart(2,'0');
  t = billTenant(t, b);

  // 날짜 관련 계산
  const prevDate = new Date(uy, um - 2, 1);
  const py = prevDate.getFullYear(), pm = prevDate.getMonth() + 1;
  const nextDate = new Date(uy, um, 1);
  const ny = nextDate.getFullYear(), nm = nextDate.getMonth() + 1;

  // payday 파싱
  const mMatch = (t.payday || '').match(/\d+/);
  const pd = mMatch ? Number(mMatch[0]) : 1;

  // 산정 기간: 월세/관리비/승강기
  const prevMonthStr = String(pm).padStart(2, '0');
  const thisMonthStr = mm;
  const startDayStr = String(pd).padStart(2, '0');
  let endY = uy, endM = um, endD = pd - 1;
  if (endD === 0) {
    const lastD = new Date(uy, um - 1, 0);
    endY = lastD.getFullYear();
    endM = lastD.getMonth() + 1;
    endD = lastD.getDate();
  }
  const rentPeriod = `${py}/${prevMonthStr}/${startDayStr} ~ ${endY}/${String(endM).padStart(2, '0')}/${String(endD).padStart(2, '0')}`;
  const elecPeriod = `${py}/${prevMonthStr}/24 ~ ${uy}/${thisMonthStr}/23`;

  // 금액 계산
  const rentNet = Number(t.rent) || 0;
  const rentVat = withVat(rentNet) - rentNet;
  const rentTotal = rentNet + rentVat;

  const mgmtNet = Number(t.mgmt) || 0;
  const mgmtVat = withVat(mgmtNet) - mgmtNet;
  const mgmtTotal = mgmtNet + mgmtVat;

  const elecNet = b.electricityNA ? 0 : (Number(b.electricity) || 0);
  const elecVat = withVat(elecNet) - elecNet;
  const elecTotal = elecNet + elecVat;

  const elevNet = b.paid?.pay_elev?.na ? 0 : (RentalBilling.charges(t, b).pay_elev || 0);
  const elevVat = withVat(elevNet) - elevNet;
  const elevTotal = elevNet + elevVat;

  // 수도 관련 (홀수월 정산)
  const waterTargetMonth = (um % 2 === 0) ? `${uy}-${String(um - 1).padStart(2, '0')}` : key;
  const waterTargetM = (um % 2 === 0) ? (um - 1) : um;
  const nextWaterM = (um % 2 === 0) ? (um + 1) : (um + 2);
  const wb = (bills[waterTargetMonth] || {})[t.id] || {};
  const waterAmt = Number(wb.water) || 0;

  const waterPeriodMap = {
    1: `${uy - 1}/10/21 ~ ${uy - 1}/12/20`,
    3: `${uy - 1}/12/21 ~ ${uy}/02/20`,
    5: `${uy}/02/21 ~ ${uy}/04/20`,
    7: `${uy}/04/21 ~ ${uy}/06/20`,
    9: `${uy}/06/21 ~ ${uy}/08/20`,
    11: `${uy}/08/21 ~ ${uy}/10/20`
  };

  // 상태 판정
  const isRentPaid = b.paid?.pay_rent?.paid || b.stampedRent;
  const isMgmtPaid = b.paid?.pay_mgmt?.paid || b.stampedMgmt;
  const isElecPaid = b.paid?.pay_elec?.paid;
  const isElevPaid = b.paid?.pay_elev?.paid;
  const isWaterPaid = wb.paid?.pay_water?.paid;

  const rentStatus = isRentPaid ? '✅ 납부완료' : '[연체중]';
  const mgmtStatus = isMgmtPaid ? '✅ 납부완료' : '[연체중]';
  const elecStatus = isElecPaid ? '✅ 납부완료' : '[연체중]';
  const elevStatus = isElevPaid ? '✅ 납부완료' : '[연체중]';
  const waterStatus = isWaterPaid ? '✅ 납부완료' : '[연체중]';

  // 입금 확인일
  const rentPaidDate = b.paid?.pay_rent?.date || (b.stampedRentDate ? b.stampedRentDate : '');
  const mgmtPaidDate = b.paid?.pay_mgmt?.date || (b.stampedMgmtDate ? b.stampedMgmtDate : '');

  // 요청 금액 계산
  let totalDue = 0;
  const unpaidItems = [];
  if (!isRentPaid && rentTotal > 0) { totalDue += rentTotal; unpaidItems.push(`${um}월 월세 ${fmtN(rentTotal)}원`); }
  if (!isMgmtPaid && mgmtTotal > 0) { totalDue += mgmtTotal; unpaidItems.push(`${um}월 관리비 ${fmtN(mgmtTotal)}원`); }
  if (!isElecPaid && elecTotal > 0) { totalDue += elecTotal; unpaidItems.push(`${um}월 공용전기료 ${fmtN(elecTotal)}원`); }
  if (!isElevPaid && elevTotal > 0) { totalDue += elevTotal; unpaidItems.push(`${um}월 승강기 유지관리보수비 ${fmtN(elevTotal)}원`); }
  if (!isWaterPaid && waterAmt > 0) { totalDue += waterAmt; unpaidItems.push(`${waterTargetM}월 수도요금 ${fmtN(waterAmt)}원`); }

  // 재계약 기간
  const rp = calcRenewPeriod(t.contract);

  // 수도 정산 섹션 생성
  const waterHistory = t.waterHistory || [];
  const oddMonths = [3, 5, 7, 9].filter(m => m <= (um % 2 === 0 ? um + 1 : um));
  const waterBlocks = oddMonths.map(m => {
    const mk = `${uy}-${String(m).padStart(2, '0')}`;
    const curW = waterHistory.find(w => w.mk === mk);
    const mb = (bills[mk] || {})[t.id] || {};
    const mAmt = Number(mb.water) || 0;
    const isPaid = mb.paid?.pay_water?.paid;
    const isFuture = m > um;

    if (isFuture) {
      return `[${m}월 수도]

정산 대상 기간 : ${waterPeriodMap[m] || ''}
주방 보조계량기 : ${curW ? fmtN(curW.val) : '정산 전'}
배분 기준 증감값 : -
정산 예정일 : ${uy}/${String(m).padStart(2, '0')}/30
수도요금 : 상수도 정기고지 전
상태 : 정산 예정

※ 해당 기간 수도요금은 건물 전체 수도요금 확정 후 1층 사용분을 제외하고, 2~5층 주방 보조계량기 증감값을 기준으로 배분하여 실비 정산합니다.
※ ${m}월 수도요금은 이번 입금 요청금액에 포함되지 않습니다.`;
    }

    return `[${m}월 수도]${isPaid ? '' : ' [연체중]'}

정산 대상 기간 : ${waterPeriodMap[m] || ''}
수도요금 : ${fmtN(mAmt)}원
상태 : ${isPaid ? '✅ 납부완료' : '[연체중]'}`;
  }).join('\n\n---\n\n');

  // 관리비 세부 항목
  let mgmtLines = '';
  if (t.mgmtItems?.length && calcMgmtTotal(getMgmtItems(t)) === mgmtNet) {
    ALL_MGMT_ITEMS.forEach(def => {
      const x = getMgmtItems(t).find(i => i.key === def.key) || {status: def.defaultStatus, amount: def.defaultAmt};
      let amtStr;
      if (x.status === 'active') amtStr = x.amount > 0 ? fmtN(x.amount) + '원' : '0원';
      else if (x.status === 'actual') amtStr = '실비정산';
      else amtStr = '미운영';
      mgmtLines += `\n${def.no}. ${x.name || def.name} : ${amtStr}`;
    });
  } else {
    mgmtLines = `\n1-1. 건물 관리 운영비 : 60,000원\n1-2. 관리 행정 운영비 : 100,000원\n2-1. 청소 용역비 : 50,000원\n2-2. 건물 환경 관리비 : 20,000원\n3. 경비비 : 미운영\n4. 소독비 : 미운영\n5. 승강기 유지비 : ${elevTotal > 0 ? '별도 부과' : '미운영'}\n6. 냉난방비 및 급탕비 : 미운영\n7-1. 소방 안전 관리비 : 10,000원\n7-2. 시설 유지 관리비 : 60,000원\n7-3. 보안 방범 관리비 : 미운영\n7-4. 냉방 시설 청소비 : 미운영\n8. 위탁관리 수수료 : 미운영\n9. 전기료 : 별도 부과\n10. 수도료 : 별도 실비정산\n11. 가스 사용료 : 미운영\n12. 정화조 오물처리 수수료 : 실비정산\n13. 폐기물 처리 수수료 : 미운영\n14. 건물 보험료 : 미운영`;
  }

  const extraTotal = mgmtTotal + elecTotal + elevTotal;

  const msg = `[알림] ${uy}년 ${um}월 관리내역 및 납부 현황 안내

안녕하세요, [${t.biz || t.name}/${t.name}] 사장님.

■ 간략 납부 현황

${um}월 월세 (${rentPeriod})
: ${fmtN(rentTotal)}원 ${rentStatus}

${um}월 관리비 (${rentPeriod})
: ${fmtN(mgmtTotal)}원 ${mgmtStatus}
(공급가액 ${fmtN(mgmtNet)}원 + 부가세 ${fmtN(mgmtVat)}원)

${um}월 공용전기료 (${elecPeriod})
: ${fmtN(elecTotal)}원 ${elecStatus}
(공급가액 ${fmtN(elecNet)}원 + 부가세 ${fmtN(elecVat)}원)

${um}월 승강기 유지관리보수비 (${rentPeriod})
: ${fmtN(elevTotal)}원 ${elevStatus}
(공급가액 ${fmtN(elevNet)}원 + 부가세 ${fmtN(elevVat)}원)

${waterTargetM}월 수도요금 (${waterPeriodMap[waterTargetM] || ''})
: ${fmtN(waterAmt)}원 ${waterStatus}

현재 입금 요청금액 : ${fmtN(totalDue)}원

※ ${nextWaterM}월 수도요금 (${waterPeriodMap[nextWaterM] || ''})은 정산 예정으로, 이번 입금 요청금액에 포함되지 않습니다.

전자세금계산서는 ${ny}/${String(nm).padStart(2, '0')}/10까지 발급 예정이며, 관리내역 및 납부 현황 확인을 위해 카카오톡으로 먼저 고지드립니다.

납부금액은 상단에 간략히 정리하였으며, 필요하신 경우 하단의 상세 내용을 확인해 주시기 바랍니다.

---

■ 계약 현황

현재 계약 상태 : 정상 계약

최초 계약 기간 : ${t.contract_first || ''}
현재 계약 기간 : ${t.contract || ''}
재계약 협의 예정 기간 : ${rp ? rp.str : ''}

납입 기준일
- 월세 : 매월 ${pd}일
- 관리비 : 매월 말일 (관리인 고지 후)

※ ${t.paytype || '후불납'}
※ ${t.renew || '1년 단위 재계약'}

---

■ 재계약 안내

- 계약 종료 6개월 전 ~ 1개월 전 사이에 임대인 또는 임대인으로부터 권한을 위임받은 관리인(대리인)이 재계약 관련 안내 및 협의를 진행합니다.
- 재계약 시 계약 조건을 확인한 후 재계약서를 작성하며, 임대인·임차인 각 1부씩 보관합니다.
- 임대인 또는 임차인이 직접 참석하지 않는 경우 적법하게 권한을 위임받은 대리인을 통해 계약을 진행할 수 있습니다.
- 대리인이 계약을 진행하는 경우 위임관계를 확인 후 계약서를 작성합니다.

---

■ 수도요금 정산 현황

※ 2~5층 주방에 설치된 계량기는 각 층의 실제 수도요금을 직접 산출하는 계량기가 아니라, 층별 수도요금 배분을 위한 보조계량기입니다.

※ 건물 전체 수도요금에서 별도 산정되는 1층 사용분을 제외한 후, 나머지 2~5층 수도요금을 각 층 주방 보조계량기의 검침 증감값을 기준으로 비율 배분하여 실비 정산합니다.

※ 아래 보조계량기의 증감값은 해당 층의 실제 수도 사용량(㎥)을 직접 의미하지 않으며, 수도요금 배분을 위한 기준값으로 사용됩니다.

※ 수도요금은 상수도 정기고지 일정에 따라 2개월 단위로 정산합니다.

---

${waterBlocks}

---

■ ${um}월 월세

산정 기간 : ${rentPeriod}

월세 : ${fmtN(rentTotal)}원
상태 : ${rentStatus}${rentPaidDate ? ` (${rentPaidDate} 입금 확인)` : ''}

---

■ ${um}월 관리비

산정 기간 : ${rentPeriod}

공급가액 : ${fmtN(mgmtNet)}원
부가세 : ${fmtN(mgmtVat)}원
합계 : ${fmtN(mgmtTotal)}원
${mgmtLines}

상태 : ${mgmtStatus}

---

■ ${um}월 별도 부과항목

[공용전기료]

산정 기간 : ${elecPeriod}

공급가액 : ${fmtN(elecNet)}원
부가세 : ${fmtN(elecVat)}원
합계 : ${fmtN(elecTotal)}원
상태 : ${elecStatus}

---

[승강기 유지관리보수비]

산정 기간 : ${rentPeriod}

공급가액 : ${fmtN(elevNet)}원
부가세 : ${fmtN(elevVat)}원
합계 : ${fmtN(elevTotal)}원
상태 : ${elevStatus}

---

■ ${um}월 관리비 및 별도 부과항목 합계

관리비 : ${fmtN(mgmtTotal)}원
공용전기료 : ${fmtN(elecTotal)}원
승강기 유지관리보수비 : ${fmtN(elevTotal)}원

합계 : ${fmtN(extraTotal)}원
상태 : ${mgmtStatus}${mgmtPaidDate ? ` (${mgmtPaidDate} 입금 확인)` : ''}

※ 미운영 항목은 현재 관리비에 포함되어 있지 않으며 비용을 부과하지 않습니다.

향후 건물 운영 여건, 법령 변경 또는 공용시설 운영 필요에 따라 해당 항목이 신설·운영될 수 있으며, 이 경우 관련 법령 및 임대차계약에 따라 사전에 안내 후 적용될 수 있습니다.

---

■ 현재 납부 현황

${um}월 월세 (${rentPeriod})
: ${fmtN(rentTotal)}원 ${rentStatus}

${um}월 관리비 (${rentPeriod})
: ${fmtN(mgmtTotal)}원 ${mgmtStatus}
(공급가액 ${fmtN(mgmtNet)}원 + 부가세 ${fmtN(mgmtVat)}원)

${um}월 공용전기료 (${elecPeriod})
: ${fmtN(elecTotal)}원 ${elecStatus}
(공급가액 ${fmtN(elecNet)}원 + 부가세 ${fmtN(elecVat)}원)

${um}월 승강기 유지관리보수비 (${rentPeriod})
: ${fmtN(elevTotal)}원 ${elevStatus}
(공급가액 ${fmtN(elevNet)}원 + 부가세 ${fmtN(elevVat)}원)

${waterTargetM}월 수도요금 (${waterPeriodMap[waterTargetM] || ''})
: ${fmtN(waterAmt)}원 ${waterStatus}

${nextWaterM}월 수도요금 (${waterPeriodMap[nextWaterM] || ''})
: 정산 예정 / 이번 입금 요청금액에 미포함

현재 입금 요청금액 : ${fmtN(totalDue)}원

전자세금계산서는 ${ny}/${String(nm).padStart(2, '0')}/10까지 발급 예정입니다.

${totalDue > 0 ? `기존 미입금된 ${unpaidItems.join(', ')} 확인 후 입금 부탁드립니다.` : '전액 입금 확인되었습니다. 감사합니다.'}

감사합니다.

다인빌딩 관리인`;

  document.getElementById('kakao-msg-wrap').innerHTML=`<div class="kakao-box" id="kakao-text">${msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
  openModal('modal-receipt');
}
async function copyKakao() {
  const el = document.getElementById('kakao-text'); if (!el) return;
  try { await navigator.clipboard.writeText(el.innerText); showToast('복사됐어요! 카카오톡에 붙여넣기 📋'); }
  catch { showToast('자동 복사를 사용할 수 없습니다. 메시지 내용을 선택해서 복사해주세요.'); }
}

async function saveWaterRatio() {
  if (!validateNumbers('section-settings')) return;
  const values = ['wr2', 'wr3', 'wr4'].map(id => document.getElementById(id).value);
  if (values.some(v => v === '') || values.reduce((sum, v) => sum + Number(v), 0) <= 0) {
    showToast('각 비율을 입력하고 합계를 0보다 크게 지정해주세요.'); return;
  }
  waterRatio = {r2: Number(values[0]), r3: Number(values[1]), r4: Number(values[2])};
  if (await save()) showToast('비율 저장됐어요 ✓');
}
function loadWaterRatioInputs(){const e2=document.getElementById('wr2');const e3=document.getElementById('wr3');const e4=document.getElementById('wr4');if(e2)e2.value=waterRatio.r2;if(e3)e3.value=waterRatio.r3;if(e4)e4.value=waterRatio.r4;}
function downloadJson(data, label) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = `임대관리_${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData() {
  try {
    flushBillDraft();
    if (loadedState.error) {
      const raw = {};
      [RentalCore.STATE_KEY, ...RentalCore.KEYS].forEach(key => raw[key] = appStorage.getItem(key));
      downloadJson({recoveryRaw: raw}, '손상원본');
    } else downloadJson({...RentalCore.envelope(failedSaveData||currentData()),localDrafts:collectBillDrafts()}, failedSaveData?'미저장작업_복구':'백업');
    showToast('백업 파일 다운로드를 시작했습니다.');
  } catch (error) { showToast('내보내기 실패: ' + error.message); }
}
function backupCurrentData(reason) {
  const snapshot={reason,...RentalCore.envelope(currentData()),localDrafts:collectBillDrafts()};
  appStorage.setItem(RentalCore.BACKUP_KEY,JSON.stringify(snapshot));
  return snapshot;
}
function makeRecovery(reason) {
  if (syncBusy || storageFault || conflictingTab) { showToast('저장 또는 동기화 상태를 먼저 확인해주세요.'); return false; }
  try { assertCurrentStorage();backupCurrentData(reason); return true; }
  catch { showToast('복원 지점을 저장하지 못해 작업을 중단했습니다. 파일 백업과 저장 공간을 확인해주세요.'); return false; }
}
async function replaceData(data, reason, drafts = {}) {
  if(syncBusy||persistenceBusy||conflictingTab)throw new Error('동기화 또는 다른 창의 변경을 먼저 확인해주세요.');
  clearTimeout(saveTimer);persistenceBusy=true;
  try {
    await writeLocal(data,true,null,()=>{
      if(loadedState.error){
        const raw={};
        [RentalCore.STATE_KEY,...RentalCore.KEYS].forEach(key=>raw[key]=appStorage.getItem(key));
        appStorage.setItem('rentalApp.damaged.v1',JSON.stringify(raw));
      } else backupCurrentData(reason);
    });
    assignData(data);storageFault=null;loadedState.error=null;failedSaveData=null;
    cloudDirty=true;cloudBaseRevision=null;
    const draftsSaved=storeBillDrafts(drafts);
    showDataNotice(draftsSaved?'':'자료는 복원했으나 초안을 저장하지 못했습니다. 초안은 현재 창에 보관 중이므로 창을 닫기 전에 백업을 내보내주세요.');
    refreshDataViews();syncUI('local');
  } finally {persistenceBusy=false;}
}

async function restoreRecovery() {
  try {
    const raw = appStorage.getItem(RentalCore.BACKUP_KEY);
    if (!raw) { showToast('아직 복원 지점이 없습니다.'); return; }
    const backup = JSON.parse(raw);
    const data = RentalCore.validateData(backup);
    if (!confirm(`${backup.reason || '이전 데이터'} (${backup.exportedAt || ''})로 되돌릴까요?`)) return;
    await replaceData(data, '복원 지점으로 되돌리기 전',validateDrafts(backup.localDrafts));
    showToast('복원 완료 · 구글 저장은 별도로 실행해주세요.');
  } catch (error) { showToast('복원 실패: ' + error.message); }
}
function importData(event) {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast('10MB 이하의 JSON 백업을 선택해주세요.'); return; }
  const startedRevision=revision, startedDraft=draftVersion;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed=JSON.parse(reader.result);
      const data = RentalCore.validateData(parsed);
      if(revision!==startedRevision||draftVersion!==startedDraft)throw new Error('파일을 읽는 동안 편집이 발생했습니다. 다시 가져와주세요.');
      if (!confirm(`세입자 ${data.tenants.length}명, 고지서 ${Object.keys(data.bills).length}개월의 백업으로 교체할까요?`)) return;
      await replaceData(data, '파일 가져오기 전',validateDrafts(parsed.localDrafts));
      showToast('가져오기 완료 · 구글 저장은 별도로 실행해주세요.');
    } catch (error) { showToast('가져오기 실패: ' + error.message); }
  };
  reader.onerror = () => showToast('파일을 읽지 못했습니다.');
  reader.readAsText(file);
}
async function resetAllData() {
  if (!confirm('이 앱의 데이터를 초기화할까요? 현재 자료는 복원 지점에 남기며 구글 데이터는 유지합니다.')) return;
  try { await replaceData(RentalCore.empty(), '초기화 전'); showToast('초기화 완료 · 백업 / 복원에서 되돌릴 수 있습니다.'); }
  catch (error) { showToast('초기화 실패: ' + error.message); }
}
let previousFocus = null;
function openModal(id) {
  const modal = document.getElementById(id);
  previousFocus = document.activeElement;
  modal.classList.add('open');
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', modal.querySelector('.modal-title')?.textContent || '상세 입력');
  modal.querySelector('input, select, button')?.focus();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  previousFocus?.focus();
}
document.querySelectorAll('.modal-overlay').forEach(modal => modal.addEventListener('click', event => {
  if (event.target === modal) closeModal(modal.id);
}));
document.addEventListener('keydown', event => {
  const modal = document.querySelector('.modal-overlay.open'); if (!modal) return;
  if (event.key === 'Escape') { closeModal(modal.id); return; }
  if (event.key !== 'Tab') return;
  const items = [...modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
    .filter(el => !el.disabled && el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
  else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
});
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = storageFault || conflictingTab ? '저장 상태를 확인해주세요. 상단 안내를 참고하세요.' : message;
  toast.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

/* 실시간 날짜 표시 */
const DAYS_EN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function updateLiveDate(){
  const now=new Date();
  const yy=String(now.getFullYear()).slice(2);
  const mo=String(now.getMonth()+1).padStart(2,'0');
  const d=String(now.getDate()).padStart(2,'0');
  const day=DAYS_EN[now.getDay()];
  const main=document.getElementById('live-date-main');
  if(main)main.textContent=`${yy}/${mo}/${d} (${day})`;
}

/* Init */
document.addEventListener('input',event=>{
  if(event.target.closest('#mgmt-items-wrap'))mgmtEdited=true;
});
document.addEventListener('change',event=>{
  if(event.target.closest('#mgmt-items-wrap'))mgmtEdited=true;
});
document.addEventListener('DOMContentLoaded',()=>{
  for(const [month,rows] of Object.entries(bills))for(const [id,bill] of Object.entries(rows))
    snapshotBill(findTenant(id,month),bill,month,true);
  lastCommitted=structuredClone(currentData());
  updateMonthLabel();loadWaterRatioInputs();renderAll();syncUI(cloudEnabled&&cloudDirty?'pending':'local');
  document.getElementById('cloud-enabled').checked = cloudEnabled;
  document.getElementById('cloud-enabled').disabled=isDemo;
  document.getElementById('demo-banner').hidden=!isDemo;
  switchTab('home');
  if(storageFault)showDataNotice('저장된 데이터를 읽지 못했습니다. 원본은 보존했습니다. 백업 파일로 복원하거나 손상 원본을 내보내주세요.');
  updateLiveDate();
  setInterval(updateLiveDate, 60000);
});
// PWA metadata and worker are optional; local files need neither URL.
if(location.protocol==='http:' || location.protocol==='https:') {
  const manifest=document.createElement('link');
  manifest.rel='manifest';manifest.href='./manifest.json';document.head.appendChild(manifest);
}
if('serviceWorker'in navigator && (location.protocol==='https:'||(location.protocol==='http:'&&['localhost','127.0.0.1'].includes(location.hostname)))) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
      const notice=()=>{const el=document.getElementById('app-update-notice');if(el){el.hidden=false;el.textContent='새 버전이 준비됐습니다. 작업을 저장하고 이 앱의 모든 창을 닫은 뒤 다시 열면 적용됩니다.';}};
      if(reg.waiting)notice();
      reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',()=>{if(reg.waiting&&navigator.serviceWorker.controller)notice();}));
    }).catch(()=>{const el=document.getElementById('app-update-notice');if(el){el.hidden=false;el.textContent='오프라인 앱 준비에 실패했습니다. 온라인 상태에서 다시 열어주세요.';}});
  });
}
