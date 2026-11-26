// Deleting an account and downloading your data: node tests/both/delete-account.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5187, FEEDS = 8085, TURSO = 8084;
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-del-'));
  const adminName = 'dladm_' + rnd();
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: adminName, KEEP_AWAKE: 'off',
    GREENHOUSE_BASE_URL: 'http://127.0.0.1:' + FEEDS, LEVER_BASE_URL: 'http://127.0.0.1:' + FEEDS,
    ASHBY_BASE_URL: 'http://127.0.0.1:' + FEEDS, SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:' + FEEDS
  });
  let turso, mem;
  if (mode === 'hosted') {
    mem = new DatabaseSync(':memory:');
    turso = startTurso(mem);
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' });
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);
  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
  const A = member(), B = member(), C = member();
  const MARK = 'zqmark' + rnd();              // everything A writes contains this
  const pwA = crypto.randomUUID(), pwC = crypto.randomUUID();
  const aName = 'dla_' + rnd(), bName = 'dlb_' + rnd();
  // every place a value lives, read straight from the database
  const dump = () => {
    const db = mem || new DatabaseSync(path.join(tmp, 'bench.db'), { readOnly: true });
    const out = {};
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) out[t.name] = db.prepare('SELECT * FROM ' + t.name).all();
    if (!mem) db.close();
    return out;
  };
  try {
    for (const [c, u, n, p] of [[A, aName, MARK, pwA], [B, bName, 'Bee', crypto.randomUUID()], [C, adminName, 'Cee', pwC]]) {
      const r = await c('POST', '/api/signup', { username: u, name: n.slice(0, 24), password: p });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }
    // fill every feature
    await A('PUT', '/api/me/data', { resume: MARK, moodlog: { '2026-11-01': { tags: [], note: MARK } } });
    await A('PUT', '/api/profile', { name: MARK, headline: MARK, bio: MARK, skills: [], openTo: [], status: 'looking', color: 'tomato' });
    let r = await A('POST', '/api/posts', { text: MARK, tag: 'Win' });
    let posts = (await B('GET', '/api/posts')).json.posts;
    const aPost = posts.find((p) => p.text === MARK);
    check('setup: post', !!aPost, r);
    await B('POST', '/api/posts/' + aPost.id + '/replies', { text: 'reply by B' });
    await B('POST', '/api/posts/' + aPost.id + '/react', { r: aPost.reacts ? Object.keys(aPost.reacts)[0] : '🙌' });
    await B('POST', '/api/posts', { text: 'post by B', tag: 'Win' });
    const bPost = (await B('GET', '/api/posts')).json.posts.find((p) => p.text === 'post by B');
    await A('POST', '/api/posts/' + bPost.id + '/replies', { text: MARK });
    const roomMsg = (await A('POST', '/api/chat/room/lobby', { text: MARK + ' room' })).json.msg;
    const reported = (await A('POST', '/api/chat/room/lobby', { text: MARK + ' reported' })).json.msg;
    check('setup: report', (await B('POST', '/api/chat/msg/' + reported.id + '/report', { reason: 'bad' })).status === 201);
    await A('POST', '/api/chat/dm/' + bName, { text: MARK + ' dm' });
    await B('POST', '/api/chat/dm/' + aName, { text: 'secret reply from B' });
    await B('POST', '/api/chat/dm/' + adminName, { text: 'B to C stays' });
    await A('POST', '/api/leads', { title: MARK, company: MARK, url: 'https://example.com/' + MARK });
    await A('POST', '/api/referrals', { company: MARK, note: MARK });
    await B('POST', '/api/referrals', { company: 'Beeco' });
    const beeco = (await A('GET', '/api/referrals')).json.offers.find((o) => o.company === 'Beeco');
    check('setup: ask', (await A('POST', '/api/referrals/' + beeco.id + '/ask', { role: 'x', message: MARK })).status === 201);
    await A('POST', '/api/alerts', { what: MARK });
    await A('PUT', '/api/buddy/prefs', { seeking: true, goal: MARK });
    await A('POST', '/api/blocks/' + adminName, {});

    // download
    r = await A('GET', '/api/me/export');
    const ex = JSON.stringify(r.json);
    check('export works', r.status === 200 && r.json.account.username === aName && r.json.private.resume === MARK, r.json.account);
    check('export has posts, messages, leads, offers', r.json.posts.length === 1 && r.json.messages.length >= 3 && r.json.jobLeads.length === 1 && r.json.referralOffers.length === 1 && r.json.jobAlerts.length === 1, Object.fromEntries(Object.entries(r.json).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])));
    check('export leaves out passwords and other people', !/"pass"|"salt"|"recovery"/.test(ex) && !ex.includes('secret reply from B'));
    check('export needs login', (await member()('GET', '/api/me/export')).status === 401);

    // refusals
    check('wrong password refused', (await A('POST', '/api/me/delete', { password: 'wrong-password', confirm: aName })).status === 401);
    check('wrong username refused', (await A('POST', '/api/me/delete', { password: pwA, confirm: bName })).status === 400);
    check('moderator refused', (await C('POST', '/api/me/delete', { password: pwC, confirm: adminName })).status === 400);
    check('anonymous refused', (await member()('POST', '/api/me/delete', { password: pwA, confirm: aName })).status === 401);
    check('still here after refusals', (await A('GET', '/api/me')).status === 200);

    const before = dump();
    const aId = before.users.find((u) => u.username === aName).id;
    await B.stream();
    r = await A('POST', '/api/me/delete', { password: pwA, confirm: aName.toUpperCase() });
    check('delete succeeds', r.status === 200, r);
    await wait(300);
    check('open pages told to drop the message', B.events.some((e) => e.type === 'del' && e.id === roomMsg.id), B.events);
    if (B.stop) B.stop();
    check('session is dead', (await A('GET', '/api/me')).status === 401);
    check('cannot log in', (await member()('POST', '/api/login', { username: aName, password: pwA })).status === 401);
    check('cannot log in to the placeholder', (await member()('POST', '/api/login', { username: '~' + aId, password: pwA })).status === 401);

    // the raw database
    let d = dump();
    const found = Object.entries(d).flatMap(([t, rows]) => rows.filter((x) => JSON.stringify(x).includes(MARK) || JSON.stringify(x).includes(aName)).map((x) => t + ':' + JSON.stringify(x)));
    // the message itself, and the report's own copy of what was reported (so an edit cannot hide it); both go when the report is closed
    check('only the reported message keeps its text', found.length === 2 && found.some((x) => x.startsWith('messages:')) && found.some((x) => x.startsWith('reports:')) && found.every((x) => x.includes('reported')), found);
    check('B\'s side of the private chat is gone', !JSON.stringify(d.messages).includes('secret reply from B'));
    check('other chats untouched', JSON.stringify(d.messages).includes('B to C stays'));
    const idRows = Object.entries(d).filter(([t]) => !['users', 'messages', 'job_leads', 'referral_offers'].includes(t))
      .flatMap(([t, rows]) => rows.filter((x) => [x.user_id, x.from_id, x.to_id, x.a, x.b, x.blocker_id, x.blocked_id].includes(aId)).map(() => t));
    check('no rows left pointing at the account', idRows.length === 0, idRows);
    check('replies on the deleted post are gone', !JSON.stringify(d.replies).includes('reply by B'));
    check('B\'s own post survives', JSON.stringify(d.posts).includes('post by B'));
    const ph = d.users.find((u) => u.id === aId);
    check('placeholder is empty', ph && ph.username === '~' + aId && ph.name === 'Deleted member' && ph.data === '{}' && ph.recovery === null, ph);

    // everything still works for others
    for (const u of ['/api/posts', '/api/chat/summary', '/api/chat/room/lobby', '/api/leads', '/api/referrals', '/api/people', '/api/fun/today', '/api/buddy']) {
      const x = await B('GET', u);
      check('works after: ' + u, x.status === 200 && !JSON.stringify(x.json).includes(MARK) && !JSON.stringify(x.json).includes('Deleted member'), [x.status, JSON.stringify(x.json).slice(0, 200)]);
    }
    check('profile is gone', (await B('GET', '/api/profile/' + aName)).status === 404);
    r = await C('GET', '/api/admin/reports');
    const rep = r.json.reports.find((x) => x.text.includes('reported'));
    check('moderator can still see the open report', !!rep && rep.authorName === 'Deleted member', r.json.reports);
    check('not listed as banned', r.json.banned.length === 0, r.json.banned);
    check('moderator closes it', (await C('POST', '/api/admin/reports/' + rep.id, { action: 'dismiss' })).status === 200);
    check('then the reported text is wiped too', !JSON.stringify(dump()).includes(MARK));
    const A2 = member();
    r = await A2('POST', '/api/signup', { username: aName, name: 'New person', password: crypto.randomUUID() });
    check('username is free again, with a new id', r.status === 201 && dump().users.find((u) => u.username === aName).id !== aId);
    check('new person starts empty', JSON.stringify((await A2('GET', '/api/me')).json.data) === '{}' && (await A2('GET', '/api/chat/summary')).json.dms.length === 0);
    check('"~" usernames cannot be registered', (await member()('POST', '/api/signup', { username: '~99', name: 'x', password: crypto.randomUUID() })).status === 400);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); feeds.close(); if (turso) turso.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (results.some((x) => x.startsWith('FAIL'))) console.log(log.split('\n').slice(-12).join('\n'));
  process.exit(0);
})();
