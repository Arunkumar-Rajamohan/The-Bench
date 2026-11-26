// Edge cases found by checking the whole app: node tests/both/edges.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5174, TURSO = 8074, base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));

function startTurso(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    const parts = []; // joined before decoding, so a letter split across two pieces stays whole
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      const out = JSON.parse(body).requests.map((r) => {
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
function member() {
  let cookie = '';
  const call = async (method, url, body, rawBody) => {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {});
    let r;
    try { r = await fetch(base + url, { method, headers, body: rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : undefined }); }
    catch (e) { return { status: 'dropped', json: {}, cookieSet: '' }; } // the server cut the connection
    const sc = r.headers.get('set-cookie') || '';
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})), cookieSet: sc };
  };
  call.token = () => cookie.replace('sid=', '');
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-edge-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { turso = startTurso(mem = new DatabaseSync(':memory:')); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const rows = (sql, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const out = /^\s*select/i.test(sql) ? db.prepare(sql).all(...args) : db.prepare(sql).run(...args); if (!mem) db.close(); return out; };
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    const A = member(), u = 'ed_' + rnd();
    let r = await A('POST', '/api/signup', { username: u, name: 'Edge', password: crypto.randomUUID() });
    if (r.status !== 201) throw new Error(JSON.stringify(r));

    // ---- requests that are too big get an answer, not a dropped connection ----
    r = await A('POST', '/api/posts', null, JSON.stringify({ text: 'x'.repeat(400 * 1024), tag: 'Win' }));
    check('a too-big request is answered "too big"', r.status === 413 && /too big/i.test(r.json.error), r);
    r = await A('GET', '/api/me');
    check('and the connection still works afterwards', r.status === 200);
    r = await member()('PUT', '/api/me/data', { notes: 'x'.repeat(400 * 1024) });
    check('signed out while saving a lot: told to log in, not a dropped connection', r.status === 401, r);
    r = await A('POST', '/api/chat/msg/999999999/react', null, JSON.stringify({ r: '👍', pad: 'x'.repeat(400 * 1024) }));
    check('an early "not found" before a big body is read still arrives', r.status === 404 || r.status === 413, r);
    r = await A('PUT', '/api/me/data', { notes: 'x'.repeat(300 * 1024) });
    check('a busy member\'s 300 KB of private data saves', r.status === 200, r.status);
    r = await A('PUT', '/api/me/data', { notes: 'x'.repeat(520 * 1024) });
    check('more than 500 KB is refused, with what to do about it', r.status === 413 && /Remove something long/.test(r.json.error), r);
    r = await A('PUT', '/api/me/data', null, JSON.stringify({ notes: 'x'.repeat(1200 * 1024) }));
    check('far too much data: the same clear answer, not a dropped connection', r.status === 413 && /Remove something long/.test(r.json.error), r);
    r = await A('PUT', '/api/me/data', { notes: 'नमस्ते '.repeat(40000) }); // about 280k characters, 800 KB as bytes
    check('text in Indian scripts is measured fairly', r.status === 200, r.status);
    r = await A('GET', '/api/me/data');
    check('and comes back exactly', r.json.data.notes === 'नमस्ते '.repeat(40000));

    // ---- names like "constructor" are not real choices ----
    for (const field of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      r = await A('POST', '/api/alerts', { field });
      check('a job alert cannot be saved for the field "' + field + '"', r.status === 400, r);
    }
    r = await A('POST', '/api/alerts', { where: 'constructor' });
    check('an odd city word is just a city word', r.status === 201 && r.json.alert.where === 'constructor' && !/function|native/.test(r.json.alert.name), r.json);
    r = await A('GET', '/api/jobs?field=constructor&where=__proto__');
    check('job search ignores them too', r.status === 200, r.status);

    // ---- staying signed in ----
    const t = A.token(), h = sha(t);
    let exp = rows('SELECT expires FROM sessions WHERE token_hash = ?', h)[0].expires;
    r = await A('GET', '/api/me');
    check('a fresh sign-in is not renewed on every visit', !r.cookieSet && rows('SELECT expires FROM sessions WHERE token_hash = ?', h)[0].expires === exp, r.cookieSet);
    rows('UPDATE sessions SET expires = ? WHERE token_hash = ?', Date.now() + 3 * 864e5, h); // pretend it was 27 days ago
    r = await A('GET', '/api/me');
    exp = rows('SELECT expires FROM sessions WHERE token_hash = ?', h)[0].expires;
    check('someone who keeps coming back gets another 30 days', exp > Date.now() + 29 * 864e5 && /Max-Age=2592000/.test(r.cookieSet) && r.cookieSet.includes(t), [exp - Date.now(), r.cookieSet]);
    r = await A('GET', '/api/me');
    check('once a day at most', !r.cookieSet);
    rows('UPDATE sessions SET expires = ? WHERE token_hash = ?', Date.now() - 1000, h);
    check('an expired sign-in is not brought back', (await A('GET', '/api/me')).status === 401);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
