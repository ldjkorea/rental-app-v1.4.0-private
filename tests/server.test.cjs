const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function server() {
  let raw=JSON.stringify({tenants:[],bills:{}}), held=false, fail='', writes=0, backups=[];
  const props=new Map(),sheet={getSheetId:()=>7,getRange:()=>({getValue:()=>raw,setValue:v=>{if(fail==='write')throw Error('write failed');raw=v;writes++;}})};
  const backup={getSheetId:()=>8,appendRow:r=>{if(fail==='backup')throw Error('backup failed');backups.push(r);}};
  const book={getActiveSheet:()=>sheet,getSheetById:id=>id===7?sheet:null,getSheetByName:()=>backup,insertSheet:()=>backup};
  const c=vm.createContext({ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID()},
    LockService:{getScriptLock:()=>({tryLock:()=>!held&&(held=true),releaseLock:()=>{held=false;}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>book,flush:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../server/Code.gs'),'utf8'),c);
  const get=()=>JSON.parse(c.doGet({})),post=req=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(req)}}));
  const request=(data={tenants:[],bills:{}})=>({protocol:'rental-sync-v2',expectedRevision:get().revision,requestId:crypto.randomUUID(),data});
  return {get,post,request,raw:()=>raw,writes:()=>writes,backups,fail:v=>{fail=v;},hold:v=>{held=v;},corrupt:v=>{raw=v;}};
}
test('legacy GET is read-only and advertises real conditional writes',()=>{const s=server(),before=s.raw();assert.equal(s.get().capabilities.conditionalWrite,true);assert.equal(s.raw(),before);assert.equal(s.writes(),0);});
test('save backs up prior A1 and returns persisted revision and identical data',()=>{const s=server(),before=s.raw(),r=s.request({tenants:[],bills:{},expenses:{},historical:'preserve'}),ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(ack.requestId,r.requestId);assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,r.data);assert.equal(s.backups[0][2],before);});
test('two clients sharing a version allow exactly one write',()=>{const s=server(),a=s.request(),b=s.request();assert.equal(s.post(a).status,'ok');assert.equal(s.post(b).status,'conflict');assert.equal(s.writes(),1);});
test('same request retry does not write or back up twice',()=>{const s=server(),r=s.request(),ack=s.post(r);assert.equal(s.post(r).revision,ack.revision);assert.equal(s.writes(),1);assert.equal(s.backups.length,1);});
test('ID reuse with different contents fails and old retry after later write conflicts',()=>{const s=server(),r=s.request();s.post(r);assert.equal(s.post({...r,data:{tenants:[],bills:{},loans:[]}}).status,'error');s.post(s.request());assert.equal(s.post(r).status,'conflict');assert.equal(s.writes(),2);});
test('legacy unconditional POST never mutates storage',()=>{const s=server(),before=s.raw();assert.equal(s.post({tenants:[],bills:{}}).status,'unsupported');assert.equal(s.raw(),before);});
test('backup failure and write failure preserve original data',()=>{for(const fault of ['backup','write']){const s=server(),r=s.request(),before=s.raw();s.fail(fault);assert.equal(s.post(r).status,'error');assert.equal(s.raw(),before);assert.equal(s.get().status,'ok');}});
test('invalid and oversized payloads fail before backup or mutation',()=>{for(const data of [{tenants:[],bills:[]},{tenants:[],bills:{},extra:'x'.repeat(5000001)},JSON.parse('{"tenants":[],"bills":{},"__proto__":{}}')]){const s=server(),r=s.request(data);assert.equal(s.post(r).status,'error');assert.equal(s.writes(),0);assert.equal(s.backups.length,0);}});
test('chunked 50k+ payloads succeed and preserve data across reads',()=>{const s=server(),largeData={tenants:[],bills:{},extra:'x'.repeat(75000)},r=s.request(largeData),ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,largeData);});
test('corrupt persisted data is never replaced and busy lock prevents writes',()=>{const s=server(),r=s.request();s.corrupt('{broken');assert.equal(s.post(r).status,'error');assert.equal(s.raw(),'{broken');s.hold(true);assert.equal(s.post(r).status,'busy');assert.equal(s.writes(),0);});
