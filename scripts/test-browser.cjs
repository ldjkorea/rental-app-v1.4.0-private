/* Start this checkout on a free loopback port and run every browser suite. */
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
const suites=['browser.cjs','v2-browser.cjs','audit-browser.cjs','pwa-browser.cjs','single-file-browser.cjs'];
let server,serverExited;
function run(file,env){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[path.join(root,'tests',file)],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',b=>{log+=b;process.stdout.write(b);});child.stderr.on('data',b=>{log+=b;process.stderr.write(b);});
    const timeout=setTimeout(()=>{log+='\nSuite timed out';child.kill();},180000);
    child.on('error',e=>{log+='\n'+e.message;});
    child.on('close',code=>{clearTimeout(timeout);fs.writeFileSync(path.join(out,file+'.log'),log);resolve({suite:file,exitCode:code,status:code===0?'pass':'fail'});});
  });
}
(async()=>{
  require.resolve('playwright');fs.mkdirSync(out,{recursive:true});
  server=spawn(process.execPath,['scripts/serve.cjs'],{cwd:root,env:{...process.env,RENTAL_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  serverExited=new Promise(resolve=>server.once('exit',resolve));
  const url=await new Promise((resolve,reject)=>{
    let output='';const timeout=setTimeout(()=>reject(new Error('Test server startup timed out')),10000);
    server.on('error',e=>{clearTimeout(timeout);reject(e);});
    server.on('exit',code=>{clearTimeout(timeout);reject(new Error('Test server exited: '+code));});
    server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]+'/');}});
  });
  const env={...process.env,RENTAL_TEST_URL:url};delete env.RENTAL_CASE;
  const startedAt=new Date().toISOString(),results=[];
  for(const suite of suites)results.push(await run(suite,env));
  fs.writeFileSync(path.join(out,'browser-suite-summary.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),url,node:process.version,results},null,2));
  if(results.some(r=>r.status==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server?.exitCode===null){server.kill();await serverExited;}
});
