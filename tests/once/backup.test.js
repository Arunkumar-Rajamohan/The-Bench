// Backup and restore, end to end: real server -> backup -> restore -> real server again.
'use strict';
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const serverJs = process.argv[2];
const tool = path.join(path.dirname(serverJs), 'backup', 'backup.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-backup-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));

// A stand-in for Turso. Keys: 'rw' may write, 'ro' may only read.
function turso(port, db) {
  db.exec('PRAGMA foreign_keys = OFF');
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'bigint' ? { type: 'integer', value: String(v) } : typeof v === 'number' ? { type: 'float', value: v }
    : v instanceof Uint8Array ? { type: 'blob', base64: Buffer.from(v).toString('base64') } : { type: 'text', value: v };
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? BigInt(a.value) : a.type === 'float' ? Number(a.value) : a.type === 'blob' ? Buffer.from(a.base64, 'base64') : a.value;
  const state = { wrote: 0, seen: [] };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const key = String(req.headers.authorization || '').replace('Bearer ', '').split('.')[0];
      if (!['rw', 'ro'].includes(key)) { res.writeHead(401); return res.end('{}'); }
      let dead = false;
      const out = JSON.parse(body).requests.map((r) => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        if (dead) return { type: 'error', error: { message: 'stopped' } };
        const sql = r.stmt.sql, read = /^\s*select/i.test(sql), tx = /^\s*(begin|commit)/i.test(sql);
        state.seen.push(key + ' ' + sql.slice(0, 40));
        try {
          if (!read && !tx && key === 'ro') throw new Error('read-only key');
          if (tx) { db.exec(sql); return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null } } }; }
          const st = db.prepare(sql), args = (r.stmt.args || []).map(dec);
          if (read) {
            st.setReadBigInts(true);
            const rows = st.all(...args);
            return { type: 'ok', response: { type: 'execute', result: { cols: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [], rows: rows.map((o) => Object.values(o).map(enc)), affected_row_count: 0, last_insert_rowid: null } } };
          }
          state.wrote++;
          const i = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(i.changes), last_insert_rowid: String(i.lastInsertRowid) } } };
        } catch (e) { dead = true; try { db.exec('ROLLBACK'); } catch (x) { /* none open */ } return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results: out }));
    });
  }).listen(port, '127.0.0.1');
  return { srv, state };
}
async function bench(port, extra) {
  const child = spawn(process.execPath, [serverJs], { env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', KEEP_AWAKE: 'off' }, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
  const base = 'http://127.0.0.1:' + port;
  const call = async (m, u, b, cookie) => { const r = await fetch(base + u, { method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); return { status: r.status, cookie: sc ? sc.split(';')[0] : cookie, json: await r.json().catch(() => ({})) }; };
  return { call, stop: async () => { child.kill(); await wait(300); }, log: () => log };
}
const run = (args, input) => new Promise((done) => {
  const c = spawn(process.execPath, [tool, ...args], { env: Object.assign({}, process.env, { BENCH_BACKUP_HOME: home, NODE_NO_WARNINGS: '1' }), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => out += d); c.stderr.on('data', (d) => out += d);
  c.stdin.end(input || '');
  c.on('close', (code) => done({ code, out }));
});
const folder = path.join(home, 'TheBenchBackups');
const files = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);

(async () => {
  const live = new DatabaseSync(':memory:'), fresh = new DatabaseSync(':memory:');
  const T = turso(8071, live), F = turso(8072, fresh);
  let S, S2, S3;
  try {
    S = await bench(5171, { TURSO_DATABASE_URL: 'http://127.0.0.1:8071', TURSO_AUTH_TOKEN: 'rw', NODE_ENV: 'production' });
    const pw = crypto.randomUUID(), SECRET = 'zqsecret' + crypto.randomBytes(4).toString('hex');
    const a = await S.call('POST', '/api/signup', { username: 'alpha_one', name: 'Ålpha 🙌', password: pw });
    const b = await S.call('POST', '/api/signup', { username: 'beta_two', name: "O'Neil \"B\"", password: pw });
    check('setup: accounts', a.status === 201 && b.status === 201, [a.json, S.log()]);
    await S.call('PUT', '/api/me/data', { resume: SECRET + " it's ₹6,50,000\nline two 日本", moodlog: {} }, a.cookie);
    await S.call('POST', '/api/posts', { text: 'Post with "quotes" and 🙌', tag: 'Win' }, a.cookie);
    await S.call('POST', '/api/chat/dm/beta_two', { text: SECRET + ' dm' }, a.cookie);
    // values a database can hold that text cannot
    live.exec('CREATE TABLE odd ("a b" INTEGER, f REAL, n TEXT, x BLOB)');
    live.prepare('INSERT INTO odd VALUES (?,?,?,?)').run(9007199254740993n, 1.5, null, Buffer.from([0, 255, 10]));

    let r = await run([]);
    check('before setup: says so', r.code === 1 && /Not set up yet/.test(r.out), r);
    r = await run(['setup'], 'not an address\nro\n');
    check('bad address refused', r.code === 1 && /should look like/.test(r.out), r);
    r = await run(['setup'], 'http://127.0.0.1:8071\nnope\n');
    check('bad key refused', r.code === 1 && /refused the key/.test(r.out) && !fs.existsSync(path.join(home, '.the-bench-backup.json')), r);
    r = await run(['setup'], 'http://127.0.0.1:8072\nro\n');
    check('wrong database refused', r.code === 1 && /does not look like The Bench/.test(r.out), r);
    r = await run(['setup'], 'http://127.0.0.1:8071\nro.KEYTEXT\n');
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.the-bench-backup.json'), 'utf8'));
    check('setup works and shows the passphrase once', r.code === 0 && r.out.includes(cfg.passphrase) && /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(cfg.passphrase), r);
    check('key is never shown', !r.out.includes('KEYTEXT'));

    const wrote = T.state.wrote;
    r = await run([]);
    check('backup works with a read-only key', r.code === 0 && /Backed up and test-restored: 2 members/.test(r.out) && files().length === 1, r);
    check('and wrote nothing to the live database', T.state.wrote === wrote && !T.state.seen.some((s) => s.startsWith('ro') && !/^ro (SELECT|BEGIN|COMMIT)/.test(s)));
    check('no key or passphrase in the output', !r.out.includes(cfg.passphrase) && !r.out.includes('KEYTEXT'));
    const file = path.join(folder, files()[0]), raw = fs.readFileSync(file);
    check('the file is encrypted', !raw.includes(SECRET) && !raw.includes('alpha_one') && !raw.includes('users'));
    r = await run(['check']);
    check('check opens it', r.code === 0 && /Good:/.test(r.out) && /2 members/.test(r.out), r);

    const hurt = Buffer.from(raw); hurt[hurt.length - 20] ^= 1;
    fs.writeFileSync(path.join(tmp, 'hurt.benchbackup'), hurt);
    r = await run(['check', path.join(tmp, 'hurt.benchbackup')], cfg.passphrase + '\n');
    check('one changed byte is noticed', r.code === 1 && /wrong, or the file is damaged/.test(r.out), r);
    fs.writeFileSync(path.join(tmp, 'cut.benchbackup'), raw.subarray(0, 200));
    r = await run(['check', path.join(tmp, 'cut.benchbackup')], cfg.passphrase + '\n');
    check('a cut-off file is noticed', r.code === 1 && /damaged/.test(r.out), r);
    fs.writeFileSync(path.join(tmp, 'junk.benchbackup'), 'x'.repeat(500));
    r = await run(['check', path.join(tmp, 'junk.benchbackup')], 'x\n');
    check('some other file is refused', r.code === 1 && /not a The Bench backup/.test(r.out), r);
    // another computer: no settings there, only the file and the written-down passphrase
    const keep = path.join(home, '.the-bench-backup.json'), aside = path.join(tmp, 'cfg'); fs.renameSync(keep, aside);
    r = await run(['check', file], 'WRONG-PASS\n'); check('wrong passphrase refused', r.code === 1 && /passphrase is wrong/.test(r.out), r);
    r = await run(['check', file], cfg.passphrase + '\n'); check('right passphrase works without the settings', r.code === 0 && /Good:/.test(r.out), r);
    fs.renameSync(aside, keep);

    // restore to a file, and run the real app on it
    const dir = path.join(tmp, 'restored'); fs.mkdirSync(dir);
    r = await run(['restore', file, 'local', path.join(dir, 'bench.db')]);
    check('restore to a file', r.code === 0 && /2 members/.test(r.out), r);
    r = await run(['restore', file, 'local', path.join(dir, 'bench.db')]);
    check('never overwrites a file', r.code === 1 && /already exists/.test(r.out), r);
    const rd = new DatabaseSync(path.join(dir, 'bench.db')), st = rd.prepare('SELECT * FROM odd'); st.setReadBigInts(true); const odd = st.get();
    check('odd values survive exactly', odd['a b'] === 9007199254740993n && odd.f === 1.5 && odd.n === null && Buffer.from(odd.x).equals(Buffer.from([0, 255, 10])), String(odd && odd['a b']));
    check('log-in sessions are left out', rd.prepare('SELECT COUNT(*) AS n FROM sessions').get().n === 0 && live.prepare('SELECT COUNT(*) AS n FROM sessions').get().n > 0);
    const idx = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all().map((x) => x.name).join();
    check('indexes come back', idx(rd) === idx(live) && idx(rd).length > 0, idx(rd));
    rd.close();
    S2 = await bench(5172, { DATA_DIR: dir });
    const me2 = await S2.call('POST', '/api/login', { username: 'alpha_one', password: pw });
    check('real app runs on it: log in, data intact', me2.status === 200 && me2.json.user.name === 'Ålpha 🙌' && me2.json.data.resume === SECRET + " it's ₹6,50,000\nline two 日本", [me2.json, S2.log()]);
    check('old sessions do not work there', (await S2.call('GET', '/api/me', null, a.cookie)).status === 401);
    const dm = await S2.call('GET', '/api/chat/dm/beta_two', null, me2.cookie), ps = await S2.call('GET', '/api/posts', null, me2.cookie);
    check('chats and posts intact', dm.json.messages[0].text === SECRET + ' dm' && ps.json.posts[0].text === 'Post with "quotes" and 🙌', [dm.json, ps.json]);
    check('new members do not collide', (await S2.call('POST', '/api/signup', { username: 'gamma_three', name: 'G', password: pw })).status === 201);

    // restore into a new, empty Turso database, and run the real app on that
    r = await run(['restore', file, 'turso'], 'http://127.0.0.1:8071\nrw\n');
    check('refuses a database that is not empty', r.code === 1 && /not empty, so nothing was changed/.test(r.out) && T.state.wrote >= wrote && live.prepare('SELECT COUNT(*) AS n FROM users').get().n === 2, r);
    r = await run(['restore', file, 'turso'], 'http://127.0.0.1:8072\nrw\n');
    check('restore into an empty Turso database', r.code === 0 && /Restored and counted: 2 members/.test(r.out), r);
    S3 = await bench(5173, { TURSO_DATABASE_URL: 'http://127.0.0.1:8072', TURSO_AUTH_TOKEN: 'rw', NODE_ENV: 'production' });
    const me3 = await S3.call('POST', '/api/login', { username: 'alpha_one', password: pw });
    check('real app runs on that too', me3.status === 200 && me3.json.data.resume.startsWith(SECRET), [me3.json, S3.log()]);

    // tidying up old copies
    const oldDay = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10), okDay = new Date(Date.now() - 80 * 864e5).toISOString().slice(0, 10);
    for (const d of [oldDay, okDay]) fs.copyFileSync(file, path.join(folder, 'the-bench-' + d + '-000000.benchbackup'));
    fs.writeFileSync(path.join(folder, 'my notes.txt'), 'mine'); fs.writeFileSync(path.join(folder, 'the-bench-2020-01-01-copy.benchbackup'), 'mine');
    await wait(1100); r = await run([]);
    check('removes copies over 90 days old, nothing else', r.code === 0 && !files().some((f) => f.includes(oldDay)) && files().some((f) => f.includes(okDay)) && files().includes('my notes.txt') && files().includes('the-bench-2020-01-01-copy.benchbackup'), [r.out, files()]);

    // the live database suddenly nearly empty: keep everything and shout
    fs.copyFileSync(file, path.join(folder, 'the-bench-' + oldDay + '-000000.benchbackup'));
    live.exec("UPDATE users SET username = '~' || id WHERE username = 'beta_two'");
    await wait(1100); r = await run([]);
    check('a sudden drop in members is flagged and old copies kept', r.code === 2 && /WARNING: there were 2 members last time and 1 now/.test(r.out) && files().some((f) => f.includes(oldDay)), [r, files()]);

    // the database disappears part-way: no half-written backup is left
    T.srv.close(); T.srv.closeAllConnections(); const n = files().length;
    r = await run([]);
    check('unreachable database: clear message, nothing half-written', r.code === 1 && /Could not reach the database/.test(r.out) && files().length === n && !files().some((f) => f.endsWith('.part')), r);
    r = await run(['nonsense']); check('unknown command explained', r.code === 1 && /Unknown command/.test(r.out), r);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  for (const s of [S, S2, S3]) if (s) await s.stop();
  T.srv.close(); F.srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log('backup: ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
