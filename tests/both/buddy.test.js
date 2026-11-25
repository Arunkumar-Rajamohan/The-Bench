// Buddy test: node tests/both/buddy.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5187, TURSO = 8087;
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = dayFmt.format(new Date());
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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
  call.waitFor = async (kind, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = events.find((x) => x.type === 'buddy' && x.kind === kind); if (e) return e; await wait(25); } return null; };
  return call;
}

(async () => {
  const admin = 'mod_' + rnd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-buddy-'));
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: admin,
    GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let turso;
  if (mode === 'hosted') {
    turso = startTurso(new DatabaseSync(':memory:'));
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' });
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);

  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
  const A = member(), B = member(), C = member(), M = member();
  const ua = 'ba_' + rnd(), ub = 'bb_' + rnd(), uc = 'bc_' + rnd();
  try {
    for (const [c, u, name] of [[A, ua, 'Asha'], [B, ub, 'Bala'], [C, uc, 'Chitra'], [M, admin, 'Mod']]) {
      const r = await c('POST', '/api/signup', { username: u, name, password: crypto.randomUUID() });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }
    await A('PUT', '/api/profile', { name: 'Asha', headline: 'Customer support associate', location: 'Chennai' });
    await B('PUT', '/api/profile', { name: 'Bala', headline: 'Support specialist', location: 'Chennai' });
    await C('PUT', '/api/profile', { name: 'Chitra', headline: 'Data analyst', location: 'Pune' });
    await A.stream(); await B.stream();

    check('anonymous blocked', (await member()('GET', '/api/buddy')).status === 401);
    let r = await A('GET', '/api/buddy');
    check('starts unpaired, not seeking', r.status === 200 && r.json.pair === null && r.json.prefs.seeking === false && r.json.today === today, r.json);
    check('goal too long', (await A('PUT', '/api/buddy/prefs', { seeking: true, goal: 'x'.repeat(121) })).status === 400);
    r = await A('PUT', '/api/buddy/prefs', { seeking: true, goal: '  2 applications   a day ' });
    check('opt in with goal', r.status === 200 && r.json.prefs.seeking === true && r.json.prefs.goal === '2 applications a day', r.json.prefs);
    await B('PUT', '/api/buddy/prefs', { seeking: true, goal: 'land a support role' });

    r = await C('GET', '/api/buddy/suggestions');
    check('suggestions list seekers only', r.json.suggestions.map((x) => x.username).sort().join() === [ua, ub].sort().join(), r.json);
    r = await A('GET', '/api/buddy/suggestions');
    check('suggestions exclude me', r.json.suggestions.length === 1 && r.json.suggestions[0].username === ub && r.json.suggestions[0].goal === 'land a support role', r.json);
    check('people shows seeking flag', (await C('GET', '/api/people')).json.people.find((p) => p.username === ua).seeking === true);
    r = await C('GET', '/api/profile/' + ua);
    check('profile shows buddy status', r.json.buddy && r.json.buddy.seeking === true && r.json.buddy.paired === false && r.json.buddy.goal === '2 applications a day', r.json.buddy);

    check('cannot ask someone not looking', (await A('POST', '/api/buddy/requests', { username: uc })).status === 409);
    check('cannot ask yourself', (await A('POST', '/api/buddy/requests', { username: ua })).status === 404);
    check('note too long', (await A('POST', '/api/buddy/requests', { username: ub, note: 'x'.repeat(141) })).status === 400);
    r = await A('POST', '/api/buddy/requests', { username: ub, note: 'Same city, same goal!' });
    check('send request', r.status === 201 && r.json.outgoing.length === 1 && r.json.outgoing[0].username === ub, r.json);
    check('recipient told live', !!(await B.waitFor('request')));
    r = await B('GET', '/api/buddy');
    const req = r.json.incoming[0];
    check('recipient sees request with note', req && req.username === ua && req.note === 'Same city, same goal!', r.json);
    check('no duplicate request', (await A('POST', '/api/buddy/requests', { username: ub })).status === 409);
    check('no reverse duplicate', (await B('POST', '/api/buddy/requests', { username: ua })).status === 409);
    check('outsider cannot accept', (await C('POST', '/api/buddy/requests/' + req.id + '/accept', {})).status === 404);
    check('sender cannot accept own', (await A('POST', '/api/buddy/requests/' + req.id + '/accept', {})).status === 403);

    r = await B('POST', '/api/buddy/requests/' + req.id + '/accept', {});
    check('accept makes a pair', r.status === 200 && r.json.pair && r.json.pair.buddy.username === ua && r.json.pair.streak === 0, r.json);
    check('sender told live', !!(await A.waitFor('accepted')));
    r = await A('GET', '/api/buddy');
    check('both see the pair, seeking switched off', r.json.pair && r.json.pair.buddy.username === ub && r.json.prefs.seeking === false && r.json.pair.buddy.headline === 'Support specialist', r.json);
    check('paired people leave suggestions', (await C('GET', '/api/buddy/suggestions')).json.suggestions.length === 0);
    check('profile shows paired', (await C('GET', '/api/profile/' + ua)).json.buddy.paired === true);
    await C('PUT', '/api/buddy/prefs', { seeking: true });
    check('cannot request while paired', (await A('POST', '/api/buddy/requests', { username: uc })).status === 409);
    check('cannot request someone paired', (await C('POST', '/api/buddy/requests', { username: ua })).status === 409);

    // daily check-ins
    check('done needs a plan', (await A('PUT', '/api/buddy/checkin', { done: true })).status === 400);
    check('plan too long', (await A('PUT', '/api/buddy/checkin', { plan: 'x'.repeat(141) })).status === 400);
    check('cheer before buddy checks in', (await B('POST', '/api/buddy/cheer', { emoji: '🙌' })).status === 409);
    r = await A('PUT', '/api/buddy/checkin', { plan: 'Apply to 2 jobs' });
    check('check in', r.status === 200 && r.json.pair.me.plan === 'Apply to 2 jobs' && r.json.pair.me.done === false, r.json.pair);
    r = await B('GET', '/api/buddy');
    check('buddy sees my plan', r.json.pair.them.plan === 'Apply to 2 jobs' && r.json.pair.theirWeek[6].planned === true, r.json.pair);
    check('bad cheer', (await B('POST', '/api/buddy/cheer', { emoji: '💩' })).status === 400);
    r = await B('POST', '/api/buddy/cheer', { emoji: '💪' });
    check('cheer', r.status === 200 && r.json.pair.them.cheer === '💪');
    check('cheered person told live', !!(await A.waitFor('cheer')));
    check('cheer shows on my day', (await A('GET', '/api/buddy')).json.pair.me.cheer === '💪');

    r = await A('POST', '/api/buddy/nudge', {});
    check('nudge a buddy who has not checked in', r.status === 200 && r.json.pair.nudgedThem === true, r.json);
    check('nudged person told live', !!(await B.waitFor('nudge')));
    check('one nudge a day', (await A('POST', '/api/buddy/nudge', {})).status === 409);
    check('nudged person sees it', (await B('GET', '/api/buddy')).json.pair.nudgedMe === true);
    check('cannot nudge someone who checked in', (await B('POST', '/api/buddy/nudge', {})).status === 409);

    r = await A('PUT', '/api/buddy/checkin', { done: true });
    check('mark done keeps plan', r.json.pair.me.done === true && r.json.pair.me.plan === 'Apply to 2 jobs', r.json.pair.me);
    check('buddy told when done', !!(await B.waitFor('done')));
    check('streak 0 until both check in', (await A('GET', '/api/buddy')).json.pair.streak === 0);
    await B('PUT', '/api/buddy/checkin', { plan: 'Mock interview practice' });
    r = await A('GET', '/api/buddy');
    check('streak 1 when both checked in today', r.json.pair.streak === 1 && r.json.pair.silentDays === 0, r.json.pair);
    if (mode === 'local') {
      const db = new DatabaseSync(path.join(tmp, 'bench.db'));
      const ids = db.prepare('SELECT id, username FROM users').all();
      const idA = ids.find((x) => x.username === ua).id, idB = ids.find((x) => x.username === ub).id;
      const ins = db.prepare('INSERT INTO checkins (user_id, day, plan, done, updated) VALUES (?, ?, ?, 1, 0)');
      for (const d of [1, 2]) { ins.run(idA, shift(today, -d), 'past', ); ins.run(idB, shift(today, -d), 'past'); }
      ins.run(idA, shift(today, -4), 'older'); // gap on day -3 breaks the run
      db.close();
      r = await A('GET', '/api/buddy');
      check('streak counts back across days', r.json.pair.streak === 3, r.json.pair.streak);
      check('week shows done days', r.json.pair.myWeek.filter((d) => d.done).length >= 3, r.json.pair.myWeek);
    }

    // block ends the pairing
    check('block', (await B('POST', '/api/blocks/' + ua)).status === 200);
    check('blocked side told it ended', !!(await A.waitFor('ended')));
    check('pairing gone for both', (await A('GET', '/api/buddy')).json.pair === null && (await B('GET', '/api/buddy')).json.pair === null);
    await B('DELETE', '/api/blocks/' + ua);
    check('no buddy actions without a pair', (await A('POST', '/api/buddy/nudge', {})).status === 404);

    // pair with C, then end it by hand
    await A('PUT', '/api/buddy/prefs', { seeking: true });
    r = await A('POST', '/api/buddy/requests', { username: uc });
    const req2 = (await C('GET', '/api/buddy')).json.incoming[0];
    check('decline', (await C('POST', '/api/buddy/requests/' + req2.id + '/decline', {})).status === 200);
    check('sender told of decline', !!(await A.waitFor('declined')));
    check('declined request gone', (await A('GET', '/api/buddy')).json.outgoing.length === 0);
    await A('POST', '/api/buddy/requests', { username: uc });
    const req3 = (await C('GET', '/api/buddy')).json.incoming[0];
    check('sender can cancel', (await A('DELETE', '/api/buddy/requests/' + req3.id)).status === 200 && (await C('GET', '/api/buddy')).json.incoming.length === 0);
    await A('POST', '/api/buddy/requests', { username: uc });
    await C('POST', '/api/buddy/requests/' + (await C('GET', '/api/buddy')).json.incoming[0].id + '/accept', {});
    check('new pair', (await A('GET', '/api/buddy')).json.pair.buddy.username === uc);
    r = await C('POST', '/api/buddy/end', {});
    check('end pairing', r.status === 200 && r.json.pair === null);
    check('other side told', !!(await A.waitFor('ended')));

    // ban closes a pairing
    // (Bala sends this one, so Asha stays clear of the 10-requests-an-hour limit.)
    await B('PUT', '/api/buddy/prefs', { seeking: true });
    await C('PUT', '/api/buddy/prefs', { seeking: true });
    await B('POST', '/api/buddy/requests', { username: uc });
    await C('POST', '/api/buddy/requests/' + (await C('GET', '/api/buddy')).json.incoming[0].id + '/accept', {});
    await C('POST', '/api/chat/room/lobby', { text: 'spam' });
    const mid = (await M('GET', '/api/chat/room/lobby')).json.messages.pop().id;
    await B('POST', '/api/chat/msg/' + mid + '/report', {});
    await M('POST', '/api/admin/reports/' + (await M('GET', '/api/admin/reports')).json.reports[0].id, { action: 'ban' });
    check('banned buddy closes the pairing', (await B('GET', '/api/buddy')).json.pair === null);
    for (const x of [A, B]) if (x.stop) x.stop();
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); if (turso) turso.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, '').replace(/Job feeds failed[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
