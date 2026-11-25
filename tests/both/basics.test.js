// Smoke test: node tests/both/basics.test.js <server.js> <mode: local|hosted>
// "hosted" starts a stand-in for Turso's /v2/pipeline API (shape taken from Turso's docs).
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5199, MOCK = 8099;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-smoke-'));
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      if (req.url !== '/v2/pipeline' || req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end(); }
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
        } catch (e) { return { type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  }).listen(MOCK, '127.0.0.1');
}

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})), setCookie: sc || '' };
  };
}

(async () => {
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp });
  let mock;
  if (mode === 'hosted') {
    mock = startMock();
    env.TURSO_DATABASE_URL = 'http://127.0.0.1:' + MOCK;
    env.TURSO_AUTH_TOKEN = 'test-token';
    env.NODE_ENV = 'production';
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 50 && !/running at/.test(log); i++) await wait(100);

  const results = [];
  const check = (name, ok) => results.push((ok ? 'PASS ' : 'FAIL ') + name);
  try {
    const a = client(), b = client(), anon = client();
    const ua = 'smoke_a_' + crypto.randomBytes(3).toString('hex'), ub = 'smoke_b_' + crypto.randomBytes(3).toString('hex');
    const pa = crypto.randomUUID(), pb = crypto.randomUUID();
    check('health', (await fetch(base + '/healthz')).status === 200);
    check('page served', (await fetch(base + '/')).status === 200);
    check('anon blocked', (await anon('GET', '/api/posts')).status === 401);
    let r = await a('POST', '/api/signup', { username: ua, name: 'Smoke A', password: pa });
    check('signup A', r.status === 201);
    check('cookie flags', /HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie) && (mode !== 'hosted' || /Secure/.test(r.setCookie)));
    check('duplicate username', (await anon('POST', '/api/signup', { username: ua, name: 'x', password: pb })).status === 409);
    check('signup B', (await b('POST', '/api/signup', { username: ub, name: 'Smoke B', password: pb })).status === 201);
    r = await a('POST', '/api/posts', { text: 'hello', tag: 'Tip' });
    const id = r.json.id;
    check('post created with id', r.status === 201 && Number.isInteger(id) && id > 0);
    check('B reacts', (await b('POST', '/api/posts/' + id + '/react', { r: '🙌' })).status === 200);
    check('B replies', (await b('POST', '/api/posts/' + id + '/replies', { text: 'hi back' })).status === 201);
    r = await a('GET', '/api/posts');
    const p = (r.json.posts || [])[0] || {};
    check('feed shows reaction + reply', p.own === true && p.reacts && p.reacts['🙌'] === 1 && !p.mine['🙌'] && p.replies.length === 1 && p.replies[0].name === 'Smoke B');
    r = await b('GET', '/api/posts');
    check('B sees own reaction', r.json.posts[0].own === false && r.json.posts[0].mine['🙌'] === true);
    check('B cannot delete', (await b('DELETE', '/api/posts/' + id)).status === 403);
    check('save data', (await a('PUT', '/api/me/data', { apps: [{ id: 'x', title: 'T', company: 'C', stage: 'Applied' }] })).status === 200);
    check('logout', (await a('POST', '/api/logout')).status === 200 && (await a('GET', '/api/me')).status === 401);
    check('wrong password', (await a('POST', '/api/login', { username: ua, password: 'nope-nope-nope' })).status === 401);
    r = await a('POST', '/api/login', { username: ua, password: pa });
    check('login restores data', r.status === 200 && r.json.data.apps && r.json.data.apps[0].title === 'T');
    check('B data separate', !(await b('GET', '/api/me')).json.data.apps);
    check('owner deletes', (await a('DELETE', '/api/posts/' + id)).status === 200 && (await a('GET', '/api/posts')).json.posts.length === 0);
    check('cross-site blocked', (await fetch(base + '/api/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status === 403);
  } catch (e) { results.push('FAIL crashed: ' + e.message); }
  child.kill(); if (mock) mock.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* file still locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error|error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log);
  process.exit(0);
})();
