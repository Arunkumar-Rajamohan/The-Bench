// Fun tab test: node tests/both/fun.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const FUN = require(path.join(path.dirname(serverJs), 'fun-data.js'));
const PORT = 5194, MOCK = 8094;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-fun-'));
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');

// Same day maths as the server.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = dayFmt.format(new Date());
const dayNum = (day) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.UTC(2026, 10, 1)) / 864e5);
const pickFor = (list, n) => list[((n % list.length) + list.length) % list.length];
const WORD = pickFor(FUN.WORDS, dayNum(today)).word;
const QUESTION = pickFor(FUN.QUESTIONS, dayNum(today));
const YQUESTION = pickFor(FUN.QUESTIONS, dayNum(today) - 1);
const sorted = (s) => s.split('').sort().join('');
function wrongAnagrams(n) {
  const out = new Set();
  for (let k = 0; out.size < n && k < 5000; k++) {
    const a = WORD.split('');
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const s = a.join('');
    if (s !== WORD) out.add(s);
  }
  return [...out];
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

function member() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
}

(async () => {
  const admin = 'mod_' + rnd();
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: admin });
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
  const A = member(), B = member(), M = member();
  const ua = 'fa_' + rnd(), ub = 'fb_' + rnd();
  try {
    for (const [c, u] of [[A, ua], [B, ub], [M, admin]]) {
      const r = await c('POST', '/api/signup', { username: u, name: 'N ' + u, password: crypto.randomUUID() });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }
    check('anonymous blocked', (await member()('GET', '/api/fun/today')).status === 401);

    // ----- puzzle -----
    let r = await A('GET', '/api/fun/today');
    let p = r.json.puzzle;
    check('today payload', r.status === 200 && r.json.day === today && p && r.json.qotd, r.json);
    check('answer is secret before playing', p.answer === null && !JSON.stringify(r.json).includes('"' + WORD + '"'), p);
    check('scramble is an anagram, not the word', p.scrambled !== WORD && sorted(p.scrambled) === sorted(WORD) && p.length === WORD.length, p);
    check('nothing revealed yet', p.reveal === '_'.repeat(WORD.length) && p.triesLeft === 5 && p.streak === 0, p);
    r = await B('GET', '/api/fun/today');
    check('same scramble for everyone', r.json.puzzle.scrambled === p.scrambled);

    check('digits rejected', (await A('POST', '/api/fun/puzzle', { guess: '12345' })).status === 400);
    check('wrong length rejected', (await A('POST', '/api/fun/puzzle', { guess: WORD + 'S' })).status === 400);
    const other = WORD.slice(0, -1) + (WORD.endsWith('Z') ? 'Q' : 'Z');
    check('wrong letters rejected', (await A('POST', '/api/fun/puzzle', { guess: other })).status === 400);
    check('rejected guesses do not use tries', (await A('GET', '/api/fun/today')).json.puzzle.triesLeft === 5);

    const wrongs = wrongAnagrams(6);
    r = await A('POST', '/api/fun/puzzle', { guess: wrongs[0].toLowerCase() });
    p = r.json;
    check('wrong guess counted', r.status === 200 && p.triesLeft === 4 && !p.solved && !p.done && p.answer === null, p);
    check('miss reveals first letter', p.reveal === WORD[0] + '_'.repeat(WORD.length - 1), p.reveal);
    check('repeat guess rejected', (await A('POST', '/api/fun/puzzle', { guess: wrongs[0] })).status === 400);
    r = await A('POST', '/api/fun/puzzle', { guess: ' ' + WORD.toLowerCase() + ' ' });
    p = r.json;
    check('correct guess solves', r.status === 200 && p.solved && p.done && p.answer === WORD && p.guesses.length === 2, p);
    check('streak counts today', p.streak === 1, p.streak);
    check('leaderboard: 4 points for 2 tries', p.leaderboard.length === 1 && p.leaderboard[0].username === ua && p.leaderboard[0].points === 4 && p.leaderboard[0].me === true, p.leaderboard);
    check('no guessing after done', (await A('POST', '/api/fun/puzzle', { guess: wrongs[1] })).status === 409);

    for (let i = 1; i <= 5; i++) r = await B('POST', '/api/fun/puzzle', { guess: wrongs[i] });
    p = r.json;
    check('five misses ends the game', r.status === 200 && p.done && !p.solved && p.answer === WORD && p.triesLeft === 0, p);
    check('failed player not on leaderboard', p.leaderboard.length === 1 && p.leaderboard[0].me === false, p.leaderboard);
    check('state survives reload', (await B('GET', '/api/fun/today')).json.puzzle.guesses.length === 5);

    // ----- question of the day -----
    r = await A('GET', '/api/fun/today');
    check('question for today', r.json.qotd.question === QUESTION && r.json.qotd.answered === false && r.json.qotd.answers.length === 0, r.json.qotd);
    check('empty answer rejected', (await A('POST', '/api/fun/qotd', { text: '  ' })).status === 400);
    check('too long answer rejected', (await A('POST', '/api/fun/qotd', { text: 'x'.repeat(301) })).status === 400);
    r = await A('POST', '/api/fun/qotd', { text: 'A <b>pilot</b>!' });
    const ansA = (r.json.answers || [])[0];
    check('answer posted', r.status === 201 && r.json.answered === true && ansA && ansA.own === true && ansA.text === 'A <b>pilot</b>!', r.json);
    check('one answer per day', (await A('POST', '/api/fun/qotd', { text: 'again' })).status === 409);
    r = await B('POST', '/api/fun/qotd', { text: 'Astronaut' });
    check('second person answers', r.status === 201 && r.json.answers.length === 2);
    check('B reacts to A', (await B('POST', '/api/fun/answers/' + ansA.id + '/react', { r: '😂' })).status === 200);
    r = await A('GET', '/api/fun/qotd');
    let mine = r.json.answers.find((x) => x.id === ansA.id);
    check('reaction counted, not marked mine for A', mine.reacts['😂'] === 1 && !mine.mine['😂'], mine);
    check('bad emoji rejected', (await B('POST', '/api/fun/answers/' + ansA.id + '/react', { r: '💩' })).status === 400);
    check('react toggles off', (await B('POST', '/api/fun/answers/' + ansA.id + '/react', { r: '😂' })).status === 200 &&
      !(await A('GET', '/api/fun/qotd')).json.answers.find((x) => x.id === ansA.id).reacts['😂']);

    await B('POST', '/api/blocks/' + ua);
    check('blocked author hidden', !(await B('GET', '/api/fun/qotd')).json.answers.some((x) => x.username === ua));
    await B('DELETE', '/api/blocks/' + ua);

    check('B reports A answer', (await B('POST', '/api/chat/msg/' + ansA.id + '/report', { reason: 'test' })).status === 201);
    r = await M('GET', '/api/admin/reports');
    check('moderator sees it as Question of the Day', r.json.reports.length === 1 && r.json.reports[0].where === 'Question of the Day', r.json.reports);
    check('moderator dismisses', (await M('POST', '/api/admin/reports/' + r.json.reports[0].id, { action: 'dismiss' })).status === 200);

    check('author deletes own answer', (await A('DELETE', '/api/chat/msg/' + ansA.id)).status === 200);
    r = await A('GET', '/api/fun/qotd');
    check('can answer again after deleting', r.json.answered === false && (await A('POST', '/api/fun/qotd', { text: 'Chef' })).status === 201);
    const ansB = (await M('GET', '/api/fun/qotd')).json.answers.find((x) => x.username === ub);
    check('others cannot delete', (await A('DELETE', '/api/chat/msg/' + ansB.id)).status === 403);
    check('moderator deletes any answer', (await M('DELETE', '/api/chat/msg/' + ansB.id)).status === 200);

    r = await A('GET', '/api/fun/qotd?day=yesterday');
    check('yesterday has its own question', r.status === 200 && r.json.question === YQUESTION && r.json.day !== today && r.json.answers.length === 0, r.json);
    check('answers do not leak into chat rooms', !(await A('GET', '/api/chat/summary')).json.rooms.some((x) => x.lastId > 0));

    // ----- bingo is saved with private data -----
    const bingo = { card: Array.from({ length: 24 }, (_, i) => i), ticks: [0, 1], celebrated: [], total: 3 };
    check('bingo saves', (await A('PUT', '/api/me/data', { bingo })).status === 200);
    check('bingo comes back', JSON.stringify((await A('GET', '/api/me')).json.data.bingo) === JSON.stringify(bingo));
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); if (mock) mock.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed  (word today: ' + WORD.length + ' letters)');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-2000));
  process.exit(0);
})();
