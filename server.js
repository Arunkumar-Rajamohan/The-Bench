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
const MAX_DATA = 500 * 1024; // characters of private data (tracker, resume, practice...): a busy year fits well within it
const DATA_TOO_BIG = 'your saved data is too big. Remove something long, like an old job post.';
const TAGS = ['Win', 'Rant', 'Question', 'Tip'];
const REACTS = ['🙌', '💪', '😂'];
const CHAT_REACTS = ['👍', '❤️', '😂', '🙌', '🙏', '🎉'];
const EDIT_WINDOW = 24 * 3600e3; // own chat messages can be fixed for a day after sending
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
// The first name in that list is the site owner: the only one who can open the usage counts.
const OWNER = [...ADMINS][0] || '';
const isOwner = (u) => !!u && !!OWNER && u.username === OWNER;

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
  // Referral board: members who can refer people into a company (kind 'refer') or know people there (kind 'contact').
  `CREATE TABLE IF NOT EXISTS referral_offers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    company TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'refer',
    roles TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    open INTEGER NOT NULL DEFAULT 1,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  )`,
  // Who asked which offer, and when (one ask per offer per person every 30 days).
  `CREATE TABLE IF NOT EXISTS referral_asks (
    offer_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (offer_id, user_id)
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
  // Accountability buddies
  `CREATE TABLE IF NOT EXISTS buddy_prefs (
    user_id INTEGER PRIMARY KEY,
    seeking INTEGER NOT NULL DEFAULT 0,
    goal TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS buddy_requests (
    id INTEGER PRIMARY KEY,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS buddy_pairs (
    id INTEGER PRIMARY KEY,
    a INTEGER NOT NULL,
    b INTEGER NOT NULL,
    created INTEGER NOT NULL,
    ended INTEGER NOT NULL DEFAULT 0,
    nudge_a TEXT NOT NULL DEFAULT '',
    nudge_b TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS checkins (
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    cheer TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  )`,
  // Phone notifications. A device only gets them while the log-in it was turned on from is still valid.
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    session TEXT NOT NULL,
    created INTEGER NOT NULL,
    fails INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id)',
  // Usage counts (see "usage counts" below): totals, plus scrambled markers that only live until the week is over.
  'CREATE TABLE IF NOT EXISTS usage_marks (week TEXT NOT NULL, metric TEXT NOT NULL, mark TEXT NOT NULL, PRIMARY KEY (week, metric, mark))',
  'CREATE TABLE IF NOT EXISTS usage_weeks (week TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (week, metric))',
  'CREATE TABLE IF NOT EXISTS usage_days (day TEXT PRIMARY KEY, n INTEGER NOT NULL)',
  // Read receipts. No row in receipts = not asked yet, which counts as off. dm_reads: how far a member has read a private chat.
  'CREATE TABLE IF NOT EXISTS receipts (user_id INTEGER PRIMARY KEY, is_on INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS dm_reads (user_id INTEGER NOT NULL, key TEXT NOT NULL, last_id INTEGER NOT NULL, PRIMARY KEY (user_id, key))',
  'CREATE TABLE IF NOT EXISTS push_prefs (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS push_sent (user_id INTEGER NOT NULL, key TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (user_id, key))',
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

// exec(sql, args) -> { rows: [objects], lastId: number, changes: rows changed }
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
      lastId: Number(res.last_insert_rowid) || 0,
      changes: Number(res.affected_row_count) || 0
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
    if (/^\s*select/i.test(sql)) return { rows: st.all(...args), lastId: 0, changes: 0 };
    const info = st.run(...args);
    return { rows: [], lastId: Number(info.lastInsertRowid) || 0, changes: Number(info.changes) || 0 };
  };
}

// Columns added after launch. ADD COLUMN fails once the column exists, which is fine.
const MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN recovery TEXT',
  'ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN data_rev INTEGER NOT NULL DEFAULT 0', // goes up by one with every save of data
  'ALTER TABLE messages ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0', // 1 = never shows "Seen" (referral requests)
  'ALTER TABLE users ADD COLUMN last_day TEXT', // the last day they opened The Bench; used only to count, never shown to members
  'ALTER TABLE messages ADD COLUMN reply_to INTEGER NOT NULL DEFAULT 0', // the message this one answers, in the same chat
  'ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0', // when the author last changed it; 0 = never
  'ALTER TABLE reports ADD COLUMN text TEXT' // what a reported chat message said when it was reported; cleared once handled
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
  session: stmt('SELECT u.id, u.username, u.name, u.data, u.data_rev, u.created, u.recovery IS NOT NULL AS has_recovery, s.expires AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ? AND u.banned = 0'),
  renewSession: stmt('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
  dropSession: stmt('DELETE FROM sessions WHERE token_hash = ?'),
  dropUserSessions: stmt('DELETE FROM sessions WHERE user_id = ?'),
  setRecovery: stmt('UPDATE users SET recovery = ? WHERE id = ?'),
  setPassword: stmt('UPDATE users SET pass = ?, salt = ?, recovery = ? WHERE id = ?'),
  saveData: stmt('UPDATE users SET data = ?, data_rev = data_rev + 1 WHERE id = ? AND banned = 0'),
  saveDataAt: stmt('UPDATE users SET data = ?, data_rev = data_rev + 1 WHERE id = ? AND banned = 0 AND data_rev = ?'),
  dataOf: stmt('SELECT data, data_rev FROM users WHERE id = ?'),
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
  // A reply carries what it answers, only from the same chat, and never the words of someone banned or blocked.
  history: stmt(`SELECT m.id, m.text, m.created, m.edited, m.reply_to, u.name, u.username,
      r.text AS r_text, r.deleted AS r_deleted, ru.name AS r_name, ru.username AS r_username, ru.banned AS r_banned,
      (r.user_id IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)) AS r_blocked
    FROM messages m JOIN users u ON u.id = m.user_id
    LEFT JOIN messages r ON r.id = m.reply_to AND r.channel = m.channel
    LEFT JOIN users ru ON ru.id = r.user_id
    WHERE m.channel = ? AND m.deleted = 0 AND m.id < ? AND u.banned = 0
      AND m.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
    ORDER BY m.id DESC LIMIT 50`),
  chatReacts: stmt(`SELECT r.message_id, r.emoji, COUNT(*) AS n, SUM(r.user_id = ?) AS mine FROM msg_reacts r
    WHERE r.message_id IN (SELECT id FROM messages WHERE channel = ? AND id >= ? AND id <= ?) GROUP BY r.message_id, r.emoji`),
  msgReactCount: stmt('SELECT COUNT(*) AS n FROM msg_reacts WHERE message_id = ? AND emoji = ?'),
  delMsgReacts: stmt('DELETE FROM msg_reacts WHERE message_id = ?'),
  replyTo: stmt('SELECT m.id, m.channel, m.user_id, m.deleted, m.text, u.name, u.username, u.banned FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?'),
  editMsg: stmt('UPDATE messages SET text = ?, edited = ? WHERE id = ? AND deleted = 0'),
  addMsg: stmt('INSERT INTO messages (channel, user_id, text, created) VALUES (?, ?, ?, ?)'),
  addChatMsg: stmt('INSERT INTO messages (channel, user_id, text, created, reply_to) VALUES (?, ?, ?, ?, ?)'),
  addDmMsg: stmt('INSERT INTO messages (channel, user_id, text, created, quiet, reply_to) VALUES (?, ?, ?, ?, ?, ?)'),
  receipts: stmt('SELECT is_on FROM receipts WHERE user_id = ?'),
  saveReceipts: stmt('INSERT INTO receipts (user_id, is_on) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET is_on = excluded.is_on'),
  dmRead: stmt('SELECT last_id FROM dm_reads WHERE user_id = ? AND key = ?'),
  saveDmRead: stmt(`INSERT INTO dm_reads (user_id, key, last_id) VALUES (?, ?, ?)
    ON CONFLICT (user_id, key) DO UPDATE SET last_id = excluded.last_id WHERE excluded.last_id > dm_reads.last_id`),
  dropDmReads: stmt('DELETE FROM dm_reads WHERE user_id = ?'),
  newestSeen: stmt('SELECT MAX(id) AS id FROM messages WHERE channel = ? AND user_id = ? AND deleted = 0 AND quiet = 0 AND id > ? AND id <= ?'),
  newestMsg: stmt('SELECT MAX(id) AS id FROM messages'),
  msg: stmt('SELECT id, channel, user_id, deleted, created, text FROM messages WHERE id = ?'),
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
  addMsgReport: stmt('INSERT OR IGNORE INTO reports (message_id, reporter_id, reason, created, text) VALUES (?, ?, ?, ?, ?)'),
  // Moderators see what was reported, even if the author changed it afterwards.
  openReports: stmt(`SELECT r.id, r.reason, r.created, r.message_id, COALESCE(r.text, m.text) AS text, m.edited, m.channel, m.deleted, m.created AS msg_created,
      au.username AS author, au.name AS author_name, au.banned AS author_banned, ru.username AS reporter
    FROM reports r JOIN messages m ON m.id = r.message_id JOIN users au ON au.id = m.user_id JOIN users ru ON ru.id = r.reporter_id
    WHERE r.resolved = 0 ORDER BY r.id LIMIT 100`),
  setting: stmt('SELECT value FROM settings WHERE key = ?'),
  addSetting: stmt('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'),
  pushSubs: stmt(`SELECT p.* FROM push_subs p JOIN sessions s ON s.token_hash = p.session AND s.user_id = p.user_id AND s.expires > ?
    JOIN users u ON u.id = p.user_id AND u.banned = 0 WHERE p.user_id = ? ORDER BY p.created`),
  pushPeople: stmt(`SELECT DISTINCT u.id, u.data_rev FROM push_subs p JOIN sessions s ON s.token_hash = p.session AND s.user_id = p.user_id AND s.expires > ?
    JOIN users u ON u.id = p.user_id AND u.banned = 0`),
  savePushSub: stmt(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, session, created) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, session = excluded.session, fails = 0`),
  delPushSub: stmt('DELETE FROM push_subs WHERE endpoint = ?'),
  delMyPushSub: stmt('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?'),
  failPushSub: stmt('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?'),
  okPushSub: stmt('UPDATE push_subs SET fails = 0 WHERE endpoint = ? AND fails > 0'),
  pushPrefs: stmt('SELECT data FROM push_prefs WHERE user_id = ?'),
  savePushPrefs: stmt('INSERT INTO push_prefs (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data'),
  claimSent: stmt('INSERT OR IGNORE INTO push_sent (user_id, key, created) VALUES (?, ?, ?)'),
  unclaimSent: stmt('DELETE FROM push_sent WHERE user_id = ? AND key = ?'),
  openReportCount: stmt('SELECT COUNT(*) AS n FROM reports r JOIN messages m ON m.id = r.message_id WHERE r.resolved = 0'),
  report: stmt('SELECT * FROM reports WHERE id = ?'),
  resolveReport: stmt('UPDATE reports SET resolved = 1, text = NULL WHERE id = ?'),
  resolveMsgReports: stmt('UPDATE reports SET resolved = 1, text = NULL WHERE message_id = ?'),
  // After the last open report on an already-deleted message is closed, drop the text that was kept for review.
  wipeIfDeleted: stmt(`UPDATE messages SET text = '' WHERE id = ? AND deleted = 1
    AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.message_id = messages.id AND r.resolved = 0)`),
  setBanned: stmt('UPDATE users SET banned = ? WHERE id = ?'),
  // Deleted accounts are empty placeholders named '~<id>' (a name nobody can sign up with); they are not bans.
  bannedUsers: stmt("SELECT username, name FROM users WHERE banned = 1 AND username NOT LIKE '~%' ORDER BY username"),
  dmKeysOf: stmt('SELECT key FROM dms WHERE a = ? OR b = ?'),
  recentMsgsOf: stmt("SELECT id, channel FROM messages WHERE user_id = ? AND deleted = 0 AND (channel LIKE 'room:%' OR channel LIKE 'qotd:%') ORDER BY id DESC LIMIT 200"),
  emptyUser: stmt("UPDATE users SET username = ?, name = 'Deleted member', pass = ?, salt = ?, recovery = NULL, data = '{}', last_day = NULL, banned = 1 WHERE id = ?"),
  lastDay: stmt('SELECT last_day, created FROM users WHERE id = ?'),
  setLastDay: stmt('UPDATE users SET last_day = ? WHERE id = ? AND last_day IS ?'),
  addMark: stmt('INSERT OR IGNORE INTO usage_marks (week, metric, mark) VALUES (?, ?, ?)'),
  bumpDay: stmt('INSERT INTO usage_days (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1'),
  bumpWeek: stmt('INSERT INTO usage_weeks (week, metric, n) VALUES (?, ?, 1) ON CONFLICT (week, metric) DO UPDATE SET n = n + 1'),
  foldWeeks: stmt(`INSERT INTO usage_weeks (week, metric, n) SELECT week, metric, COUNT(*) FROM usage_marks WHERE week < ? GROUP BY week, metric
    ON CONFLICT (week, metric) DO UPDATE SET n = MAX(n, excluded.n)`),

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
  refOffers: stmt(`SELECT o.id, o.user_id, o.company, o.kind, o.roles, o.note, o.open, o.updated, u.name, u.username,
      (SELECT COUNT(*) FROM referral_asks a WHERE a.offer_id = o.id AND a.created > ?) AS asks,
      (SELECT a.created FROM referral_asks a WHERE a.offer_id = o.id AND a.user_id = ?) AS my_ask
    FROM referral_offers o JOIN users u ON u.id = o.user_id
    WHERE o.deleted = 0 AND u.banned = 0
      AND o.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
      AND o.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
    ORDER BY o.open DESC, o.updated DESC LIMIT 300`),
  refOffer: stmt('SELECT * FROM referral_offers WHERE id = ?'),
  refOffersOf: stmt('SELECT id, company, kind, open FROM referral_offers WHERE user_id = ? AND deleted = 0 ORDER BY updated DESC'),
  addRefOffer: stmt('INSERT INTO referral_offers (user_id, company, kind, roles, note, open, created, updated) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'),
  setRefOpen: stmt('UPDATE referral_offers SET open = ?, updated = ? WHERE id = ?'),
  delRefOffer: stmt('UPDATE referral_offers SET deleted = 1 WHERE id = ?'),
  refAsk: stmt('SELECT created FROM referral_asks WHERE offer_id = ? AND user_id = ?'),
  saveRefAsk: stmt(`INSERT INTO referral_asks (offer_id, user_id, created) VALUES (?, ?, ?)
    ON CONFLICT (offer_id, user_id) DO UPDATE SET created = excluded.created`),
  alertsFor: stmt('SELECT * FROM job_alerts WHERE user_id = ? ORDER BY id'),
  alert: stmt('SELECT * FROM job_alerts WHERE id = ?'),
  addAlert: stmt('INSERT INTO job_alerts (user_id, what, place, remote, field, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  delAlert: stmt('DELETE FROM job_alerts WHERE id = ? AND user_id = ?'),
  seenAlert: stmt('UPDATE job_alerts SET last_seen = ? WHERE id = ? AND user_id = ?'),
  buddyPrefs: stmt('SELECT * FROM buddy_prefs WHERE user_id = ?'),
  saveBuddyPrefs: stmt(`INSERT INTO buddy_prefs (user_id, seeking, goal, updated) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET seeking = excluded.seeking, goal = excluded.goal, updated = excluded.updated`),
  stopSeeking: stmt('UPDATE buddy_prefs SET seeking = 0 WHERE user_id = ?'),
  buddySeekers: stmt(`SELECT u.id, u.username, u.name, bp.goal, pr.data FROM buddy_prefs bp
      JOIN users u ON u.id = bp.user_id LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE bp.seeking = 1 AND u.banned = 0 AND u.id != ?
      AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
      AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      AND u.id NOT IN (SELECT a FROM buddy_pairs WHERE ended = 0)
      AND u.id NOT IN (SELECT b FROM buddy_pairs WHERE ended = 0)
    ORDER BY bp.updated DESC LIMIT 60`),
  activePair: stmt('SELECT * FROM buddy_pairs WHERE ended = 0 AND (a = ? OR b = ?) ORDER BY id DESC LIMIT 1'),
  addPair: stmt('INSERT INTO buddy_pairs (a, b, created) VALUES (?, ?, ?)'),
  endPair: stmt('UPDATE buddy_pairs SET ended = 1 WHERE id = ?'),
  nudgeA: stmt('UPDATE buddy_pairs SET nudge_a = ? WHERE id = ?'),
  nudgeB: stmt('UPDATE buddy_pairs SET nudge_b = ? WHERE id = ?'),
  buddyIncoming: stmt(`SELECT r.id, r.note, r.created, u.username, u.name FROM buddy_requests r JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? AND r.status = 'pending' AND u.banned = 0 ORDER BY r.id DESC`),
  buddyOutgoing: stmt(`SELECT r.id, r.note, r.created, u.username, u.name FROM buddy_requests r JOIN users u ON u.id = r.to_id
    WHERE r.from_id = ? AND r.status = 'pending' AND u.banned = 0 ORDER BY r.id DESC`),
  buddyReq: stmt('SELECT * FROM buddy_requests WHERE id = ?'),
  buddyReqBetween: stmt(`SELECT id FROM buddy_requests WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`),
  addBuddyReq: stmt('INSERT INTO buddy_requests (from_id, to_id, note, created) VALUES (?, ?, ?, ?)'),
  setBuddyReq: stmt('UPDATE buddy_requests SET status = ? WHERE id = ?'),
  cancelBuddyReqsFor: stmt(`UPDATE buddy_requests SET status = 'cancelled' WHERE status = 'pending' AND (from_id IN (?, ?) OR to_id IN (?, ?))`),
  checkin: stmt('SELECT * FROM checkins WHERE user_id = ? AND day = ?'),
  checkinsSince: stmt('SELECT * FROM checkins WHERE user_id = ? AND day >= ? ORDER BY day'),
  saveCheckin: stmt(`INSERT INTO checkins (user_id, day, plan, done, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, day) DO UPDATE SET plan = excluded.plan, done = excluded.done, updated = excluded.updated`),
  setCheer: stmt('UPDATE checkins SET cheer = ? WHERE user_id = ? AND day = ?'),
  people: stmt(`SELECT u.username, u.name, u.created, p.data, (SELECT seeking FROM buddy_prefs WHERE user_id = u.id) AS seeking FROM users u LEFT JOIN profiles p ON p.user_id = u.id
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

// A body that is too big is read to the end and thrown away, so the "too big" answer reaches the browser:
// cutting the connection instead looks like the server is down, and the app would keep retrying.
function readBody(req, max, tooBig) {
  max = max || MAX_BODY;
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
      return reject(new HttpError(415, 'Send JSON.'));
    }
    let size = 0, over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (over) { if (size > max * 4) req.destroy(); return; } // a flood, not a mistake: stop reading
      if (size > max) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return reject(new HttpError(413, tooBig || 'That is too big.'));
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
  return { username: u.username, name: u.name, since: u.created, isOwner: isOwner(u), hasRecovery: !!(u.recovery || u.has_recovery), isAdmin: isAdmin(u) };
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
const MAX_STREAMS_PER_USER = 8;

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
  // At the limit, let go of the oldest: it is usually a phone that lost its network or a page left behind.
  if (set && set.size >= MAX_STREAMS_PER_USER) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    oldest.end();
  }
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

// ---------- usage counts ----------
// How many people use what, for the owner. Totals only.
//  - To count each person once a week, a marker is kept: a scramble of the person and the thing, with a secret that
//    changes weekly. Markers for different things cannot be linked, and markers and secret are deleted after the week.
//  - The owner's own use is not counted, nor anyone whose browser sends Do Not Track or Global Privacy Control.
//  - Wellbeing is never counted. Counts of 1 to 4 people are only ever given as "under 5".
const USAGE_VIEWS = ['feed', 'chat', 'fun', 'jobs', 'tracker', 'routine', 'tools', 'resume', 'cover', 'prep', 'interview', 'salary', 'learn', 'buddy', 'people', 'milestones', 'review'];
const USAGE_DID = ['post', 'room', 'dm', 'referral', 'checkin'];
const USAGE_METRICS = ['active', ...USAGE_VIEWS.map((x) => 'v:' + x), ...USAGE_DID.map((x) => 'a:' + x)];
const USAGE_FEW = 5;
const usageDay = () => dayKey(process.env.USAGE_TEST_CLOCK ? new Date(Number(fs.readFileSync(process.env.USAGE_TEST_CLOCK, 'utf8'))) : undefined);
const weekOf = (day) => shiftDay(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7)); // its Monday
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const usageOptOut = (req) => req.headers['sec-gpc'] === '1' || req.headers.dnt === '1';
let usageSecret = { week: '', value: '' }, usageKnown = new Set();

async function usageSecretFor(week) {
  if (usageSecret.week === week) return usageSecret.value;
  await foldUsage(week);
  await q.addSetting.run('usage_secret:' + week, crypto.randomBytes(32).toString('hex'));
  usageSecret = { week, value: (await q.setting.get('usage_secret:' + week)).value };
  usageKnown = new Set();
  return usageSecret.value;
}
const usageMark = (secret, metric, userId) => crypto.createHmac('sha256', secret).update(metric + ':' + userId).digest('hex').slice(0, 32);
// Weeks that are over become plain totals; their markers and secret are deleted.
async function foldUsage(week) {
  await q.foldWeeks.run(week);
  await exec('DELETE FROM usage_marks WHERE week < ?', [week]);
  await exec("DELETE FROM settings WHERE key LIKE 'usage_secret:%' AND key < ?", ['usage_secret:' + week]);
}
async function mark(user, metric) {
  const week = weekOf(usageDay()), secret = await usageSecretFor(week), known = metric + ':' + user.id;
  if (usageKnown.has(known)) return;
  await q.addMark.run(week, metric, usageMark(secret, metric, user.id));
  if (usageKnown.size < 50000) usageKnown.add(known);
}
// Something they did. Never slows the request down or makes it fail.
function did(req, user, what) {
  if (isOwner(user) || usageOptOut(req)) return;
  mark(user, 'a:' + what).catch((e) => console.error('Usage count failed: ' + e.message));
}
async function opened(user, view) {
  const today = usageDay(), row = await q.lastDay.get(user.id);
  if (row && row.last_day !== today && (await q.setLastDay.run(today, user.id, row.last_day)).changes) {
    await q.bumpDay.run(today);
    // First visit in a new 7-day stretch since joining: count it as having come back.
    const joined = dayKey(new Date(row.created)), k = Math.floor(daysBetween(joined, today) / 7);
    const before = row.last_day ? Math.floor(daysBetween(joined, row.last_day) / 7) : 0;
    if (k >= 1 && k <= 8 && k > before) await q.bumpWeek.run(weekOf(joined), 'back' + k);
  }
  await mark(user, 'active');
  if (USAGE_VIEWS.includes(view)) await mark(user, 'v:' + view);
}
async function forgetUsage(userId) {
  const week = weekOf(usageDay()), secret = await usageSecretFor(week);
  for (const m of USAGE_METRICS) await exec('DELETE FROM usage_marks WHERE week = ? AND metric = ? AND mark = ?', [week, m, usageMark(secret, m, userId)]);
  for (const m of USAGE_METRICS) usageKnown.delete(m + ':' + userId);
}
async function usageReport() {
  const today = usageDay(), week = weekOf(today);
  await foldUsage(week);
  if (!(await q.setting.get('usage_from'))) await q.addSetting.run('usage_from', today);
  const from = (await q.setting.get('usage_from')).value;
  const totals = {};
  for (const x of (await exec('SELECT week, metric, n FROM usage_weeks')).rows) (totals[x.week] = totals[x.week] || {})[x.metric] = x.n;
  for (const x of (await exec('SELECT metric, COUNT(*) AS n FROM usage_marks WHERE week = ? GROUP BY metric', [week])).rows) (totals[week] = totals[week] || {})[x.metric] = x.n;
  const get = (w, m) => (totals[w] && totals[w][m]) || 0;
  const people = (await exec('SELECT username, created, banned FROM users')).rows.filter((u) => u.username !== OWNER);
  const joined = {};
  for (const u of people) { const w = weekOf(dayKey(new Date(u.created))); joined[w] = (joined[w] || 0) + 1; }
  const few = (x) => (x > 0 && x < USAGE_FEW ? { few: true } : { n: x });
  const last = shiftDay(week, -7), counted = (w) => shiftDay(w, 6) >= from;
  const byDay = {};
  for (const x of (await exec('SELECT day, n FROM usage_days WHERE day > ?', [shiftDay(today, -28)])).rows) byDay[x.day] = x.n;
  const weeks = [];
  for (let i = 0; i < 8; i++) {
    const w = shiftDay(week, -7 * i);
    // "Came back" = opened it 8 to 14 days after joining. Known for everyone in a week only once 13 + 6 days have passed.
    weeks.push({ week: w, joined: joined[w] || 0, active: counted(w) ? get(w, 'active') : null, back: w >= weekOf(from) && shiftDay(w, 7) <= today ? get(w, 'back1') : null, final: shiftDay(w, 6 + 14) <= today });
  }
  const line = (key) => ({ key, now: few(get(week, key)), before: counted(last) ? few(get(last, key)) : null });
  return {
    from, week, few: USAGE_FEW, members: people.filter((u) => !u.banned).length, joinedNow: joined[week] || 0, activeNow: get(week, 'active'),
    days: Array.from({ length: 28 }, (_, i) => { const day = shiftDay(today, i - 27); return { day, n: day >= from ? byDay[day] || 0 : null }; }),
    weeks, did: USAGE_DID.map((x) => line('a:' + x)), views: USAGE_VIEWS.map((x) => line('v:' + x)),
    notify: few((await exec('SELECT COUNT(DISTINCT user_id) AS n FROM push_subs')).rows[0].n)
  };
}
async function usageApi(req, res, route, user) {
  if (req.method === 'POST' && route === '/usage') {
    limit('usage:' + user.id, 120, 10 * 60000);
    const b = await readBody(req);
    if (!isOwner(user) && !usageOptOut(req)) await opened(user, String(b.view || '')).catch((e) => console.error('Usage count failed: ' + e.message));
    send(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && route === '/usage') {
    if (!isOwner(user)) throw new HttpError(403, 'Only the site owner can see this.');
    limit('usageread:' + user.id, 60, 60000);
    send(res, 200, await usageReport());
    return true;
  }
  return false;
}

// ---------- read receipts (private chats) ----------
// Both people must have said yes. Referral requests are "quiet": they never show Seen, so helpers are not pressured.
let receiptsFrom = 0; // messages up to this one are from before receipts existed
async function loadReceiptsStart() {
  if (!(await q.setting.get('receipts_from'))) await q.addSetting.run('receipts_from', String((await q.newestMsg.get()).id || 0));
  receiptsFrom = Number((await q.setting.get('receipts_from')).value) || 0;
}
async function receiptsOf(userId) {
  const row = await q.receipts.get(userId);
  return { asked: !!row, on: !!row && !!row.is_on };
}
// The newest message of `mine` that `reader` has read and that `mine` may know about; 0 if none.
async function seenBy(mine, reader) {
  const key = dmKey(mine, reader), read = await q.dmRead.get(reader, key);
  if (!read || !(await receiptsOf(mine)).on || !(await receiptsOf(reader)).on) return 0;
  if ((await q.isBlocked.get(mine, reader)) || (await q.isBlocked.get(reader, mine))) return 0;
  return (await q.newestSeen.get('dm:' + key, mine, receiptsFrom, read.last_id)).id || 0;
}
function pushSeen(toId, readerName, id) { push(toId, { type: 'seen', channel: 'dm:' + readerName, id }); }
async function markRead(user, peer, id) {
  if (!(await receiptsOf(user.id)).on) return;
  const key = dmKey(user.id, peer.id), dm = await q.dm.get(key);
  if (!dm) return;
  const before = await seenBy(peer.id, user.id);
  await q.saveDmRead.run(user.id, key, Math.min(id, dm.last_id));
  const now = await seenBy(peer.id, user.id);
  if (now > before) pushSeen(peer.id, user.username, now);
}
async function setReceipts(user, on) {
  await q.saveReceipts.run(user.id, on ? 1 : 0);
  if (!on) {
    await q.dropDmReads.run(user.id); // forget it, not just hide it
    for (const d of await q.dmKeysOf.all(user.id, user.id)) {
      const other = d.key.split(':').map(Number).find((x) => x !== user.id);
      pushSeen(other, user.username, 0);
    }
  }
  push(user.id, { type: 'receipts', channel: 'receipts', asked: true, on });
}

// ---------- phone notifications ----------
// What is sent never includes message text, job titles or company names: it may appear on a lock screen.
const PUSH_KINDS = ['dm', 'buddy', 'due', 'interview', 'weekly', 'mod'];
const PUSH_OPT_IN = new Set(['weekly']); // off until the member turns it on; the rest start on
const PUSH_DEVICES = 6;
const BUDDY_PUSH = {
  request: 'would like to be your accountability buddy.', accepted: 'said yes. You are buddies now.', checkin: 'checked in for today.',
  done: 'finished today\'s plan.', cheer: 'cheered you on.', nudge: 'is nudging you to check in.'
};
// Tests only: send to a stand-in push service, with a pretend clock. Never set on the live site.
const PUSH_TEST_ORIGIN = process.env.PUSH_TEST_ORIGIN || '';
const pushNow = () => (PUSH_TEST_ORIGIN && process.env.PUSH_TEST_CLOCK ? Number(fs.readFileSync(process.env.PUSH_TEST_CLOCK, 'utf8')) : Date.now());
const pushContact = /^https:\/\//.test(process.env.RENDER_EXTERNAL_URL || '') ? process.env.RENDER_EXTERNAL_URL : 'https://the-bench-xcss.onrender.com';
let siteKey = null;

// Made once, the first time the server starts, and kept in the database.
async function loadSiteKey() {
  if (!(await q.setting.get('push_key'))) await q.addSetting.run('push_key', JSON.stringify(webpush.newSiteKey()));
  siteKey = JSON.parse((await q.setting.get('push_key')).value);
}
const lately = new Map();
function once(key, ms) { // true the first time, then false until ms have passed
  const now = Date.now();
  if (lately.get(key) > now) return false;
  if (lately.size > 5000) for (const [k, until] of lately) if (until < now) lately.delete(k);
  lately.set(key, now + ms);
  return true;
}
async function claim(userId, key) { return (await q.claimSent.run(userId, key, Date.now())).changes > 0; }
function cleanPrefs(raw, admin) {
  const out = {};
  for (const k of PUSH_KINDS) if (k !== 'mod' || admin) out[k] = PUSH_OPT_IN.has(k) ? !!(raw && raw[k] === true) : !(raw && raw[k] === false);
  return out;
}
// Sunday evening, India time: a nudge to look back at the week. It says nothing about what is in it.
async function weeklyNudge(userId) {
  const now = webpush.ist(pushNow());
  if (new Date(now.day + 'T00:00:00Z').getUTCDay() !== 0 || now.time < '18:00' || now.time >= '21:00') return;
  const key = 'wk:' + now.day;
  if (!(await claim(userId, key))) return;
  const how = await notify(userId, 'weekly', { title: 'The Bench', body: 'Your week in review is ready. Take two minutes to look back and plan next week.', url: '/#/review', tag: 'weekly', ttl: 3 * 3600 });
  if (!how.sent && how.failed) await q.unclaimSent.run(userId, key); // try again next time
}
async function prefsForPush(userId) {
  const row = await q.pushPrefs.get(userId);
  return cleanPrefs(row ? parseData(row.data) : null, true);
}
async function deliver(sub, msg) {
  if (!webpush.goodEndpoint(sub.endpoint, PUSH_TEST_ORIGIN)) { await q.delPushSub.run(sub.endpoint); return 'gone'; }
  let status = 0;
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: webpush.authorization(sub.endpoint, siteKey, pushContact), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(msg.ttl || 3600), Urgency: msg.urgent ? 'high' : 'normal', Topic: sha(msg.tag).slice(0, 30)
      },
      body: webpush.encrypt(JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag }), sub.p256dh, sub.auth)
    });
    status = res.status;
    if (res.body) res.body.cancel().catch(() => {});
  } catch (e) { /* could not reach the push service */ }
  if (status >= 200 && status < 300) { await q.okPushSub.run(sub.endpoint); return 'sent'; }
  if (status === 404 || status === 410) { await q.delPushSub.run(sub.endpoint); return 'gone'; } // turned off in the browser
  if (status !== 429 && status < 500 && status) console.error('Push service said HTTP ' + status);
  if (sub.fails >= 9) await q.delPushSub.run(sub.endpoint); else await q.failPushSub.run(sub.endpoint);
  return 'failed';
}
// Never throws and never holds anything up. Resolves to how it went.
async function notify(userId, kind, msg) {
  const out = { sent: 0, failed: 0, gone: 0 };
  try {
    if (!siteKey) return out;
    const subs = await q.pushSubs.all(Date.now(), userId);
    if (!subs.length || (kind && !(await prefsForPush(userId))[kind])) return out;
    msg = Object.assign({}, msg, { title: String(msg.title).slice(0, 60), body: String(msg.body).slice(0, 160) });
    for (const how of await Promise.all(subs.map((s) => deliver(s, msg)))) out[how]++;
  } catch (e) { console.error('Notification failed: ' + e.message); }
  return out;
}

// Every few minutes: anyone with an interview or follow-up coming due?
const trackerDates = new Map(); // user id -> { rev, items }, so unchanged trackers are not read again
let pushTicking = false;
async function pushTick() {
  if (pushTicking || !siteKey) return;
  pushTicking = true;
  try {
    const people = await q.pushPeople.all(Date.now());
    for (const id of trackerDates.keys()) if (!people.some((p) => p.id === id)) trackerDates.delete(id);
    for (const p of people) {
      const prefs = await prefsForPush(p.id);
      if (prefs.weekly) await weeklyNudge(p.id);
      if (!prefs.due && !prefs.interview) continue;
      let known = trackerDates.get(p.id);
      if (!known || known.rev !== p.data_rev) {
        const row = await q.dataOf.get(p.id);
        known = { rev: row.data_rev, items: webpush.datesOf(parseData(row.data)) };
        trackerDates.set(p.id, known);
      }
      for (const d of webpush.dueNow(known.items, pushNow(), prefs)) {
        const mine = [];
        let text = d.text;
        if (d.digest) {
          const fresh = [];
          for (const x of d.digest) if (await claim(p.id, x.key)) { fresh.push(x); mine.push(x.key); }
          if (!fresh.length) continue;
          text = webpush.digestText(fresh);
        } else {
          if (!(await claim(p.id, d.keys[0]))) continue;
          mine.push(d.keys[0]);
          for (const k of d.keys.slice(1)) if (await claim(p.id, k)) mine.push(k);
        }
        const how = await notify(p.id, d.urgent ? 'interview' : null, { title: 'The Bench', body: text, url: '/#/tracker', tag: d.tag, ttl: d.urgent ? 3600 : 21600, urgent: d.urgent });
        if (!how.sent && how.failed) for (const k of mine) await q.unclaimSent.run(p.id, k); // try again next time
      }
    }
    if (once('usage-tidy', 3600000)) await foldUsage(weekOf(usageDay()));
    if (once('push-tidy', 6 * 3600000)) {
      await exec('DELETE FROM push_sent WHERE created < ?', [Date.now() - 14 * 864e5]);
      await exec('DELETE FROM push_subs WHERE session NOT IN (SELECT token_hash FROM sessions WHERE expires > ?)', [Date.now()]);
    }
  } catch (e) { console.error('Reminder check failed: ' + e.message); }
  pushTicking = false;
}
function startPushTimer() {
  const every = PUSH_TEST_ORIGIN && process.env.PUSH_TICK_MS ? Number(process.env.PUSH_TICK_MS) : 5 * 60000;
  setInterval(pushTick, every).unref();
  setTimeout(pushTick, Math.min(every, 30000)).unref();
}

async function pushApi(req, res, route, user) {
  const method = req.method;
  if (!/^\/push(\/|$)/.test(route)) return false;
  const admin = isAdmin(user);

  if (method === 'GET' && route === '/push') {
    const row = await q.pushPrefs.get(user.id);
    send(res, 200, { key: siteKey ? siteKey.pub : '', prefs: cleanPrefs(row ? parseData(row.data) : null, admin), devices: (await q.pushSubs.all(Date.now(), user.id)).length });
    return true;
  }
  if (method === 'POST' && route === '/push/on') {
    limit('push:' + user.id, 60, 10 * 60000);
    const b = await readBody(req), keys = b.keys || {};
    if (!webpush.goodEndpoint(b.endpoint, PUSH_TEST_ORIGIN)) throw new HttpError(400, 'This browser\'s notification service is not supported.');
    if (!webpush.goodKeys(keys.p256dh, keys.auth)) throw new HttpError(400, 'Those notification keys are not valid.');
    await q.savePushSub.run(b.endpoint, user.id, keys.p256dh, keys.auth, sha(tokenOf(req)), Date.now());
    const mine = await q.pushSubs.all(Date.now(), user.id);
    for (const old of mine.slice(0, Math.max(0, mine.length - PUSH_DEVICES))) if (old.endpoint !== b.endpoint) await q.delPushSub.run(old.endpoint);
    send(res, 200, { ok: true });
    return true;
  }
  if (method === 'POST' && route === '/push/off') {
    const b = await readBody(req);
    await q.delMyPushSub.run(String(b.endpoint || ''), user.id);
    send(res, 200, { ok: true });
    return true;
  }
  if (method === 'PUT' && route === '/push/prefs') {
    limit('push:' + user.id, 60, 10 * 60000);
    const prefs = cleanPrefs(await readBody(req), admin);
    await q.savePushPrefs.run(user.id, JSON.stringify(prefs));
    send(res, 200, { prefs });
    return true;
  }
  if (method === 'POST' && route === '/push/test') {
    limit('pushtest:' + user.id, 6, 10 * 60000);
    const b = await readBody(req);
    const sub = (await q.pushSubs.all(Date.now(), user.id)).find((s) => s.endpoint === b.endpoint);
    if (!sub) throw new HttpError(404, 'Notifications are not on for this device. Turn them on first.');
    const how = await deliver(sub, { title: 'The Bench', body: 'Notifications are working on this device.', url: '/#/account', tag: 'test', ttl: 300, urgent: true });
    if (how !== 'sent') throw new HttpError(502, how === 'gone' ? 'This device is no longer registered. Turn notifications off and on again.' : 'The notification service did not accept it. Try again in a minute.');
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}

// ---------- deleting an account ----------
// [name in the file, query, how many times the member's id appears]
const EXPORTS = [
  ['profile', 'SELECT data, updated FROM profiles WHERE user_id = ?', 1],
  ['posts', 'SELECT tag, text, created FROM posts WHERE user_id = ?', 1],
  ['replies', 'SELECT post_id, text, created FROM replies WHERE user_id = ?', 1],
  ['messages', "SELECT channel, text, created FROM messages WHERE user_id = ? AND deleted = 0 AND (channel LIKE 'room:%' OR channel LIKE 'qotd:%' OR channel LIKE 'dm:%')", 1],
  ['jobLeads', 'SELECT title, company, location, url, note, created FROM job_leads WHERE user_id = ? AND deleted = 0', 1],
  ['referralOffers', 'SELECT company, kind, roles, note, open, created FROM referral_offers WHERE user_id = ? AND deleted = 0', 1],
  ['referralRequests', 'SELECT o.company, a.created FROM referral_asks a JOIN referral_offers o ON o.id = a.offer_id WHERE a.user_id = ?', 1],
  ['jobAlerts', 'SELECT what, place, remote, field, created FROM job_alerts WHERE user_id = ?', 1],
  ['buddySettings', 'SELECT seeking, goal, updated FROM buddy_prefs WHERE user_id = ?', 1],
  ['buddyRequestsSent', 'SELECT note, status, created FROM buddy_requests WHERE from_id = ?', 1],
  ['readReceiptSetting', 'SELECT is_on FROM receipts WHERE user_id = ?', 1],
  ['chatReactions', 'SELECT message_id, emoji FROM msg_reacts WHERE user_id = ?', 1],
  ['notificationSettings', 'SELECT data FROM push_prefs WHERE user_id = ?', 1],
  ['notificationDevices', 'SELECT created FROM push_subs WHERE user_id = ?', 1],
  ['checkins', 'SELECT day, plan, done, updated FROM checkins WHERE user_id = ?', 1],
  ['puzzles', 'SELECT day, guesses, solved, tries FROM puzzle_plays WHERE user_id = ?', 1],
  ['blocked', 'SELECT u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?', 1]
];
// Blank a message, unless an open report still needs it: then its text goes when a moderator closes the report.
const BLANK_MSG = "UPDATE messages SET deleted = 1, text = CASE WHEN EXISTS (SELECT 1 FROM reports r WHERE r.message_id = messages.id AND r.resolved = 0) THEN text ELSE '' END ";

// Turso does not cascade for us, so every table is listed. The account row goes last: if a step fails, the member
// can still log in and try again. It becomes an empty placeholder so its id is never handed to someone else.
async function deleteAccount(u) {
  const id = u.id;
  const pair = await q.activePair.get(id, id);
  if (pair) await endPairBetween(id, buddyPeer(pair, id));
  const gone = await q.recentMsgsOf.all(id);
  for (const d of await q.dmKeysOf.all(id, id)) {
    await exec(BLANK_MSG + 'WHERE channel = ?', ['dm:' + d.key]);
    await exec('DELETE FROM dm_reads WHERE key = ?', [d.key]);
  }
  await exec(BLANK_MSG + 'WHERE user_id = ?', [id]);
  await exec('DELETE FROM msg_reacts WHERE user_id = ? OR message_id IN (SELECT id FROM messages WHERE user_id = ?)', [id, id]);
  await exec('DELETE FROM dms WHERE a = ? OR b = ?', [id, id]);
  await exec('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [id, id]);
  await exec('DELETE FROM reports WHERE reporter_id = ? AND resolved = 1', [id]);
  await exec('DELETE FROM reactions WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)', [id, id]);
  await exec('DELETE FROM replies WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)', [id, id]);
  await exec('DELETE FROM posts WHERE user_id = ?', [id]);
  await exec('DELETE FROM lead_votes WHERE user_id = ?', [id]);
  await exec("UPDATE job_leads SET deleted = 1, title = '', company = '', location = '', url = '', note = '' WHERE user_id = ?", [id]);
  await exec('DELETE FROM referral_asks WHERE user_id = ? OR offer_id IN (SELECT id FROM referral_offers WHERE user_id = ?)', [id, id]);
  await exec("UPDATE referral_offers SET deleted = 1, company = '', roles = '', note = '' WHERE user_id = ?", [id]);
  await exec('DELETE FROM job_alerts WHERE user_id = ?', [id]);
  await exec('DELETE FROM buddy_prefs WHERE user_id = ?', [id]);
  await exec('DELETE FROM buddy_requests WHERE from_id = ? OR to_id = ?', [id, id]);
  await exec('DELETE FROM buddy_pairs WHERE a = ? OR b = ?', [id, id]);
  await exec('DELETE FROM checkins WHERE user_id = ?', [id]);
  await exec('DELETE FROM puzzle_plays WHERE user_id = ?', [id]);
  await exec('DELETE FROM profiles WHERE user_id = ?', [id]);
  for (const t of ['push_subs', 'push_prefs', 'push_sent', 'receipts', 'dm_reads']) await exec('DELETE FROM ' + t + ' WHERE user_id = ?', [id]);
  trackerDates.delete(id);
  await forgetUsage(id);
  await q.emptyUser.run('~' + id, crypto.randomBytes(64).toString('hex'), crypto.randomBytes(16).toString('hex'), id);
  await q.dropUserSessions.run(id);
  closeStreams(id);
  for (const m of gone) pushAll({ type: 'del', channel: m.channel, id: m.id });
}

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
    const created = Date.now();
    try { info = await q.addUser.run(username, name, pass, salt, recoveryHash(recoveryCode), created); }
    catch (e) { throw new HttpError(409, 'That username is taken.'); }
    return send(res, 201, { user: publicUser({ username, name, recovery: 'set', created }), data: {}, rev: 0, recoveryCode },
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
    return send(res, 200, { user: Object.assign(publicUser(u), await profileFlags(u.id)), data: parseData(u.data), rev: u.data_rev }, { 'Set-Cookie': await startSession(u.id) });
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
    return send(res, 200, { user: Object.assign(publicUser(u), { hasRecovery: true }), data: parseData(u.data), rev: u.data_rev, recoveryCode },
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
  // Members who keep coming back stay signed in: the 30 days start again (at most once a day), on the server and in the browser.
  if (Number(user.session_expires) - Date.now() < (SESSION_DAYS - 1) * 864e5) {
    const t = tokenOf(req);
    await q.renewSession.run(Date.now() + SESSION_DAYS * 864e5, sha(t));
    res.setHeader('Set-Cookie', cookie(t, SESSION_DAYS * 86400));
  }

  if (method === 'GET' && route === '/me') {
    return send(res, 200, { user: Object.assign(publicUser(user), await profileFlags(user.id)), data: parseData(user.data), rev: user.data_rev });
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

  // Everything we hold about this member, as one file.
  if (method === 'GET' && route === '/me/export') {
    limit('export:' + user.id, 10, 60 * 60000);
    const full = await q.userById.get(user.id);
    const out = {
      exported: new Date().toISOString(),
      account: { username: full.username, name: full.name, joined: new Date(full.created).toISOString(), lastOpened: full.last_day || null },
      private: parseData(full.data)
    };
    for (const [name, sql, args] of EXPORTS) {
      out[name] = (await exec(sql, Array(args).fill(user.id))).rows;
    }
    return send(res, 200, out);
  }

  if (method === 'POST' && route === '/me/delete') {
    limit('account:' + user.id, 10, 10 * 60000);
    const b = await readBody(req);
    const full = await q.userById.get(user.id);
    if (!(await checkPassword(full, b.password))) throw new HttpError(401, 'Your current password is not right.');
    if (String(b.confirm || '').trim().toLowerCase() !== full.username) throw new HttpError(400, 'Type your username to confirm.');
    // A freed moderator username could be registered by anyone, who would then be a moderator.
    if (isAdmin(full)) throw new HttpError(400, 'Moderators must be removed from the moderator list before deleting their account.');
    await deleteAccount(full);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }

  if (method === 'GET' && route === '/me/data') {
    return send(res, 200, { data: parseData(user.data), rev: user.data_rev });
  }

  // If-Match carries the version the save was based on. If someone saved since (another device or tab), nothing is
  // written: the newer copy goes back (409) so the app can merge and try again.
  if (method === 'PUT' && route === '/me/data') {
    const b = await readBody(req, MAX_DATA * 2, DATA_TOO_BIG); // bytes: text in Indian scripts takes up to 3 bytes a letter
    const json = JSON.stringify(b);
    if (json.length > MAX_DATA) throw new HttpError(413, DATA_TOO_BIG);
    const m = /^"?(\d{1,15})"?$/.exec(String(req.headers['if-match'] || ''));
    const done = m ? await q.saveDataAt.run(json, user.id, Number(m[1])) : await q.saveData.run(json, user.id);
    const now = await q.dataOf.get(user.id);
    if (m && !done.changes) return send(res, 409, { error: 'Your data changed on another device.', data: parseData(now.data), rev: now.data_rev });
    const rev = m ? Number(m[1]) + 1 : now.data_rev;
    push(user.id, { type: 'data', channel: 'data', rev });
    return send(res, 200, { ok: true, rev });
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
    did(req, user, 'post');
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
  if (await referralApi(req, res, route, user)) return;
  if (await buddyApi(req, res, route, user)) return;
  if (await pushApi(req, res, route, user)) return;
  if (await usageApi(req, res, route, user)) return;
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
const webpush = require('./push.js');
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
    field: field === 'nontech' || Object.hasOwn(FIELD_LABEL, field) ? field : '' // never "constructor" and the like
  };
}

// Returns the matches before the field filter (for the field counts) and the final list.
function searchJobs(f) {
  const words = f.what.split(' ').filter(Boolean);
  const matches = jobsStore.jobs.filter((j) => {
    if (f.remote && !j.remote) return false;
    const loc = j.location.toLowerCase();
    const alias = Object.hasOwn(CITY_ALIASES, f.where) ? CITY_ALIASES[f.where] : '';
    if (f.where && !loc.includes(f.where) && !(alias && loc.includes(alias))) return false;
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
      await tellModerators(true);
      send(res, 201, { ok: true });
      return true;
    }
  }

  return false;
}

// ---------- referral board ----------
// Members say where they can refer people (or know people). Asking sends the offerer a private message.
const REF_KINDS = ['refer', 'contact'];
const MAX_REF_OFFERS = 8;
const REF_ASK_DAYS = 30;
// Referrals here are favours between members. Anything that smells of charging for one is refused.
const PAID_REFERRAL = /(₹|\brs\.?\s*\d|\binr\s*\d|\bfees?\b|\bcharges?\b|\bpaid referral|\bpay (me|us|first|upfront|for|before))/i;

function refView(r, me) {
  return {
    id: r.id, company: r.company, kind: r.kind, roles: r.roles, note: r.note, open: !!r.open, t: r.updated,
    name: r.name, username: r.username, own: r.user_id === me.id, asks: r.asks || 0, myAsk: r.my_ask || null
  };
}

async function referralApi(req, res, route, user) {
  const method = req.method;
  let m;

  if (method === 'GET' && route === '/referrals') {
    const rows = await q.refOffers.all(Date.now() - REF_ASK_DAYS * 864e5, user.id, user.id, user.id);
    send(res, 200, { offers: rows.map((r) => refView(r, user)), maxOffers: MAX_REF_OFFERS, askDays: REF_ASK_DAYS });
    return true;
  }

  if (method === 'POST' && route === '/referrals') {
    limit('write:' + user.id, 20, 60000);
    const b = await readBody(req);
    const company = line(b.company, 60, 'Company');
    if (!company) throw new HttpError(400, 'Which company can you help with?');
    const kind = REF_KINDS.includes(b.kind) ? b.kind : 'refer';
    const roles = line(b.roles, 120, 'Roles');
    const note = line(b.note, 280, 'Note');
    if (PAID_REFERRAL.test(company + ' ' + roles + ' ' + note)) {
      throw new HttpError(400, 'Referrals on The Bench are always free. Please remove anything about fees or payment.');
    }
    const mine = await q.refOffersOf.all(user.id);
    if (mine.some((o) => o.company.toLowerCase() === company.toLowerCase())) throw new HttpError(409, 'You already have an offer for ' + company + '.');
    if (mine.length >= MAX_REF_OFFERS) throw new HttpError(400, 'You can list up to ' + MAX_REF_OFFERS + ' companies. Remove one to add another.');
    const t = Date.now();
    await q.addRefOffer.run(user.id, company, kind, roles, note, t, t);
    did(req, user, 'referral');
    send(res, 201, { ok: true });
    return true;
  }

  if ((m = /^\/referrals\/(\d{1,15})(\/ask|\/report|\/open)?$/.exec(route))) {
    const offer = await q.refOffer.get(Number(m[1]));
    if (!offer || offer.deleted) throw new HttpError(404, 'That offer is gone.');

    if (method === 'POST' && m[2] === '/open') {
      if (offer.user_id !== user.id) throw new HttpError(403, 'Only the person who listed it can change it.');
      const b = await readBody(req);
      await q.setRefOpen.run(b.open ? 1 : 0, Date.now(), offer.id);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'DELETE' && !m[2]) {
      if (offer.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'You can only remove your own offers.');
      await q.delRefOffer.run(offer.id);
      send(res, 200, { ok: true });
      return true;
    }

    if (method === 'POST' && m[2] === '/ask') {
      if (offer.user_id === user.id) throw new HttpError(400, 'That is your own offer.');
      if (!offer.open) throw new HttpError(400, 'This member has paused referrals for now.');
      const peer = await q.userById.get(offer.user_id);
      if (!peer || peer.banned) throw new HttpError(404, 'That offer is gone.');
      const prev = await q.refAsk.get(offer.id, user.id);
      if (prev && prev.created > Date.now() - REF_ASK_DAYS * 864e5) {
        throw new HttpError(409, 'You already asked about ' + offer.company + ' recently. Carry on the conversation in your messages.');
      }
      limit('refask:' + user.id, 10, 864e5);
      const b = await readBody(req);
      const role = line(b.role, 100, 'Role');
      if (!role) throw new HttpError(400, 'Which role are you asking about?');
      const url = b.url ? leadUrl(b.url) : '';
      const message = text(b.message, 700, 'Message');
      const body = 'Referral request for ' + offer.company + ': ' + role + (url ? '\n' + url : '') + '\n\n' + message + '\n\n(Sent from the Referral board)';
      await sendDm(user, peer, body, true);
      await q.saveRefAsk.run(offer.id, user.id, Date.now());
      did(req, user, 'referral');
      send(res, 201, { ok: true, username: peer.username });
      return true;
    }

    if (method === 'POST' && m[2] === '/report') {
      limit('report:' + user.id, 20, 60 * 60000);
      if (offer.user_id === user.id) throw new HttpError(400, 'You cannot report your own offer.');
      const b = await readBody(req);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      const snapshot = [(offer.kind === 'refer' ? 'Can refer at ' : 'Knows people at ') + offer.company, offer.roles, offer.note].filter(Boolean).join('\n');
      const info = await q.addMsg.run('ref:' + offer.id, offer.user_id, snapshot, Date.now());
      await q.addReport.run(info.lastId, user.id, reason, Date.now());
      await tellModerators(true);
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
// What the app needs about your own profile when you sign in: whether it is filled in, and your avatar colour.
async function profileFlags(userId) {
  const p = readProfile(await q.profile.get(userId));
  return { profileDone: !isEmptyProfile(p), color: p.color };
}

async function profileApi(req, res, route, user) {
  const method = req.method;
  let m;

  if (method === 'GET' && route === '/people') {
    const people = (await q.people.all()).map((r) => {
      const p = readProfile(r);
      return { username: r.username, name: r.name, joined: r.created, headline: p.headline, location: p.location,
        status: p.status, color: p.color, skills: p.skills, me: r.username === user.username, seeking: !!r.seeking };
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
        stats: { posts: s.posts, answers: s.answers, solved: s.solved },
        buddy: Object.assign(await prefsOf(u.id), { paired: !!(await currentPair(u.id)) }),
        referrals: (await q.refOffersOf.all(u.id)).filter((o) => o.open).map((o) => ({ company: o.company, kind: o.kind }))
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
      await tellModerators(true);
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
// A short, one-line copy of a message, shown above a reply to it.
function snippet(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim(), a = Array.from(s);
  return a.length > 140 ? a.slice(0, 140).join('') + '…' : s;
}
function replyView(m) {
  if (!m.reply_to) return undefined;
  if (m.r_username == null || m.r_deleted) return { id: m.reply_to, gone: true };
  if (m.r_banned || m.r_blocked) return { id: m.reply_to, hidden: true };
  return { id: m.reply_to, name: m.r_name, username: m.r_username, text: snippet(m.r_text) };
}
function wire(m, reacts) {
  const o = { id: m.id, text: m.text, t: m.created, name: m.name, username: m.username };
  if (m.edited) o.edited = m.edited;
  const reply = replyView(m);
  if (reply) o.reply = reply;
  const x = reacts && reacts.get(m.id);
  if (x) { o.reacts = x.reacts; o.mine = x.mine; }
  return o;
}
// One page of a chat, newest last. `blocker` hides people the viewer blocked (0 in private chats: both see everything).
async function chatPage(channel, req, user, blocker) {
  const rows = await q.history.all(blocker, channel, beforeParam(req), blocker);
  const reacts = new Map();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    for (const r of await q.chatReacts.all(user.id, channel, Math.min(...ids), Math.max(...ids))) {
      const x = reacts.get(r.message_id) || { reacts: {}, mine: {} };
      x.reacts[r.emoji] = Number(r.n);
      if (Number(r.mine)) x.mine[r.emoji] = true;
      reacts.set(r.message_id, x);
    }
  }
  return { messages: rows.reverse().map((m) => wire(m, reacts)), more: rows.length === 50 };
}
// The message a new one replies to: it must still be there, in the same chat, from someone the sender can see.
async function replyTarget(channel, id, user) {
  if (id === undefined || id === null || id === 0) return null;
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Which message are you replying to?');
  const t = await q.replyTo.get(id);
  // (private chats check blocks when the message is sent)
  if (!t || t.deleted || t.channel !== channel || t.banned || (channel.startsWith('room:') && (await q.isBlocked.get(user.id, t.user_id)))) {
    throw new HttpError(404, 'The message you replied to is no longer there.');
  }
  return { authorId: t.user_id, view: { id: t.id, name: t.name, username: t.username, text: snippet(t.text) } };
}
// Send a room event to everyone, except people who blocked `authorId`. People who blocked the author of the
// message being answered get it without the quoted words.
async function roomPush(ev, authorId, reply) {
  const skip = new Set((await q.blockersOf.all(authorId)).map((r) => r.blocker_id));
  const hide = reply && reply.authorId !== authorId ? (await q.blockersOf.all(reply.authorId)).map((r) => r.blocker_id).filter((id) => !skip.has(id)) : [];
  for (const id of hide) skip.add(id);
  pushAll(ev, skip);
  if (hide.length) {
    const quiet = Object.assign({}, ev, { msg: Object.assign({}, ev.msg, { reply: { id: reply.view.id, hidden: true } }) });
    for (const id of hide) push(id, quiet);
  }
}
// Tell both people in a private chat, each under the other person's name.
async function dmPush(channel, ev) {
  const [a, b] = channel.slice(3).split(':').map(Number);
  const ua = await q.userById.get(a), ub = await q.userById.get(b);
  if (!ua || !ub) return;
  push(a, Object.assign({}, ev, { channel: 'dm:' + ub.username }));
  push(b, Object.assign({}, ev, { channel: 'dm:' + ua.username }));
}
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
const isPublicChannel = (channel) => /^(room|qotd|profile|lead|ref):/.test(channel);
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
  await q.delMsgReacts.run(m.id);
  // Removing a reported profile snapshot clears that member's profile (their name and account stay).
  if (m.channel.startsWith('profile:')) await q.clearProfile.run(m.user_id);
  else if (m.channel.startsWith('lead:')) await q.delLead.run(Number(m.channel.slice(5)));
  else if (m.channel.startsWith('ref:')) await q.delRefOffer.run(Number(m.channel.slice(4)));
  else await broadcastDelete(m.channel, m.id);
}

// Send a private message (checks blocks and the new-conversations limit). Used by chat and by referral requests.
async function sendDm(user, peer, body, quiet, reply) {
  const key = dmKey(user.id, peer.id);
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
  const info = await q.addDmMsg.run('dm:' + key, user.id, body, now, quiet ? 1 : 0, reply ? reply.view.id : 0);
  await q.touchDm.run(info.lastId, key);
  const msg = { id: info.lastId, text: body, t: now, name: user.name, username: user.username };
  if (reply) msg.reply = reply.view;
  push(peer.id, { type: 'msg', channel: 'dm:' + user.username, msg, peer: { username: user.username, name: user.name } });
  if (once('dm:' + user.id + ':' + peer.id, 60000)) notify(peer.id, 'dm', { title: user.name, body: 'Sent you a private message.', url: '/#/dm/' + user.username, tag: 'dm-' + user.username, ttl: 86400, urgent: true });
  push(user.id, { type: 'msg', channel: 'dm:' + peer.username, msg, peer: { username: peer.username, name: peer.name } });
  return msg;
}

// Keep every moderator's badge current. A problem here must never get in the way of reporting something.
async function tellModerators(isNew) {
  try {
    const open = (await q.openReportCount.get()).n;
    for (const name of ADMINS) {
      const u = await q.userByName.get(name);
      if (u) push(u.id, { type: 'reports', channel: 'reports', open });
      if (u && isNew && once('mod:' + u.id, 10 * 60000)) notify(u.id, 'mod', { title: 'New report', body: 'A member reported something.', url: '/#/admin', tag: 'mod', ttl: 86400 });
    }
  } catch (e) { console.error('Could not tell moderators: ' + e.message); }
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
    send(res, 200, { rooms: ROOMS.map((r) => ({ slug: r.slug, desc: r.desc, lastId: last['room:' + r.slug] || 0 })), dms, receipts: await receiptsOf(user.id) });
    return true;
  }

  if ((m = /^\/chat\/room\/([a-z-]{1,30})$/.exec(route))) {
    const slug = m[1];
    if (!ROOM_SLUGS.has(slug)) throw new HttpError(404, 'No such room.');
    const channel = 'room:' + slug;
    if (method === 'GET') {
      send(res, 200, await chatPage(channel, req, user, user.id));
      return true;
    }
    if (method === 'POST') {
      limit('chat:' + user.id, 20, 60000);
      const b = await readBody(req);
      const body = text(b.text, MSG_MAX, 'Message');
      const reply = await replyTarget(channel, b.replyTo, user);
      const now = Date.now();
      const info = await q.addChatMsg.run(channel, user.id, body, now, reply ? reply.view.id : 0);
      const msg = { id: info.lastId, text: body, t: now, name: user.name, username: user.username };
      if (reply) msg.reply = reply.view;
      await roomPush({ type: 'msg', channel, msg }, user.id, reply);
      did(req, user, 'room');
      send(res, 201, { msg });
      return true;
    }
  }

  if (method === 'PUT' && route === '/chat/receipts') {
    limit('receipts:' + user.id, 20, 10 * 60000);
    const b = await readBody(req);
    if (typeof b.on !== 'boolean') throw new HttpError(400, 'Say on or off.');
    await setReceipts(user, b.on);
    send(res, 200, { receipts: { asked: true, on: b.on } });
    return true;
  }
  if (method === 'POST' && (m = /^\/chat\/dm\/([a-z0-9_]{3,20})\/read$/.exec(route))) {
    limit('read:' + user.id, 240, 60000);
    const b = await readBody(req), peer = await peerByName(m[1], user);
    if (!Number.isSafeInteger(b.id) || b.id < 1) throw new HttpError(400, 'Which message?');
    await markRead(user, peer, b.id);
    send(res, 200, { ok: true });
    return true;
  }

  if ((m = /^\/chat\/dm\/([a-z0-9_]{3,20})$/.exec(route))) {
    const peer = await peerByName(m[1], user);
    const key = dmKey(user.id, peer.id);
    const channel = 'dm:' + key;
    if (method === 'GET') {
      send(res, 200, Object.assign(await chatPage(channel, req, user, 0), {
        peer: { username: peer.username, name: peer.name },
        blockedByMe: !!(await q.isBlocked.get(user.id, peer.id)),
        seen: await seenBy(user.id, peer.id)
      }));
      return true;
    }
    if (method === 'POST') {
      limit('chat:' + user.id, 20, 60000);
      const b = await readBody(req);
      const body = text(b.text, MSG_MAX, 'Message');
      const reply = await replyTarget(channel, b.replyTo, user);
      const msg = await sendDm(user, peer, body, false, reply);
      did(req, user, 'dm');
      send(res, 201, { msg });
      return true;
    }
  }

  if ((m = /^\/chat\/msg\/(\d{1,15})(\/report|\/react)?$/.exec(route))) {
    const msg = await q.msg.get(Number(m[1]));
    if (!msg || msg.deleted || !canSee(msg.channel, user.id)) throw new HttpError(404, 'That message is gone.');
    const inChat = /^(room|dm):/.test(msg.channel);
    // In a private chat, nobody can change anything once either person has blocked the other.
    const dmBlocked = async () => {
      if (!msg.channel.startsWith('dm:')) return false;
      const other = msg.channel.slice(3).split(':').map(Number).find((x) => x !== user.id);
      return !!((await q.isBlocked.get(user.id, other)) || (await q.isBlocked.get(other, user.id)));
    };

    if (method === 'DELETE' && !m[2]) {
      if (msg.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'You can only delete your own messages.');
      await removeMessage(msg);
      send(res, 200, { ok: true });
      return true;
    }
    if (method === 'PATCH' && !m[2]) {
      limit('edit:' + user.id, 30, 60000);
      if (msg.user_id !== user.id) throw new HttpError(403, 'You can only edit your own messages.');
      if (!inChat) throw new HttpError(400, 'This cannot be edited.');
      if (Date.now() - msg.created > EDIT_WINDOW) throw new HttpError(400, 'Messages can be edited for 24 hours after sending.');
      if (await dmBlocked()) throw new HttpError(403, 'You cannot change messages in this chat any more.');
      const b = await readBody(req);
      const body = text(b.text, MSG_MAX, 'Message');
      if (body === msg.text) { send(res, 200, { msg: { id: msg.id, text: body } }); return true; }
      const now = Date.now();
      await q.editMsg.run(body, now, msg.id);
      const ev = { type: 'edit', channel: msg.channel, id: msg.id, text: body, edited: now };
      if (msg.channel.startsWith('dm:')) await dmPush(msg.channel, ev);
      else pushAll(ev, new Set((await q.blockersOf.all(user.id)).map((r) => r.blocker_id)));
      send(res, 200, { msg: { id: msg.id, text: body, edited: now } });
      return true;
    }
    if (method === 'POST' && m[2] === '/react') {
      limit('react:' + user.id, 120, 60000);
      if (!inChat) throw new HttpError(400, 'Reactions are not available here.');
      const b = await readBody(req);
      if (!CHAT_REACTS.includes(b.r)) throw new HttpError(400, 'Unknown reaction.');
      if (await dmBlocked()) throw new HttpError(403, 'You cannot react in this chat any more.');
      const on = !(await q.hasMsgReact.get(msg.id, user.id, b.r));
      if (on) await q.addMsgReact.run(msg.id, user.id, b.r); else await q.delMsgReact.run(msg.id, user.id, b.r);
      const n = Number((await q.msgReactCount.get(msg.id, b.r)).n);
      // Only the count goes out, never who reacted.
      const ev = { type: 'react', channel: msg.channel, id: msg.id, emoji: b.r, n };
      if (msg.channel.startsWith('dm:')) await dmPush(msg.channel, ev); else pushAll(ev);
      send(res, 200, { id: msg.id, emoji: b.r, n, on });
      return true;
    }
    if (method === 'POST' && m[2] === '/report') {
      limit('report:' + user.id, 20, 60 * 60000);
      if (msg.user_id === user.id) throw new HttpError(400, 'You cannot report your own message.');
      const b = await readBody(req);
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
      await q.addMsgReport.run(msg.id, user.id, reason, Date.now(), msg.text);
      await tellModerators(true);
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
    if (method === 'POST') { await q.addBlock.run(user.id, peer.id, Date.now()); await endPairBetween(user.id, peer.id); pushSeen(peer.id, user.username, 0); pushSeen(user.id, peer.username, 0); }
    else await q.delBlock.run(user.id, peer.id);
    send(res, 200, { ok: true });
    return true;
  }

  // ----- moderators -----
  if (route.startsWith('/admin/')) {
    if (!isAdmin(user)) throw new HttpError(403, 'Moderators only.');

    if (method === 'GET' && route === '/admin/count') {
      send(res, 200, { open: (await q.openReportCount.get()).n });
      return true;
    }

    if (method === 'GET' && route === '/admin/reports') {
      const reports = (await q.openReports.all()).map((r) => ({
        id: r.id, reason: r.reason, t: r.created, messageId: r.message_id, text: r.text, deleted: !!r.deleted, editedSince: r.edited > r.created,
        where: r.channel.startsWith('room:') ? '#' + r.channel.slice(5)
          : r.channel.startsWith('qotd:') ? 'Question of the Day'
          : r.channel.startsWith('profile:') ? 'a profile'
          : r.channel.startsWith('lead:') ? 'a job lead'
          : r.channel.startsWith('ref:') ? 'a referral offer' : 'a private message',
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
      await tellModerators();
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

// ---------- accountability buddies ----------
// Opt in, get matched with one buddy, check in daily (plan + done), cheer and nudge each other.
// Plans are visible only to your buddy. Blocking or a ban ends a pairing.

const BUDDY_CHEERS = ['🙌', '💪', '🔥', '👏'];
const MAX_OUTGOING_REQUESTS = 3;
const SILENT_DAYS = 5;
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

async function prefsOf(userId) {
  const p = await q.buddyPrefs.get(userId);
  return { seeking: !!(p && p.seeking), goal: (p && p.goal) || '' };
}
function buddyPeer(pair, userId) { return pair.a === userId ? pair.b : pair.a; }
function pushBuddy(userId, kind, from) {
  push(userId, { type: 'buddy', channel: 'buddy', kind, from });
  const text = BUDDY_PUSH[kind];
  if (!text) return;
  // The same thing from the same person at most once a day, however often it happens.
  claim(userId, 'b:' + kind + ':' + from + ':' + dayKey()).then((first) => first && notify(userId, 'buddy', { title: 'Your buddy', body: from + ' ' + text, url: '/#/buddy', tag: 'buddy-' + kind, ttl: 43200 }))
    .catch((e) => console.error('Buddy notification failed: ' + e.message));
}

// The current pairing, or null. A pairing with a banned member is closed on sight.
async function currentPair(userId) {
  const pair = await q.activePair.get(userId, userId);
  if (!pair) return null;
  const other = await q.userById.get(buddyPeer(pair, userId));
  if (!other || other.banned) { await q.endPair.run(pair.id); return null; }
  return { pair, other };
}

async function endPairBetween(x, y) {
  const pair = await q.activePair.get(x, x);
  if (pair && buddyPeer(pair, x) === y) {
    await q.endPair.run(pair.id);
    pushBuddy(y, 'ended', '');
    pushBuddy(x, 'ended', '');
  }
}

function sharedStreak(mine, theirs, today) {
  const a = new Set(mine.filter((c) => c.plan).map((c) => c.day));
  const b = new Set(theirs.filter((c) => c.plan).map((c) => c.day));
  let d = a.has(today) && b.has(today) ? today : shiftDay(today, -1), n = 0;
  while (a.has(d) && b.has(d)) { n++; d = shiftDay(d, -1); }
  return n;
}

function week(checkins, today) {
  const byDay = Object.fromEntries(checkins.map((c) => [c.day, c]));
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDay(today, -i), c = byDay[d];
    out.push({ day: d, planned: !!(c && c.plan), done: !!(c && c.done) });
  }
  return out;
}
const checkinView = (c) => (c ? { plan: c.plan, done: !!c.done, cheer: c.cheer || '' } : { plan: '', done: false, cheer: '' });

async function buddyState(user) {
  const today = dayKey();
  const state = { today, prefs: await prefsOf(user.id), pair: null, incoming: [], outgoing: [] };
  const cur = await currentPair(user.id);
  if (cur) {
    const { pair, other } = cur;
    const since = shiftDay(today, -90);
    const mine = await q.checkinsSince.all(user.id, since);
    const theirs = await q.checkinsSince.all(other.id, since);
    const prof = readProfile(await q.profile.get(other.id));
    const lastTheirs = theirs.filter((c) => c.plan).map((c) => c.day).pop();
    const startDay = dayKey(new Date(pair.created));
    const silentFor = dayDiff(lastTheirs || startDay, today);
    const iAmA = pair.a === user.id;
    state.pair = {
      id: pair.id, since: pair.created,
      buddy: { username: other.username, name: other.name, color: prof.color, headline: prof.headline, goal: (await prefsOf(other.id)).goal },
      me: checkinView(mine.find((c) => c.day === today)),
      them: checkinView(theirs.find((c) => c.day === today)),
      myWeek: week(mine, today), theirWeek: week(theirs, today),
      streak: sharedStreak(mine, theirs, today),
      silentDays: silentFor, // days since your buddy last checked in (or since you paired)
      nudgedMe: (iAmA ? pair.nudge_a : pair.nudge_b) === today,
      nudgedThem: (iAmA ? pair.nudge_b : pair.nudge_a) === today
    };
  } else {
    state.incoming = (await q.buddyIncoming.all(user.id)).map((r) => ({ id: r.id, note: r.note, t: r.created, username: r.username, name: r.name }));
    state.outgoing = (await q.buddyOutgoing.all(user.id)).map((r) => ({ id: r.id, note: r.note, t: r.created, username: r.username, name: r.name }));
  }
  return state;
}

async function buddyApi(req, res, route, user) {
  const method = req.method;
  let m;
  if (!route.startsWith('/buddy')) return false;

  if (method === 'GET' && route === '/buddy') { send(res, 200, await buddyState(user)); return true; }

  if (method === 'PUT' && route === '/buddy/prefs') {
    limit('buddyprefs:' + user.id, 30, 10 * 60000);
    const b = await readBody(req);
    const goal = line(b.goal, 120, 'Your goal');
    await q.saveBuddyPrefs.run(user.id, b.seeking ? 1 : 0, goal, Date.now());
    send(res, 200, await buddyState(user));
    return true;
  }

  if (method === 'GET' && route === '/buddy/suggestions') {
    const me = readProfile(await q.profile.get(user.id));
    const myGoal = (await prefsOf(user.id)).goal;
    const words = (t) => new Set(String(t || '').toLowerCase().match(/[a-z]{4,}/g) || []);
    const mineWords = words(me.headline + ' ' + me.skills.join(' ') + ' ' + myGoal);
    const rows = await q.buddySeekers.all(user.id, user.id, user.id);
    const list = rows.map((r) => {
      const p = readProfile(r);
      let score = 0;
      if (me.location && p.location && me.location.toLowerCase() === p.location.toLowerCase()) score += 2;
      for (const w of words(p.headline + ' ' + p.skills.join(' ') + ' ' + r.goal)) if (mineWords.has(w)) score++;
      return { username: r.username, name: r.name, goal: r.goal, headline: p.headline, location: p.location, color: p.color, status: p.status, score };
    }).sort((x, y) => y.score - x.score).slice(0, 12);
    send(res, 200, { suggestions: list });
    return true;
  }

  if (method === 'POST' && route === '/buddy/requests') {
    limit('buddyreq:' + user.id, 10, 60 * 60000);
    const b = await readBody(req);
    const target = await q.userByName.get(String(b.username || '').toLowerCase());
    if (!target || target.banned || target.id === user.id) throw new HttpError(404, 'That person is not available.');
    const note = line(b.note, 140, 'Your note');
    if (await currentPair(user.id)) throw new HttpError(409, 'You already have a buddy. End that pairing first.');
    if (await currentPair(target.id)) throw new HttpError(409, target.name + ' already has a buddy.');
    if (!(await prefsOf(target.id)).seeking) throw new HttpError(409, target.name + ' is not looking for a buddy right now.');
    if ((await q.isBlocked.get(user.id, target.id)) || (await q.isBlocked.get(target.id, user.id))) throw new HttpError(403, 'You cannot send a request to this person.');
    if (await q.buddyReqBetween.get(user.id, target.id, target.id, user.id)) throw new HttpError(409, 'There is already a request between you two.');
    if ((await q.buddyOutgoing.all(user.id)).length >= MAX_OUTGOING_REQUESTS) throw new HttpError(429, 'You have ' + MAX_OUTGOING_REQUESTS + ' requests waiting. Give people a little time, or cancel one.');
    await q.addBuddyReq.run(user.id, target.id, note, Date.now());
    pushBuddy(target.id, 'request', user.name);
    send(res, 201, await buddyState(user));
    return true;
  }

  if ((m = /^\/buddy\/requests\/(\d{1,15})(\/accept|\/decline)?$/.exec(route))) {
    const r = await q.buddyReq.get(Number(m[1]));
    if (!r || r.status !== 'pending' || (r.to_id !== user.id && r.from_id !== user.id)) throw new HttpError(404, 'That request is no longer open.');
    if (method === 'DELETE' && !m[2]) {
      if (r.from_id !== user.id) throw new HttpError(403, 'Only the sender can cancel a request.');
      await q.setBuddyReq.run('cancelled', r.id);
      send(res, 200, await buddyState(user));
      return true;
    }
    if (method === 'POST' && m[2] && r.to_id === user.id) {
      const sender = await q.userById.get(r.from_id);
      if (m[2] === '/decline') {
        await q.setBuddyReq.run('declined', r.id);
        if (sender) pushBuddy(sender.id, 'declined', user.name);
        send(res, 200, await buddyState(user));
        return true;
      }
      if (!sender || sender.banned) { await q.setBuddyReq.run('cancelled', r.id); throw new HttpError(404, 'That person is no longer here.'); }
      if ((await currentPair(user.id)) || (await currentPair(sender.id))) throw new HttpError(409, 'One of you already has a buddy.');
      await q.addPair.run(sender.id, user.id, Date.now());
      await q.setBuddyReq.run('accepted', r.id);
      await q.cancelBuddyReqsFor.run(user.id, sender.id, user.id, sender.id);
      await q.stopSeeking.run(user.id);
      await q.stopSeeking.run(sender.id);
      pushBuddy(sender.id, 'accepted', user.name);
      send(res, 200, await buddyState(user));
      return true;
    }
    throw new HttpError(403, 'You cannot do that with this request.');
  }

  // Everything below needs a current buddy, except checking in (which you can do on your own too).
  if (method === 'PUT' && route === '/buddy/checkin') {
    limit('checkin:' + user.id, 60, 10 * 60000);
    const b = await readBody(req);
    const today = dayKey();
    const prev = await q.checkin.get(user.id, today);
    const plan = b.plan === undefined ? (prev ? prev.plan : '') : line(b.plan, 140, 'Today\'s plan');
    const done = b.done === undefined ? !!(prev && prev.done) : !!b.done;
    if (done && !plan) throw new HttpError(400, 'Write today\'s plan first.');
    await q.saveCheckin.run(user.id, today, plan, done ? 1 : 0, Date.now());
    did(req, user, 'checkin');
    const cur = await currentPair(user.id);
    if (cur) pushBuddy(cur.other.id, done && !(prev && prev.done) ? 'done' : 'checkin', user.name);
    send(res, 200, await buddyState(user));
    return true;
  }

  const cur = await currentPair(user.id);
  if (!cur) throw new HttpError(404, 'You do not have a buddy right now.');
  const today = dayKey();

  if (method === 'POST' && route === '/buddy/cheer') {
    limit('cheer:' + user.id, 30, 10 * 60000);
    const b = await readBody(req);
    if (!BUDDY_CHEERS.includes(b.emoji)) throw new HttpError(400, 'Pick one of the cheers.');
    const theirs = await q.checkin.get(cur.other.id, today);
    if (!theirs || !theirs.plan) throw new HttpError(409, cur.other.name + ' has not checked in yet today.');
    await q.setCheer.run(b.emoji, cur.other.id, today);
    pushBuddy(cur.other.id, 'cheer', user.name);
    send(res, 200, await buddyState(user));
    return true;
  }

  if (method === 'POST' && route === '/buddy/nudge') {
    const theirs = await q.checkin.get(cur.other.id, today);
    if (theirs && theirs.plan) throw new HttpError(409, cur.other.name + ' has already checked in today.');
    const otherIsA = cur.pair.a === cur.other.id;
    if ((otherIsA ? cur.pair.nudge_a : cur.pair.nudge_b) === today) throw new HttpError(409, 'You already nudged ' + cur.other.name + ' today.');
    await (otherIsA ? q.nudgeA : q.nudgeB).run(today, cur.pair.id);
    pushBuddy(cur.other.id, 'nudge', user.name);
    send(res, 200, await buddyState(user));
    return true;
  }

  if (method === 'POST' && route === '/buddy/end') {
    await q.endPair.run(cur.pair.id);
    pushBuddy(cur.other.id, 'ended', user.name);
    send(res, 200, await buddyState(user));
    return true;
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
  '/og.png': ['og.png', 'image/png'], // the picture shown when someone shares the link
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'], // served from the root so it can look after the whole site
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png', FOREVER],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png', FOREVER],
  '/icons/badge-96.png': ['icons/badge-96.png', 'image/png', FOREVER], // the small white shape in a phone's status bar
  '/icons/maskable-512.png': ['icons/maskable-512.png', 'image/png', FOREVER],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png', FOREVER],
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

// ---------- keep-awake ----------
// Render's free plan puts the app to sleep after ~15 minutes with no visitors, and waking takes 30-60 seconds.
// Visiting our own public address every 10 minutes counts as a visitor, so it stays awake. Render sets
// RENDER_EXTERNAL_URL automatically; set KEEP_AWAKE=off on the host to stop. It only touches /healthz (no database).
// Waking hours only (default 07:00-24:00 India time): overnight the pings stop, so the app sleeps as the free plan
// intends and uses roughly 520 of Render's 750 free hours a month instead of ~740. A sleeping app cannot wake itself,
// so the first visitor after the night wakes it; pings carry on from there. KEEP_AWAKE_HOURS=all keeps it on 24/7.
const istHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
function awakeWindow(spec) {
  if (spec === 'all') return () => true;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec || '7-24');
  const from = m ? Number(m[1]) : 7, to = m ? Number(m[2]) : 24;
  return (h) => (from <= to ? h >= from && h < to : h >= from || h < to); // also handles windows across midnight, e.g. 20-6
}
function startKeepAwake() {
  const target = (process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (!target || process.env.KEEP_AWAKE === 'off') return;
  if (!/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(target)) { console.error('Keep-awake skipped: the address must use https.'); return; }
  const minutes = Math.max(Number(process.env.KEEP_AWAKE_MINUTES) || 10, 0.01);
  const hours = (process.env.KEEP_AWAKE_HOURS || '7-24').trim();
  const inWindow = awakeWindow(hours);
  const ping = () => {
    if (!inWindow(istHour())) return; // night time: let the app sleep
    fetch(target + '/healthz', { headers: { 'User-Agent': 'TheBench-KeepAwake/1.0' }, signal: AbortSignal.timeout(20000) })
      .then((r) => { if (!r.ok) console.error('Keep-awake ping got HTTP ' + r.status); })
      .catch((e) => console.error('Keep-awake ping failed: ' + e.message));
  };
  setInterval(ping, minutes * 60000);
  console.log('Keep-awake on: pinging ' + target + '/healthz every ' + minutes + ' minutes' +
    (hours === 'all' ? ', all day' : ' between ' + hours.replace('-', ':00 and ') + ':00 India time'));
}

initDb().then(loadSiteKey).then(loadReceiptsStart).then(() => q.addSetting.run('usage_from', usageDay())).then(() => {
  server.listen(PORT, HOST, () => {
    console.log('The Bench is running at http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + (TURSO_URL ? ' (hosted database)' : ' (local database)'));
    ensureJobs(); // warm the job listings so the first visitor does not wait
    startKeepAwake();
    startPushTimer();
  });
}).catch((e) => {
  console.error('Could not start: ' + e.message);
  process.exit(1);
});
