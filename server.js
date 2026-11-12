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

async function initDb() {
  for (const sql of SCHEMA) await exec(sql);
  await exec('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
}

const stmt = (sql) => ({
  run: (...a) => exec(sql, a),
  get: async (...a) => (await exec(sql, a)).rows[0],
  all: async (...a) => (await exec(sql, a)).rows
});

const q = {
  userByName: stmt('SELECT * FROM users WHERE username = ?'),
  addUser: stmt('INSERT INTO users (username, name, pass, salt, created) VALUES (?, ?, ?, ?, ?)'),
  addSession: stmt('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)'),
  session: stmt('SELECT u.id, u.username, u.name, u.data FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?'),
  dropSession: stmt('DELETE FROM sessions WHERE token_hash = ?'),
  saveData: stmt('UPDATE users SET data = ? WHERE id = ?'),
  posts: stmt('SELECT p.id, p.tag, p.text, p.created, p.user_id, u.name, u.username FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 100'),
  replies: stmt('SELECT r.post_id, r.text, r.created, u.name FROM replies r JOIN users u ON u.id = r.user_id WHERE r.post_id >= ? ORDER BY r.id'),
  reacts: stmt('SELECT post_id, emoji, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM reactions WHERE post_id >= ? GROUP BY post_id, emoji'),
  post: stmt('SELECT id, user_id FROM posts WHERE id = ?'),
  addPost: stmt('INSERT INTO posts (user_id, tag, text, created) VALUES (?, ?, ?, ?)'),
  delPostReplies: stmt('DELETE FROM replies WHERE post_id = ?'),
  delPostReacts: stmt('DELETE FROM reactions WHERE post_id = ?'),
  delPost: stmt('DELETE FROM posts WHERE id = ? AND user_id = ?'),
  addReply: stmt('INSERT INTO replies (post_id, user_id, text, created) VALUES (?, ?, ?, ?)'),
  hasReact: stmt('SELECT 1 AS x FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?'),
  addReact: stmt('INSERT INTO reactions (post_id, user_id, emoji) VALUES (?, ?, ?)'),
  delReact: stmt('DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND emoji = ?')
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

function publicUser(u) { return { username: u.username, name: u.name }; }
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
    if (typeof b.password !== 'string' || b.password.length < 8) throw new HttpError(400, 'Password needs at least 8 characters.');
    if (b.password.length > 200) throw new HttpError(400, 'Password is too long.');
    if (await q.userByName.get(username)) throw new HttpError(409, 'That username is taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    const pass = await hashPassword(b.password, salt);
    let info;
    try { info = await q.addUser.run(username, name, pass, salt, Date.now()); }
    catch (e) { throw new HttpError(409, 'That username is taken.'); }
    return send(res, 201, { user: { username, name }, data: {} }, { 'Set-Cookie': await startSession(info.lastId) });
  }

  if (method === 'POST' && route === '/login') {
    limit('auth:' + ip, 20, 10 * 60000);
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
    limit('auth:user:' + username.slice(0, 20), 10, 10 * 60000); // per account, whatever the IP
    const u = await q.userByName.get(username);
    // Hash even when the user does not exist, so timing does not reveal usernames.
    const hash = await hashPassword(password, u ? u.salt : '00000000000000000000000000000000');
    const ok = !!u && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.pass, 'hex'));
    if (!ok) throw new HttpError(401, 'Wrong username or password.');
    return send(res, 200, { user: publicUser(u), data: parseData(u.data) }, { 'Set-Cookie': await startSession(u.id) });
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
    return send(res, 200, { user: publicUser(user), data: parseData(user.data) });
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
      if (post.user_id !== user.id) throw new HttpError(403, 'You can only delete your own posts.');
      await q.delPostReplies.run(id);
      await q.delPostReacts.run(id);
      await q.delPost.run(id, user.id);
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

  throw new HttpError(404, 'Not found.');
}

// ---------- static files (fixed allow-list, so nothing else on disk is reachable) ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8']
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
      'Cache-Control': 'no-cache',
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
