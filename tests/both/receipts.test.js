// Read receipts in private chats: node tests/both/receipts.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5179, TURSO = 8059, base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));

function startTurso(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
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
  const events = [];
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.seen = () => events.filter((e) => e.type === 'seen');
  call.events = events;
  call.stream = async () => {
    const r = await fetch(base + '/api/stream', { headers: { Cookie: cookie } });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    call.stop = () => reader.cancel().catch(() => {});
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); for (const l of c.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); } } } catch (e) { /* closed */ } })();
  };
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-rr-')), adminName = 'radm_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: adminName, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  // a database from before receipts: no "quiet" column, and an old private chat in it
  const old = mode === 'hosted' ? (mem = new DatabaseSync(':memory:')) : new DatabaseSync(path.join(tmp, 'bench.db'));
  if (mode === 'hosted') { turso = startTurso(mem); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  old.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, channel TEXT NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)');
  old.exec("INSERT INTO messages (id, channel, user_id, text, created) VALUES (99, 'dm:3:4', 4, 'from before', 5), (100, 'room:lobby', 4, 'x', 5)");
  old.exec('CREATE TABLE dms (key TEXT PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL, started_by INTEGER NOT NULL, created INTEGER NOT NULL, last_id INTEGER NOT NULL DEFAULT 0)');
  old.exec("INSERT INTO dms VALUES ('3:4', 3, 4, 4, 5, 99)"); // the third and fourth people to sign up below: C and M
  if (!mem) old.close();
  const start = async () => {
    log = '';
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
  };
  const stop = async () => { child.kill(); await wait(400); };
  const rows = (sql, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db'), { readOnly: true }); const out = db.prepare(sql).all(...args); if (!mem) db.close(); return out; };
  try {
    await start();
    check('old database upgrades', /running at/.test(log), log);
    const A = member(), B = member(), C = member(), M = member();
    const a = 'ra_' + rnd(), b = 'rb_' + rnd(), c = 'rc_' + rnd(), pwA = crypto.randomUUID();
    for (const [x, u, n, p] of [[A, a, 'Asha', pwA], [B, b, 'Bala', crypto.randomUUID()], [C, c, 'Chitra', crypto.randomUUID()], [M, adminName, 'Mod', crypto.randomUUID()]]) { const r = await x('POST', '/api/signup', { username: u, name: n, password: p }); if (r.status !== 201) throw new Error(JSON.stringify(r)); }
    await A.stream(); await B.stream(); await C.stream(); await wait(300);
    const say = async (from, to, text) => (await from('POST', '/api/chat/dm/' + to, { text })).json.msg.id;
    const read = (who, peer, id) => who('POST', '/api/chat/dm/' + peer + '/read', { id });
    const seen = async (who, peer) => (await who('GET', '/api/chat/dm/' + peer)).json.seen;
    const on = (who, v) => who('PUT', '/api/chat/receipts', { on: v });
    const settle = () => wait(250);

    // ---- nothing is shared until both have chosen ----
    check('needs login', (await member()('PUT', '/api/chat/receipts', { on: true })).status === 401 && (await member()('POST', '/api/chat/dm/' + a + '/read', { id: 1 })).status === 401);
    let r = await A('GET', '/api/chat/summary');
    check('not asked yet, and off', r.json.receipts && r.json.receipts.asked === false && r.json.receipts.on === false, r.json.receipts);
    const m1 = await say(A, b, 'one');
    await read(B, a, m1); await settle();
    check('neither chose: nothing recorded or shown', rows('SELECT COUNT(*) AS n FROM dm_reads')[0].n === 0 && (await seen(A, b)) === 0 && A.seen().length === 0);
    await on(B, true); await read(B, a, m1); await settle();
    check('only the reader chose: sender sees nothing', (await seen(A, b)) === 0 && A.seen().length === 0);
    r = await A('GET', '/api/chat/summary'); check('reading does not change the sender\'s setting', r.json.receipts.asked === false);
    await on(A, true);
    check('both chose: seen', (await seen(A, b)) === m1, await seen(A, b));
    check('a wrong setting is refused', (await on(A, 'yes')).status === 400 && (await A('PUT', '/api/chat/receipts', {})).status === 400);

    // ---- live ----
    const m2 = await say(A, b, 'two');
    check('new message is not seen yet', (await seen(A, b)) === m1);
    await read(B, a, m2); await settle();
    check('sender is told live', A.seen().some((e) => e.channel === 'dm:' + b && e.id === m2) && (await seen(A, b)) === m2, A.seen());
    const n0 = A.seen().length; await read(B, a, m2); await read(B, a, m1); await settle();
    check('repeats and older reads say nothing and never go back', A.seen().length === n0 && (await seen(A, b)) === m2);
    check('the reader is not told about their own reading', B.seen().length === 0, B.seen());
    check('nobody else is told', C.seen().length === 0);
    const mB = await say(B, a, 'reply'); await settle(); check('works the other way too', (await seen(B, a)) === 0); await read(A, b, mB); await settle(); check('and shows there', (await seen(B, a)) === mB && B.seen().some((e) => e.id === mB && e.channel === 'dm:' + a));

    // ---- cheating ----
    const m3 = await say(A, b, 'three');
    await read(B, a, 9e15); await settle(); check('cannot read ahead', rows('SELECT last_id FROM dm_reads WHERE user_id = (SELECT id FROM users WHERE username = ?)', b)[0].last_id === m3 && (await seen(A, b)) === m3);
    const m4 = await say(A, b, 'four'); check('a later message is still unseen', (await seen(A, b)) === m3);
    for (const bad of [0, -1, 1.5, '5', null, undefined, {}]) if ((await B('POST', '/api/chat/dm/' + a + '/read', { id: bad })).status !== 400) check('bad id refused: ' + bad, false);
    check('bad ids refused', true);
    check('no such person', (await read(B, 'nobody_here', 5)).status === 404 && (await read(B, b, 5)).status === 400);
    await on(C, true); check('no chat, nothing recorded', (await read(C, a, 5)).status === 200 && rows('SELECT COUNT(*) AS n FROM dm_reads WHERE user_id = (SELECT id FROM users WHERE username = ?)', c)[0].n === 0);
    await read(C, a, m4); await settle(); check('a third person cannot mark it read', (await seen(A, b)) === m3);
    check('a moderator cannot see it', !('seen' in (await M('GET', '/api/admin/reports')).json) && (await M('GET', '/api/chat/dm/' + a)).json.seen === 0);

    // ---- referral requests never show it ----
    await A('POST', '/api/referrals', { company: 'Acme' }); const offer = (await B('GET', '/api/referrals')).json.offers[0];
    await B('POST', '/api/referrals/' + offer.id + '/ask', { role: 'X', message: 'please' });
    const before = await seen(B, a), list = (await A('GET', '/api/chat/dm/' + b)).json.messages, ask = list[list.length - 1];
    check('setup: request arrived', /Referral request/.test(ask.text) && ask.id > before, ask);
    const n1 = B.seen().length; await read(A, b, ask.id); await settle();
    check('reading a referral request tells the asker nothing', (await seen(B, a)) === before && B.seen().length === n1, [await seen(B, a), before, B.seen().length, n1]);
    const follow = await say(B, a, 'any update?'); await settle(); check('a normal follow-up is unseen until read', (await seen(B, a)) === before); await read(A, b, follow); await settle(); check('then shows as usual', (await seen(B, a)) === follow);

    // ---- nothing from the past ----
    await on(M, true); await read(C, adminName, 99); await settle();
    check('setup: the old chat really was read', rows('SELECT last_id FROM dm_reads WHERE key = ?', '3:4')[0].last_id === 99);
    check('messages from before are never "seen"', (await seen(M, c)) === 0 && rows("SELECT value FROM settings WHERE key = 'receipts_from'")[0].value === '100', await seen(M, c));
    const fresh = await say(M, c, 'new one'); check('a new message there is not seen by having read the old one', (await seen(M, c)) === 0); await read(C, adminName, fresh); await settle(); check('and is once read', (await seen(M, c)) === fresh);
    await stop(); await start(); check('the starting point does not move after a restart', rows("SELECT value FROM settings WHERE key = 'receipts_from'")[0].value === '100'); await A.stream(); await B.stream(); await wait(300);
    check('receipts survive a restart', (await seen(B, a)) === follow);

    // ---- deleting a message ----
    const m5 = await say(A, b, 'five'), m6 = await say(A, b, 'six'); await read(B, a, m6); await settle(); await A('DELETE', '/api/chat/msg/' + m6); check('a deleted message passes it to the one before', (await seen(A, b)) === m5);

    // ---- turning it off, both ways ----
    A.events.length = 0; B.events.length = 0;
    await on(B, false); await settle();
    check('off: the other person stops seeing it, live', A.seen().some((e) => e.channel === 'dm:' + b && e.id === 0) && (await seen(A, b)) === 0);
    check('off: you stop seeing theirs', (await seen(B, a)) === 0);
    check('off: reading history is forgotten', rows('SELECT COUNT(*) AS n FROM dm_reads WHERE user_id = (SELECT id FROM users WHERE username = ?)', b)[0].n === 0);
    check('other devices hear about the switch', B.events.some((e) => e.type === 'receipts' && e.on === false && e.asked === true));
    check('nobody else does', !A.events.some((e) => e.type === 'receipts'));
    await read(B, a, m5); await settle(); check('off: reading records nothing', rows('SELECT COUNT(*) AS n FROM dm_reads WHERE user_id = (SELECT id FROM users WHERE username = ?)', b)[0].n === 0);
    await on(B, true); check('on again: starts fresh', (await seen(A, b)) === 0); await read(B, a, m5); await settle(); check('and works again', (await seen(A, b)) === m5);

    // ---- blocking ----
    A.events.length = 0; B.events.length = 0;
    await B('POST', '/api/blocks/' + a, {}); await settle();
    check('blocked: neither sees it, live', A.seen().some((e) => e.id === 0) && B.seen().some((e) => e.id === 0) && (await seen(A, b)) === 0 && (await seen(B, a)) === 0);
    A.events.length = 0; await read(B, a, m5); await settle(); check('blocked: reading tells nothing', A.seen().length === 0);
    await B('DELETE', '/api/blocks/' + a); check('unblocked: back', (await seen(A, b)) === m5);

    // ---- your data ----
    r = await A('GET', '/api/me/export'); check('download has the setting', r.json.readReceiptSetting[0].is_on === 1);
    const id = rows('SELECT id FROM users WHERE username = ?', a)[0].id; await A('POST', '/api/me/delete', { password: pwA, confirm: a });
    check('deleting the account removes it all, both sides', rows('SELECT COUNT(*) AS n FROM dm_reads WHERE user_id = ? OR key LIKE ? OR key LIKE ?', id, id + ':%', '%:' + id)[0].n === 0 && rows('SELECT COUNT(*) AS n FROM receipts WHERE user_id = ?', id)[0].n === 0);
    check('the other person is fine', (await B('GET', '/api/chat/summary')).status === 200 && (await read(B, c, 1)).status === 200);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) await stop();
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
