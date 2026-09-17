/* Real service worker lifecycle on a loopback-only server and temporary profile. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
const results=[],errors=[],external=[];
let browser,server,context,update=false;
const assets=new Set(['index.html','sw.js','manifest.json','icon.svg','assets/core.js','assets/billing.js','assets/app.js','assets/enhancements.js','assets/styles.css','assets/workspace.css','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png']);
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
async function test(name,action){
  try{await action();results.push({name,status:'pass'});console.log('PASS '+name);}
  catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);throw error;}
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!pathname.startsWith('/rental-app/'))return res.writeHead(404).end();
    const file=pathname.slice('/rental-app/'.length)||'index.html';
    if(!assets.has(file))return res.writeHead(404).end();
    let body=fs.readFileSync(path.join(root,file));
    if(file==='sw.js'&&update)body=Buffer.from(body.toString().replace("CACHE_PREFIX+'1.4.0-status-docs-1'","CACHE_PREFIX+'1.4.0-status-docs-1-test-update'"));
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/rental-app/?demo=1';
  browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():(external.push(r.request().url()),r.abort()));
  let page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await test('PWA installs all application assets and gains control after reload',async()=>{
    await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const urls=await page.evaluate(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(k=>k.endsWith('1.4.0-status-docs-1')));return (await cache.keys()).map(r=>r.url);});
    assert.equal(urls.length,14);assert.ok(urls.some(u=>u.endsWith('/assets/billing.js')));assert.ok(urls.some(u=>u.endsWith('/icons/icon-512.png')));
    await page.screenshot({path:path.join(out,'verified-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    for(const tab of ['home','tenants','history','settlement','settings']){
      await page.locator('#nav-'+tab).click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' overflow');
    }
    await page.locator('#nav-home').click();
    await page.screenshot({path:path.join(out,'verified-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:1000});
  });
  await test('offline query navigation, edit, save and reload retain local data',async()=>{
    await context.setOffline(true);await page.goto(url+'&view=offline');
    await page.locator('#section-home.active').waitFor();await page.evaluate(()=>goToHistory('demo2'));
    await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    await page.locator('#bill-electricity').fill('43210');await page.evaluate(()=>saveBill());
    await page.waitForFunction(()=>!document.getElementById('toast').classList.contains('show'));
    await page.screenshot({path:path.join(out,'verified-bill.png'),fullPage:true});
    await page.reload();assert.equal(await page.evaluate(()=>bills[mk()].demo2.electricity),43210);
    assert.equal(await page.evaluate(()=>localStorage.getItem(RentalCore.STATE_KEY)),null);
    await page.screenshot({path:path.join(out,'pwa-offline.png'),fullPage:true});
    await context.setOffline(false);
  });
  await test('PWA update waits for open windows and keeps unsaved drafts',async()=>{
    await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    await page.locator('#bill-electricity').fill('87654');await page.evaluate(()=>flushBillDraft());
    await page.evaluate(async()=>{await caches.open('unrelated-app-cache');await caches.open('rental-app-%2Fother%2F-1.0');await caches.open('rental-foundation-v3');});
    update=true;await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.locator('#app-update-notice').waitFor({state:'visible'});
    await page.screenshot({path:path.join(out,'verified-update.png'),fullPage:true});
    assert.equal(await page.locator('#bill-electricity').inputValue(),'87654');
    assert.equal(await page.evaluate(()=>Object.values(readBillDrafts())[0].fields.electricity),'87654');
  });
  await test('closing all app windows activates update and only removes related old caches',async()=>{
    await page.close();page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration()).waiting);
    const names=await page.evaluate(()=>caches.keys());
    assert.ok(names.includes('rental-app-%2Frental-app%2F-1.4.0-status-docs-1-test-update'));
    assert.ok(!names.includes('rental-app-%2Frental-app%2F-1.4.0-status-docs-1'));
    assert.ok(!names.includes('rental-foundation-v3'));
    assert.ok(names.includes('unrelated-app-cache'));assert.ok(names.includes('rental-app-%2Fother%2F-1.0'));
    await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    assert.equal(await page.locator('#bill-electricity').inputValue(),'87654');
  });
  await test('updated PWA remains usable offline with no application errors or cloud requests',async()=>{
    await context.setOffline(true);await page.reload();await page.locator('#section-home.active').waitFor();
    assert.equal(await page.locator('#home-bill-list .t-item').count(),4);
    assert.deepEqual(errors,[]);assert.equal(external.filter(u=>u.includes('script.google')).length,0);
  });
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,'pwa-browser-results.json'),JSON.stringify(results,null,2));
});
