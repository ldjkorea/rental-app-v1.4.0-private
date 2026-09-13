const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let child,url,port,exited;
before(async()=>{
  child=spawn(process.execPath,['scripts/serve.cjs'],{cwd:root,env:{...process.env,RENTAL_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=new Promise(resolve=>child.once('exit',resolve));
  url=await new Promise((resolve,reject)=>{
    let output='';const timeout=setTimeout(()=>reject(new Error('Local test server startup timed out')),10000);
    child.on('error',e=>{clearTimeout(timeout);reject(e);});
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Local test server exited: '+code));});
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);port=match[1];resolve(match[0]+'/');}});
  });
});
after(async()=>{if(child?.exitCode===null){child.kill();await exited;}});
test('server identifies the exact current project and version',async()=>{
  const response=await fetch(url+'manifest.json');assert.equal(response.status,200);
  const expected=createHash('sha256').update(root.toLowerCase().split(path.sep).join('/')).digest('hex').slice(0,16);
  assert.equal(response.headers.get('x-rental-root'),expected);
  assert.equal(response.headers.get('x-rental-version'),require('../package.json').version);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('server only exposes application assets and rejects write methods',async()=>{
  for(const file of ['.git/config','package.json','tests/core.test.cjs','test-results/browser-results.json','start.ps1','../README.md','%2e%2e%2fREADME.md'])
    assert.equal((await fetch(url+file)).status,404,file);
  assert.equal((await fetch(url,{method:'POST',body:'test'})).status,404);
  const head=await fetch(url+'assets/app.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
function launcher(testPort){
  return new Promise((resolve,reject)=>{
    const launch=spawn(process.env.ComSpec||'cmd.exe',['/d','/c',path.join(root,'실행.cmd'),'--no-open'],{cwd:root,env:{...process.env,RENTAL_PORT:String(testPort)},windowsHide:true});
    let output='';launch.stdout.on('data',b=>output+=b);launch.stderr.on('data',b=>output+=b);
    launch.on('error',reject);launch.on('exit',code=>resolve({code,output}));
  });
}
test('Windows launcher reuses this project without opening a browser',{skip:process.platform!=='win32'},async()=>{
  const result=await launcher(port);assert.equal(result.code,0,result.output);assert.ok(result.output.includes(url));
});
test('Windows launcher refuses a server from another project',{skip:process.platform!=='win32'},async()=>{
  const server=require('node:http').createServer((req,res)=>res.writeHead(200,{'X-Rental-App':'reliability-foundation','X-Rental-Root':'another-project','X-Rental-Version':require('../package.json').version}).end('{}'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const result=await launcher(server.address().port);assert.notEqual(result.code,0);assert.ok(result.output.includes('RENTAL_PORT'),result.output);}
  finally{await new Promise(resolve=>server.close(resolve));}
});
