// Interview experiences: node tests/both/experiences.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5168, TURSO = 8068, base = 'http://127.0.0.1:' + PORT;
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
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ivx-')), mod = 'ivmod_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: mod, KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { turso = startTurso(mem = new DatabaseSync(':memory:')); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const rows = (sql, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db')); const out = db.prepare(sql).all(...args); if (!mem) db.close(); return out; };
  try {
    child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
    const A = member(), B = member(), C = member(), M = member();
    const a = 'iva_' + rnd(), b = 'ivb_' + rnd(), c = 'ivc_' + rnd(), pwA = crypto.randomUUID();
    for (const [x, u, n, p] of [[A, a, 'Asha', pwA], [B, b, 'Bala', crypto.randomUUID()], [C, c, 'Chitra', crypto.randomUUID()], [M, mod, 'Mod', crypto.randomUUID()]]) {
      const r = await x('POST', '/api/signup', { username: u, name: n, password: p }); if (r.status !== 201) throw new Error(JSON.stringify(r));
    }
    const share = (who, o) => who('POST', '/api/interviews', Object.assign({ company: 'Infosys Ltd.', role: 'Support analyst', rounds: ['Online test', 'HR'], difficulty: 3, outcome: 'offer', waitDays: 9, questions: 'Tell me about yourself.', tips: 'Be clear.' }, o));
    let r = await share(A, { month: '2026-10', level: 'fresher', mode: 'online' });
    check('share an experience', r.status === 201 && r.json.key === 'infosys', r);
    r = await share(B, { company: 'infosys', outcome: 'rejected', waitDays: 20, difficulty: 4, rounds: ['Online test', 'Technical', 'HR'], anonymous: true, tips: 'Revise SQL joins.' });
    check('the same company, spelt differently', r.status === 201 && r.json.key === 'infosys', r);
    await share(C, { company: 'INFOSYS LIMITED', outcome: 'no-reply', waitDays: 5, difficulty: 2, rounds: ['Phone screen'], questions: '', tips: 'They never wrote back.' });
    await share(A, { company: 'Kettle & Co', role: 'Barista trainer', rounds: ['Manager'], outcome: 'waiting' });

    // reading
    r = await C('GET', '/api/interviews?company=' + encodeURIComponent('Infosys'));
    const list = r.json.interviews, s = r.json.summary;
    check('one company, all spellings together', r.status === 200 && list.length === 3 && r.json.key === 'infosys' && r.json.company === 'INFOSYS LIMITED', r.json);
    check('the summary adds up', s.count === 3 && s.difficulty === 3 && s.outcomes.offer === 1 && s.outcomes.rejected === 1 && s.outcomes['no-reply'] === 1 && s.waitDays === 9 && s.waitCount === 2, s);
    check('rounds people had, with counts', JSON.stringify(s.rounds) === JSON.stringify([{ name: 'Online test', n: 2 }, { name: 'Phone screen', n: 1 }, { name: 'Technical', n: 1 }, { name: 'HR', n: 2 }]), s.rounds);
    const anon = list.find((x) => x.anonymous);
    check('a nameless one never says who', anon && anon.name === '' && anon.username === '' && !JSON.stringify(anon).includes(b) && !JSON.stringify(r.json).includes('Bala'), anon);
    check('the author still sees it as theirs', (await B('GET', '/api/interviews?company=infosys')).json.interviews.some((x) => x.anonymous && x.own && x.name === 'Bala'));
    check('"never heard back" keeps no waiting time', list.find((x) => x.outcome === 'no-reply').waitDays === null);
    r = await C('GET', '/api/interviews');
    check('all experiences, newest first', r.json.interviews.length === 4 && r.json.interviews[0].company === 'Kettle & Co' && r.json.summary === null);
    r = await C('GET', '/api/interviews/companies');
    check('companies with counts', JSON.stringify(r.json.companies.map((x) => [x.key, x.n])) === JSON.stringify([['infosys', 3], ['kettle and co', 1]]) && r.json.companies[0].name === 'INFOSYS LIMITED', r.json);
    check('a company nobody has written about', (await C('GET', '/api/interviews?company=Zoho')).json.summary.count === 0);
    check('needs login', (await member()('GET', '/api/interviews')).status === 401);

    // what gets refused
    check('needs a company and a role', (await share(C, { company: '' })).status === 400 && (await share(C, { role: '  ' })).status === 400 && (await share(C, { company: '!!!' })).status === 400);
    check('needs something useful', (await share(C, { rounds: [], questions: '', tips: '' })).status === 400);
    check('a sensible waiting time', (await share(C, { waitDays: 400 })).status === 400 && (await share(C, { waitDays: 2.5 })).status === 400 && (await share(C, { waitDays: -1 })).status === 400);
    check('a sensible month', (await share(C, { month: '2099-01' })).status === 400 && (await share(C, { month: '2026-13' })).status === 400 && (await share(C, { month: 'soon' })).status === 400);
    check('not too long', (await share(C, { questions: 'x'.repeat(1501) })).status === 400 && (await share(C, { tips: 'x'.repeat(601) })).status === 400 && (await share(C, { company: 'x'.repeat(61) })).status === 400);
    r = await share(C, { company: 'Odd Co', rounds: ['HR', 'Hacking', 'constructor'], level: 'god', outcome: 'hired', mode: 'teleport', difficulty: 9, anonymous: 'yes' });
    const odd = (await C('GET', '/api/interviews?company=odd co')).json.interviews[0];
    check('anything unknown falls back safely', r.status === 201 && JSON.stringify(odd.rounds) === '["HR"]' && odd.level === '' && odd.outcome === 'waiting' && odd.mode === '' && odd.difficulty === 3 && odd.anonymous === false, odd);
    for (let i = 0; i < 3; i++) await share(C, { company: 'Co ' + i });
    check('five a day at most', (await share(C, { company: 'One too many' })).status === 429);

    // helpful, delete, report
    const aId = list.find((x) => x.company === 'Infosys Ltd.').id;
    check('mark as helpful', (await C('POST', '/api/interviews/' + aId + '/helpful', {})).status === 200 && (await B('POST', '/api/interviews/' + aId + '/helpful', {})).status === 200);
    r = await C('GET', '/api/interviews?company=infosys');
    check('most helpful first', r.json.interviews[0].id === aId && r.json.interviews[0].helpful === 2 && r.json.interviews[0].mine === true, r.json.interviews[0]);
    check('not your own', (await A('POST', '/api/interviews/' + aId + '/helpful', {})).status === 400);
    const bOwn = (await B('GET', '/api/interviews?company=infosys')).json.interviews.find((x) => x.own).id;
    await C('POST', '/api/interviews/' + bOwn + '/helpful', {}); await A('POST', '/api/interviews/' + bOwn + '/helpful', {}); await M('POST', '/api/interviews/' + bOwn + '/helpful', {});
    r = await C('GET', '/api/interviews?company=infosys');
    check('the name is written properly even when a lower-case one is on top', r.json.interviews[0].company === 'infosys' && r.json.company !== 'infosys' && /[A-Z]/.test(r.json.company), [r.json.interviews[0].company, r.json.company]);
    for (const who of [C, A, M]) await who('POST', '/api/interviews/' + bOwn + '/helpful', {});
    await C('POST', '/api/interviews/' + aId + '/helpful', {});
    check('tap again to take it back', (await C('GET', '/api/interviews?company=infosys')).json.interviews.find((x) => x.id === aId).helpful === 1);
    check('only yours to delete', (await C('DELETE', '/api/interviews/' + aId)).status === 403);
    const bId = (await B('GET', '/api/interviews?company=infosys')).json.interviews.find((x) => x.own).id;
    check('reporting', (await C('POST', '/api/interviews/' + bId + '/report', { reason: 'made up' })).status === 201 && (await B('POST', '/api/interviews/' + bId + '/report', {})).status === 400);
    r = await M('GET', '/api/admin/reports');
    const rep = r.json.reports.find((x) => x.where === 'an interview experience');
    check('moderators see the report, and who wrote it', rep && /Support analyst at infosys/.test(rep.text) && /without a name/.test(rep.text) && rep.author === b, rep);
    await M('POST', '/api/admin/reports/' + rep.id, { action: 'delete' });
    check('a moderator can remove it', !(await C('GET', '/api/interviews?company=infosys')).json.interviews.some((x) => x.id === bId));
    check('and its words are gone from the database', rows('SELECT questions, tips, deleted FROM interviews WHERE id = ?', bId)[0].tips === '' && rows('SELECT deleted FROM interviews WHERE id = ?', bId)[0].deleted === 1);
    // blocking hides them, banning hides them
    await C('POST', '/api/blocks/' + a);
    check('blocked people\'s experiences are hidden', !(await C('GET', '/api/interviews')).json.interviews.some((x) => x.username === a));
    await C('DELETE', '/api/blocks/' + a);

    // your data
    r = await A('GET', '/api/me/export');
    check('download has your experiences', r.json.interviewExperiences.length === 2 && r.json.interviewExperiences.some((x) => x.company === 'Kettle & Co'), r.json.interviewExperiences);
    const aid = rows('SELECT id FROM users WHERE username = ?', a)[0].id;
    await A('POST', '/api/me/delete', { password: pwA, confirm: a });
    check('deleting the account removes them and their votes', rows('SELECT COUNT(*) AS n FROM interviews WHERE user_id = ?', aid)[0].n === 0 && rows('SELECT COUNT(*) AS n FROM interview_votes WHERE interview_id = ?', aId)[0].n === 0);
    check('the rest still loads', (await C('GET', '/api/interviews?company=infosys')).json.interviews.length === 1);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) { child.kill(); await wait(400); }
  if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
