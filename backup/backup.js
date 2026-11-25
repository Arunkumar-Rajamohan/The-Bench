// Backs up the live database (Turso) to an encrypted file on this computer, and restores one.
//
//   node backup/backup.js setup                     ask for the database address and a READ-ONLY key
//   node backup/backup.js                           make a backup, then test-restore it
//   node backup/backup.js check [file]              test-restore a backup (the newest, if no file is given)
//   node backup/backup.js restore <file> local <new.db>    rebuild it as a database file here
//   node backup/backup.js restore <file> turso             rebuild it into a NEW, EMPTY Turso database
//
// Settings live in your user folder (not in this project, so they never reach GitHub).
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const HOME = process.env.BENCH_BACKUP_HOME || os.homedir();
const CONFIG = path.join(HOME, '.the-bench-backup.json');
const FOLDER = path.join(HOME, 'TheBenchBackups');
const KEEP_DAYS = 90;
const MAGIC = Buffer.from('BENCHBK1');
// Never copied: log-in sessions. After a restore everyone simply logs in again.
const SKIP_ROWS = new Set(['sessions']);

class Stop extends Error {} // a problem to explain plainly, without a stack trace
const say = (...a) => console.log(...a);
const quote = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// ---------- encryption ----------
const keyFrom = (pass, salt) => crypto.scryptSync(pass.normalize('NFKC'), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
function seal(text, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(pass, salt), iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(zlib.gzipSync(text)), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
function unseal(buf, pass) {
  if (buf.length < 60 || !buf.subarray(0, 8).equals(MAGIC)) throw new Stop('That is not a The Bench backup file.');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(pass, buf.subarray(8, 24)), buf.subarray(24, 36));
  d.setAAD(MAGIC);
  d.setAuthTag(buf.subarray(36, 52));
  let zipped;
  try { zipped = Buffer.concat([d.update(buf.subarray(52)), d.final()]); }
  catch (e) { throw new Stop('Could not open the backup: the passphrase is wrong, or the file is damaged.'); }
  return zlib.gunzipSync(zipped).toString('utf8');
}

// ---------- Turso ----------
function address(v) {
  const url = String(v || '').trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
  if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/127\.0\.0\.1:\d+)$/i.test(url)) throw new Stop('The address should look like libsql://your-database.turso.io');
  return url;
}
// Runs all statements on one connection. Stops at the first one that fails.
async function pipeline(db, stmts) {
  let r;
  try {
    r = await fetch(db.url + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + db.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: stmts.map((s) => ({ type: 'execute', stmt: typeof s === 'string' ? { sql: s } : s })).concat({ type: 'close' }) }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) { throw new Stop('Could not reach the database. Check your internet connection and the address.'); }
  if (r.status === 401 || r.status === 403) throw new Stop('The database refused the key. Make a new one in Turso, then run setup again.');
  if (!r.ok) throw new Stop('The database answered with HTTP ' + r.status + '.');
  const results = (await r.json()).results || [];
  return stmts.map((s, i) => {
    const x = results[i];
    if (!x || x.type !== 'ok') throw new Stop('Database error: ' + ((x && x.error && x.error.message) || 'no answer'));
    return x.response.result;
  });
}
const TABLES_SQL = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql\\_%' ESCAPE '\\' AND name NOT LIKE '\\_%' ESCAPE '\\'";
const plain = (c) => (c.type === 'null' ? null : c.value);

async function readAll(db) {
  const [schema] = await pipeline(db, [TABLES_SQL]);
  const items = schema.rows.map((r) => ({ type: plain(r[0]), name: plain(r[1]), sql: plain(r[2]) }));
  const tables = items.filter((x) => x.type === 'table');
  if (!tables.some((t) => t.name === 'users')) throw new Stop('That database has no users table, so it does not look like The Bench. Check the address.');
  const wanted = tables.filter((t) => !SKIP_ROWS.has(t.name));
  // Inside one transaction, so every table is from the same moment.
  const out = await pipeline(db, ['BEGIN', ...wanted.map((t) => 'SELECT * FROM ' + quote(t.name)), 'COMMIT']);
  return {
    version: 1, made: new Date().toISOString(),
    tables: tables.map((t) => {
      const at = wanted.indexOf(t);
      return { name: t.name, sql: t.sql, cols: at < 0 ? [] : out[at + 1].cols.map((c) => c.name), rows: at < 0 ? [] : out[at + 1].rows };
    }),
    indexes: items.filter((x) => x.type === 'index').map((x) => x.sql)
  };
}

// ---------- rebuilding ----------
const toSqlite = (c) => c.type === 'null' ? null
  : c.type === 'integer' ? BigInt(c.value)
  : c.type === 'float' ? Number(c.value)
  : c.type === 'blob' ? Buffer.from(c.base64, 'base64')
  : String(c.value);
const insertSql = (t) => 'INSERT INTO ' + quote(t.name) + ' (' + t.cols.map(quote).join(', ') + ') VALUES (' + t.cols.map(() => '?').join(', ') + ')';

// Build the backup as a SQLite database and confirm every row went in. file = ':memory:' to only test it.
function rebuild(data, file) {
  if (data.version !== 1 || !Array.isArray(data.tables)) throw new Stop('This backup was made by a newer version of the tool.');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys = OFF; BEGIN');
    for (const t of data.tables) {
      db.exec(t.sql);
      if (!t.rows.length) continue;
      const st = db.prepare(insertSql(t));
      for (const row of t.rows) st.run(...row.map(toSqlite));
    }
    for (const sql of data.indexes) db.exec(sql);
    db.exec('COMMIT');
    for (const t of data.tables) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM ' + quote(t.name)).get().n;
      if (n !== t.rows.length) throw new Stop(t.name + ': ' + n + ' rows rebuilt, but the backup has ' + t.rows.length + '.');
    }
    const ok = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (ok !== 'ok') throw new Stop('The rebuilt database is not sound: ' + ok);
  } finally { db.close(); }
}
const members = (data) => {
  const t = data.tables.find((x) => x.name === 'users'), at = t.cols.indexOf('username');
  return t.rows.filter((r) => !String(plain(r[at])).startsWith('~')).length; // '~12' = a deleted account's empty placeholder
};
const summary = (data) => members(data) + ' members, ' + data.tables.reduce((n, t) => n + t.rows.length, 0) + ' rows in ' + data.tables.length + ' tables';

// ---------- files ----------
const NAME = /^the-bench-(\d{4}-\d{2}-\d{2})-(\d{6})\.benchbackup$/;
const backups = () => (fs.existsSync(FOLDER) ? fs.readdirSync(FOLDER).filter((f) => NAME.test(f)).sort() : []);
function config() {
  let c;
  try { c = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { throw new Stop('Not set up yet. Run:  node backup/backup.js setup'); }
  if (!c.url || !c.token || !c.passphrase) throw new Stop('The settings are incomplete. Run:  node backup/backup.js setup');
  return c;
}
function open(file, pass) { return JSON.parse(unseal(fs.readFileSync(file), pass)); }

// ---------- questions ----------
async function ask(label, hidden) {
  if (!process.stdin.isTTY) { // answers piped in (used by the tests)
    if (!ask.lines) ask.lines = fs.readFileSync(0, 'utf8').split(/\r?\n/);
    return (ask.lines.shift() || '').trim();
  }
  const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(label)) process.stdout.write(label); }; // do not show what is pasted
  const answer = await new Promise((r) => rl.question(label, r));
  rl.close();
  if (hidden) process.stdout.write('\n');
  return answer.trim();
}
function newPassphrase() { // 8 groups of 4, no look-alike letters
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('')).join('-');
}

// ---------- commands ----------
async function setup() {
  say('This stores your settings in ' + CONFIG + '\n(your user folder, not the project, so they are never sent to GitHub).\n');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { /* first time */ }
  const url = address(await ask('Database address (libsql://...): '));
  const token = await ask('READ-ONLY key (paste it; it stays hidden): ', true);
  if (!token) throw new Stop('No key was entered.');
  try { // Turso keys say what they may do
    if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).a === 'rw') say('\nNote: this key can also CHANGE the database. A read-only key is safer for backups.');
  } catch (e) { /* a different kind of key */ }
  say('\nChecking...');
  const data = await readAll({ url, token });
  const passphrase = old.passphrase || newPassphrase();
  fs.writeFileSync(CONFIG, JSON.stringify({ url, token, passphrase }, null, 2), { mode: 0o600 });
  say('It works: ' + summary(data) + '.\n');
  if (old.passphrase) say('Your existing passphrase is kept, so older backups still open.');
  else say('YOUR BACKUP PASSPHRASE. Write it down somewhere that is not this computer:\n\n    ' + passphrase + '\n\nWithout it, a backup cannot be opened by anyone, including you.');
  say('\nNow make your first backup:  node backup/backup.js');
}

async function run() {
  const c = config();
  say('Reading the live database...');
  const data = await readAll({ url: address(c.url), token: c.token });
  const before = backups(), now = new Date().toISOString();
  const file = path.join(FOLDER, 'the-bench-' + now.slice(0, 10) + '-' + now.slice(11, 19).replace(/:/g, '') + '.benchbackup');
  fs.mkdirSync(FOLDER, { recursive: true });
  const part = file + '.part';
  try {
    fs.writeFileSync(part, seal(JSON.stringify(data), c.passphrase), { mode: 0o600 });
    const again = open(part, c.passphrase); // prove that what is on disk opens and rebuilds
    rebuild(again, ':memory:');
    if (JSON.stringify(again) !== JSON.stringify(data)) throw new Stop('The saved file does not match what was read.');
    fs.renameSync(part, file);
  } catch (e) { try { fs.unlinkSync(part); } catch (x) { /* not written */ } throw e; }
  say('Backed up and test-restored: ' + summary(data) + '.\n' + file + ' (' + Math.ceil(fs.statSync(file).size / 1024) + ' KB)');

  // Old copies are removed, but never when this one looks wrong next to the last.
  let last = null;
  if (before.length) { try { last = members(open(path.join(FOLDER, before[before.length - 1]), c.passphrase)); } catch (e) { say('\nNote: the previous backup could not be opened (' + e.message + ')'); } }
  if (last !== null && members(data) < last * 0.7) {
    say('\nWARNING: there were ' + last + ' members last time and ' + members(data) + ' now. Older backups have been kept. Check the site before relying on this one.');
    process.exitCode = 2;
    return;
  }
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const old = before.filter((f) => Date.parse(NAME.exec(f)[1]) < cutoff);
  for (const f of old) fs.unlinkSync(path.join(FOLDER, f));
  if (old.length) say('Removed ' + old.length + ' backup' + (old.length > 1 ? 's' : '') + ' older than ' + KEEP_DAYS + ' days.');
  say('You have ' + backups().length + ' backup' + (backups().length > 1 ? 's' : '') + '. Copy one to a USB stick or Google Drive now and then: they are encrypted.');
}

async function passFor(file) {
  try { const p = config().passphrase; unseal(fs.readFileSync(file), p); return p; } catch (e) { /* other computer, or older passphrase */ }
  return ask('Backup passphrase: ', true);
}
function pickFile(arg) {
  if (arg) { const f = fs.existsSync(arg) ? arg : path.join(FOLDER, arg); if (!fs.existsSync(f)) throw new Stop('No such file: ' + arg); return f; }
  const all = backups();
  if (!all.length) throw new Stop('No backups yet. Run:  node backup/backup.js');
  return path.join(FOLDER, all[all.length - 1]);
}
async function check(arg) {
  const file = pickFile(arg), data = open(file, await passFor(file));
  rebuild(data, ':memory:');
  say('Good: ' + path.basename(file) + '\nMade ' + data.made + '. ' + summary(data) + '.');
}

async function restore(arg, where, target) {
  if (!arg || !['local', 'turso'].includes(where) || (where === 'local' && !target)) throw new Stop('Use:  restore <file> local <new.db>   or   restore <file> turso');
  const file = pickFile(arg), data = open(file, await passFor(file));
  rebuild(data, ':memory:'); // never start writing from a backup that does not rebuild
  if (where === 'local') {
    if (fs.existsSync(target)) throw new Stop(target + ' already exists. Choose a new name.');
    rebuild(data, target);
    return say('Rebuilt into ' + target + ': ' + summary(data) + '.');
  }
  say('This writes into a NEW, EMPTY Turso database. It refuses if that database already has anything in it.');
  const db = { url: address(await ask('Address of the new database (libsql://...): ')), token: await ask('Its read-and-write key (hidden): ', true) };
  const [have] = await pipeline(db, [TABLES_SQL]);
  if (have.rows.length) throw new Stop('That database is not empty, so nothing was changed. Create a new one in Turso.');
  await pipeline(db, data.tables.map((t) => t.sql));
  for (const t of data.tables) {
    for (let i = 0; i < t.rows.length; i += 100) {
      await pipeline(db, ['BEGIN', ...t.rows.slice(i, i + 100).map((row) => ({ sql: insertSql(t), args: row })), 'COMMIT']);
    }
  }
  if (data.indexes.length) await pipeline(db, data.indexes);
  for (const t of data.tables) {
    const [r] = await pipeline(db, ['SELECT COUNT(*) FROM ' + quote(t.name)]);
    if (Number(plain(r.rows[0][0])) !== t.rows.length) throw new Stop(t.name + ' did not copy fully. Delete that new database and try again.');
  }
  say('Restored and counted: ' + summary(data) + '.\nNext: in Render, change TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to the new database.');
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const todo = { setup, check: () => check(args[0]), restore: () => restore(...args), run };
  Promise.resolve().then(() => {
    const f = todo[cmd || 'run'];
    if (!f) throw new Stop('Unknown command. Use: setup, run, check or restore.');
    return f();
  }).catch((e) => { console.error('\n' + (e instanceof Stop ? e.message : e.stack)); process.exitCode = 1; });
}
module.exports = { seal, unseal, rebuild, readAll };
