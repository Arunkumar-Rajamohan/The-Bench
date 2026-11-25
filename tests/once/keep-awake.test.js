// Keep-awake test: node keepawake-test.js <serverJsPath>
// Points the ping at a local stand-in (fast interval) and checks schedule, waking-hours window and off switches.
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [serverJs] = process.argv.slice(2);
const PORT = 5186, TARGET = 8086;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let hits = [];
const target = http.createServer((req, res) => { hits.push({ path: req.url, ua: req.headers['user-agent'] }); res.writeHead(200); res.end('ok'); }).listen(TARGET, '127.0.0.1');

async function run(extraEnv, ms) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-awake-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp,
    GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  delete env.RENDER_EXTERNAL_URL; delete env.KEEP_AWAKE; delete env.KEEP_AWAKE_HOURS; delete env.KEEP_AWAKE_URL;
  Object.assign(env, extraEnv);
  hits = [];
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  await wait(ms);
  child.kill();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  return { hits: hits.slice(), log };
}

(async () => {
  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300)));
  const url = 'http://127.0.0.1:' + TARGET;
  const fast = { RENDER_EXTERNAL_URL: url, KEEP_AWAKE_MINUTES: '0.01' }; // every 0.6 s for the test
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

  let r = await run(Object.assign({}, fast, { KEEP_AWAKE_HOURS: 'all' }), 2500);
  check('pings on a schedule using the host-provided address', r.hits.length >= 2, r.hits.length);
  check('pings only the health check', r.hits.length > 0 && r.hits.every((x) => x.path === '/healthz'), r.hits.map((x) => x.path));
  check('identifies itself', r.hits.every((x) => x.ua === 'TheBench-KeepAwake/1.0'));
  check('all-day mode says so in the log', r.log.includes('every 0.01 minutes, all day'), r.log.slice(0, 300));

  r = await run(Object.assign({}, fast, { KEEP_AWAKE_HOURS: h + '-' + (h + 1) }), 2000);
  check('pings inside the waking-hours window', r.hits.length >= 2, { h, hits: r.hits.length });

  r = await run(Object.assign({}, fast, { KEEP_AWAKE_HOURS: ((h + 2) % 24) + '-' + (((h + 3) % 24) || 24) }), 2000);
  check('stays quiet outside the window, so the app can sleep', r.hits.length === 0, { h, hits: r.hits.length });

  r = await run(Object.assign({}, fast, { KEEP_AWAKE_HOURS: ((h + 23) % 24) + '-' + ((h + 1) % 24) }), 2000);
  check('a window across midnight still covers now', r.hits.length >= 2, { h, window: ((h + 23) % 24) + '-' + ((h + 1) % 24), hits: r.hits.length });

  r = await run({ RENDER_EXTERNAL_URL: url }, 1500);
  check('default: every 10 minutes, 7am to midnight India time', r.log.includes('every 10 minutes between 7:00 and 24:00 India time') && r.hits.length === 0, r.log.slice(0, 200));

  r = await run(Object.assign({}, fast, { KEEP_AWAKE_HOURS: 'all', KEEP_AWAKE: 'off' }), 2000);
  check('KEEP_AWAKE=off stops it', r.hits.length === 0 && !r.log.includes('Keep-awake on'), r.hits.length);

  r = await run({ KEEP_AWAKE_MINUTES: '0.01', KEEP_AWAKE_HOURS: 'all' }, 2000);
  check('off on your own computer (no address)', r.hits.length === 0 && !r.log.includes('Keep-awake on'));

  r = await run({ KEEP_AWAKE_URL: 'http://example.com', KEEP_AWAKE_MINUTES: '0.01', KEEP_AWAKE_HOURS: 'all' }, 1500);
  check('refuses a non-https address', r.hits.length === 0 && r.log.includes('Keep-awake skipped'), r.log.slice(0, 200));

  target.close();
  console.log('keep-awake: ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed (India hour now: ' + h + ')');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
