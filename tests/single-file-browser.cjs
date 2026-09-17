/* Isolated release validation: only index.html exists beside the file URL.
   HTTP also serves only index.html; all other requests are recorded and refused. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results/single-file');
const isolated = path.join(out, 'portable');
const sizes = [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]];
const tabs = ['home','tenants','history','settlement','settings'];
const results = [], errors = [];
let browser, server;
const baselineFiles = new Set(['index.html','assets/styles.css','assets/workspace.css','assets/core.js','assets/billing.js','assets/app.js','assets/enhancements.js','icon.svg','manifest.json']);
const baseline = new Map();
for (const name of baselineFiles)
  baseline.set(name, execFileSync('git', ['show', '33e61e6:' + name], {cwd:root, maxBuffer:1024*1024}));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};

async function check(name, action) {
  await action(); results.push({name,status:'pass'}); console.log('PASS ' + name);
}
async function layout(page, mobile) {
  await page.evaluate(() => window.scrollTo(0,0));
  const metrics = await page.evaluate(() => {
    const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}; };
    const nav = document.querySelector('.workspace-sidebar');
    const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const overflow = [...document.querySelectorAll('.section.active button,.section.active input,.section.active select,.section.active .card')]
      .filter(visible).filter(e => {
        // A wide allocation table is intentionally scrollable inside its wrapper.
        if (e.closest('.result-tbl')) return false;
        const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;
      }).map(e => e.id || e.className);
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,nav:rect(nav),
      buttons:[...document.querySelectorAll('.pill-item')].map(rect),overflow,
      brand:getComputedStyle(document.querySelector('.workspace-brand')).display};
  });
  assert.ok(metrics.scrollWidth <= metrics.width+1, JSON.stringify(metrics));
  assert.deepEqual(metrics.overflow, [], 'controls must fit the viewport');
  if (mobile) {
    const clippedHeader = await page.evaluate(() => [...document.querySelectorAll('.month-nav button')].filter(e => {
      const b=e.getBoundingClientRect(), parent=e.parentElement.getBoundingClientRect();
      return b.width<44||b.height<44||b.left<parent.left||b.right>parent.right;
    }).map(e=>e.outerHTML));
    assert.deepEqual(clippedHeader, [], 'month controls must be fully visible and touchable');
    assert.equal(metrics.brand,'none');
    assert.equal(metrics.nav.width,metrics.width);
    assert.ok(Math.abs(metrics.nav.bottom - (await page.evaluate(() => innerHeight))) <= 1);
    for (const b of metrics.buttons) assert.ok(b.height>=44 && b.width>=44);
    await page.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
    const bottom = await page.evaluate(() => ({
      content:document.querySelector('.content').getBoundingClientRect().bottom,
      nav:document.querySelector('.workspace-sidebar').getBoundingClientRect().top
    }));
    assert.ok(bottom.content<=bottom.nav, 'last content must scroll above the navigation: '+JSON.stringify(bottom));
  } else {
    assert.equal(metrics.nav.x,0);assert.equal(metrics.nav.y,0);assert.equal(metrics.nav.width,234);
  }
}

async function navigate(page, width, height, prefix) {
  for (const tab of tabs) {
    await page.locator('#nav-'+tab).click();
    await page.locator('#section-'+tab+'.active').waitFor();
    if (tab==='history') await page.locator('#hist-chips .chip').nth(1).click();
    await layout(page,width<=800);
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:path.join(out,prefix+'-'+width+'x'+height+'-'+tab+'.png'),fullPage:true,animations:'disabled'});
  }
}

async function workflow(page, label) {
  await page.locator('#nav-tenants').click();
  await page.locator('#tenant-search').fill('온유');
  assert.equal(await page.locator('#tenant-list .t-item').count(),1);
  await page.locator('#tenant-search').fill('');
  await page.locator('#nav-settlement').click();
  await page.locator('#sett-elec').fill('115000');
  await page.locator('#sett-water-chk').check();
  await page.locator('#sett-water-total').fill('300000');
  await page.locator('#sett-water-usage').fill('177');
  await page.locator('#sett-water-f1').fill('41');
  await page.locator('#sett-elev').fill('150001');
  await page.locator('#sett-waste').fill('100003');
  await page.getByRole('button',{name:/배분 계산하기/}).click();
  await page.locator('#sett-step2').waitFor({state:'visible'});
  await layout(page,(await page.viewportSize()).width<=800);
  const tableScroll=page.locator('.result-tbl').locator('..');
  await tableScroll.evaluate(e=>e.scrollLeft=e.scrollWidth);
  await page.screenshot({path:path.join(out,label+'-allocation.png'),fullPage:true});
  await page.locator('#confirm-settlement').click();
  await page.waitForFunction(()=>settInputs[mk()]?.confirmed);
  await page.locator('#nav-history').click();
  await page.locator('#hist-chips .chip').filter({hasText:'온유'}).click();
  await page.getByRole('button',{name:'✏️ 수정',exact:true}).click();
  await page.locator('#bill-electricity').fill('43210');
  await page.locator('#bill-water').fill('12345');
  await page.getByRole('button',{name:'💾 저장',exact:true}).click();
  await page.waitForFunction(()=>bills[mk()].demo2.electricity===43210);
  await page.reload();
  assert.equal(await page.evaluate(()=>bills[mk()].demo2.electricity),43210);
  await page.evaluate(()=>goToHistory('demo2'));
  await page.locator('.payment-card button').first().click();
  await page.locator('#stamp-date').fill('2026-09-14');
  await page.getByRole('button',{name:'이 날짜로 완납 저장'}).click();
  await page.locator('#modal-stamp').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>bills[mk()].demo2.stampedRent),true);
  assert.equal(await page.evaluate(()=>!!bills[mk()].demo2.stampedMgmt),false);
  await layout(page,(await page.viewportSize()).width<=800);
  await page.locator('#nav-tenants').click();
  await page.getByRole('button',{name:/세입자 추가/}).click();
  await page.locator('#inp-name').fill('휴대성 검증');
  await page.locator('#inp-unit').fill('501호');
  await page.locator('#inp-rent').fill('700000');
  await page.locator('#modal-tenant').getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('#modal-tenant').waitFor({state:'hidden'});
  await page.reload();
  assert.ok(await page.evaluate(()=>tenants.some(t=>t.name==='휴대성 검증')));
  const expected=await page.evaluate(()=>currentData());
  assert.ok(await page.evaluate(()=>!!localStorage.getItem(RentalCore.STATE_KEY)));
  await page.locator('#nav-settings').click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'📤 파일로 내보내기'}).click();
  const download=await downloadEvent;
  const backupPath=path.join(out,label+'-backup.json');
  await download.saveAs(backupPath);
  await page.locator('#import-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from('{"tenants":[],"bills":{}}')});
  await page.waitForFunction(()=>tenants.length===0&&!persistenceBusy);
  await page.getByRole('button',{name:'↩ 직전 복원 지점으로 되돌리기'}).click();
  await page.waitForFunction(()=>tenants.length===5&&!persistenceBusy);
  assert.deepEqual(await page.evaluate(()=>currentData()),expected);
  await page.locator('#import-file').setInputFiles(backupPath);
  await page.waitForFunction(()=>!persistenceBusy&&document.querySelector('#toast').textContent.includes('가져오기 완료'));
  await page.reload();
  assert.deepEqual(await page.evaluate(()=>currentData()),expected);
  const beforeBad=await page.evaluate(()=>localStorage.getItem(RentalCore.STATE_KEY));
  await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"tenants":{},"bills":[]}')});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('가져오기 실패'));
  assert.equal(await page.evaluate(()=>localStorage.getItem(RentalCore.STATE_KEY)),beforeBad);
}

(async()=>{
  fs.mkdirSync(isolated,{recursive:true});
  fs.copyFileSync(path.join(root,'index.html'),path.join(isolated,'index.html'));
  assert.deepEqual(fs.readdirSync(isolated),['index.html']);
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/baseline/')){
      const file=url.pathname.slice('/baseline/'.length)||'index.html';
      if(!baseline.has(file))return res.writeHead(404).end();
      return res.writeHead(200,{'Content-Type':types[path.extname(file)]}).end(baseline.get(file));
    }
    if(url.pathname!=='/'&&url.pathname!=='/index.html')return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':types['.html']}).end(fs.readFileSync(path.join(isolated,'index.html')));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  for(const protocol of ['http','file']){
    for(const [width,height] of sizes){
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height},isMobile:width<=800,hasTouch:width<=800});
      const requests=[];
      await context.route('**/*',r=>{
        const url=r.request().url();requests.push(url);
        return url.startsWith(origin+'/')||url.startsWith('file:')?r.continue():r.abort();
      });
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
      const url=protocol==='http'?origin+'/index.html':pathToFileURL(path.join(isolated,'index.html')).href;
      await page.goto(url+'?demo=1');await page.locator('#section-home.active').waitFor();
      // Export demo state into an isolated normal storage namespace so canonical
      // writes and imports are exercised, not merely demo persistence.
      const seed=await page.evaluate(()=>currentData());
      await page.evaluate(data=>localStorage.setItem(RentalCore.STATE_KEY,JSON.stringify(data)),seed);
      await page.goto(url);await page.locator('#section-home.active').waitFor();
      await check(protocol+' '+width+'x'+height+' five tabs and layout',()=>navigate(page,width,height,protocol));
      if(width===360||width===1920)
        await check(protocol+' '+width+' storage, bills, payment, settlement, backup/recovery',()=>workflow(page,protocol+'-'+width));
      assert.equal(requests.filter(u=>/\/assets\/|fonts\.google|script\.google/.test(u)).length,0,'no asset or external dependency');
      if(protocol==='file')assert.equal(requests.filter(u=>/sw\.js|manifest\.json/.test(u)).length,0);
      await context.close();
    }
  }
  // Compare the desktop layout against the immutable pre-change commit.
  for(const [width,height] of sizes.filter(s=>s[0]>800)){
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height},reducedMotion:'reduce'});
    await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const pages=[await context.newPage(),await context.newPage()];
    for(let i=0;i<pages.length;i++){
      await pages[i].clock.install({time:new Date('2026-09-14T03:00:00Z')});
      await pages[i].goto(origin+(i?'/index.html':'/baseline/index.html')+'?demo=1');
      await pages[i].locator('#section-home.active').waitFor();
    }
    await check('PC '+width+'x'+height+' geometry against 33e61e6',async()=>{
      for(const tab of tabs){
        const geometry=[];
        for(let i=0;i<pages.length;i++){
          await pages[i].locator('#nav-'+tab).click();
          if(tab==='history')await pages[i].locator('#hist-chips .chip').nth(1).click();
          geometry.push(await pages[i].evaluate(()=>[...document.querySelectorAll('.workspace-sidebar,.header,.content,.section.active .card,.section.active .metric-card')]
            .map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];})));
          await pages[i].screenshot({path:path.join(out,'pc-'+(i?'after':'before')+'-'+width+'-'+tab+'.png'),fullPage:true,animations:'disabled'});
        }
        assert.deepEqual(geometry[1],geometry[0],tab+' desktop geometry');
      }
    });
    await context.close();
  }
  assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e.stack);results.push({status:'fail',error:e.stack});process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,sizes},null,2));
});
