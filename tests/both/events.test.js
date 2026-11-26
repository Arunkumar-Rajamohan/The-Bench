// Walk-in drives and events: node tests/both/events.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5167, TURSO = 8067, base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
const istToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = (n) => new Date(Date.parse(istToday + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ev-')), mod = 'evmod_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: mod, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { turso = startTurso(mem = new DatabaseSync(':memory:')); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const db = (sql, ...args) => { const d = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const out = /^\s*select/i.test(sql) ? d.prepare(sql).all(...args) : d.prepare(sql).run(...args); if (!mem) d.close(); return out; };
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    const A = member(), B = member(), C = member(), M = member();
    const a = 'eva_' + rnd(), b = 'evb_' + rnd(), c = 'evc_' + rnd(), pwA = crypto.randomUUID();
    for (const [x, u, n, p] of [[A, a, 'Asha', pwA], [B, b, 'Bala', crypto.randomUUID()], [C, c, 'Chitra', crypto.randomUUID()], [M, mod, 'Mod', crypto.randomUUID()]]) {
      const r = await x('POST', '/api/signup', { username: u, name: n, password: p }); if (r.status !== 201) throw new Error(JSON.stringify(r));
    }
    const walkin = { kind: 'walkin', title: 'Walk-in drive: customer support', org: 'Kettle & Co', day: day(3), until: day(5), start: '10:00', finish: '13:00', city: 'Chennai', venue: 'Tidel Park, Taramani', url: 'https://example.com/walkin', details: 'Freshers welcome. Salary ₹18,000 a month. Bring 2 resumes.' };
    const post = (who, o) => who('POST', '/api/events', Object.assign({}, walkin, o));
    let r = await post(A, {});
    check('share a walk-in (a salary in rupees is fine)', r.status === 201, r);
    r = await post(B, { kind: 'webinar', title: 'Resume clinic', org: 'Pune Jobs Club', day: day(1), until: '', start: '18:00', finish: '', online: true, city: 'ignored', venue: 'ignored', details: '' });
    check('share an online webinar', r.status === 201, r);
    await post(A, { title: 'Job fair', kind: 'fair', org: 'City council', day: istToday, until: '', start: '', finish: '', city: 'chennai', venue: '', url: '', details: '' });

    r = await C('GET', '/api/events');
    const list = r.json.events;
    check('upcoming events, soonest first', r.status === 200 && list.length === 3 && list.map((e) => e.day).join() === [istToday, day(1), day(3)].join() && r.json.today === istToday, list.map((e) => e.day));
    const web = list.find((e) => e.kind === 'webinar');
    check('online ones have no city or venue', web.online === true && web.city === 'Online' && web.venue === '' && web.finish === '', web);
    const w = list.find((e) => e.kind === 'walkin');
    check('everything a walk-in needs', w.until === day(5) && w.start === '10:00' && w.finish === '13:00' && w.venue === 'Tidel Park, Taramani' && w.url === 'https://example.com/walkin' && w.name === 'Asha' && w.going === 0 && w.mine === false, w);

    // what gets refused
    const bad = async (o, label) => { const x = await post(C, o); check(label, x.status === 400, x); };
    await bad({ day: day(-1) }, 'not in the past');
    await bad({ day: day(121), until: '' }, 'not more than four months ahead');
    await bad({ day: '2026-02-30', until: '' }, 'not a date that does not exist');
    await bad({ until: day(2) }, 'the last day cannot be before the first');
    await bad({ until: day(18) }, 'and not more than two weeks after it');
    await bad({ start: '25:00' }, 'a real start time');
    await bad({ start: '14:00', finish: '13:00' }, 'ends after it starts');
    await bad({ city: '', online: false }, 'a city, unless online');
    await bad({ online: 'yes', city: '' }, '"yes" is not the same as ticking online');
    await bad({ title: '' }, 'needs a title');
    await bad({ org: ' ' }, 'needs an organiser');
    await bad({ url: 'javascript:alert(1)' }, 'only real web links');
    await bad({ details: 'Registration fee ₹500 to be paid at the venue.' }, 'no registration fees');
    await bad({ details: 'Pay to confirm your slot before Friday.' }, 'no paying to confirm a slot');
    await bad({ venue: 'Bring the training charges in cash' }, 'no training charges, even in the venue');
    await bad({ details: 'Fee: Rs 999 for the interview kit' }, 'no fee with an amount');
    r = await post(C, { kind: 'mystery', org: 'Odd Co' });
    check('an unknown kind is a walk-in', r.status === 201 && (await C('GET', '/api/events')).json.events.find((e) => e.org === 'Odd Co').kind === 'walkin');

    // multi-day events stay listed until their last day; old ones drop off
    db("INSERT INTO events (user_id, kind, title, org, day, until, city, created) VALUES (1, 'walkin', 'Still on', 'Old Co', ?, ?, 'Pune', 1)", day(-2), day(1));
    db("INSERT INTO events (user_id, kind, title, org, day, until, city, created) VALUES (1, 'walkin', 'All over', 'Old Co', ?, '', 'Pune', 1)", day(-1));
    r = await C('GET', '/api/events');
    check('a drive that started earlier and runs till tomorrow is still listed', r.json.events.some((e) => e.title === 'Still on'));
    check('one that is over is not', !r.json.events.some((e) => e.title === 'All over'));
    const overId = db("SELECT id FROM events WHERE title = 'All over'")[0].id;
    check('cannot say you are going to one that is over', (await B('POST', '/api/events/' + overId + '/going', {})).status === 400);

    // going
    r = await B('POST', '/api/events/' + w.id + '/going', {});
    check('say you are going', r.status === 200 && r.json.mine === true && r.json.going === 1, r);
    await C('POST', '/api/events/' + w.id + '/going', {});
    r = await B('GET', '/api/events');
    check('the count and your own choice show', r.json.events.find((e) => e.id === w.id).going === 2 && r.json.events.find((e) => e.id === w.id).mine === true);
    check('others see the count, not that it is theirs', (await A('GET', '/api/events')).json.events.find((e) => e.id === w.id).mine === false);
    r = await B('POST', '/api/events/' + w.id + '/going', {});
    check('tap again to take it back', r.json.mine === false && r.json.going === 1, r);

    // delete and report
    check('only yours to delete', (await B('DELETE', '/api/events/' + w.id)).status === 403);
    check('reporting', (await C('POST', '/api/events/' + w.id + '/report', { reason: 'fake' })).status === 201 && (await A('POST', '/api/events/' + w.id + '/report', {})).status === 400);
    r = await M('GET', '/api/admin/reports');
    const rep = r.json.reports.find((x) => x.where === 'a walk-in or event');
    check('moderators see what was reported', rep && /Walk-in drive: customer support \(Kettle & Co\)/.test(rep.text) && /Chennai/.test(rep.text) && rep.author === a, rep);
    await M('POST', '/api/admin/reports/' + rep.id, { action: 'delete' });
    check('a moderator can remove it', !(await C('GET', '/api/events')).json.events.some((e) => e.id === w.id));
    check('its details and the going list go too', db('SELECT details, venue FROM events WHERE id = ?', w.id)[0].details === '' && db('SELECT COUNT(*) AS n FROM event_going WHERE event_id = ?', w.id)[0].n === 0);
    const fair = (await A('GET', '/api/events')).json.events.find((e) => e.kind === 'fair');
    check('delete your own', (await A('DELETE', '/api/events/' + fair.id)).status === 200 && !(await C('GET', '/api/events')).json.events.some((e) => e.id === fair.id));

    // blocking, limits, login
    await post(A, { title: 'Another drive', day: day(7), until: '' });
    await C('POST', '/api/blocks/' + a);
    check('events from someone you blocked are hidden', !(await C('GET', '/api/events')).json.events.some((e) => e.name === 'Asha') && (await B('GET', '/api/events')).json.events.some((e) => e.name === 'Asha'));
    await C('DELETE', '/api/blocks/' + a);
    for (let i = 0; i < 2; i++) await post(A, { title: 'Drive ' + i, day: day(8 + i), until: '' });
    check('five a day at most', (await post(A, { title: 'Too many', day: day(11), until: '' })).status === 429);
    check('needs login', (await member()('GET', '/api/events')).status === 401);

    // your data
    const another = (await B('GET', '/api/events')).json.events.find((e) => e.title === 'Another drive');
    await B('POST', '/api/events/' + another.id + '/going', {});
    r = await A('GET', '/api/me/export');
    check('download has the events you shared', r.json.eventsShared.length >= 3 && r.json.eventsShared.some((e) => e.title === 'Another drive'), r.json.eventsShared);
    check('and the ones you are going to', (await B('GET', '/api/me/export')).json.eventsGoing.some((e) => e.title === 'Another drive'));
    const aid = db('SELECT id FROM users WHERE username = ?', a)[0].id;
    await A('POST', '/api/me/delete', { password: pwA, confirm: a });
    check('deleting the account removes their events and who was going', db('SELECT COUNT(*) AS n FROM events WHERE user_id = ?', aid)[0].n === 0 && db('SELECT COUNT(*) AS n FROM event_going WHERE event_id = ?', another.id)[0].n === 0);
    check('the list still loads', (await B('GET', '/api/events')).status === 200);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
