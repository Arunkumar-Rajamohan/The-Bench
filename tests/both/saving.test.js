// Saving private data: version checks on the server: node tests/both/saving.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5185, FEEDS = 8083, TURSO = 8082;
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const start = Date.now();

// stand-in feeds: Stripe (Greenhouse) has two old India jobs; a third, brand new one appears when addNew is set.
let addNew = false;
const feeds = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname === '/v1/boards/stripe/jobs') {
    const jobs = [
      { id: 1, title: 'Customer Support Specialist', absolute_url: 'https://stripe.com/jobs/1', location: { name: 'Chennai, India' }, first_published: new Date(start - 3 * 864e5).toISOString() },
      { id: 2, title: 'Account Executive', absolute_url: 'https://stripe.com/jobs/2', location: { name: 'Bengaluru, India' }, first_published: new Date(start - 2 * 864e5).toISOString() }
    ];
    if (addNew) jobs.push({ id: 3, title: 'Support Team Lead', absolute_url: 'https://stripe.com/jobs/3', location: { name: 'Chennai' }, first_published: new Date().toISOString() });
    return send({ jobs });
  }
  if (u.pathname.startsWith('/v1/boards/')) return send({ jobs: [] });
  if (u.pathname.startsWith('/v0/postings/')) return send([]);
  if (u.pathname.startsWith('/posting-api/')) return send({ jobs: [] });
  if (u.pathname.startsWith('/v1/companies/')) return send({ content: [], totalFound: 0 });
  res.writeHead(404); res.end();
}).listen(FEEDS, '127.0.0.1');

function startTurso(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const results = JSON.parse(body).requests.map((r) => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        try {
          const st = db.prepare(r.stmt.sql);
          const args = (r.stmt.args || []).map(dec);
          let rows = [], cols = [], info = { changes: 0, lastInsertRowid: null };
          if (/^\s*select/i.test(r.stmt.sql)) {
            const out = st.all(...args);
            cols = out.length ? Object.keys(out[0]).map((name) => ({ name, decltype: null })) : [];
            rows = out.map((o) => Object.values(o).map(enc));
          } else info = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: Number(info.changes), last_insert_rowid: info.lastInsertRowid === null ? null : String(info.lastInsertRowid) } } };
        } catch (e) { return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  }).listen(TURSO, '127.0.0.1');
}

function member() {
  let cookie = '';
  const events = [];
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.events = events;
  call.stream = async () => {
    const r = await fetch(base + '/api/stream', { headers: { Cookie: cookie } });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); for (const l of c.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); } } } catch (e) { /* closed */ } })();
    call.stop = () => reader.cancel().catch(() => {});
  };
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rev-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:' + FEEDS, LEVER_BASE_URL: 'http://127.0.0.1:' + FEEDS, ASHBY_BASE_URL: 'http://127.0.0.1:' + FEEDS, SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:' + FEEDS });
  // a database made before this change: no data_rev column, one member with data
  const old = mode === 'hosted' ? new DatabaseSync(':memory:') : new DatabaseSync(path.join(tmp, 'bench.db'));
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass TEXT NOT NULL, salt TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL)");
  const salt = 'ab'.repeat(16), pwO = crypto.randomUUID();
  old.prepare('INSERT INTO users (username, name, pass, salt, data, created) VALUES (?,?,?,?,?,?)').run('oldie', 'Old', 'x', salt, '{"resume":"old resume"}', 5);
  let turso;
  if (mode === 'hosted') { turso = startTurso(old); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); } else old.close();
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);
  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
  let cookie = '';
  const raw = async (method, url, body, ifm, ck) => { const r = await fetch(base + url, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: ck === undefined ? cookie : ck }, ifm === undefined ? {} : { 'If-Match': String(ifm) }), body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && ck === undefined) cookie = sc.split(';')[0]; return { status: r.status, json: await r.json().catch(() => ({})) }; };
  try {
    check('old database starts', /running at/.test(log), log.slice(-300));
    const u = 'rv_' + rnd(), pw = crypto.randomUUID();
    let r = await raw('POST', '/api/signup', { username: u, name: 'R', password: pw });
    check('signup gives rev 0 and since', r.json.rev === 0 && r.json.user.since > 1e12, r.json);
    const since = r.json.user.since;
    r = await raw('GET', '/api/me'); check('me gives the same', r.json.rev === 0 && r.json.user.since === since, r.json);
    r = await raw('PUT', '/api/me/data', { a: 1 }, 0); check('save at 0', r.status === 200 && r.json.rev === 1, r);
    r = await raw('PUT', '/api/me/data', { a: 2 }, 0); check('stale save refused with newer copy', r.status === 409 && r.json.rev === 1 && r.json.data.a === 1, r);
    r = await raw('GET', '/api/me/data'); check('stale save wrote nothing', r.json.data.a === 1 && r.json.rev === 1, r);
    r = await raw('PUT', '/api/me/data', { a: 3 }, '"1"'); check('quoted version accepted', r.status === 200 && r.json.rev === 2, r);
    r = await raw('PUT', '/api/me/data', { a: 4 }, 99); check('future version refused', r.status === 409, r);
    r = await raw('PUT', '/api/me/data', { a: 5 }); check('older app without version still works, and bumps', r.status === 200 && r.json.rev === 3, r);
    r = await raw('PUT', '/api/me/data', { a: 6 }, 2); check('newer app notices that', r.status === 409 && r.json.data.a === 5, r);
    const race = await Promise.all(Array.from({ length: 12 }, (_, i) => raw('PUT', '/api/me/data', { race: i }, 3)));
    check('12 saves at once: exactly one wins', race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 11, race.map((x) => x.status));
    const won = race.findIndex((x) => x.status === 200);
    r = await raw('GET', '/api/me/data'); check('and it is the one stored', r.json.data.race === won && r.json.rev === 4, r);
    r = await raw('PUT', '/api/me/data', { big: 'x'.repeat(210 * 1024) }, 4); check('too big refused', r.status === 413, r.status);
    check('needs login', (await raw('GET', '/api/me/data', null, undefined, '')).status === 401 && (await raw('PUT', '/api/me/data', { a: 1 }, 4, '')).status === 401);
    const B = member(); await B('POST', '/api/login', { username: u, password: pw }); await B.stream(); await wait(300);
    const D = member(); await D('POST', '/api/signup', { username: 'rx_' + rnd(), name: 'X', password: crypto.randomUUID() }); await D.stream(); await wait(300);
    await raw('PUT', '/api/me/data', { a: 7 }, 4); await wait(300);
    check('other device is told', B.events.some((e) => e.type === 'data' && e.rev === 5), B.events);
    check('other members are not', !D.events.some((e) => e.type === 'data'), D.events);
    check('the notice carries no data', !JSON.stringify(B.events).includes('"a"'));
    B.stop(); D.stop();
    r = await raw('POST', '/api/login', { username: u, password: pw }); check('login gives rev', r.json.rev === 5 && r.json.user.since === since, r.json);
    r = await raw('POST', '/api/me/delete', { password: pw, confirm: u }); check('delete still works', r.status === 200, r);
    r = await raw('PUT', '/api/me/data', { ghost: 1 }, 5); check('no saving after deletion', r.status === 401, r);
    r = await raw('POST', '/api/signup', { username: u, name: 'R2', password: pw }); check('re-used name is a different account', r.json.user.since !== since && r.json.rev === 0, r.json);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); feeds.close(); if (turso) turso.close(); await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
