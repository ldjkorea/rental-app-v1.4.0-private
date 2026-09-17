const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');

function server(options={}) {
  let held=false,fail='',writes=0,maxRows=1000;
  const initialRaw=options.raw||JSON.stringify({tenants:[],bills:{}});
  const targetRows=[];
  for(let i=0;i<initialRaw.length;i+=35000)targetRows.push([initialRaw.slice(i,i+35000)]);
  if(!targetRows.length)targetRows.push(['']);
  const backupRows=[];
  const props=new Map(Object.entries(options.properties||{}));
  function sheet(id,rows,isBackup=false){
    return {
      getSheetId:()=>id,
      getLastRow:()=>{for(let i=rows.length-1;i>=0;i--)if((rows[i]||[]).some(v=>v!==''&&v!=null))return i+1;return 0;},
      getMaxRows:()=>maxRows,insertRowsAfter:(_after,count)=>{maxRows+=count;},
      getRange:(row,column,numRows=1,numColumns=1)=>({
        getValue:()=>rows[row-1]?.[column-1]??'',
        getValues:()=>Array.from({length:numRows},(_,r)=>Array.from({length:numColumns},(_,c)=>rows[row-1+r]?.[column-1+c]??'')),
        setValue:value=>{if(fail===(isBackup?'backup':'write'))throw Error((isBackup?'backup':'write')+' failed');rows[row-1]??=[];rows[row-1][column-1]=value;if(!isBackup)writes++;},
        setValues:values=>{if(fail===(isBackup?'backup':'write'))throw Error((isBackup?'backup':'write')+' failed');values.forEach((source,r)=>source.forEach((value,c)=>{rows[row-1+r]??=[];rows[row-1+r][column-1+c]=value;}));if(!isBackup)writes++;},
        clearContent:()=>{for(let r=0;r<numRows;r++)for(let c=0;c<numColumns;c++)if(rows[row-1+r])rows[row-1+r][column-1+c]='';}
      })
    };
  }
  const target=sheet(7,targetRows),backup=sheet(8,backupRows,true);
  const book={getActiveSheet:()=>target,getSheetById:id=>id===7?target:null,getSheetByName:name=>name==='_RentalSyncRecovery'?backup:null,insertSheet:()=>backup};
  class Paragraph {constructor(value){this.value=String(value);}getText(){return this.value;}getType(){return 'PARAGRAPH';}setHeading(){return this;}}
  class Body {
    constructor(texts=[]){this.children=texts.map(text=>new Paragraph(text));}
    getNumChildren(){return this.children.length;}getChild(index){return this.children[index];}
    appendParagraph(text){const p=new Paragraph(text);this.children.push(p);return p;}
    insertParagraph(index,text){const p=new Paragraph(text);this.children.splice(index,0,p);return p;}
    removeChild(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);}
  }
  const docId='status-doc-1';
  const body=new Body(options.documentTexts||['사용자 메모 위','[RENTAL_CURRENT_STATUS_BEGIN]','이전 자동 내용','[RENTAL_CURRENT_STATUS_END]','사용자 메모 아래']);
  const document={getId:()=>docId,getUrl:()=>`https://docs.google.com/document/d/${docId}/edit`,getBody:()=>body,saveAndClose:()=>{}};
  const DocumentApp={ElementType:{PARAGRAPH:'PARAGRAPH'},ParagraphHeading:{HEADING1:'HEADING1',HEADING2:'HEADING2'},openById:id=>{if(fail==='docs'||id!==docId)throw Error('document unavailable');return document;},create:()=>{if(fail==='docs')throw Error('document unavailable');return document;}};
  const DriveApp={getFilesByName:()=>({hasNext:()=>false,next:()=>null})};
  if(options.existingDocument!==false&&!props.has('RENTAL_STATUS_DOCUMENT_ID'))props.set('RENTAL_STATUS_DOCUMENT_ID',docId);
  const c=vm.createContext({
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID(),formatDate:(date,_zone,format)=>format==='yyyy-MM-dd'?date.toISOString().slice(0,10):date.toISOString().replace('T',' ').slice(0,19)},
    LockService:{getScriptLock:()=>({tryLock:()=>!held&&(held=true),releaseLock:()=>{held=false;}})},SpreadsheetApp:{getActiveSpreadsheet:()=>book,flush:()=>{}},DocumentApp,DriveApp,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)??null,setProperty:(key,value)=>props.set(key,value)})}
  });
  for(const file of ['Billing.gs','CurrentStatus.gs','Code.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../server',file),'utf8'),c,{filename:file});
  const get=()=>JSON.parse(c.doGet({})),post=req=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(req)}}));
  const request=(data={tenants:[],bills:{}})=>({protocol:'rental-sync-v2',expectedRevision:get().revision,requestId:crypto.randomUUID(),data});
  return {get,post,request,writes:()=>writes,backupRows,body,props,raw:()=>targetRows.map(row=>String(row[0]||'')).join(''),fail:value=>{fail=value;},hold:value=>{held=value;},corrupt:value=>{targetRows.splice(0,targetRows.length,[value]);}};
}

test('GET is read-only and advertises conditional writes and current status',()=>{const s=server(),before=s.raw(),result=s.get();assert.equal(result.capabilities.conditionalWrite,true);assert.equal(result.capabilities.currentStatus,true);assert.equal(s.raw(),before);assert.equal(s.writes(),0);});
test('save writes a complete recovery set and returns persisted revision and docs result',()=>{const s=server(),before=s.raw(),r=s.request({tenants:[],bills:{},expenses:{},historical:'preserve'}),ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(ack.requestId,r.requestId);assert.equal(ack.docs.status,'ok');assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,r.data);assert.equal(s.backupRows.map(row=>row[2]).join(''),before);assert.equal(s.backupRows[0][6],'rental-recovery-v2');});
test('optional empty-floor operations round-trip without creating a tenant',()=>{const s=server(),data={tenants:[],bills:{},floorOperations:{5:{leaseStatus:'공실(정리중)'}}},ack=s.post(s.request(data));assert.equal(ack.status,'ok');assert.deepEqual(s.get().data,data);assert.equal(s.get().data.tenants.length,0);for(const floorOperations of [{6:{leaseStatus:'공실(정리중)'}},{5:{leaseStatus:'추정 상태'}}]){const invalid=server(),result=invalid.post(invalid.request({tenants:[],bills:{},floorOperations}));assert.equal(result.status,'error');assert.equal(invalid.writes(),0);}});
test('two clients sharing a version allow exactly one write',()=>{const s=server(),a=s.request(),b=s.request();assert.equal(s.post(a).status,'ok');assert.equal(s.post(b).status,'conflict');assert.equal(s.writes(),1);});
test('same request retry does not write or back up twice',()=>{const s=server(),r=s.request(),ack=s.post(r),backupCount=s.backupRows.length,retry=s.post(r);assert.equal(retry.revision,ack.revision);assert.equal(retry.duplicate,true);assert.equal(s.writes(),1);assert.equal(s.backupRows.length,backupCount);});
test('ID reuse with different contents fails and old retry after later write conflicts',()=>{const s=server(),r=s.request();s.post(r);assert.equal(s.post({...r,data:{tenants:[],bills:{},loans:[]}}).status,'error');s.post(s.request());assert.equal(s.post(r).status,'conflict');assert.equal(s.writes(),2);});
test('legacy unconditional POST never mutates storage',()=>{const s=server(),before=s.raw();assert.equal(s.post({tenants:[],bills:{}}).status,'unsupported');assert.equal(s.raw(),before);});
test('backup failure and write failure preserve original data',()=>{for(const fault of ['backup','write']){const s=server(),r=s.request(),before=s.raw();s.fail(fault);assert.equal(s.post(r).status,'error');assert.equal(s.raw(),before);assert.equal(s.get().status,'ok');}});
test('invalid and oversized payloads fail before backup or mutation',()=>{for(const data of [{tenants:[],bills:[]},{tenants:[],bills:{},extra:'x'.repeat(5000001)},JSON.parse('{"tenants":[],"bills":{},"__proto__":{}}')]){const s=server(),r=s.request(data);assert.equal(s.post(r).status,'error');assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);}});
test('77k+ payloads save in chunks and recovery retains the complete prior source',()=>{const oldData={tenants:[],bills:{},old:'o'.repeat(78000)},s=server({raw:JSON.stringify(oldData)}),before=s.raw(),largeData={tenants:[],bills:{},next:'x'.repeat(85000)},ack=s.post(s.request(largeData));assert.equal(ack.status,'ok');assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,largeData);assert.equal(s.backupRows.length,Math.ceil(before.length/35000));assert.equal(s.backupRows.map(row=>row[2]).join(''),before);});
test('Docs failure is reported separately and never rolls back a verified DB save',()=>{const s=server(),r=s.request({tenants:[],bills:{},marker:'saved'});s.fail('docs');const ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'error');assert.equal(s.get().data.marker,'saved');assert.equal(s.writes(),1);});
test('manual status regeneration uses saved DB, preserves revision and does not write DB',()=>{const s=server(),remote=s.get(),before=s.raw(),ack=s.post({protocol:'rental-sync-v2',action:'regenerateCurrentStatus',expectedRevision:remote.revision,requestId:crypto.randomUUID()});assert.equal(ack.status,'ok');assert.equal(ack.revision,remote.revision);assert.equal(ack.docs.status,'ok');assert.equal(s.raw(),before);assert.equal(s.writes(),0);});
test('stale manual regeneration conflicts and payload injection is rejected',()=>{const s=server(),base={protocol:'rental-sync-v2',action:'regenerateCurrentStatus',requestId:crypto.randomUUID()};assert.equal(s.post({...base,expectedRevision:'sha256-stale'}).status,'conflict');assert.equal(s.post({...base,expectedRevision:s.get().revision,data:{tenants:[],bills:{}}}).status,'error');});
test('generated document replaces only marked region and preserves user text',()=>{const s=server(),r=s.request({tenants:[{id:'t1',name:'임차인',unit:'201호',payday:'15일',rent:100000,mgmt:10000}],bills:{}});assert.equal(s.post(r).docs.status,'ok');const values=s.body.children.map(child=>child.getText());assert.equal(values[0],'사용자 메모 위');assert.equal(values.at(-1),'사용자 메모 아래');assert.ok(values.includes('201호 · 임차인'));assert.ok(!values.includes('이전 자동 내용'));});
test('current status omits archived historical tenants',()=>{const s=server(),r=s.request({tenants:[{id:'old',name:'이전 임차인',unit:'201호',archived:true}],bills:{}});assert.equal(s.post(r).docs.status,'ok');assert.ok(!s.body.children.some(child=>child.getText().includes('이전 임차인')));});
test('missing configured document ID reports an error without creating a replacement',()=>{const s=server({properties:{RENTAL_STATUS_DOCUMENT_ID:'missing-doc'}}),ack=s.post(s.request());assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'error');assert.equal(s.props.get('RENTAL_STATUS_DOCUMENT_ID'),'missing-doc');});
test('corrupt persisted data is never replaced and busy lock prevents writes',()=>{const s=server(),r=s.request();s.corrupt('{broken');assert.equal(s.post(r).status,'error');assert.equal(s.raw(),'{broken');const busy=server();busy.hold(true);assert.equal(busy.post(busy.request()).status,'busy');assert.equal(busy.writes(),0);});
