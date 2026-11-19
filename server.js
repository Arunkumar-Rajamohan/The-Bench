/* The Bench — server. Zero dependencies: Node 22.5+ (built-in SQLite). */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 5173;
const PROD = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || (PROD ? '0.0.0.0' : '127.0.0.1');
const SESSION_DAYS = 30;
const MAX_BODY = 256 * 1024;
const MAX_DATA = 200 * 1024;
const TAGS = ['Win', 'Rant', 'Question', 'Tip'];
const REACTS = ['🙌', '💪', '😂'];
const ROOMS = [
  { slug: 'lobby', desc: 'Hang out, say hi, talk about anything.' },
  { slug: 'job-leads', desc: 'Share openings you found. Real jobs only: never ones that ask you to pay.' },
  { slug: 'interview-prep', desc: 'Practice questions, interview nerves, how it went.' },
  { slug: 'vent', desc: 'Bad day? Let it out. Be kind here.' }
];
const ROOM_SLUGS = new Set(ROOMS.map((r) => r.slug));
const MSG_MAX = 1000;
const NEW_DMS_PER_DAY = 10;
// Moderators: comma-separated usernames, set on the host (e.g. ADMIN_USERNAMES=arun).
const ADMINS = new Set((process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isAdmin = (u) => !!u && ADMINS.has(u.username);

// ---------- database ----------
// Two modes, same SQL:
//   - TURSO_DATABASE_URL set  -> hosted Turso database over HTTPS (used when deployed)
//   - otherwise               -> a local SQLite file in ./data (used on your own computer)
const TURSO_URL = (process.env.TURSO_DATABASE_URL || '').trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pass TEXT NOT NULL,
    salt TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    text TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id, emoji)
  )`,
  // Chat. channel is 'room:<slug>' or 'dm:<smaller user id>:<larger user id>'.
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    channel TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, id)',
  `CREATE TABLE IF NOT EXISTS dms (
    key TEXT PRIMARY KEY,
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    started_by INTEGER NOT NULL,
    created INTEGER NOT NULL,
    last_id INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS dms_a ON dms(a)',
  'CREATE INDEX IF NOT EXISTS dms_b ON dms(b)',
  `CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`,
  // Fun tab. Question-of-the-day answers live in `messages` (channel 'qotd:<day>'), so reports, deletes and bans cover them.
  `CREATE TABLE IF NOT EXISTS msg_reacts (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS puzzle_plays (
    day TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    guesses TEXT NOT NULL DEFAULT '[]',
    solved INTEGER NOT NULL DEFAULT 0,
    tries INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL,
    PRIMARY KEY (day, user_id)
  )`,
  // Profiles: one JSON blob per member, validated by cleanProfile() before it is stored.
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    UNIQUE (message_id, reporter_id)
  )`
];

// exec(sql, args) -> { rows: [objects], lastId: number }
let exec;
if (TURSO_URL) {
  // Plain http is accepted only for a database on this same machine (local testing).
  if (!/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(TURSO_URL) || !TURSO_TOKEN) {
    throw new Error('Set TURSO_DATABASE_URL (libsql://… or https://…) and TURSO_AUTH_TOKEN together.');
  }
  const enc = (v) => (v === null || v === undefined) ? { type: 'null' }
    : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v })
    : { type: 'text', value: String(v) };
  const dec = (c) => c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value;
  exec = async (sql, args = []) => {
    const r = await fetch(TURSO_URL + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: args.map(enc) } }, { type: 'close' }] }),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('Database request failed with HTTP ' + r.status);
    const first = ((await r.json()).results || [])[0];
    if (!first || first.type !== 'ok') {
      throw new Error('Database error: ' + ((first && first.error && first.error.message) || 'unknown'));
    }
    const res = first.response.result;
    const names = res.cols.map((c) => c.name);
    return {
      rows: res.rows.map((row) => Object.fromEntries(row.map((c, i) => [names[i], dec(c)]))),
      lastId: Number(res.last_insert_rowid) || 0
    };
  };
} else {
  // Most free hosts wipe local files on every restart, which would silently delete all accounts.
  if (PROD && !process.env.DATA_DIR) {
    throw new Error('In production set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (or DATA_DIR pointing at a persistent disk).');
  }
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'bench.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // Statements are prepared per call: on Node 22 long-lived ones can be finalized under us.
  exec = async (sql, args = []) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { rows: st.all(...args), lastId: 0 };
    const info = st.run(...args);
    return { rows: [], lastId: Number(info.lastInsertRowid) || 0 };
  };
}

// Columns added after launch. ADD COLUMN fails once the column exists, which is fine.
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN recovery TEXT',
  'ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0'
];

async function initDb() {
  for (const sql of SCHEMA) await exec(sql);
  for (const sql of MIGRATIONS) {
    try { await exec(sql); }
    catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  await exec('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
}

const stmt = (sql) => ({
  run: (...a) => exec(sql, a),
  get: async (...a) => (await exec(sql, a)).rows[0],
  all: async (...a) => (await exec(sql, a)).rows
});

const q = {
  userByName: stmt('SELECT * FROM users WHERE username = ?'),
  userById: stmt('SELECT * FROM users WHERE id = ?'),
  addUser: stmt('INSERT INTO users (username, name, pass, salt, recovery, created) VALUES (?, ?, ?, ?, ?, ?)'),
  addSession: stmt('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)'),
  session: stmt('SELECT u.id, u.username, u.name, u.data, u.recovery IS NOT NULL AS has_recovery FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ? AND u.banned = 0'),
  dropSession: stmt('DELETE FROM sessions WHERE token_hash = ?'),
  dropUserSessions: stmt('DELETE FROM sessions WHERE user_id = ?'),
  setRecovery: stmt('UPDATE users SET recovery = ? WHERE id = ?'),
  setPassword: stmt('UPDATE users SET pass = ?, salt = ?, recovery = ? WHERE id = ?'),
  saveData: stmt('UPDATE users SET data = ? WHERE id = ?'),
  posts: stmt('SELECT p.id, p.tag, p.text, p.created, p.user_id, u.name, u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE u.banned = 0 ORDER BY p.id DESC LIMIT 100'),
  replies: stmt('SELECT r.post_id, r.text, r.created, u.name FROM replies r JOIN users u ON u.id = r.user_id WHERE r.post_id >= ? ORDER BY r.id'),
  reacts: stmt('SELECT post_id, emoji, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM reactions WHERE post_id >= ? GROUP BY post_id, emoji'),
  post: stmt('SELECT id, user_id FROM posts WHERE id = ?'),
  addPost: stmt('INSERT INTO posts (user_id, tag, text, created) VALUES (?, ?, ?, ?)'),
  delPostReplies: stmt('DELETE FROM replies WHERE post_id = ?'),
  delPostReacts: stmt('DELETE FROM reactions WHERE post_id = ?'),
  delPost: stmt('DELETE FROM posts WHERE id = ?'),
  addReply: stmt('INSERT INTO replies (post_id, user_id, text, created) VALUES (?, ?, ?, ?)'),
  hasReact: stmt('SELECT 1 AS x FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?'),
  addReact: stmt('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)'),
  delReact: stmt('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?'),

  // chat
  history: stmt(`SELECT m.id, m.text, m.created, u.name, u.username FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.channel = ? AND m.deleted = 0 AND m.id < ? AND u.banned = 0
      AND m.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
    ORDER BY m.id DESC LIMIT 50`),
  addMsg: stmt('INSERT INTO messages (channel, user_id, text, created) VALUES (?, ?, ?, ?)'),
  msg: stmt('SELECT id, channel, user_id, deleted FROM messages WHERE id = ?'),
  // Keep the text of a message someone reported, so a moderator can still review it after the author deletes it.
  delMsg: stmt(`UPDATE messages SET deleted = 1,
    text = CASE WHEN EXISTS (SELECT 1 FROM reports r WHERE r.message_id = messages.id AND r.resolved = 0) THEN text ELSE '' END
    WHERE id = ?`),
  roomLast: stmt("SELECT channel, MAX(id) AS last_id FROM messages WHERE channel LIKE 'room:%' AND deleted = 0 GROUP BY channel"),
  dm: stmt('SELECT * FROM dms WHERE key = ?'),
  addDm: stmt('INSERT OR IGNORE INTO dms (key, a, b, started_by, created, last_id) VALUES (?, ?, ?, ?, ?, 0)'),
  touchDm: stmt('UPDATE dms SET last_id = ? WHERE key = ?'),
  dmsStartedSince: stmt('SELECT COUNT(*) AS n FROM dms WHERE started_by = ? AND created > ?'),
  myDms: stmt(`SELECT d.last_id, u.username, u.name,
      (SELECT m.text FROM messages m WHERE m.id = d.last_id AND m.deleted = 0) AS last_text,
      (SELECT m.user_id FROM messages m WHERE m.id = d.last_id) AS last_from
    FROM dms d JOIN users u ON u.id = CASE WHEN d.a = ? THEN d.b ELSE d.a END
    WHERE (d.a = ? OR d.b = ?) AND d.last_id > 0 AND u.banned = 0
    ORDER BY d.last_id DESC LIMIT 50`),
  isBlocked: stmt('SELECT 1 AS x FROM blocks WHERE blocker_id = ? AND blocked_id = ?'),
  blockersOf: stmt('SELECT blocker_id FROM blocks WHERE blocked_id = ?'),
  addBlock: stmt('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created) VALUES (?, ?, ?)'),
  delBlock: stmt('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?'),
  myBlocks: stmt('SELECT u.username, u.name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created DESC'),
  addReport: stmt('INSERT OR IGNORE INTO reports (message_id, reporter_id, reason, created) VALUES (?, ?, ?, ?)'),
  openReports: stmt(`SELECT r.id, r.reason, r.created, r.message_id, m.text, m.channel, m.deleted, m.created AS msg_created,
      au.username AS author, au.name AS author_name, au.banned AS author_banned, ru.username AS reporter
    FROM reports r JOIN messages m ON m.id = r.message_id JOIN users au ON au.id = m.user_id JOIN users ru ON ru.id = r.reporter_id
    WHERE r.resolved = 0 ORDER BY r.id LIMIT 100`),
  report: stmt('SELECT * FROM reports WHERE id = ?'),
  resolveReport: stmt('UPDATE reports SET resolved = 1 WHERE id = ?'),
  resolveMsgReports: stmt('UPDATE reports SET resolved = 1 WHERE message_id = ?'),
  // After the last open report on an already-deleted message is closed, drop the text that was kept for review.
  wipeIfDeleted: stmt(`UPDATE messages SET text = '' WHERE id = ? AND deleted = 1
    AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.message_id = messages.id AND r.resolved = 0)`),
  setBanned: stmt('UPDATE users SET banned = ? WHERE id = ?'),
  bannedUsers: stmt('SELECT username, name FROM users WHERE banned = 1 ORDER BY username'),

  // fun tab
  answers: stmt(`SELECT m.id, m.text, m.created, m.user_id, u.name, u.username FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.channel = ? AND m.deleted = 0 AND u.banned = 0
      AND m.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
    ORDER BY m.id LIMIT 300`),
  answerReacts: stmt(`SELECT r.message_id, r.emoji, COUNT(*) AS n, SUM(r.user_id = ?) AS mine
    FROM msg_reacts r JOIN messages m ON m.id = r.message_id WHERE m.channel = ? GROUP BY r.message_id, r.emoji`),
  myAnswer: stmt('SELECT id FROM messages WHERE channel = ? AND user_id = ? AND deleted = 0'),
  hasMsgReact: stmt('SELECT 1 AS x FROM msg_reacts WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  addMsgReact: stmt('INSERT OR IGNORE INTO msg_reacts (message_id, user_id, emoji) VALUES (?, ?, ?)'),
  delMsgReact: stmt('DELETE FROM msg_reacts WHERE message_id = ? AND user_id = ? AND emoji = ?'),
  play: stmt('SELECT * FROM puzzle_plays WHERE day = ? AND user_id = ?'),
  savePlay: stmt(`INSERT INTO puzzle_plays (day, user_id, guesses, solved, tries, updated) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (day, user_id) DO UPDATE SET guesses = excluded.guesses, solved = excluded.solved, tries = excluded.tries, updated = excluded.updated`),
  solvedDays: stmt('SELECT day FROM puzzle_plays WHERE user_id = ? AND solved = 1 ORDER BY day DESC LIMIT 60'),
  leaderboard: stmt(`SELECT u.name, u.username, SUM(6 - p.tries) AS points, COUNT(*) AS solved
    FROM puzzle_plays p JOIN users u ON u.id = p.user_id
    WHERE p.solved = 1 AND p.day >= ? AND p.day <= ? AND u.banned = 0
    GROUP BY p.user_id ORDER BY points DESC, solved DESC, MIN(p.updated) ASC LIMIT 10`),

  // profiles
  profile: stmt('SELECT data, updated FROM profiles WHERE user_id = ?'),
  saveProfile: stmt(`INSERT INTO profiles (user_id, data, updated) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
  clearProfile: stmt('DELETE FROM profiles WHERE user_id = ?'),
  setName: stmt('UPDATE users SET name = ? WHERE id = ?'),
  profileStats: stmt(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
      (SELECT COUNT(*) FROM messages WHERE user_id = ? AND channel LIKE 'qotd:%' AND deleted = 0) AS answers,
      (SELECT COUNT(*) FROM puzzle_plays WHERE user_id = ? AND solved = 1) AS solved`),
  people: stmt(`SELECT u.username, u.name, u.created, p.data FROM users u LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.banned = 0 ORDER BY COALESCE(p.updated, 0) DESC, u.id DESC LIMIT 300`)
};

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers) {
  const json = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers));
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
      return reject(new HttpError(415, 'Send JSON.'));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'That is too big.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch (e) { reject(new HttpError(400, 'Bad request.')); }
    });
    req.on('error', reject);
  });
}

function text(v, max, label) {
  if (typeof v !== 'string') throw new HttpError(400, label + ' is missing.');
  const t = v.trim();
  if (!t) throw new HttpError(400, label + ' is empty.');
  if (t.length > max) throw new HttpError(400, label + ' is too long (max ' + max + ' characters).');
  return t;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

const DUMMY_SALT = '00000000000000000000000000000000';

// True when `password` matches user `u`. Hashes even when `u` is missing, so timing does not reveal usernames.
async function checkPassword(u, password) {
  const pw = typeof password === 'string' ? password.slice(0, 200) : '';
  const hash = await hashPassword(pw, u ? u.salt : DUMMY_SALT);
  return !!u && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.pass, 'hex'));
}

function newPassword(v) {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, 'Password needs at least 8 characters.');
  if (v.length > 200) throw new HttpError(400, 'Password is too long.');
  return v;
}

// Recovery codes: 16 characters from a 32-letter alphabet (80 random bits), shown as XXXX-XXXX-XXXX-XXXX.
// No 0, O, 1 or I, which are easy to mix up. Only a hash is stored, and each code works once.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, so every byte maps evenly
function makeRecoveryCode() {
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[bytes[i] & 31];
  return s.match(/.{4}/g).join('-');
}
function recoveryHash(code) {
  // Ignore case, spaces and dashes; read a typed I or 1 as the L it must have been.
  const norm = String(code || '').slice(0, 64).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[I1]/g, 'L');
  return sha('recovery:' + norm);
}

function cookie(token, maxAge) {
  return 'sid=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAge + (PROD ? '; Secure' : '');
}

async function startSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q.addSession.run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return cookie(token, SESSION_DAYS * 86400);
}

function tokenOf(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

async function currentUser(req) {
  const t = tokenOf(req);
  return t ? await q.session.get(sha(t), Date.now()) : undefined;
}

function publicUser(u) {
  return { username: u.username, name: u.name, hasRecovery: !!(u.recovery || u.has_recovery), isAdmin: isAdmin(u) };
}
function parseData(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

// Simple in-memory rate limiter: `max` hits per `windowMs` per key.
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  h.n++;
  if (h.n > max) throw new HttpError(429, 'Slow down a little and try again in a few minutes.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (h.reset < now) hits.delete(k);
}, 60000).unref();

// ---------- live updates (Server-Sent Events) ----------
// One server instance, so an in-memory list of open connections is enough.
const streams = new Map(); // user id -> Set of open responses
const MAX_STREAMS_PER_USER = 5;

function push(userId, event) {
  const set = streams.get(userId);
  if (!set) return;
  const line = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const r of set) r.write(line);
}
function pushAll(event, skip) {
  const line = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const [uid, set] of streams) {
    if (skip && skip.has(uid)) continue;
    for (const r of set) r.write(line);
  }
}
function closeStreams(userId) {
  const set = streams.get(userId);
  if (!set) return;
  for (const r of set) r.end();
  streams.delete(userId);
}
function openStream(req, res, user) {
  let set = streams.get(user.id);
  if (set && set.size >= MAX_STREAMS_PER_USER) throw new HttpError(429, 'Too many open tabs.');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  res.write('retry: 5000\n\n');
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  if (!set) streams.set(user.id, (set = new Set()));
  set.add(res);
  req.on('close', () => {
    set.delete(res);
    if (!set.size && streams.get(user.id) === set) streams.delete(user.id);
  });
}
// Comment lines keep idle connections open through the host's proxy.
setInterval(() => {
  for (const set of streams.values()) for (const r of set) r.write(': ping\n\n');
}, 25000).unref();

// ---------- API ----------
async function api(req, res, route) {
  const method = req.method;
  // Behind a host's proxy the socket address is the proxy, so use the forwarded client address there.
  const fwd = PROD ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const ip = fwd || req.socket.remoteAddress || '?';

  // Block cross-site writes: browsers send Origin on these, and it must be us.
  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* malformed */ }
      if (host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
    }
  }

  if (method === 'POST' && route === '/signup') {
    limit('auth:' + ip, 20, 10 * 60000);
    const b = await readBody(req);
    const username = text(b.username, 20, 'Username').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new HttpError(400, 'Username: 3–20 letters, numbers or underscores.');
    const name = text(b.name, 24, 'Name');
    const password = newPassword(b.password);
    if (await q.userByName.get(username)) throw new HttpError(409, 'That username is taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    const pass = await hashPassword(password, salt);
    const recoveryCode = makeRecoveryCode();
    let info;
    try { info = await q.addUser.run(username, name, pass, salt, recoveryHash(recoveryCode), Date.now()); }
    catch (e) { throw new HttpError(409, 'That username is taken.'); }
    return send(res, 201, { user: publicUser({ username, name, recovery: 'set' }), data: {}, recoveryCode },
      { 'Set-Cookie': await startSession(info.lastId) });
  }

  if (method === 'POST' && route === '/login') {
    limit('auth:' + ip, 20, 10 * 60000);
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    limit('auth:user:' + username.slice(0, 20), 10, 10 * 60000); // per account, whatever the IP
    const u = await q.userByName.get(username);
    if (!(await checkPassword(u, b.password))) throw new HttpError(401, 'Wrong username or password.');
    if (u.banned) throw new HttpError(403, 'This account has been suspended.');
    return send(res, 200, { user: Object.assign(publicUser(u), { profileDone: await profileDone(u.id) }), data: parseData(u.data) }, { 'Set-Cookie': await startSession(u.id) });
  }

  // Forgot password: username + one-time recovery code -> new password.
  // Signs out every other device and hands back a fresh code, since the old one is now used up.
  if (method === 'POST' && route === '/reset') {
    limit('auth:' + ip, 20, 10 * 60000);
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    limit('reset:user:' + username.slice(0, 20), 5, 60 * 60000); // per account, whatever the IP
    const password = newPassword(b.password);
    const u = await q.userByName.get(username);
    const given = Buffer.from(recoveryHash(b.code), 'hex');
    const stored = Buffer.from(u && u.recovery ? u.recovery : sha('no-code'), 'hex');
    if (!u || !u.recovery || !crypto.timingSafeEqual(given, stored)) {
      throw new HttpError(401, 'That username and recovery code do not match.');
    }
    if (u.banned) throw new HttpError(403, 'This account has been suspended.');
    const salt = crypto.randomBytes(16).toString('hex');
    const recoveryCode = makeRecoveryCode();
    await q.setPassword.run(await hashPassword(password, salt), salt, recoveryHash(recoveryCode), u.id);
    await q.dropUserSessions.run(u.id);
    return send(res, 200, { user: Object.assign(publicUser(u), { hasRecovery: true }), data: parseData(u.data), recoveryCode },
      { 'Set-Cookie': await startSession(u.id) });
  }

  if (method === 'POST' && route === '/logout') {
    const t = tokenOf(req);
    if (t) await q.dropSession.run(sha(t));
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }

  // Everything below needs a signed-in user.
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please log in.');

  if (method === 'GET' && route === '/me') {
    return send(res, 200, { user: Object.assign(publicUser(user), { profileDone: await profileDone(user.id) }), data: parseData(user.data) });
  }

  // Account changes ask for the current password, so a borrowed logged-in device cannot take over the account.
  if (method === 'POST' && (route === '/me/recovery' || route === '/me/password')) {
    limit('account:' + user.id, 10, 10 * 60000);
    const b = await readBody(req);
    const full = await q.userById.get(user.id);
    if (!(await checkPassword(full, b.password))) throw new HttpError(401, 'Your current password is not right.');

    if (route === '/me/recovery') {
      const recoveryCode = makeRecoveryCode();
      await q.setRecovery.run(recoveryHash(recoveryCode), user.id);
      return send(res, 200, { recoveryCode });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    await q.setPassword.run(await hashPassword(newPassword(b.newPassword), salt), salt, full.recovery, user.id);
    await q.dropUserSessions.run(user.id); // sign out everywhere else, keep this device signed in
    return send(res, 200, { ok: true }, { 'Set-Cookie': await startSession(user.id) });
  }

  if (method === 'PUT' && route === '/me/data') {
    const b = await readBody(req);
    const json = JSON.stringify(b);
    if (json.length > MAX_DATA) throw new HttpError(413, 'Your saved data is too big.');
    await q.saveData.run(json, user.id);
    return send(res, 200, { ok: true });
  }

  if (method === 'GET' && route === '/posts') {
    const posts = await q.posts.all();
    const byId = new Map();
    const out = posts.map((p) => {
      const o = { id: p.id, tag: p.tag, text: p.text, t: p.created, name: p.name, username: p.username, own: p.user_id === user.id, reacts: {}, mine: {}, replies: [] };
      byId.set(p.id, o);
      return o;
    });
    if (posts.length) {
      const min = posts[posts.length - 1].id;
      for (const r of await q.replies.all(min)) {
        const o = byId.get(r.post_id);
        if (o) o.replies.push({ name: r.name, text: r.text, t: r.created });
      }
      for (const r of await q.reacts.all(user.id, min)) {
        const o = byId.get(r.post_id);
        if (o) { o.reacts[r.emoji] = r.n; if (r.mine) o.mine[r.emoji] = true; }
      }
    }
    return send(res, 200, { posts: out });
  }

  if (method === 'POST' && route === '/posts') {
    limit('write:' + user.id, 20, 60000);
    const b = await readBody(req);
    const body = text(b.text, 600, 'Post');
    const tag = TAGS.includes(b.tag) ? b.tag : 'Win';
    const info = await q.addPost.run(user.id, tag, body, Date.now());
    return send(res, 201, { id: info.lastId });
  }

  const m = /^\/posts\/(\d{1,15})(\/react|\/replies)?$/.exec(route);
  if (m) {
    const id = Number(m[1]);
    const post = await q.post.get(id);
    if (!post) throw new HttpError(404, 'That post is gone.');

    if (method === 'DELETE' && !m[2]) {
      if (post.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'You can only delete your own posts.');
      await q.delPostReplies.run(id);
      await q.delPostReacts.run(id);
      await q.delPost.run(id);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && m[2] === '/react') {
      limit('react:' + user.id, 120, 60000);
      const b = await readBody(req);
      if (!REACTS.includes(b.r)) throw new HttpError(400, 'Unknown reaction.');
      if (await q.hasReact.get(id, user.id, b.r)) await q.delReact.run(id, user.id, b.r);
      else await q.addReact.run(id, user.id, b.r);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && m[2] === '/replies') {
      limit('write:' + user.id, 20, 60000);
      const b = await readBody(req);
      await q.addReply.run(id, user.id, text(b.text, 300, 'Reply'), Date.now());
      return send(res, 201, { ok: true });
    }
  }

  if (await chatApi(req, res, route, user)) return;
  if (await funApi(req, res, route, user)) return;
  if (await profileApi(req, res, route, user)) return;
  if (await jobsApi(req, res, route, user)) return;
  throw new HttpError(404, 'Not found.');
}

// ---------- job listings (Adzuna) ----------
// Switched on by setting ADZUNA_APP_ID and ADZUNA_APP_KEY on the host. Results are cached for an hour
// per search, and a daily cap protects the free quota. Each listing must be credited to Adzuna.

const ADZUNA_ID = (process.env.ADZUNA_APP_ID || '').trim();
const ADZUNA_KEY = (process.env.ADZUNA_APP_KEY || '').trim();
const ADZUNA_COUNTRY = (process.env.ADZUNA_COUNTRY || 'in').trim().toLowerCase();
const ADZUNA_BASE = (process.env.ADZUNA_BASE_URL || 'https://api.adzuna.com').trim().replace(/\/+$/, '');
const ADZUNA_SITE = { in: 'https://www.adzuna.in', gb: 'https://www.adzuna.co.uk', us: 'https://www.adzuna.com' }[ADZUNA_COUNTRY] || 'https://www.adzuna.com';
const JOBS_TTL = 60 * 60000;
const JOBS_DAILY_CAP = Number(process.env.JOBS_DAILY_CAP) || 200;
const jobsCache = new Map(); // search key -> { t, data }
const jobsBudget = { day: '', used: 0 };
if (ADZUNA_ID && !/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(ADZUNA_BASE)) throw new Error('ADZUNA_BASE_URL must use https.');

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', rupee: '₹'
};
function plainText(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
    })
    .replace(/\s+/g, ' ').trim();
}

function normaliseJob(r) {
  const url = typeof r.redirect_url === 'string' && /^https?:\/\//.test(r.redirect_url) ? r.redirect_url : null;
  if (!url || !r.title) return null;
  const predicted = String(r.salary_is_predicted) === '1';
  const min = Number(r.salary_min) || 0, max = Number(r.salary_max) || 0;
  return {
    id: 'adz:' + String(r.id || url).slice(0, 40),
    title: plainText(r.title).slice(0, 140),
    company: plainText(r.company && r.company.display_name).slice(0, 80),
    location: plainText(r.location && r.location.display_name).slice(0, 80),
    posted: Date.parse(r.created) || null,
    url,
    salary: !predicted && (min || max) ? { min, max } : null, // estimated salaries need extra Adzuna branding, so skip them
    contract: r.contract_time === 'part_time' ? 'Part-time' : r.contract_time === 'full_time' ? 'Full-time' : '',
    type: r.contract_type === 'contract' ? 'Contract' : r.contract_type === 'permanent' ? 'Permanent' : '',
    category: plainText(r.category && r.category.label).replace(/ Jobs$/, '').slice(0, 60),
    snippet: plainText(r.description).slice(0, 280)
  };
}

async function adzunaSearch(what, where, page) {
  const key = [what.toLowerCase(), where.toLowerCase(), page].join('|');
  const hit = jobsCache.get(key);
  if (hit && Date.now() - hit.t < JOBS_TTL) return hit.data;

  const today = dayKey();
  if (jobsBudget.day !== today) { jobsBudget.day = today; jobsBudget.used = 0; }
  if (jobsBudget.used >= JOBS_DAILY_CAP) {
    if (hit) return hit.data; // an older copy beats nothing
    throw new HttpError(503, 'Job search has had a busy day and is resting until midnight. Try a search you have run before, or come back tomorrow.');
  }
  jobsBudget.used++;

  const params = new URLSearchParams({
    app_id: ADZUNA_ID, app_key: ADZUNA_KEY, results_per_page: '20', max_days_old: '30',
    sort_by: what ? 'relevance' : 'date', 'content-type': 'application/json'
  });
  if (what) params.set('what', what);
  if (where) params.set('where', where);
  let r;
  try {
    r = await fetch(ADZUNA_BASE + '/v1/api/jobs/' + encodeURIComponent(ADZUNA_COUNTRY) + '/search/' + page + '?' + params, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000)
    });
  } catch (e) {
    if (hit) return hit.data;
    throw new HttpError(502, 'Could not reach the job listings just now. Try again in a minute.');
  }
  if (!r.ok) {
    console.error('Adzuna responded ' + r.status);
    if (hit) return hit.data;
    throw new HttpError(502, 'The job listings service is having trouble right now. Try again later.');
  }
  const j = await r.json().catch(() => ({}));
  const data = {
    total: Number(j.count) || 0,
    jobs: (Array.isArray(j.results) ? j.results : []).map(normaliseJob).filter(Boolean)
  };
  jobsCache.set(key, { t: Date.now(), data });
  if (jobsCache.size > 300) jobsCache.delete(jobsCache.keys().next().value); // drop the oldest entry
  return data;
}

async function jobsApi(req, res, route, user) {
  if (req.method !== 'GET' || route !== '/jobs') return false;
  const configured = !!(ADZUNA_ID && ADZUNA_KEY);
  if (!configured) { send(res, 200, { configured: false, jobs: [], total: 0 }); return true; }
  limit('jobs:' + user.id, 30, 60000);
  const sp = new URL(req.url, 'http://x').searchParams;
  const what = (sp.get('what') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const where = (sp.get('where') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const page = Math.min(Math.max(parseInt(sp.get('page'), 10) || 1, 1), 10);
  const data = await adzunaSearch(what, where, page);
  send(res, 200, { configured: true, page, total: data.total, jobs: data.jobs, source: { name: 'Adzuna', url: ADZUNA_SITE, currency: { in: 'INR', gb: 'GBP', us: 'USD' }[ADZUNA_COUNTRY] || '' } });
  return true;
}

// ---------- profiles ----------
// Visible to signed-in members only. Everything is optional except the display name.

const STATUSES = ['looking', 'interviewing', 'hired', 'break'];
const OPEN_TO = ['Remote', 'Hybrid', 'On-site'];
const COLORS = ['tomato', 'ink', 'gold', 'sage', 'blue', 'plum'];
const blankProfile = () => ({ status: 'looking', headline: '', since: '', location: '', openTo: [], skills: [], bio: '', link: '', color: 'tomato' });

function line(v, max, label) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw new HttpError(400, label + ' should be text.');
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw new HttpError(400, label + ' is too long (max ' + max + ' characters).');
  return t;
}

function cleanProfile(b) {
  const p = blankProfile();
  p.status = STATUSES.includes(b.status) ? b.status : 'looking';
  p.headline = line(b.headline, 60, 'The role you want');
  p.location = line(b.location, 40, 'Location');
  if (typeof b.bio === 'string') {
    p.bio = b.bio.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (p.bio.length > 280) throw new HttpError(400, 'About you is too long (max 280 characters).');
  }
  if (b.since) {
    const thisMonth = dayKey().slice(0, 7);
    if (typeof b.since !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.since) || b.since < '1990-01' || b.since > thisMonth) {
      throw new HttpError(400, 'Pick a month between 1990 and now for when you started looking.');
    }
    p.since = b.since;
  }
  p.openTo = OPEN_TO.filter((o) => Array.isArray(b.openTo) && b.openTo.includes(o));
  const skills = Array.isArray(b.skills) ? b.skills : typeof b.skills === 'string' ? b.skills.split(',') : [];
  const seen = new Set();
  for (const s of skills) {
    if (typeof s !== 'string') continue;
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (t.length > 24) throw new HttpError(400, 'Each skill can be up to 24 characters ("' + t.slice(0, 24) + '…").');
    seen.add(t.toLowerCase());
    p.skills.push(t);
  }
  if (p.skills.length > 8) throw new HttpError(400, 'Up to 8 skills, please.');
  if (b.link) {
    let url;
    try { url = new URL(String(b.link).trim()); } catch (e) { throw new HttpError(400, 'That link does not look right. Start it with https://'); }
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
      throw new HttpError(400, 'Links must be normal web addresses starting with https://');
    }
    if (url.href.length > 200) throw new HttpError(400, 'That link is too long.');
    p.link = url.href;
  }
  p.color = COLORS.includes(b.color) ? b.color : 'tomato';
  return p;
}

// Read stored JSON defensively: anything unexpected falls back to the blank value.
function readProfile(row) {
  const p = blankProfile();
  if (!row || !row.data) return p;
  let d;
  try { d = JSON.parse(row.data); } catch (e) { return p; }
  if (!d || typeof d !== 'object') return p;
  for (const k of Object.keys(p)) {
    if (Array.isArray(p[k]) ? Array.isArray(d[k]) : typeof d[k] === typeof p[k]) p[k] = d[k];
  }
  return p;
}
const isEmptyProfile = (p) => !p.headline && !p.bio && !p.location && !p.skills.length && !p.link;
const profileDone = async (userId) => !isEmptyProfile(readProfile(await q.profile.get(userId)));

async function profileApi(req, res, route, user) {
  const method = req.method;
  let m;

  if (method === 'GET' && route === '/people') {
    const people = (await q.people.all()).map((r) => {
      const p = readProfile(r);
      return { username: r.username, name: r.name, joined: r.created, headline: p.headline, location: p.location,
        status: p.status, color: p.color, skills: p.skills, me: r.username === user.username };
    });
    send(res, 200, { people });
    return true;
  }

  if (method === 'PUT' && route === '/profile') {
    limit('profile:' + user.id, 20, 10 * 60000);
    const b = await readBody(req);
    const name = text(b.name, 24, 'Name');
    const p = cleanProfile(b);
    await q.setName.run(name, user.id);
    await q.saveProfile.run(user.id, JSON.stringify(p), Date.now());
    send(res, 200, { name, profile: p });
    return true;
  }

  if ((m = /^\/profile\/([a-z0-9_]{3,20})(\/report)?$/.exec(route))) {
    const u = await q.userByName.get(m[1]);
    if (!u || u.banned) throw new HttpError(404, 'That person is not here.');
    const p = readProfile(await q.profile.get(u.id));

    if (method === 'GET' && !m[2]) {
      const s = await q.profileStats.get(u.id, u.id, u.id);
      send(res, 200, {
        username: u.username, name: u.name, joined: u.created, profile: p, me: u.id === user.id,
        blockedByMe: u.id !== user.id && !!(await q.isBlocked.get(user.id, u.id)),
        stats: { posts: s.posts, answers: s.answers, solved: s.solved }
      });
      return true;
    }

    if (method === 'POST' && m[2]) {
      limit('report:' + user.id, 20, 60 * 60000);
      if (u.id === user.id) throw new HttpError(400, 'You cannot report your own profile.');
      if (isEmptyProfile(p)) throw new HttpError(400, 'This profile is empty, so there is nothing to report.');
      const b = await readBody(req);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      // Snapshot what the profile said right now, so moderators see exactly what was reported.
      const snapshot = [u.name, p.headline && 'Looking for: ' + p.headline, p.location, p.bio,
        p.skills.length && 'Skills: ' + p.skills.join(', '), p.link].filter(Boolean).join('\n');
      const info = await q.addMsg.run('profile:' + u.id, u.id, snapshot, Date.now());
      await q.addReport.run(info.lastId, user.id, reason, Date.now());
      send(res, 201, { ok: true });
      return true;
    }
  }

  return false;
}

// ---------- fun tab: question of the day + daily word puzzle ----------
// Rejection Bingo is personal, so it lives in each user's private data (PUT /api/me/data).
// A "day" runs midnight to midnight India time, the same for everyone.

const FUN = require('./fun-data');
const FUN_EPOCH = Date.UTC(2026, 10, 1); // day 0 = 1 Nov 2026
const PUZZLE_TRIES = 5;
const ANSWER_MAX = 300;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (d) => dayFmt.format(d || new Date()); // YYYY-MM-DD
const dayNum = (day) => Math.round((Date.parse(day + 'T00:00:00Z') - FUN_EPOCH) / 864e5);
const shiftDay = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const pickFor = (list, n) => list[((n % list.length) + list.length) % list.length];

// Small seeded random generator, so everyone gets the same scramble on the same day.
function seeded(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function puzzleFor(day) {
  const n = dayNum(day), w = pickFor(FUN.WORDS, n), rand = seeded(n + 1000);
  const letters = w.word.split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  let scrambled = letters.join('');
  if (scrambled === w.word) scrambled = scrambled.slice(1) + scrambled[0];
  return { number: n + 1, word: w.word, hint: w.hint, scrambled };
}
const sortLetters = (s) => s.split('').sort().join('');

function parseGuesses(play) {
  try { const g = JSON.parse(play.guesses); return Array.isArray(g) ? g.filter((x) => typeof x === 'string') : []; }
  catch (e) { return []; }
}

// What the player may see. The answer is only included once they have solved it or run out of tries.
function puzzleView(p, play) {
  const guesses = play ? parseGuesses(play) : [];
  const solved = !!(play && play.solved);
  const done = solved || guesses.length >= PUZZLE_TRIES;
  const wrong = guesses.filter((g) => g !== p.word).length;
  const shown = done ? p.word.length : Math.min(wrong, p.word.length - 2); // each miss reveals one more letter
  return {
    number: p.number, hint: p.hint, scrambled: p.scrambled, length: p.word.length,
    guesses, solved, done, maxTries: PUZZLE_TRIES, triesLeft: Math.max(0, PUZZLE_TRIES - guesses.length),
    reveal: p.word.slice(0, shown) + '_'.repeat(p.word.length - shown),
    answer: done ? p.word : null
  };
}

async function puzzleExtras(user, day) {
  const days = new Set((await q.solvedDays.all(user.id)).map((r) => r.day));
  let streak = 0, d = days.has(day) ? day : shiftDay(day, -1);
  while (days.has(d)) { streak++; d = shiftDay(d, -1); }
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();
  const monday = shiftDay(day, -((dow + 6) % 7));
  const board = (await q.leaderboard.all(monday, shiftDay(monday, 6))).map((r) => ({
    name: r.name, username: r.username, points: r.points, solved: r.solved, me: r.username === user.username
  }));
  return { streak, leaderboard: board, weekStart: monday };
}

async function qotdView(user, day) {
  const channel = 'qotd:' + day;
  const rows = await q.answers.all(channel, user.id);
  const reacts = {};
  for (const r of await q.answerReacts.all(user.id, channel)) {
    (reacts[r.message_id] = reacts[r.message_id] || { counts: {}, mine: {} }).counts[r.emoji] = r.n;
    if (r.mine) reacts[r.message_id].mine[r.emoji] = true;
  }
  return {
    day, question: pickFor(FUN.QUESTIONS, dayNum(day)),
    answered: rows.some((r) => r.user_id === user.id),
    answers: rows.map((r) => ({
      id: r.id, text: r.text, t: r.created, name: r.name, username: r.username, own: r.user_id === user.id,
      reacts: (reacts[r.id] || {}).counts || {}, mine: (reacts[r.id] || {}).mine || {}
    }))
  };
}

async function funApi(req, res, route, user) {
  const method = req.method;
  const today = dayKey();
  let m;

  if (method === 'GET' && route === '/fun/today') {
    const p = puzzleFor(today);
    send(res, 200, {
      day: today,
      qotd: await qotdView(user, today),
      puzzle: Object.assign(puzzleView(p, await q.play.get(today, user.id)), await puzzleExtras(user, today))
    });
    return true;
  }

  if (method === 'GET' && route === '/fun/qotd') {
    const which = new URL(req.url, 'http://x').searchParams.get('day');
    send(res, 200, await qotdView(user, which === 'yesterday' ? shiftDay(today, -1) : today));
    return true;
  }

  if (method === 'POST' && route === '/fun/qotd') {
    limit('write:' + user.id, 20, 60000);
    const b = await readBody(req);
    const body = text(b.text, ANSWER_MAX, 'Answer');
    const channel = 'qotd:' + today;
    if (await q.myAnswer.get(channel, user.id)) throw new HttpError(409, 'You already answered today. Delete your answer to write a new one.');
    await q.addMsg.run(channel, user.id, body, Date.now());
    send(res, 201, await qotdView(user, today));
    return true;
  }

  if (method === 'POST' && (m = /^\/fun\/answers\/(\d{1,15})\/react$/.exec(route))) {
    limit('react:' + user.id, 120, 60000);
    const b = await readBody(req);
    if (!REACTS.includes(b.r)) throw new HttpError(400, 'Unknown reaction.');
    const msg = await q.msg.get(Number(m[1]));
    if (!msg || msg.deleted || !msg.channel.startsWith('qotd:')) throw new HttpError(404, 'That answer is gone.');
    if (await q.hasMsgReact.get(msg.id, user.id, b.r)) await q.delMsgReact.run(msg.id, user.id, b.r);
    else await q.addMsgReact.run(msg.id, user.id, b.r);
    send(res, 200, { ok: true });
    return true;
  }

  if (method === 'POST' && route === '/fun/puzzle') {
    limit('puzzle:' + user.id, 30, 60000);
    const b = await readBody(req);
    const p = puzzleFor(today);
    const play = await q.play.get(today, user.id);
    const view = puzzleView(p, play);
    if (view.done) throw new HttpError(409, 'You have finished today\'s puzzle. A new one arrives at midnight.');
    const guess = String(b.guess || '').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(guess)) throw new HttpError(400, 'Letters only, please.');
    if (guess.length !== p.word.length) throw new HttpError(400, 'Use all ' + p.word.length + ' letters.');
    if (sortLetters(guess) !== sortLetters(p.word)) throw new HttpError(400, 'Use only the letters shown, each one once.');
    if (view.guesses.includes(guess)) throw new HttpError(400, 'You already tried that one.');
    const guesses = view.guesses.concat(guess);
    const solved = guess === p.word;
    await q.savePlay.run(today, user.id, JSON.stringify(guesses), solved ? 1 : 0, guesses.length, Date.now());
    send(res, 200, Object.assign(puzzleView(p, { guesses: JSON.stringify(guesses), solved }), await puzzleExtras(user, today)));
    return true;
  }

  return false;
}

// ---------- chat API ----------
// Rooms are open to every member. DMs are visible only to the two people in them; moderators
// see a DM message only when one of those two people reports it.

const dmKey = (x, y) => Math.min(x, y) + ':' + Math.max(x, y);
const wire = (m) => ({ id: m.id, text: m.text, t: m.created, name: m.name, username: m.username });
function beforeParam(req) {
  const v = Number(new URL(req.url, 'http://x').searchParams.get('before'));
  return Number.isInteger(v) && v > 0 ? v : Number.MAX_SAFE_INTEGER;
}
async function peerByName(name, me) {
  const u = await q.userByName.get(String(name || '').toLowerCase());
  if (!u || u.banned) throw new HttpError(404, 'That person is not here.');
  if (u.id === me.id) throw new HttpError(400, 'That is you!');
  return u;
}
// 'profile:<id>' messages are snapshots of a reported profile: never listed anywhere, only shown to moderators.
const isPublicChannel = (channel) => channel.startsWith('room:') || channel.startsWith('qotd:') || channel.startsWith('profile:');
// Who can see a stored message: anyone for rooms and question-of-the-day answers, only the two people for a DM.
function canSee(channel, userId) {
  if (isPublicChannel(channel)) return true;
  const ids = channel.slice(3).split(':').map(Number);
  return ids.includes(userId);
}
// Tell everyone who can see `channel` that message `id` is gone.
async function broadcastDelete(channel, id) {
  if (isPublicChannel(channel)) return pushAll({ type: 'del', channel, id });
  const [a, b] = channel.slice(3).split(':').map(Number);
  const ua = await q.userById.get(a), ub = await q.userById.get(b);
  if (ua && ub) {
    push(a, { type: 'del', channel: 'dm:' + ub.username, id });
    push(b, { type: 'del', channel: 'dm:' + ua.username, id });
  }
}
async function removeMessage(m) {
  await q.delMsg.run(m.id);
  // Removing a reported profile snapshot clears that member's profile (their name and account stay).
  if (m.channel.startsWith('profile:')) await q.clearProfile.run(m.user_id);
  else await broadcastDelete(m.channel, m.id);
}

async function chatApi(req, res, route, user) {
  const method = req.method;
  let m;

  if (method === 'GET' && route === '/stream') { openStream(req, res, user); return true; }

  if (method === 'GET' && route === '/chat/summary') {
    const last = {};
    for (const r of await q.roomLast.all()) last[r.channel] = r.last_id;
    const dms = (await q.myDms.all(user.id, user.id, user.id)).map((d) => ({
      username: d.username, name: d.name, lastId: d.last_id, lastText: d.last_text || '', lastFromMe: d.last_from === user.id
    }));
    send(res, 200, { rooms: ROOMS.map((r) => ({ slug: r.slug, desc: r.desc, lastId: last['room:' + r.slug] || 0 })), dms });
    return true;
  }

  if ((m = /^\/chat\/room\/([a-z-]{1,30})$/.exec(route))) {
    const slug = m[1];
    if (!ROOM_SLUGS.has(slug)) throw new HttpError(404, 'No such room.');
    const channel = 'room:' + slug;
    if (method === 'GET') {
      const rows = await q.history.all(channel, beforeParam(req), user.id);
      send(res, 200, { messages: rows.reverse().map(wire), more: rows.length === 50 });
      return true;
    }
    if (method === 'POST') {
      limit('chat:' + user.id, 20, 60000);
      const b = await readBody(req);
      const body = text(b.text, MSG_MAX, 'Message');
      const now = Date.now();
      const info = await q.addMsg.run(channel, user.id, body, now);
      const msg = { id: info.lastId, text: body, t: now, name: user.name, username: user.username };
      const blockers = new Set((await q.blockersOf.all(user.id)).map((r) => r.blocker_id));
      pushAll({ type: 'msg', channel, msg }, blockers);
      send(res, 201, { msg });
      return true;
    }
  }

  if ((m = /^\/chat\/dm\/([a-z0-9_]{3,20})$/.exec(route))) {
    const peer = await peerByName(m[1], user);
    const key = dmKey(user.id, peer.id);
    const channel = 'dm:' + key;
    if (method === 'GET') {
      const rows = await q.history.all(channel, beforeParam(req), 0);
      send(res, 200, {
        messages: rows.reverse().map(wire), more: rows.length === 50,
        peer: { username: peer.username, name: peer.name },
        blockedByMe: !!(await q.isBlocked.get(user.id, peer.id))
      });
      return true;
    }
    if (method === 'POST') {
      limit('chat:' + user.id, 20, 60000);
      const b = await readBody(req);
      const body = text(b.text, MSG_MAX, 'Message');
      if (await q.isBlocked.get(user.id, peer.id)) throw new HttpError(403, 'You blocked this person. Unblock them to send a message.');
      if (await q.isBlocked.get(peer.id, user.id)) throw new HttpError(403, 'You cannot message this person.');
      if (!(await q.dm.get(key))) {
        const started = await q.dmsStartedSince.get(user.id, Date.now() - 864e5);
        if (started.n >= NEW_DMS_PER_DAY) {
          throw new HttpError(429, 'You have started ' + NEW_DMS_PER_DAY + ' new conversations today. Try again tomorrow.');
        }
        await q.addDm.run(key, Math.min(user.id, peer.id), Math.max(user.id, peer.id), user.id, Date.now());
      }
      const now = Date.now();
      const info = await q.addMsg.run(channel, user.id, body, now);
      await q.touchDm.run(info.lastId, key);
      const msg = { id: info.lastId, text: body, t: now, name: user.name, username: user.username };
      push(peer.id, { type: 'msg', channel: 'dm:' + user.username, msg, peer: { username: user.username, name: user.name } });
      push(user.id, { type: 'msg', channel: 'dm:' + peer.username, msg, peer: { username: peer.username, name: peer.name } });
      send(res, 201, { msg });
      return true;
    }
  }

  if ((m = /^\/chat\/msg\/(\d{1,15})(\/report)?$/.exec(route))) {
    const msg = await q.msg.get(Number(m[1]));
    if (!msg || msg.deleted || !canSee(msg.channel, user.id)) throw new HttpError(404, 'That message is gone.');

    if (method === 'DELETE' && !m[2]) {
      if (msg.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'You can only delete your own messages.');
      await removeMessage(msg);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && m[2]) {
      limit('report:' + user.id, 20, 60 * 60000);
      if (msg.user_id === user.id) throw new HttpError(400, 'You cannot report your own message.');
      const b = await readBody(req);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      await q.addReport.run(msg.id, user.id, reason, Date.now());
      send(res, 201, { ok: true });
      return true;
    }
  }

  if (method === 'GET' && route === '/blocks') {
    send(res, 200, { blocks: await q.myBlocks.all(user.id) });
    return true;
  }
  if ((m = /^\/blocks\/([a-z0-9_]{3,20})$/.exec(route)) && (method === 'POST' || method === 'DELETE')) {
    const peer = await peerByName(m[1], user);
    if (method === 'POST') await q.addBlock.run(user.id, peer.id, Date.now());
    else await q.delBlock.run(user.id, peer.id);
    send(res, 200, { ok: true });
    return true;
  }

  // ----- moderators -----
  if (route.startsWith('/admin/')) {
    if (!isAdmin(user)) throw new HttpError(403, 'Moderators only.');

    if (method === 'GET' && route === '/admin/reports') {
      const reports = (await q.openReports.all()).map((r) => ({
        id: r.id, reason: r.reason, t: r.created, messageId: r.message_id, text: r.text, deleted: !!r.deleted,
        where: r.channel.startsWith('room:') ? '#' + r.channel.slice(5)
          : r.channel.startsWith('qotd:') ? 'Question of the Day'
          : r.channel.startsWith('profile:') ? 'a profile' : 'a private message',
        author: r.author, authorName: r.author_name, authorBanned: !!r.author_banned, reporter: r.reporter
      }));
      send(res, 200, { reports, banned: await q.bannedUsers.all() });
      return true;
    }

    if (method === 'POST' && (m = /^\/admin\/reports\/(\d{1,15})$/.exec(route))) {
      const b = await readBody(req);
      const report = await q.report.get(Number(m[1]));
      if (!report) throw new HttpError(404, 'That report is gone.');
      if (b.action === 'dismiss') {
        await q.resolveReport.run(report.id);
        await q.wipeIfDeleted.run(report.message_id);
      } else if (b.action === 'delete' || b.action === 'ban') {
        const msg = await q.msg.get(report.message_id);
        if (msg) {
          if (b.action === 'ban') {
            const author = await q.userById.get(msg.user_id);
            if (isAdmin(author)) throw new HttpError(400, 'Moderators cannot be banned here.');
            await q.setBanned.run(1, author.id);
            await q.dropUserSessions.run(author.id);
            closeStreams(author.id);
          }
          await q.resolveMsgReports.run(msg.id); // resolve first, so the text is wiped on delete
          await removeMessage(msg);
        }
        await q.resolveReport.run(report.id);
      } else {
        throw new HttpError(400, 'Unknown action.');
      }
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && (m = /^\/admin\/unban\/([a-z0-9_]{3,20})$/.exec(route))) {
      const u = await q.userByName.get(m[1]);
      if (!u) throw new HttpError(404, 'No such user.');
      await q.setBanned.run(0, u.id);
      send(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

// ---------- static files (fixed allow-list, so nothing else on disk is reachable) ----------
const FOREVER = 'public, max-age=31536000, immutable'; // fonts never change; rename the file if they do
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/fonts/inter.woff2': ['fonts/inter.woff2', 'font/woff2', FOREVER],
  '/fonts/fraunces.woff2': ['fonts/fraunces.woff2', 'font/woff2', FOREVER],
  '/fonts/fraunces-italic.woff2': ['fonts/fraunces-italic.woff2', 'font/woff2', FOREVER]
};

function serveStatic(req, res, pathname) {
  const entry = STATIC[pathname];
  if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  fs.readFile(path.join(__dirname, entry[0]), (err, buf) => {
    if (err) { res.writeHead(500); return res.end('Server error'); }
    res.writeHead(200, {
      'Content-Type': entry[1],
      'Cache-Control': entry[2] || 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (e) { res.writeHead(400); return res.end(); }

  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  api(req, res, pathname.slice(4)).catch((e) => {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something broke on our side.' });
  });
});

initDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log('The Bench is running at http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + (TURSO_URL ? ' (hosted database)' : ' (local database)'));
  });
}).catch((e) => {
  console.error('Could not start: ' + e.message);
  process.exit(1);
});
