// Faster loading: compressed files, "not modified" answers, compressed big API answers.
// node tests/both/loading.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5165, TURSO = 8065;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));

function startTurso(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const out = JSON.parse(Buffer.concat(parts).toString('utf8')).requests.map((r) => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        try {
          const st = db.prepare(r.stmt.sql), args = (r.stmt.args || []).map(dec);
          let rows = [], cols = [], info = { changes: 0, lastInsertRowid: null };
          if (/^\s*select/i.test(r.stmt.sql)) { const x = st.all(...args); cols = x.length ? Object.keys(x[0]).map((name) => ({ name })) : []; rows = x.map((o) => Object.values(o).map(enc)); } else info = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: Number(info.changes), last_insert_rowid: info.lastInsertRowid === null ? null : String(info.lastInsertRowid) } } };
        } catch (e) { return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results: out }));
    });
  }).listen(TURSO, '127.0.0.1');
}
// Raw HTTP, so we see exactly what travels (fetch would quietly unpack it).
function get(p, headers, method, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method || 'GET', headers: headers || {} }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const unpack = (r) => r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.body) : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-load-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { turso = startTurso(mem = new DatabaseSync(':memory:')); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const appJs = fs.readFileSync(path.join(path.dirname(serverJs), 'app.js'));
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    await wait(1500); // the smaller brotli copies are made in the background just after start

    let r = await get('/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    check('the app travels compressed with brotli', r.status === 200 && r.headers['content-encoding'] === 'br' && r.body.length < appJs.length / 3, [r.headers['content-encoding'], r.body.length, appJs.length]);
    check('and unpacks to exactly the file', unpack(r).equals(appJs));
    check('with a fingerprint and "check with us each time"', /^"[\w-]{20}"$/.test(r.headers.etag) && r.headers['cache-control'] === 'no-cache' && r.headers.vary === 'Accept-Encoding', r.headers);
    const etag = r.headers.etag;
    r = await get('/app.js', { 'Accept-Encoding': 'gzip' });
    check('older browsers get gzip', r.headers['content-encoding'] === 'gzip' && unpack(r).equals(appJs));
    r = await get('/app.js', {});
    check('and anything else gets it plain', !r.headers['content-encoding'] && r.body.equals(appJs));
    r = await get('/app.js', { 'Accept-Encoding': 'br', 'If-None-Match': etag });
    check('a browser that has the latest copy downloads nothing', r.status === 304 && r.body.length === 0 && r.headers.etag === etag, [r.status, r.body.length]);
    r = await get('/app.js', { 'If-None-Match': '"old-copy-fingerprint"' });
    check('an old copy gets the new one', r.status === 200 && r.body.equals(appJs));
    r = await get('/styles.css', { 'Accept-Encoding': 'br' });
    check('styles are compressed too', r.headers['content-encoding'] === 'br' && /text\/css/.test(r.headers['content-type']));
    r = await get('/', { 'Accept-Encoding': 'br' });
    check('and the page itself, with its security headers', r.headers['content-encoding'] === 'br' && /default-src 'self'/.test(r.headers['content-security-policy']) && r.headers['x-frame-options'] === 'DENY');
    r = await get('/icons/icon-192.png', { 'Accept-Encoding': 'br' });
    check('pictures are not squeezed again, and are kept for good', !r.headers['content-encoding'] && /immutable/.test(r.headers['cache-control']) && r.headers.etag);
    r = await get('/app.js', { 'Accept-Encoding': 'br' }, 'HEAD');
    check('a HEAD request gets the headers only', r.status === 200 && r.body.length === 0 && r.headers['content-encoding'] === 'br');
    r = await get('/server.js', { 'Accept-Encoding': 'br' });
    check('files that are not part of the site are still not served', r.status === 404);

    // API answers
    r = await get('/api/signup', { 'Content-Type': 'application/json', 'Accept-Encoding': 'br' }, 'POST', JSON.stringify({ username: 'ld_' + crypto.randomBytes(3).toString('hex'), name: 'Load', password: crypto.randomUUID() }));
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    check('small API answers are left as they are', r.status === 201 && !r.headers['content-encoding'], r.headers['content-encoding']);
    const big = { notes: 'Applied to Acme, Kettle & Co and more. '.repeat(3000) };
    r = await get('/api/me/data', { 'Content-Type': 'application/json', Cookie: cookie }, 'PUT', JSON.stringify(big));
    r = await get('/api/me', { Cookie: cookie, 'Accept-Encoding': 'gzip, br' });
    const me = JSON.parse(unpack(r).toString('utf8'));
    check('big ones (like your saved data) travel compressed', r.headers['content-encoding'] === 'br' && r.body.length < 10000 && me.data.notes === big.notes, [r.headers['content-encoding'], r.body.length]);
    r = await get('/api/me', { Cookie: cookie });
    check('and plain for anything that cannot unpack them', !r.headers['content-encoding'] && JSON.parse(r.body.toString('utf8')).data.notes === big.notes);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
