// Private usage counts: node tests/both/usage.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5177, TURSO = 8057, base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 600)));

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
function member(extra) {
  let cookie = '';
  const call = async (method, url, body, more) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}, extra || {}, more || {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.open = (view) => call('POST', '/api/usage', { view });
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-use-')), clock = path.join(tmp, 'clock');
  const day = (d, t) => fs.writeFileSync(clock, String(Date.parse(d + 'T' + (t || '12:00') + ':00+05:30')));
  day('2030-03-04'); // a Monday
  const owner = 'own_' + rnd(), mod = 'mod_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: owner + ', ' + mod, KEEP_AWAKE: 'off', USAGE_TEST_CLOCK: clock, GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { mem = new DatabaseSync(':memory:'); turso = startTurso(mem); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const start = async () => {
    log = '';
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
  };
  const stop = async () => { child.kill(); await wait(400); };
  const sql = (text, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const st = db.prepare(text); const out = /^\s*select/i.test(text) ? st.all(...args) : st.run(...args); if (!mem) db.close(); return out; };
  const dump = () => JSON.stringify(['usage_marks', 'usage_weeks', 'usage_days', 'settings'].map((t) => sql('SELECT * FROM ' + t)));
  // put someone's joining date where the story needs it
  const joined = (name, d) => sql('UPDATE users SET created = ? WHERE username = ?', Date.parse(d + 'T10:00:00+05:30'), name);
  try {
    await start();
    check('starts', /running at/.test(log), log);
    const O = member(), M = member(), pw = crypto.randomUUID();
    const join = async (c, u, d) => { const r = await c('POST', '/api/signup', { username: u, name: 'N ' + u.slice(0, 4), password: pw }); if (r.status !== 201) throw new Error(JSON.stringify(r)); joined(u, d); return r; };
    let r = await join(O, owner, '2030-03-04'); check('owner knows', r.json.user.isOwner === true);
    r = await join(M, mod, '2030-03-04'); check('other moderators are not the owner', r.json.user.isOwner === false && r.json.user.isAdmin === true);
    const P = [], names = [];
    for (let i = 0; i < 7; i++) { const c = member(), u = 'u' + i + '_' + rnd(); await join(c, u, '2030-03-04'); P.push(c); names.push(u); }
    const report = async () => (await O('GET', '/api/usage')).json;
    const line = (rep, key) => [...rep.did, ...rep.views].find((x) => x.key === key);

    // ---- who may look ----
    check('members cannot', (await P[0]('GET', '/api/usage')).status === 403);
    check('other moderators cannot', (await M('GET', '/api/usage')).status === 403);
    check('logged out cannot', (await member()('GET', '/api/usage')).status === 401 && (await member().open('feed')).status === 401);
    check('members are told nothing', JSON.stringify((await P[0].open('feed')).json) === '{"ok":true}');

    // ---- counting ----
    for (let i = 0; i < 3; i++) { await P[0].open('feed'); await P[0].open('jobs'); }
    let rep = await report();
    check('same person, same page, counted once', rep.activeNow === 1 && line(rep, 'v:feed').now.few === true, rep);
    check('1 to 4 people are only "under 5", with no number sent', !('n' in line(rep, 'v:feed').now) && rep.few === 5);
    check('nobody is an honest 0', line(rep, 'v:salary').now.n === 0);
    for (let i = 1; i < 5; i++) await P[i].open('feed');
    rep = await report(); check('5 people give the number', line(rep, 'v:feed').now.n === 5 && line(rep, 'v:jobs').now.few === true && rep.activeNow === 5, rep);
    check('today on the chart', rep.days.length === 28 && rep.days[27].day === '2030-03-04' && rep.days[27].n === 5 && rep.days[26].n === null, rep.days.slice(-2));
    check('members leave out the owner', rep.members === 8 && rep.joinedNow === 8, [rep.members, rep.joinedNow]);
    await O.open('feed'); rep = await report(); check('the owner is not counted', line(rep, 'v:feed').now.n === 5 && rep.days[27].n === 5 && sql('SELECT last_day FROM users WHERE username = ?', owner)[0].last_day === null);
    for (const v of ['mood', 'account', 'home', '../x', '__proto__', '', null, 7, 'x'.repeat(5000)]) await P[0].open(v);
    check('wellbeing and made-up pages are never counted', !/mood|home|account|proto|xxx/.test(dump()));
    const G = member({ 'Sec-GPC': '1' }), gName = 'gpc_' + rnd(), D = member({ DNT: '1' }), dName = 'dnt_' + rnd(); await join(G, gName, '2030-03-04'); await join(D, dName, '2030-03-04');
    const was = dump(); await G.open('feed'); await D.open('feed'); await G('POST', '/api/posts', { text: 'x', tag: 'Win' }); await D('POST', '/api/chat/room/lobby', { text: 'x' }); await wait(200);
    check('people who ask not to be tracked are left out of everything', dump() === was && sql('SELECT last_day FROM users WHERE username IN (?, ?)', gName, dName).every((x) => x.last_day === null));

    // ---- things people did ----
    for (let i = 0; i < 5; i++) { await P[i]('POST', '/api/posts', { text: 'SECRETPOST', tag: 'Win' }); await P[i]('POST', '/api/chat/room/lobby', { text: 'SECRETROOM' }); await P[i]('POST', '/api/chat/dm/' + names[i + 1], { text: 'SECRETDM' }); await P[i]('POST', '/api/referrals', { company: 'Acme' + i }); await P[i]('PUT', '/api/buddy/checkin', { plan: 'x' }); }
    await wait(300); rep = await report();
    check('posts, rooms, messages and referrals are counted', ['a:post', 'a:room', 'a:dm', 'a:referral'].every((k) => line(rep, k).now.n === 5), rep.did);
    check('daily check-ins are counted', line(rep, 'a:checkin').now.n === 5, line(rep, 'a:checkin'));
    await P[6]('POST', '/api/posts', { text: '', tag: 'Win' }); await wait(150); check('something that was refused is not', line(await report(), 'a:post').now.n === 5);
    const offer = (await P[6]('GET', '/api/referrals')).json.offers[0]; await P[6]('POST', '/api/referrals/' + offer.id + '/ask', { role: 'x', message: 'y' }); await wait(200); rep = await report();
    check('asking for a referral counts as a referral, not a private message', line(rep, 'a:referral').now.n === 6 && line(rep, 'a:dm').now.n === 5, rep.did);

    // ---- what is stored ----
    const marks = sql('SELECT * FROM usage_marks'), d0 = dump();
    check('nothing identifying is stored', !names.some((u) => d0.includes(u)) && !/SECRET/.test(d0) && marks.every((m) => /^[0-9a-f]{32}$/.test(m.mark)));
    check('the same person\'s markers do not match each other', new Set(marks.map((m) => m.mark)).size === marks.length, marks.length);
    const id0 = sql('SELECT id FROM users WHERE username = ?', names[0])[0].id;
    check('a marker is not just a hash of the account number', !marks.some((m) => [String(id0), 'active:' + id0, 'v:feed:' + id0].some((t) => crypto.createHash('sha256').update(t).digest('hex').startsWith(m.mark))));
    check('the report has no names or ids', !names.some((u) => JSON.stringify(rep).includes(u)) && !/"id"|user/.test(JSON.stringify(rep)));

    // ---- restarting does not count twice ----
    await stop(); await start(); await P[0].open('feed'); await P[1].open('feed'); rep = await report();
    check('a restart does not count anyone twice', line(rep, 'v:feed').now.n === 5 && rep.days[27].n === 5, [line(rep, 'v:feed'), rep.days[27]]);
    await Promise.all(Array.from({ length: 10 }, () => P[6].open('learn'))); rep = await report(); check('ten at once count once', rep.days[27].n === 6 && rep.activeNow === 6, [rep.days[27], rep.activeNow]);

    // ---- days and weeks ----
    day('2030-03-05', '00:05'); await P[0].open('feed'); rep = await report(); check('a new day in India', rep.days[27].day === '2030-03-05' && rep.days[27].n === 1 && rep.days[26].n === 6 && rep.activeNow === 6, rep.days.slice(-2));
    day('2030-03-10', '23:55'); await P[1].open('feed'); rep = await report(); check('Sunday is still the same week', rep.week === '2030-03-04' && line(rep, 'v:feed').now.n === 5, rep.week);
    const secretBefore = sql("SELECT key FROM settings WHERE key LIKE 'usage_secret:%'");
    day('2030-03-11', '00:05'); rep = await report();
    check('Monday: last week becomes totals', rep.week === '2030-03-11' && line(rep, 'v:feed').before.n === 5 && line(rep, 'v:feed').now.n === 0 && line(rep, 'v:jobs').before.few === true && rep.weeks[1].active === 6, [rep.weeks[1], line(rep, 'v:feed')]);
    check('and all its markers are deleted', sql('SELECT COUNT(*) AS n FROM usage_marks')[0].n === 0);
    await P[2].open('feed'); const secretAfter = sql("SELECT key FROM settings WHERE key LIKE 'usage_secret:%'");
    check('along with its secret', secretBefore.length === 1 && secretAfter.length === 1 && secretAfter[0].key === 'usage_secret:2030-03-11', [secretBefore, secretAfter]);
    await report(); await report(); rep = await report(); check('looking again changes nothing', line(rep, 'v:feed').before.n === 5 && rep.weeks[1].active === 6);

    // ---- coming back ---- (they joined on Monday 4 March; their second week is 11 to 17 March)
    rep = await report(); check('one came back so far', rep.weeks[1].back === 1 && rep.weeks[1].final === false && rep.weeks[1].joined === 10, rep.weeks[1]);
    day('2030-03-13'); await P[2].open('feed'); await P[3].open('feed'); day('2030-03-17'); await P[3].open('jobs'); rep = await report(); check('each person once', rep.weeks[1].back === 2, rep.weeks[1]);
    day('2030-03-18'); await P[4].open('feed'); rep = await report(); check('the third week is not the second', rep.weeks[2].back === 2, rep.weeks[2]);
    const late = member(), lName = 'late_' + rnd(); await join(late, lName, '2030-03-17'); await late.open('feed'); rep = await report(); check('joining does not count as coming back', rep.weeks[1].joined === 1 && rep.weeks[1].back === 0, rep.weeks[1]);
    day('2030-03-24', '12:00'); await late.open('feed'); rep = await report(); check('day 8 does', rep.weeks[1].back === 1 && rep.weeks[1].final === false, rep.weeks[1]);
    day('2030-04-05'); rep = await report(); check('final once everyone has had their second week', rep.weeks.find((w) => w.week === '2030-03-04').final === true && rep.weeks.find((w) => w.week === '2030-03-11').final === true && rep.weeks[0].back === null, rep.weeks);
    check('weeks before counting began are blank, not zero', rep.weeks.length === 8 && rep.weeks[7].week < '2030-03-04' && rep.weeks[7].active === null && rep.weeks[7].back === null, rep.weeks[7]);
    check('days before counting began too', rep.from === '2030-03-04' && (await (day('2030-03-20'), report())).days[0].n === null);

    // ---- deleting an account ----
    day('2030-04-05'); await P[5].open('feed'); await P[5].open('jobs'); const id5 = sql('SELECT id FROM users WHERE username = ?', names[5])[0].id, n5 = sql('SELECT COUNT(*) AS n FROM usage_marks')[0].n;
    await P[5]('POST', '/api/me/delete', { password: pw, confirm: names[5] });
    check('deleting removes this week\'s markers and the last day', n5 - sql('SELECT COUNT(*) AS n FROM usage_marks')[0].n === 3 && sql('SELECT last_day FROM users WHERE id = ?', id5)[0].last_day === null, [n5, sql('SELECT COUNT(*) AS n FROM usage_marks')[0].n]);
    rep = await report(); check('members goes down; who joined when does not change', rep.members === 10 && rep.weeks.find((w) => w.week === '2030-03-04').joined === 10, [rep.members, rep.weeks]);
    r = await P[4]('GET', '/api/me/export'); check('your download shows the day kept about you', r.json.account.lastOpened === '2030-03-18', r.json.account);
    check('members cannot see each other\'s last day', !/last_day|lastOpened|2030-03-18/.test(JSON.stringify([(await P[3]('GET', '/api/people')).json, (await P[3]('GET', '/api/profile/' + names[4])).json, (await P[3]('GET', '/api/me')).json])));
    // ---- no owner set ----
    await stop(); env.ADMIN_USERNAMES = ''; await start(); check('with no moderator list, nobody can see it', (await O('GET', '/api/usage')).status === 403);
    check('no errors logged', !/Usage count failed/.test(log), log.slice(-300));
  } catch (e) { results.push('FAIL crashed: ' + e.stack + log.slice(-300)); }
  if (child) await stop();
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
