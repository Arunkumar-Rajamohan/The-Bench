// Recovery / reset test: node tests/both/reset.test.js <server.js> <mode: local|hosted>
// Seeds a database with the OLD schema (no recovery column) and one old-style user first,
// to prove the migration works on the live database.
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5197, MOCK = 8097;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-reset-'));
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const OLD_PASS = crypto.randomUUID();
function seedOld(db) {
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    pass TEXT NOT NULL, salt TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL)`);
  const salt = crypto.randomBytes(16).toString('hex');
  const pass = crypto.scryptSync(OLD_PASS, salt, 64).toString('hex');
  db.prepare('INSERT INTO users (username, name, pass, salt, data, created) VALUES (?, ?, ?, ?, ?, ?)')
    .run('old_user', 'Old Timer', pass, salt, '{"resume":"kept"}', Date.now());
}

function startMock(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end(); }
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
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
}

async function startServer(env) {
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);
  return { child, log: () => log };
}

(async () => {
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp });
  let mock, mockDb;
  if (mode === 'hosted') {
    mockDb = new DatabaseSync(':memory:');
    seedOld(mockDb);
    mock = startMock(mockDb);
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + MOCK, TURSO_AUTH_TOKEN: 'test-token', NODE_ENV: 'production' });
  } else {
    const d = new DatabaseSync(path.join(tmp, 'bench.db')); seedOld(d); d.close();
  }

  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  let srv = await startServer(env);
  try {
    check('starts on old database (migration)', /running at/.test(srv.log()), srv.log());

    // Old user: no code yet, can still log in, then creates one.
    const old = client();
    let r = await old('POST', '/api/login', { username: 'old_user', password: OLD_PASS });
    check('old user logs in', r.status === 200 && r.json.user.hasRecovery === false && r.json.data.resume === 'kept', r);
    check('recovery needs right password', (await old('POST', '/api/me/recovery', { password: 'wrong-wrong' })).status === 401);
    r = await old('POST', '/api/me/recovery', { password: OLD_PASS });
    const oldCode = r.json.recoveryCode;
    check('old user gets a code', r.status === 200 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(oldCode || ''), r);
    check('/me shows hasRecovery', (await old('GET', '/api/me')).json.user.hasRecovery === true);

    // New user: code comes with sign-up.
    const a = client(), a2 = client(), anon = client();
    const ua = 'reset_' + crypto.randomBytes(3).toString('hex'), pa = crypto.randomUUID(), pa2 = crypto.randomUUID();
    r = await a('POST', '/api/signup', { username: ua, name: 'Resetter', password: pa });
    const code1 = r.json.recoveryCode;
    check('signup returns code', r.status === 201 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code1 || '') && r.json.user.hasRecovery === true, r);
    check('second device logs in', (await a2('POST', '/api/login', { username: ua, password: pa })).status === 200);

    check('wrong code rejected', (await anon('POST', '/api/reset', { username: ua, code: 'AAAA-AAAA-AAAA-AAAA', password: pa2 })).status === 401);
    check('code for other user rejected', (await anon('POST', '/api/reset', { username: ua, code: oldCode, password: pa2 })).status === 401);
    check('unknown user same error', (await anon('POST', '/api/reset', { username: 'nobody_here', code: code1, password: pa2 })).status === 401);
    check('short new password rejected', (await anon('POST', '/api/reset', { username: ua, code: code1, password: 'short' })).status === 400);

    // Typed sloppily: lowercase, spaces instead of dashes.
    const sloppy = code1.toLowerCase().replace(/-/g, ' ');
    r = await anon('POST', '/api/reset', { username: ua.toUpperCase(), code: sloppy, password: pa2 });
    const code2 = r.json.recoveryCode;
    check('reset works (sloppy typing ok)', r.status === 200 && r.json.user.username === ua && code2 && code2 !== code1, r);
    check('reset logs you in', (await anon('GET', '/api/me')).status === 200);
    check('other devices signed out', (await a('GET', '/api/me')).status === 401 && (await a2('GET', '/api/me')).status === 401);
    check('old password stops working', (await a('POST', '/api/login', { username: ua, password: pa })).status === 401);
    check('new password works', (await a('POST', '/api/login', { username: ua, password: pa2 })).status === 200);
    check('used code is single-use', (await client()('POST', '/api/reset', { username: ua, code: code1, password: pa })).status === 401);

    // Change password while signed in.
    const pa3 = crypto.randomUUID();
    check('change pw needs current', (await a('POST', '/api/me/password', { password: 'nope-nope', newPassword: pa3 })).status === 401);
    r = await a('POST', '/api/me/password', { password: pa2, newPassword: pa3 });
    check('change password', r.status === 200, r);
    check('this device stays in', (await a('GET', '/api/me')).status === 200);
    check('other session out', (await anon('GET', '/api/me')).status === 401);
    // Restart on the now-migrated database: migration must be a no-op. (Also clears the in-memory rate limits,
    // since this account has already used its 5 reset attempts for the hour.)
    srv.child.kill(); await wait(400);
    srv = await startServer(env);
    check('restarts on migrated database', /running at/.test(srv.log()), srv.log());
    check('data survived restart', (await client()('POST', '/api/login', { username: ua, password: pa3 })).status === 200);
    check('recovery code kept after change', (await client()('POST', '/api/reset', { username: ua, code: code2, password: pa })).status === 200);

    // Per-account reset limit (5 per hour).
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await client()('POST', '/api/reset', { username: 'old_user', code: 'BBBB-BBBB-BBBB-BBBB', password: pa })).status);
    check('reset attempts are limited', statuses.slice(0, 5).every((s) => s === 401) && statuses[6] === 429, statuses);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  srv.child.kill(); if (mock) mock.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
