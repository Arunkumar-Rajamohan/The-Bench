// Chat test: node tests/both/chat.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5196, MOCK = 8096;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-chat-'));
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');

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

function member(username) {
  let cookie = '';
  const events = [];
  let reader = null;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  return {
    username, events, call,
    async stream() {
      const r = await fetch(base + '/api/stream', { headers: { Cookie: cookie } });
      if (r.status !== 200) return r.status;
      reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) { events.push({ type: '__closed' }); break; }
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              for (const line of chunk.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
            }
          }
        } catch (e) { events.push({ type: '__closed' }); }
      })();
      return 200;
    },
    async waitFor(pred, ms = 3000) {
      const t = Date.now();
      while (Date.now() - t < ms) { const e = events.find(pred); if (e) return e; await wait(25); }
      return null;
    },
    stop() { if (reader) reader.cancel().catch(() => {}); }
  };
}

(async () => {
  const admin = 'mod_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: 'someone_else, ' + admin.toUpperCase() });
  let mock;
  if (mode === 'hosted') {
    mock = startMock(new DatabaseSync(':memory:'));
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + MOCK, TURSO_AUTH_TOKEN: 'test-token', NODE_ENV: 'production' });
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);

  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300)));
  const A = member('a_' + rnd()), B = member('b_' + rnd()), C = member('c_' + rnd()), M = member(admin);
  const pw = {};
  try {
    for (const u of [A, B, C, M]) {
      pw[u.username] = crypto.randomUUID();
      const r = await u.call('POST', '/api/signup', { username: u.username, name: 'Name ' + u.username.slice(0, 1).toUpperCase(), password: pw[u.username] });
      if (r.status !== 201) throw new Error('signup failed ' + JSON.stringify(r));
    }
    check('isAdmin flag only for moderator', (await M.call('GET', '/api/me')).json.user.isAdmin === true && (await A.call('GET', '/api/me')).json.user.isAdmin === false);
    check('anonymous cannot open stream', (await fetch(base + '/api/stream')).status === 401);
    const st = await Promise.all([A.stream(), B.stream(), C.stream(), M.stream()]);
    check('streams open', st.every((s) => s === 200), st);

    let r = await A.call('GET', '/api/chat/summary');
    check('summary lists 4 rooms', r.status === 200 && r.json.rooms.map((x) => x.slug).join() === 'lobby,job-leads,interview-prep,vent', r.json);

    // ----- rooms -----
    r = await A.call('POST', '/api/chat/room/lobby', { text: 'hello room' });
    const m1 = r.json.msg;
    check('post in room', r.status === 201 && m1 && m1.id > 0 && m1.username === A.username, r);
    const gotB = await B.waitFor((e) => e.type === 'msg' && e.msg.id === m1.id);
    check('live delivery to others', !!gotB && gotB.channel === 'room:lobby' && !!(await C.waitFor((e) => e.type === 'msg' && e.msg.id === m1.id)));
    check('live delivery to sender too', !!(await A.waitFor((e) => e.type === 'msg' && e.msg.id === m1.id)));
    r = await C.call('GET', '/api/chat/room/lobby');
    check('room history', r.status === 200 && r.json.messages.some((x) => x.id === m1.id && x.text === 'hello room'), r.json);
    check('unknown room 404', (await A.call('POST', '/api/chat/room/nope', { text: 'x' })).status === 404);
    check('empty message 400', (await A.call('POST', '/api/chat/room/lobby', { text: '   ' })).status === 400);
    check('too long 400', (await A.call('POST', '/api/chat/room/lobby', { text: 'x'.repeat(1001) })).status === 400);
    check('others cannot delete', (await B.call('DELETE', '/api/chat/msg/' + m1.id)).status === 403);
    check('cannot report own', (await A.call('POST', '/api/chat/msg/' + m1.id + '/report', { reason: '' })).status === 400);

    // ----- blocking -----
    check('B blocks A', (await B.call('POST', '/api/blocks/' + A.username)).status === 200);
    check('block list', (await B.call('GET', '/api/blocks')).json.blocks.some((x) => x.username === A.username));
    r = await A.call('POST', '/api/chat/room/lobby', { text: 'after block' });
    const m2 = r.json.msg;
    check('C still gets blocked author', !!(await C.waitFor((e) => e.type === 'msg' && e.msg.id === m2.id)));
    await wait(300);
    check('B does not get blocked author live', !B.events.some((e) => e.type === 'msg' && e.msg.id === m2.id));
    check('B history hides blocked author', !(await B.call('GET', '/api/chat/room/lobby')).json.messages.some((x) => x.username === A.username));
    check('blocked person cannot DM blocker', (await A.call('POST', '/api/chat/dm/' + B.username, { text: 'hi' })).status === 403);
    check('blocker cannot DM until unblock', (await B.call('POST', '/api/chat/dm/' + A.username, { text: 'hi' })).status === 403);
    check('dm view shows blockedByMe', (await B.call('GET', '/api/chat/dm/' + A.username)).json.blockedByMe === true);
    check('B unblocks A', (await B.call('DELETE', '/api/blocks/' + A.username)).status === 200);
    check('history back after unblock', (await B.call('GET', '/api/chat/room/lobby')).json.messages.some((x) => x.id === m2.id));

    // ----- DMs -----
    check('cannot DM yourself', (await A.call('POST', '/api/chat/dm/' + A.username, { text: 'me' })).status === 400);
    check('cannot DM nobody', (await A.call('POST', '/api/chat/dm/nobody_zz', { text: 'x' })).status === 404);
    r = await A.call('POST', '/api/chat/dm/' + C.username, { text: 'pay 2000 for the job' });
    const d1 = r.json.msg;
    check('send DM', r.status === 201 && d1 && d1.id > 0, r);
    const cGot = await C.waitFor((e) => e.type === 'msg' && e.msg.id === d1.id);
    check('recipient gets DM with sender channel', !!cGot && cGot.channel === 'dm:' + A.username && cGot.peer.username === A.username, cGot);
    const aGot = await A.waitFor((e) => e.type === 'msg' && e.msg.id === d1.id);
    check('sender gets DM with recipient channel', !!aGot && aGot.channel === 'dm:' + C.username, aGot);
    await wait(300);
    check('outsiders do not get the DM', !B.events.some((e) => e.msg && e.msg.id === d1.id) && !M.events.some((e) => e.msg && e.msg.id === d1.id));
    r = await C.call('GET', '/api/chat/summary');
    check('DM in summary', r.json.dms.length === 1 && r.json.dms[0].username === A.username && r.json.dms[0].lastText === 'pay 2000 for the job' && r.json.dms[0].lastFromMe === false, r.json.dms);
    r = await C.call('GET', '/api/chat/dm/' + A.username);
    check('DM history both ways', r.json.messages.length === 1 && r.json.peer.username === A.username);
    check('outsider cannot report DM', (await B.call('POST', '/api/chat/msg/' + d1.id + '/report', { reason: 'x' })).status === 404);
    check('outsider cannot delete DM', (await B.call('DELETE', '/api/chat/msg/' + d1.id)).status === 404);

    // ----- reports + moderation -----
    check('C reports DM', (await C.call('POST', '/api/chat/msg/' + d1.id + '/report', { reason: 'scam' })).status === 201);
    check('non-moderator blocked from admin', (await A.call('GET', '/api/admin/reports')).status === 403);
    r = await M.call('GET', '/api/admin/reports');
    const rep = (r.json.reports || [])[0];
    check('moderator sees report', r.status === 200 && rep && rep.text === 'pay 2000 for the job' && rep.where === 'a private message' && rep.reporter === C.username && rep.reason === 'scam', r.json);
    check('author deletes own DM', (await A.call('DELETE', '/api/chat/msg/' + d1.id)).status === 200);
    check('recipient gets delete', !!(await C.waitFor((e) => e.type === 'del' && e.id === d1.id && e.channel === 'dm:' + A.username)));
    r = await M.call('GET', '/api/admin/reports');
    check('reported text kept for review after delete', r.json.reports[0] && r.json.reports[0].text === 'pay 2000 for the job' && r.json.reports[0].deleted === true, r.json);
    check('deleted DM gone from history', (await C.call('GET', '/api/chat/dm/' + A.username)).json.messages.length === 0);
    check('dismiss report', (await M.call('POST', '/api/admin/reports/' + rep.id, { action: 'dismiss' })).status === 200);
    check('report list empty', (await M.call('GET', '/api/admin/reports')).json.reports.length === 0);
    if (mode === 'local') {
      const db = new DatabaseSync(path.join(tmp, 'bench.db'));
      const row = db.prepare('SELECT text FROM messages WHERE id = ?').get(d1.id);
      db.close();
      check('text wiped after dismissing', row && row.text === '', row);
    }

    // Spam in a room, reported, deleted + banned.
    r = await A.call('POST', '/api/chat/room/job-leads', { text: 'SPAM job, pay fee' });
    const s1 = r.json.msg;
    await A.call('POST', '/api/posts', { text: 'spam post', tag: 'Tip' });
    check('C reports room spam', (await C.call('POST', '/api/chat/msg/' + s1.id + '/report', {})).status === 201);
    check('double report is fine', (await C.call('POST', '/api/chat/msg/' + s1.id + '/report', {})).status === 201);
    check('B reports too', (await B.call('POST', '/api/chat/msg/' + s1.id + '/report', {})).status === 201);
    r = await M.call('GET', '/api/admin/reports');
    check('two open reports', r.json.reports.length === 2, r.json);
    r = await M.call('POST', '/api/admin/reports/' + r.json.reports[0].id, { action: 'ban' });
    check('delete + ban', r.status === 200, r);
    check('room gets delete event', !!(await C.waitFor((e) => e.type === 'del' && e.id === s1.id && e.channel === 'room:job-leads')));
    check('banned stream closed', !!(await A.waitFor((e) => e.type === '__closed')));
    check('banned session ended', (await A.call('GET', '/api/me')).status === 401);
    check('banned cannot log in', (await A.call('POST', '/api/login', { username: A.username, password: pw[A.username] })).status === 403);
    check('all reports on that message resolved', (await M.call('GET', '/api/admin/reports')).json.reports.length === 0);
    check('banned user hidden from room history', !(await C.call('GET', '/api/chat/room/lobby')).json.messages.some((x) => x.username === A.username));
    check('banned user hidden from feed', !(await C.call('GET', '/api/posts')).json.posts.some((x) => x.username === A.username));
    check('cannot DM banned user', (await C.call('POST', '/api/chat/dm/' + A.username, { text: 'x' })).status === 404);
    check('banned list', (await M.call('GET', '/api/admin/reports')).json.banned.some((x) => x.username === A.username));
    check('unban', (await M.call('POST', '/api/admin/unban/' + A.username)).status === 200);
    check('can log in after unban', (await A.call('POST', '/api/login', { username: A.username, password: pw[A.username] })).status === 200);

    // Moderator can delete any room message and any post.
    r = await B.call('POST', '/api/chat/room/vent', { text: 'rude' });
    check('moderator deletes room message', (await M.call('DELETE', '/api/chat/msg/' + r.json.msg.id)).status === 200);
    r = await B.call('POST', '/api/posts', { text: 'rude post', tag: 'Rant' });
    check('moderator deletes post', (await M.call('DELETE', '/api/posts/' + r.json.id)).status === 200);
    check('non-moderator cannot delete others post', (await C.call('DELETE', '/api/posts/' + (await A.call('POST', '/api/posts', { text: 'mine', tag: 'Win' })).json.id)).status === 403);

    // Older-page loading.
    // Spread over four people: each person may send 20 messages a minute.
    const senders = [A, B, C, M];
    for (let i = 0; i < 52; i++) {
      const s = await senders[i % 4].call('POST', '/api/chat/room/interview-prep', { text: 'msg ' + i });
      if (s.status !== 201) throw new Error('paging setup failed at ' + i + ': ' + JSON.stringify(s));
    }
    r = await M.call('POST', '/api/chat/room/vent', { text: 'one too many?' });
    const limited = [];
    for (let i = 0; i < 25; i++) limited.push((await M.call('POST', '/api/chat/room/vent', { text: 'flood ' + i })).status);
    check('room flood is rate limited', limited.includes(429), limited);
    r = await C.call('GET', '/api/chat/room/interview-prep');
    const first = r.json.messages[0];
    check('history pages at 50', r.json.messages.length === 50 && r.json.more === true && r.json.messages[49].text === 'msg 51', r.json.more);
    r = await C.call('GET', '/api/chat/room/interview-prep?before=' + first.id);
    check('older page', r.json.messages.length === 2 && r.json.messages[0].text === 'msg 0' && r.json.more === false, r.json);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  for (const u of [A, B, C, M]) u.stop();
  child.kill(); if (mock) mock.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-2000));
  process.exit(0);
})();
