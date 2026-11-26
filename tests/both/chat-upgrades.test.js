// Replies, reactions and edits in chat: node tests/both/chat-upgrades.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5175, TURSO = 8075, base = 'http://127.0.0.1:' + PORT;
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
  call.events = events;
  call.got = (type, id) => events.filter((e) => e.type === type && (id === undefined || e.id === id || (e.msg && e.msg.id === id)));
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-cu-')), adminName = 'cadm_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: adminName, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') {
    turso = startTurso(mem = new DatabaseSync(':memory:'));
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' });
  } else {
    // a database from before this change: messages without reply_to or edited, reports without text
    const old = new DatabaseSync(path.join(tmp, 'bench.db'));
    old.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, channel TEXT NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, quiet INTEGER NOT NULL DEFAULT 0)');
    old.exec('CREATE TABLE reports (id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT \'\', created INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, UNIQUE (message_id, reporter_id))');
    old.exec("INSERT INTO messages (id, channel, user_id, text, created) VALUES (50, 'room:lobby', 1, 'from before', 5)");
    old.close();
  }
  const rows = (sql, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const out = /^\s*select/i.test(sql) ? db.prepare(sql).all(...args) : db.prepare(sql).run(...args); if (!mem) db.close(); return out; };
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    check('server starts (and an old database upgrades)', /running at/.test(log), log);
    const A = member(), B = member(), C = member(), M = member();
    const a = 'ua_' + rnd(), b = 'ub_' + rnd(), c = 'uc_' + rnd(), pwB = crypto.randomUUID();
    for (const [x, u, n, p] of [[A, a, 'Asha', crypto.randomUUID()], [B, b, 'Bala', pwB], [C, c, 'Chitra', crypto.randomUUID()], [M, adminName, 'Mod', crypto.randomUUID()]]) {
      const r = await x('POST', '/api/signup', { username: u, name: n, password: p });
      if (r.status !== 201) throw new Error(JSON.stringify(r));
    }
    await A.stream(); await B.stream(); await C.stream(); await M.stream(); await wait(300);
    const room = (who, text, replyTo) => who('POST', '/api/chat/room/lobby', replyTo === undefined ? { text } : { text, replyTo });
    const dm = (who, to, text, replyTo) => who('POST', '/api/chat/dm/' + to, replyTo === undefined ? { text } : { text, replyTo });
    const hist = async (who, url) => (await who('GET', url || '/api/chat/room/lobby')).json.messages;
    const one = async (who, id, url) => (await hist(who, url)).find((m) => m.id === id);
    const settle = () => wait(250);
    let r;

    // ---- replies in a room ----
    if (!mem) check('the old message is still there', (await hist(A)).some((m) => m.id === 50 && m.text === 'from before' && !m.reply && !m.edited));
    const r1 = (await room(A, 'first')).json.msg;
    r = await room(B, 'answer', r1.id);
    const r2 = r.json.msg;
    check('reply is sent with what it answers', r.status === 201 && r2.reply && r2.reply.id === r1.id && r2.reply.name === 'Asha' && r2.reply.username === a && r2.reply.text === 'first', r.json);
    await settle();
    const live = C.got('msg', r2.id)[0];
    check('others get the reply live, with the quote', live && live.msg.reply && live.msg.reply.text === 'first', live);
    let h = await one(C, r2.id);
    check('history has the quote', h && h.reply && h.reply.id === r1.id && h.reply.text === 'first' && h.reply.name === 'Asha', h);
    check('a plain message has no quote', !(await one(C, r1.id)).reply);
    check('no reply to a message that does not exist', (await room(B, 'x', 9999999)).status === 404);
    check('a bad reply id is refused', (await room(B, 'x', 'abc')).status === 400 && (await room(B, 'x', -3)).status === 400 && (await room(B, 'x', 1.5)).status === 400);
    r = await room(B, 'no reply', 0); check('replyTo 0 means a plain message', r.status === 201 && !r.json.msg.reply, r.json);
    const other = (await B('POST', '/api/chat/room/vent', { text: 'in vent' })).json.msg;
    check('no reply to a message in another room', (await room(A, 'x', other.id)).status === 404);
    const long = (await room(A, 'line one\n\n' + 'word '.repeat(80))).json.msg;
    r = await room(B, 'replying to a long one', long.id);
    check('the quote is one short line', r.json.msg.reply.text.length <= 141 && !/\n/.test(r.json.msg.reply.text) && r.json.msg.reply.text.endsWith('…') && r.json.msg.reply.text.startsWith('line one word'), r.json.msg.reply);

    // blocking hides the quoted words
    await C('POST', '/api/blocks/' + a);
    h = await one(C, r2.id);
    check('someone who blocked the quoted person sees no quoted words', h && h.reply && h.reply.hidden === true && !h.reply.text && !h.reply.name, h);
    C.events.length = 0;
    const r3 = (await room(B, 'another answer', r1.id)).json.msg; await settle();
    const cl = C.got('msg', r3.id)[0], al = A.got('msg', r3.id)[0];
    check('and live too, while others get it in full', cl && cl.msg.reply.hidden === true && !cl.msg.reply.text && al && al.msg.reply.text === 'first', { cl, al });
    check('and cannot reply to them', (await room(C, 'x', r1.id)).status === 404);
    C.events.length = 0;
    const r4 = (await room(A, 'blocked author replies', r2.id)).json.msg; await settle();
    check('a reply by the blocked person never reaches them', C.got('msg', r4.id).length === 0);
    await C('DELETE', '/api/blocks/' + a);
    check('after unblocking the quote is back', (await one(C, r2.id)).reply.text === 'first');

    // ---- replies in a private chat ----
    const d1 = (await dm(A, b, 'dm one')).json.msg;
    r = await dm(B, a, 'dm answer', d1.id);
    check('reply in a private chat', r.status === 201 && r.json.msg.reply && r.json.msg.reply.text === 'dm one', r.json);
    await settle();
    const ad = A.got('msg', r.json.msg.id)[0];
    check('the other person gets it with the quote', ad && ad.channel === 'dm:' + b && ad.msg.reply.text === 'dm one', ad);
    check('history in the private chat has it', (await one(A, r.json.msg.id, '/api/chat/dm/' + b)).reply.id === d1.id);
    check('no reply to a room message from a private chat', (await dm(B, a, 'x', r1.id)).status === 404);
    check('no reply to someone else\'s private chat', (await dm(C, a, 'x', d1.id)).status === 404);
    check('referral-style quiet messages still work', (await dm(C, a, 'hello')).status === 201);

    // ---- reactions ----
    A.events.length = 0; C.events.length = 0;
    r = await B('POST', '/api/chat/msg/' + r1.id + '/react', { r: '👍' });
    check('react', r.status === 200 && r.json.n === 1 && r.json.on === true && r.json.emoji === '👍', r.json);
    await settle();
    const ev = C.got('react', r1.id)[0];
    check('others see the new count live, but not who', ev && ev.n === 1 && ev.emoji === '👍' && ev.channel === 'room:lobby' && Object.keys(ev).sort().join() === 'channel,emoji,id,n,type', ev);
    r = await C('POST', '/api/chat/msg/' + r1.id + '/react', { r: '👍' });
    check('counts add up', r.json.n === 2);
    await C('POST', '/api/chat/msg/' + r1.id + '/react', { r: '❤️' });
    h = await one(B, r1.id);
    check('history has counts and your own', h.reacts && h.reacts['👍'] === 2 && h.reacts['❤️'] === 1 && h.mine && h.mine['👍'] === true && !h.mine['❤️'], h);
    h = await one(A, r1.id);
    check('someone who did not react has none of their own', h.reacts['👍'] === 2 && Object.keys(h.mine || {}).length === 0, h);
    r = await B('POST', '/api/chat/msg/' + r1.id + '/react', { r: '👍' });
    check('tap again to take it back', r.json.n === 1 && r.json.on === false, r.json);
    check('only the six chat reactions', (await B('POST', '/api/chat/msg/' + r1.id + '/react', { r: '💩' })).status === 400 && (await B('POST', '/api/chat/msg/' + r1.id + '/react', {})).status === 400);
    check('no reacting to a message that does not exist', (await B('POST', '/api/chat/msg/9999999/react', { r: '👍' })).status === 404);
    const q = await A('POST', '/api/fun/qotd', { text: 'my answer' });
    const qid = q.json.answers.find((x) => x.own).id;
    check('question-of-the-day answers keep their own reactions', (await B('POST', '/api/chat/msg/' + qid + '/react', { r: '👍' })).status === 400);
    B.events.length = 0;
    r = await A('POST', '/api/chat/msg/' + d1.id + '/react', { r: '🙏' });
    await settle();
    check('react in a private chat; the other person is told', r.status === 200 && B.got('react', d1.id).some((e) => e.channel === 'dm:' + a && e.n === 1), B.events);
    await wait(100);
    check('nobody else is told', C.got('react', d1.id).length === 0 && M.got('react', d1.id).length === 0);
    check('outsiders cannot react in a private chat', (await C('POST', '/api/chat/msg/' + d1.id + '/react', { r: '👍' })).status === 404);
    check('not without logging in', (await member()('POST', '/api/chat/msg/' + r1.id + '/react', { r: '👍' })).status === 401);

    // ---- edits ----
    A.events.length = 0; B.events.length = 0; C.events.length = 0;
    r = await A('PATCH', '/api/chat/msg/' + r1.id, { text: 'first, fixed' });
    check('edit your own message', r.status === 200 && r.json.msg.text === 'first, fixed' && r.json.msg.edited > 0, r.json);
    await settle();
    const ee = B.got('edit', r1.id)[0];
    check('everyone sees the change live', ee && ee.text === 'first, fixed' && ee.edited === r.json.msg.edited && ee.channel === 'room:lobby', ee);
    h = await one(C, r1.id);
    check('history shows it as edited', h.text === 'first, fixed' && h.edited === r.json.msg.edited, h);
    check('replies quote the new words', (await one(C, r2.id)).reply.text === 'first, fixed');
    check('reactions stay', h.reacts['👍'] === 1);
    check('not someone else\'s', (await B('PATCH', '/api/chat/msg/' + r1.id, { text: 'hack' })).status === 403);
    check('not even a moderator', (await M('PATCH', '/api/chat/msg/' + r1.id, { text: 'hack' })).status === 403);
    check('not empty or too long', (await A('PATCH', '/api/chat/msg/' + r1.id, { text: '  ' })).status === 400 && (await A('PATCH', '/api/chat/msg/' + r1.id, { text: 'x'.repeat(1001) })).status === 400);
    check('not a question-of-the-day answer', (await A('PATCH', '/api/chat/msg/' + qid, { text: 'changed' })).status === 400);
    const before = (await one(C, r1.id)).edited; B.events.length = 0;
    r = await A('PATCH', '/api/chat/msg/' + r1.id, { text: 'first, fixed' }); await settle();
    check('saving the same words changes nothing', r.status === 200 && (await one(C, r1.id)).edited === before && B.got('edit', r1.id).length === 0);
    rows('UPDATE messages SET created = ? WHERE id = ?', Date.now() - 25 * 3600e3, long.id);
    r = await A('PATCH', '/api/chat/msg/' + long.id, { text: 'too late' });
    check('only for a day after sending', r.status === 400 && /24 hours/.test(r.json.error), r.json);
    await C('POST', '/api/blocks/' + a); C.events.length = 0; B.events.length = 0;
    await A('PATCH', '/api/chat/msg/' + r1.id, { text: 'first, fixed again' }); await settle();
    check('people who blocked the author are not sent the new words', C.got('edit', r1.id).length === 0 && B.got('edit', r1.id).length === 1);
    await C('DELETE', '/api/blocks/' + a);
    // private chat
    A.events.length = 0;
    r = await B('PATCH', '/api/chat/msg/' + r2.id, { text: 'answer, edited' });
    const dEdit = await B('PATCH', '/api/chat/msg/' + (await one(B, d1.id, '/api/chat/dm/' + a)).id, { text: 'x' });
    check('cannot edit the other person\'s private message', dEdit.status === 403);
    const myDm = (await dm(B, a, 'tpyo')).json.msg;
    await B('PATCH', '/api/chat/msg/' + myDm.id, { text: 'typo' }); await settle();
    check('private edit reaches the other person under the right name', A.got('edit', myDm.id).some((e) => e.channel === 'dm:' + b && e.text === 'typo'));
    r = await A('GET', '/api/chat/summary');
    check('the chat list shows the new words', r.json.dms.find((d) => d.username === b).lastText === 'typo', r.json.dms);
    await A('POST', '/api/blocks/' + b);
    check('blocked: no edits', (await B('PATCH', '/api/chat/msg/' + myDm.id, { text: 'sneaky' })).status === 403);
    check('blocked: no reactions either way', (await B('POST', '/api/chat/msg/' + d1.id + '/react', { r: '👍' })).status === 403 && (await A('POST', '/api/chat/msg/' + myDm.id + '/react', { r: '👍' })).status === 403);
    await A('DELETE', '/api/blocks/' + b);

    // ---- reports keep what was reported ----
    const bad = (await room(A, 'original words')).json.msg;
    await C('POST', '/api/chat/msg/' + bad.id + '/report', { reason: 'rude' });
    await A('PATCH', '/api/chat/msg/' + bad.id, { text: 'nice words' });
    r = await M('GET', '/api/admin/reports');
    const rep = r.json.reports.find((x) => x.messageId === bad.id);
    check('moderators see what was reported, and that it changed', rep && rep.text === 'original words' && rep.editedSince === true, rep);
    await M('POST', '/api/admin/reports/' + rep.id, { action: 'dismiss' });
    check('the copy goes once the report is handled', rows('SELECT text FROM reports WHERE id = ?', rep.id)[0].text === null);
    const plain = (await room(A, 'plain report')).json.msg;
    await C('POST', '/api/chat/msg/' + plain.id + '/report', {});
    r = await M('GET', '/api/admin/reports');
    check('an unchanged reported message is not marked', r.json.reports.find((x) => x.messageId === plain.id).editedSince === false);

    // ---- deleting ----
    B.events.length = 0;
    await A('DELETE', '/api/chat/msg/' + r1.id); await settle();
    h = await one(B, r2.id);
    check('a reply to a deleted message keeps no trace of it', h.reply && h.reply.gone === true && !h.reply.text && !h.reply.name, h);
    check('its reactions are gone too', rows('SELECT COUNT(*) AS n FROM msg_reacts WHERE message_id = ?', r1.id)[0].n === 0);
    check('no reply to a deleted message', (await room(B, 'x', r1.id)).status === 404);
    check('no edit of a deleted message', (await A('PATCH', '/api/chat/msg/' + r1.id, { text: 'x' })).status === 404);

    // ---- your data ----
    await A('POST', '/api/chat/msg/' + r2.id + '/react', { r: '🎉' });
    await B('POST', '/api/chat/msg/' + r3.id + '/react', { r: '🙌' });
    r = await B('GET', '/api/me/export');
    check('download includes your reactions', Array.isArray(r.json.chatReactions) && r.json.chatReactions.some((x) => x.emoji === '🙌'), r.json.chatReactions);
    const bid = rows('SELECT id FROM users WHERE username = ?', b)[0].id;
    await B('POST', '/api/me/delete', { password: pwB, confirm: b });
    check('deleting an account removes its reactions and the ones on its messages', rows('SELECT COUNT(*) AS n FROM msg_reacts r LEFT JOIN messages m ON m.id = r.message_id WHERE r.user_id = ? OR m.user_id = ?', bid, bid)[0].n === 0);
    check('the room still loads', (await hist(A)).length > 0);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-2000));
  process.exit(0);
})();
