const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const rootId = require('node:crypto').createHash('sha256').update(root.toLowerCase().replaceAll('\\','/')).digest('hex').slice(0,16);
const version=require('../package.json').version;
const port = Number(process.env.RENTAL_PORT || 4173);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'};
const publicFiles = new Set(['index.html', 'manifest.json', 'icon.svg', 'sw.js',
  'assets/app.js', 'assets/core.js', 'assets/styles.css', 'assets/billing.js', 'assets/enhancements.js', 'assets/workspace.css']);
const server = http.createServer((req, res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html'; }
  catch { res.writeHead(400).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method) || !publicFiles.has(relative)) { res.writeHead(404).end(); return; }
  const file = path.join(root, relative);
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Rental-App': 'reliability-foundation', 'X-Rental-Version':version, 'X-Rental-Root':rootId});
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
server.on('error', error => { console.error(`실행 실패: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`임대관리 개선본: http://127.0.0.1:${server.address().port}`));
