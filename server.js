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
  // Job leads shared by members (a link to the original post), plus 'useful' votes.
  `CREATE TABLE IF NOT EXISTS job_leads (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS lead_votes (
    lead_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (lead_id, user_id)
  )`,
  // Saved job searches ("alerts"). last_seen = when the member last looked at the results.
  `CREATE TABLE IF NOT EXISTS job_alerts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    what TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT '',
    remote INTEGER NOT NULL DEFAULT 0,
    field TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS job_alerts_user ON job_alerts(user_id)',
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
  leads: stmt(`SELECT l.id, l.user_id, l.title, l.company, l.location, l.url, l.note, l.created, u.name, u.username,
      (SELECT COUNT(*) FROM lead_votes v WHERE v.lead_id = l.id) AS votes,
      (SELECT COUNT(*) FROM lead_votes v WHERE v.lead_id = l.id AND v.user_id = ?) AS mine
    FROM job_leads l JOIN users u ON u.id = l.user_id
    WHERE l.deleted = 0 AND u.banned = 0
      AND l.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
      AND l.created > ?
    ORDER BY l.id DESC LIMIT 100`),
  lead: stmt('SELECT * FROM job_leads WHERE id = ?'),
  leadsSince: stmt('SELECT COUNT(*) AS n FROM job_leads WHERE user_id = ? AND created > ?'),
  addLead: stmt('INSERT INTO job_leads (user_id, title, company, location, url, note, created) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  delLead: stmt('UPDATE job_leads SET deleted = 1 WHERE id = ?'),
  hasLeadVote: stmt('SELECT 1 AS x FROM lead_votes WHERE lead_id = ? AND user_id = ?'),
  addLeadVote: stmt('INSERT OR IGNORE INTO lead_votes (lead_id, user_id) VALUES (?, ?)'),
  delLeadVote: stmt('DELETE FROM lead_votes WHERE lead_id = ? AND user_id = ?'),
  alertsFor: stmt('SELECT * FROM job_alerts WHERE user_id = ? ORDER BY id'),
  alert: stmt('SELECT * FROM job_alerts WHERE id = ?'),
  addAlert: stmt('INSERT INTO job_alerts (user_id, what, place, remote, field, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  delAlert: stmt('DELETE FROM job_alerts WHERE id = ? AND user_id = ?'),
  seenAlert: stmt('UPDATE job_alerts SET last_seen = ? WHERE id = ? AND user_id = ?'),
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

// ---------- text cleanup for listings from outside ----------
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

// ---------- jobs: straight from employers' careers feeds ----------
// Public Greenhouse, Lever and Ashby job-board feeds for the companies in employers.js.
// Refreshed every 3 hours, filtered to roles in India, searched in memory. No keys, no middlemen.

const EMPLOYERS = require('./employers');
const JOBS_REFRESH = (Number(process.env.JOBS_REFRESH_MINUTES) || 180) * 60000; // default: every 3 hours
const JOBS_PAGE = 20;
const FEED_BASE = { // overridable for local testing only
  greenhouse: (process.env.GREENHOUSE_BASE_URL || 'https://boards-api.greenhouse.io').replace(/\/+$/, ''),
  lever: (process.env.LEVER_BASE_URL || 'https://api.lever.co').replace(/\/+$/, ''),
  ashby: (process.env.ASHBY_BASE_URL || 'https://api.ashbyhq.com').replace(/\/+$/, ''),
  smartrecruiters: (process.env.SMARTRECRUITERS_BASE_URL || 'https://api.smartrecruiters.com').replace(/\/+$/, '')
};
for (const b of Object.values(FEED_BASE)) {
  if (!/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(b)) throw new Error('Job feed URLs must use https.');
}
const INDIA_PLACES = /\b(india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|hyderabad|chennai|pune|kolkata|ahmedabad|jaipur|kochi|cochin|coimbatore|chandigarh|indore|trivandrum|thiruvananthapuram|mysore|mysuru|vadodara|surat|nagpur|bhubaneswar|lucknow|goa|visakhapatnam)\b/i;
const jobsStore = { jobs: [], updated: 0, refreshing: null, failed: [] };

const isWebUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u) && u.length < 600;
const uniq = (list) => [...new Set(list.map((s) => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
const indiaPlaces = (list) => uniq(list).filter((s) => INDIA_PLACES.test(s));

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TheBench-JobBoard/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const FEEDS = {
  async greenhouse(e) {
    const j = await getJson(FEED_BASE.greenhouse + '/v1/boards/' + encodeURIComponent(e.token) + '/jobs');
    return (Array.isArray(j.jobs) ? j.jobs : []).map((x) => {
      const places = indiaPlaces([x.location && x.location.name]);
      return places.length && isWebUrl(x.absolute_url) && {
        id: 'gh:' + e.token + ':' + x.id, title: x.title, url: x.absolute_url, places,
        posted: Date.parse(x.first_published || x.updated_at) || null, team: '', type: '',
        remote: /remote/i.test((x.location && x.location.name) || '')
      };
    });
  },
  async lever(e) {
    const j = await getJson(FEED_BASE.lever + '/v0/postings/' + encodeURIComponent(e.token) + '?mode=json');
    return (Array.isArray(j) ? j : []).map((x) => {
      const c = x.categories || {};
      const places = indiaPlaces([c.location].concat(c.allLocations || []));
      const inIndia = places.length || (x.country === 'IN');
      return inIndia && isWebUrl(x.hostedUrl) && {
        id: 'lv:' + e.token + ':' + x.id, title: x.text, url: x.hostedUrl, places: places.length ? places : ['India'],
        posted: Number(x.createdAt) || null, team: c.team || c.department || '', type: c.commitment || '',
        remote: x.workplaceType === 'remote'
      };
    });
  },
  async ashby(e) {
    const j = await getJson(FEED_BASE.ashby + '/posting-api/job-board/' + encodeURIComponent(e.token));
    return (Array.isArray(j.jobs) ? j.jobs : []).filter((x) => x.isListed !== false).map((x) => {
      const country = x.address && x.address.postalAddress && x.address.postalAddress.addressCountry;
      const places = indiaPlaces([x.location, country].concat((x.secondaryLocations || []).map((s) => s.location)));
      const types = { FullTime: 'Full-time', PartTime: 'Part-time', Intern: 'Internship', Contract: 'Contract', Temporary: 'Temporary' };
      return places.length && isWebUrl(x.jobUrl) && {
        id: 'ab:' + e.token + ':' + (x.id || x.jobUrl), title: x.title, url: x.jobUrl, places,
        posted: Date.parse(x.publishedAt) || null, team: x.department || x.team || '', type: types[x.employmentType] || '',
        remote: !!x.isRemote || x.workplaceType === 'Remote'
      };
    });
  },
  async smartrecruiters(e) {
    const out = [];
    for (let offset = 0; offset < 300; offset += 100) { // at most 300 roles per company
      const j = await getJson(FEED_BASE.smartrecruiters + '/v1/companies/' + encodeURIComponent(e.token) + '/postings?country=in&limit=100&offset=' + offset);
      const rows = Array.isArray(j.content) ? j.content : [];
      for (const x of rows) {
        const loc = x.location || {};
        if (String(loc.country).toLowerCase() !== 'in' || !/^\d+$/.test(String(x.id))) continue;
        const city = String(loc.city || '').trim();
        out.push({
          id: 'sr:' + e.token + ':' + x.id, title: x.name, url: 'https://jobs.smartrecruiters.com/' + encodeURIComponent(e.token) + '/' + x.id,
          places: [city ? city.replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'India'],
          posted: Date.parse(x.releasedDate) || null, team: (x.department && x.department.label) || '',
          type: (x.typeOfEmployment && x.typeOfEmployment.label) || '', remote: !!loc.remote,
          hint: (x.function && x.function.label) || ''
        });
      }
      if (rows.length < 100 || offset + 100 >= (Number(j.totalFound) || 0)) break;
    }
    return out;
  }
};

// ----- field of work, guessed from the title (then team / function) -----
const FIELDS = [
  ['engineering', 'Engineering & IT', /\b(software|developer|devops|sre|site reliability|front[- ]?end|back[- ]?end|full[- ]?stack|android|ios|machine learning|data scientist|data engineer(ing)?|research engineer|design engineer|architect|qa|quality assurance|test automation|sdet|firmware|embedded|cloud|infrastructure|security engineer|programmer|hardware|asic|vlsi|mechanical|electrical|electronics|cad|plc|automation engineer|integration engineer|data pipelines?|threat|offensive security|penetration|cyber ?security|application security)\b/i],
  ['support', 'Customer support', /\b(support|customer|client service|care|helpdesk|help desk|service desk|cx|customer success|success manager|chat|voice process|call cent(er|re)|contact cent(er|re))\b/i],
  ['sales', 'Sales & business development', /\b(sales|account executive|account manager|key account|kam|business development|bdr|sdr|partnerships?|pre-?sales|revenue|merchant acquisition|field sales|channels?)\b/i],
  ['marketing', 'Marketing & content', /\b(marketing|growth|brand|content|copywrit\w*|social media|seo|sem|public relations|pr manager|communications|creative|media|campaign|community|video\w*|photograph\w*|editor)\b/i],
  ['finance', 'Finance & accounts', /\b(finance|financial|accountant|accounts?|accounting|audit\w*|tax|payroll|treasury|fp&a|finops|controller|billing|collections?|credit|rtr|record to report|p2p|procure to pay|o2c|order to cash|invoic\w*)\b/i],
  ['people', 'HR & people', /\b(hr|human resources|talent|recruit\w*|people|learning (and|&) development|l&d|hrbp|candidate|onboarding specialist)\b/i],
  ['legal', 'Legal, risk & compliance', /\b(legal|counsel|lawyer|compliance|risk|kyc|aml|fraud|regulatory|governance|grc|privacy|secretarial|ediscovery|e-discovery|forensic\w*)\b/i],
  ['operations', 'Operations & logistics', /\b(operations?|ops|supply chain|logistics|fulfil+ment|warehouse|procurement|purchas\w*|store|retail|delivery|fleet|city manager|category|vendor|inventory|planning|planner|admin\w*|facilities|export|import|freight|secretar\w*|executive assistant|receptionist|front desk|maintenance|service management|service manager|house manager|office manager|hse|health,? safety|safety)\b/i],
  ['design', 'Design', /\b(design(er)?|ux|ui|illustrat\w*|motion|art director|visual)\b/i],
  ['product', 'Product & projects', /\b(product manager|product owner|program manager|programme manager|project manager|project management|program management|project coordinator|pmo|scrum|delivery manager)\b/i],
  ['data', 'Data & analytics', /\b(analyst|analytics|data|insights|business intelligence|bi|research|economist|statistic\w*)\b/i],
  ['engineering', 'Engineering & IT', /\b(engineer|engineering|technical|technology|it|systems?|network|security)\b/i]
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map(([k, label]) => [k, label]).concat([['other', 'Other']]));
function fieldOf(title, extra) {
  for (const text of [title, extra]) {
    if (!text) continue;
    for (const [key, , re] of FIELDS) if (re.test(text)) return key;
  }
  return 'other';
}

function tidyJob(raw, employer) {
  return {
    id: raw.id.slice(0, 120),
    title: plainText(raw.title).slice(0, 140),
    company: employer.name,
    location: raw.places.filter((p) => !/^india$/i.test(p) || raw.places.length === 1).slice(0, 3).join(' · ').slice(0, 120),
    remote: !!raw.remote,
    url: raw.url,
    posted: raw.posted,
    team: plainText(raw.team).slice(0, 60),
    type: plainText(raw.type).slice(0, 30),
    field: fieldOf(plainText(raw.title), [raw.team, raw.hint].filter(Boolean).join(' '))
  };
}

const FEED_WORKERS = 8; // feeds fetched at the same time
function mergeJobs(all) {
  const seen = new Set();
  return all.filter((j) => (seen.has(j.id) ? false : seen.add(j.id))).sort((a, b) => (b.posted || 0) - (a.posted || 0));
}
async function refreshJobs() {
  const all = [], failed = [];
  const firstLoad = !jobsStore.jobs.length;
  jobsStore.firstLoad = firstLoad;
  const queue = EMPLOYERS.slice();
  // A small pool: each worker takes the next company as soon as it is free, so one slow feed holds up nobody.
  await Promise.all(Array.from({ length: FEED_WORKERS }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        const rows = await FEEDS[e.ats](e);
        for (const r of rows) if (r && r.title) all.push(tidyJob(r, e));
        if (firstLoad) jobsStore.jobs = mergeJobs(all); // cold start: show what has arrived so far
      } catch (err) {
        failed.push(e.name);
      }
    }
  }));
  const jobs = mergeJobs(all);
  if (jobs.length || !jobsStore.jobs.length) jobsStore.jobs = jobs; // keep the last good copy if every feed failed
  jobsStore.updated = Date.now();
  jobsStore.failed = failed;
  jobsStore.firstLoad = false;
  if (failed.length) console.error('Job feeds failed: ' + failed.join(', '));
  pushAll({ type: 'jobs-updated', channel: 'jobs' }); // open pages refresh their alert counts
}
function ensureJobs() {
  const stale = Date.now() - jobsStore.updated > JOBS_REFRESH;
  if (stale && !jobsStore.refreshing) {
    jobsStore.refreshing = refreshJobs().catch((e) => console.error('Job refresh failed: ' + e.message)).finally(() => { jobsStore.refreshing = null; });
  }
  if (jobsStore.jobs.length || !jobsStore.refreshing) return Promise.resolve();
  // Cold start with nothing yet: wait for the first feeds, but never more than a few seconds.
  return Promise.race([jobsStore.refreshing, new Promise((r) => setTimeout(r, 6000))]);
}

// ---------- community job leads ----------
const LEAD_DAYS = 45;
const LEADS_PER_DAY = 5;

function leadUrl(v) {
  let url;
  try { url = new URL(String(v || '').trim()); } catch (e) { throw new HttpError(400, 'Add the link to the job post, starting with https://'); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
    throw new HttpError(400, 'The link must be a normal web address starting with https://');
  }
  if (url.href.length > 300) throw new HttpError(400, 'That link is too long.');
  return url.href;
}

const CITY_ALIASES = { bangalore: 'bengaluru', bengaluru: 'bangalore', gurgaon: 'gurugram', gurugram: 'gurgaon', bombay: 'mumbai', madras: 'chennai' };
const MAX_ALERTS = 5;

function cleanFilters(src) {
  const get = (k) => (typeof src.get === 'function' ? src.get(k) : src[k]);
  const field = String(get('field') || '');
  return {
    what: String(get('what') || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60),
    where: String(get('where') || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60),
    remote: get('remote') === '1' || get('remote') === true || get('remote') === 1,
    field: field === 'nontech' || FIELD_LABEL[field] ? field : ''
  };
}

// Returns the matches before the field filter (for the field counts) and the final list.
function searchJobs(f) {
  const words = f.what.split(' ').filter(Boolean);
  const matches = jobsStore.jobs.filter((j) => {
    if (f.remote && !j.remote) return false;
    const loc = j.location.toLowerCase();
    if (f.where && !loc.includes(f.where) && !(CITY_ALIASES[f.where] && loc.includes(CITY_ALIASES[f.where]))) return false;
    const hay = (j.title + ' ' + j.company + ' ' + j.team).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const list = !f.field ? matches
    : f.field === 'nontech' ? matches.filter((j) => j.field !== 'engineering')
    : matches.filter((j) => j.field === f.field);
  return { matches, list };
}

function alertName(f) {
  const title = (t) => t.replace(/\b\w/g, (c) => c.toUpperCase());
  const parts = [
    f.field === 'nontech' ? 'Non-tech' : f.field ? FIELD_LABEL[f.field] : '',
    f.what ? '“' + f.what + '”' : '',
    f.where ? 'in ' + title(f.where) : '',
    f.remote ? 'remote' : ''
  ].filter(Boolean).join(' ');
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

function alertView(a) {
  const f = { what: a.what, where: a.place, remote: !!a.remote, field: a.field };
  const { list } = searchJobs(f);
  return {
    id: a.id, name: alertName(f), what: a.what, where: a.place, remote: !!a.remote, field: a.field,
    lastSeen: a.last_seen, total: list.length, newCount: list.filter((j) => j.posted && j.posted > a.last_seen).length
  };
}

async function jobsApi(req, res, route, user) {
  const method = req.method;
  let m;

  if (method === 'GET' && route === '/jobs') {
    limit('jobs:' + user.id, 60, 60000);
    await ensureJobs();
    const sp = new URL(req.url, 'http://x').searchParams;
    const page = Math.min(Math.max(parseInt(sp.get('page'), 10) || 1, 1), 50);
    const { matches, list } = searchJobs(cleanFilters(sp));
    // Count fields before applying the field filter, so the chips show what each choice would give.
    const counts = {};
    for (const j of matches) counts[j.field] = (counts[j.field] || 0) + 1;
    send(res, 200, {
      jobs: list.slice((page - 1) * JOBS_PAGE, page * JOBS_PAGE), total: list.length, page,
      companies: EMPLOYERS.length, updated: jobsStore.updated || null,
      fields: Object.keys(FIELD_LABEL).map((k) => ({ key: k, label: FIELD_LABEL[k], count: counts[k] || 0 })).filter((f) => f.count),
      nontech: matches.length - (counts.engineering || 0),
      partial: !!(jobsStore.refreshing && jobsStore.firstLoad)
    });
    return true;
  }

  if (method === 'GET' && route === '/alerts') {
    await ensureJobs();
    const alerts = (await q.alertsFor.all(user.id)).map(alertView);
    send(res, 200, { alerts, totalNew: alerts.reduce((sum, a) => sum + a.newCount, 0), partial: !!(jobsStore.refreshing && jobsStore.firstLoad) });
    return true;
  }

  if (method === 'POST' && route === '/alerts') {
    limit('alerts:' + user.id, 20, 10 * 60000);
    const f = cleanFilters(await readBody(req));
    if (!f.what && !f.where && !f.remote && !f.field) throw new HttpError(400, 'Pick a field, a keyword, a city or remote first, then save.');
    const mine = await q.alertsFor.all(user.id);
    if (mine.some((a) => a.what === f.what && a.place === f.where && !!a.remote === f.remote && a.field === f.field)) {
      throw new HttpError(409, 'You already have an alert for this search.');
    }
    if (mine.length >= MAX_ALERTS) throw new HttpError(400, 'You can keep up to ' + MAX_ALERTS + ' alerts. Delete one to add another.');
    const t = Date.now();
    const info = await q.addAlert.run(user.id, f.what, f.where, f.remote ? 1 : 0, f.field, t, t);
    send(res, 201, { alert: alertView({ id: info.lastId, what: f.what, place: f.where, remote: f.remote ? 1 : 0, field: f.field, last_seen: t }) });
    return true;
  }

  if ((m = /^\/alerts\/(\d{1,15})(\/seen)?$/.exec(route))) {
    const a = await q.alert.get(Number(m[1]));
    if (!a || a.user_id !== user.id) throw new HttpError(404, 'That alert is gone.');
    if (method === 'POST' && m[2]) {
      await q.seenAlert.run(Date.now(), a.id, user.id);
      send(res, 200, { ok: true, previous: a.last_seen });
      return true;
    }
    if (method === 'DELETE' && !m[2]) {
      await q.delAlert.run(a.id, user.id);
      send(res, 200, { ok: true });
      return true;
    }
  }

  if (method === 'GET' && route === '/leads') {
    const rows = await q.leads.all(user.id, user.id, Date.now() - LEAD_DAYS * 864e5);
    send(res, 200, {
      leads: rows.map((r) => ({
        id: r.id, title: r.title, company: r.company, location: r.location, url: r.url, note: r.note, t: r.created,
        name: r.name, username: r.username, votes: r.votes, mine: !!r.mine, own: r.user_id === user.id
      }))
    });
    return true;
  }

  if (method === 'POST' && route === '/leads') {
    limit('write:' + user.id, 20, 60000);
    const b = await readBody(req);
    const title = text(b.title, 100, 'Job title');
    const company = text(b.company, 80, 'Company');
    const location = line(b.location, 60, 'Location');
    const note = line(b.note, 280, 'Note');
    const url = leadUrl(b.url);
    const recent = await q.leadsSince.get(user.id, Date.now() - 864e5);
    if (recent.n >= LEADS_PER_DAY) throw new HttpError(429, 'You have shared ' + LEADS_PER_DAY + ' leads today. Thank you! Share more tomorrow.');
    await q.addLead.run(user.id, title, company, location, url, note, Date.now());
    send(res, 201, { ok: true });
    return true;
  }

  if ((m = /^\/leads\/(\d{1,15})(\/vote|\/report)?$/.exec(route))) {
    const lead = await q.lead.get(Number(m[1]));
    if (!lead || lead.deleted) throw new HttpError(404, 'That lead is gone.');

    if (method === 'POST' && m[2] === '/vote') {
      limit('react:' + user.id, 120, 60000);
      if (await q.hasLeadVote.get(lead.id, user.id)) await q.delLeadVote.run(lead.id, user.id);
      else await q.addLeadVote.run(lead.id, user.id);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'DELETE' && !m[2]) {
      if (lead.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'You can only delete leads you shared.');
      await q.delLead.run(lead.id);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && m[2] === '/report') {
      limit('report:' + user.id, 20, 60 * 60000);
      if (lead.user_id === user.id) throw new HttpError(400, 'You cannot report your own lead.');
      const b = await readBody(req);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      const snapshot = [lead.title + ' at ' + lead.company, lead.location, lead.note, lead.url].filter(Boolean).join('\n');
      const info = await q.addMsg.run('lead:' + lead.id, lead.user_id, snapshot, Date.now());
      await q.addReport.run(info.lastId, user.id, reason, Date.now());
      send(res, 201, { ok: true });
      return true;
    }
  }

  return false;
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
const isPublicChannel = (channel) => /^(room|qotd|profile|lead):/.test(channel);
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
  else if (m.channel.startsWith('lead:')) await q.delLead.run(Number(m.channel.slice(5)));
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
          : r.channel.startsWith('profile:') ? 'a profile'
          : r.channel.startsWith('lead:') ? 'a job lead' : 'a private message',
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
    ensureJobs(); // warm the job listings so the first visitor does not wait
  });
}).catch((e) => {
  console.error('Could not start: ' + e.message);
  process.exit(1);
});
