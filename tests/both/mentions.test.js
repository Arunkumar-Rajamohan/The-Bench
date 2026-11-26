// @mentions in chat rooms: node tests/both/mentions.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5166, TURSO = 8066, base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
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
function member() {
  let cookie = '';
  const events = [];
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.events = events;
  call.mentions = () => events.filter((e) => e.type === 'mention');
  call.stream = async () => {
    const r = await fetch(base + '/api/stream', { headers: { Cookie: cookie } });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); for (const l of c.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); } } } catch (e) { /* closed */ } })();
  };
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-men-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { turso = startTurso(mem = new DatabaseSync(':memory:')); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const rows = (sql, ...args) => { const d = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const out = d.prepare(sql).all(...args); if (!mem) d.close(); return out; };
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    const A = member(), B = member(), C = member(), D = member();
    const a = 'ma_' + rnd(), b = 'mb_' + rnd(), c = 'mc_' + rnd(), d = 'md_' + rnd(), pwB = crypto.randomUUID();
    for (const [x, u, n, p] of [[A, a, 'Asha', crypto.randomUUID()], [B, b, 'Bala', pwB], [C, c, 'Chitra', crypto.randomUUID()], [D, d, 'Dev', crypto.randomUUID()]]) {
      const r = await x('POST', '/api/signup', { username: u, name: n, password: p }); if (r.status !== 201) throw new Error(JSON.stringify(r));
    }
    for (const x of [A, B, C, D]) await x.stream();
    await wait(300);
    const say = async (who, text, room) => (await who('POST', '/api/chat/room/' + (room || 'lobby'), { text })).json.msg;
    const summary = async (who) => (await who('GET', '/api/chat/summary')).json.mentions;
    const settle = () => wait(250);

    const m1 = await say(A, 'Hi @' + b + ', welcome! And @' + b.toUpperCase() + ' again.'); await settle();
    check('the person mentioned is told live, once', B.mentions().length === 1 && B.mentions()[0].channel === 'room:lobby' && B.mentions()[0].id === m1.id, B.mentions());
    check('nobody else is', C.mentions().length === 0 && A.mentions().length === 0);
    check('the live note never carries the words', !JSON.stringify(B.mentions()[0]).includes('welcome'));
    check('the chat list counts it', (await summary(B))['room:lobby'] === 1, await summary(B));
    await say(C, '@' + b + ' are you around?'); await say(A, 'and in prep @' + b, 'interview-prep'); await settle();
    let s = await summary(B);
    check('counts per room', s['room:lobby'] === 2 && s['room:interview-prep'] === 1, s);
    check('opening a room clears it there only', (await B('POST', '/api/chat/mentions/seen', { channel: 'room:lobby' })).status === 200 && JSON.stringify(await summary(B)) === JSON.stringify({ 'room:interview-prep': 1 }), await summary(B));
    check('only real rooms', (await B('POST', '/api/chat/mentions/seen', { channel: 'dm:' + a })).status === 400 && (await B('POST', '/api/chat/mentions/seen', { channel: 'room:nope' })).status === 400 && (await B('POST', '/api/chat/mentions/seen', {})).status === 400);

    // what does not count
    B.events.length = 0;
    await say(B, 'Talking about myself @' + b); await settle();
    check('mentioning yourself does nothing', B.mentions().length === 0);
    await say(A, 'mail me at someone@' + b + '.com or see example.com/@' + b + ' and @' + b + 'xx'); await settle();
    check('emails, links and longer words are not mentions', B.mentions().length === 0, B.mentions());
    await say(A, '@nobody_here_at_all hello'); await settle();
    check('a name that does not exist is just text', rows('SELECT COUNT(*) AS n FROM mentions WHERE message_id = (SELECT MAX(id) FROM messages)')[0].n === 0);
    const many = 'ping ' + [b, c, d, 'x1_' + rnd(), 'x2_' + rnd(), 'x3_' + rnd(), a].map((u) => '@' + u).join(' ');
    const mm = await say(A, many);
    check('at most five names per message', rows('SELECT COUNT(*) AS n FROM mentions WHERE message_id = ?', mm.id)[0].n === 3, rows('SELECT * FROM mentions WHERE message_id = ?', mm.id));
    await C('POST', '/api/blocks/' + a); C.events.length = 0;
    await say(A, 'hey @' + c); await settle();
    check('someone who blocked you is not told', C.mentions().length === 0);
    await C('DELETE', '/api/blocks/' + a);
    await A('POST', '/api/blocks/' + d); D.events.length = 0;
    await say(A, 'hey @' + d); await settle();
    check('nor someone you blocked', D.mentions().length === 0);
    await A('DELETE', '/api/blocks/' + d);
    const dmMsg = (await A('POST', '/api/chat/dm/' + b, { text: 'private @' + b })).json.msg; await settle();
    check('private chats have no mentions', rows('SELECT COUNT(*) AS n FROM mentions WHERE message_id = ?', dmMsg.id)[0].n === 0);

    // edits and deletes
    D.events.length = 0;
    const e1 = await say(A, 'thanks @' + c);
    await A('PATCH', '/api/chat/msg/' + e1.id, { text: 'thanks @' + d }); await settle();
    check('an edit tells a newly named person', D.mentions().some((x) => x.id === e1.id));
    check('and forgets the one taken out', rows('SELECT user_id FROM mentions WHERE message_id = ?', e1.id).length === 1);
    D.events.length = 0;
    await A('PATCH', '/api/chat/msg/' + e1.id, { text: 'thanks @' + d + '!' }); await settle();
    check('an edit that keeps the name does not tell them again', D.mentions().length === 0);
    const before = (await summary(D))['room:lobby'];
    await A('DELETE', '/api/chat/msg/' + e1.id);
    check('deleting the message takes the mention away', ((await summary(D))['room:lobby'] || 0) === before - 1, [before, await summary(D)]);

    // your account
    check('needs login', (await member()('POST', '/api/chat/mentions/seen', { channel: 'room:lobby' })).status === 401);
    const bid = rows('SELECT id FROM users WHERE username = ?', b)[0].id;
    await B('POST', '/api/me/delete', { password: pwB, confirm: b });
    check('deleting an account removes the mentions of it and by it', rows('SELECT COUNT(*) AS n FROM mentions WHERE user_id = ? OR from_id = ?', bid, bid)[0].n === 0);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
