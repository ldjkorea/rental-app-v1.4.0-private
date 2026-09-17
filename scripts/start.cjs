/* Start or reuse this exact checkout without changing PowerShell execution policy. */
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const rootId=createHash('sha256').update(root.toLowerCase().replaceAll('\\','/')).digest('hex').slice(0,16);
const version=require('../package.json').version;
const port=Number(process.env.RENTAL_PORT||4173);
const url=`http://127.0.0.1:${port}/`;
async function probe(){
  try {
    const response=await fetch(url+'manifest.json',{signal:AbortSignal.timeout(2000),redirect:'error'});
    if(response.status!==200||response.headers.get('x-rental-app')!=='reliability-foundation'||response.headers.get('x-rental-root')!==rootId||response.headers.get('x-rental-version')!==version)
      throw new Error('이 포트에서 다른 폴더 또는 이전 버전 앱이 실행 중입니다. 해당 서버를 확인하거나 RENTAL_PORT를 지정해주세요.');
    await response.arrayBuffer();return true;
  } catch(error){if(error.cause?.code==='ECONNREFUSED')return false;throw error;}
}
async function openApp(){
  const edge=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles].filter(Boolean).map(p=>path.join(p,'Microsoft/Edge/Application/msedge.exe')).find(p=>fs.existsSync(p));
  const child=edge?spawn(edge,['--app='+url],{detached:true,stdio:'ignore'}):spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
(async()=>{
  if(Number(process.versions.node.split('.')[0])<20)throw new Error('Node.js 20 이상이 필요합니다.');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('RENTAL_PORT는 1~65535 정수여야 합니다.');
  fs.writeFileSync(path.join(root,'index.html'),require('./build.cjs').build());
  if(!await probe()){
    const server=spawn(process.execPath,[path.join(__dirname,'serve.cjs')],{cwd:root,env:{...process.env,RENTAL_PORT:String(port)},windowsHide:true,detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{server.once('spawn',resolve);server.once('error',reject);});
    let ready=false;
    try {
      for(let attempt=0;attempt<30;attempt++){
        await new Promise(resolve=>setTimeout(resolve,100));
        if(await probe()){ready=true;break;}
      }
      if(!ready)throw new Error('앱 서버의 실행 상태를 확인하지 못했습니다.');
    } catch(error){server.kill();throw error;}
    server.unref();
  }
  console.log(url);
  if(!process.argv.includes('--no-open'))await openApp();
})().catch(error=>{console.error(error.message);process.exitCode=1;});
