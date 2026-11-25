// Phone notifications: node tests/both/notifications.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5181, TURSO = 8061, PUSH = 8062;
const base = 'http://127.0.0.1:' + PORT, ORIGIN = 'http://127.0.0.1:' + PUSH;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
const w = require(path.join(path.dirname(serverJs), 'push.js'));

function startTurso(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      const results = JSON.parse(body).requests.map((r) => {
        if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
        try {
          const st = db.prepare(r.stmt.sql), args = (r.stmt.args || []).map(dec);
          let rows = [], cols = [], info = { changes: 0, lastInsertRowid: null };
          if (/^\s*select/i.test(r.stmt.sql)) { const out = st.all(...args); cols = out.length ? Object.keys(out[0]).map((name) => ({ name })) : []; rows = out.map((o) => Object.values(o).map(enc)); } else info = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: Number(info.changes), last_insert_rowid: info.lastInsertRowid === null ? null : String(info.lastInsertRowid) } } };
        } catch (e) { return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  }).listen(TURSO, '127.0.0.1');
}

// ---- a stand-in push service, and pretend browsers that decrypt with separate code (WebCrypto, not the server's) ----
const browsers = new Map(), inbox = [];
let answer = () => 201;
async function browser() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b = { id: rnd() + rnd(), kp, pub: Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: crypto.randomBytes(16) };
  b.sub = { endpoint: ORIGIN + '/send/' + b.id, keys: { p256dh: b.pub.toString('base64url'), auth: b.auth.toString('base64url') } };
  browsers.set(b.id, b);
  return b;
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function decrypt(b, body) {
  const salt = body.subarray(0, 16), n = body[20], from = body.subarray(21, 21 + n), data = body.subarray(21 + n);
  const peer = await crypto.subtle.importKey('raw', from, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const shared = Buffer.from(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, b.kp.privateKey, 256));
  const ikm = await hkdf(b.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), b.pub, from]), 32);
  const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
  const out = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12) }, key, data));
  if (out[out.length - 1] !== 2) throw new Error('bad padding');
  return JSON.parse(out.subarray(0, -1).toString());
}
async function goodSignature(header) {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header || '');
  if (!m) return { ok: false };
  const k = await crypto.subtle.importKey('raw', Buffer.from(m[4], 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2]));
  return { ok, key: m[4], head: JSON.parse(Buffer.from(m[1], 'base64url')), claims: JSON.parse(Buffer.from(m[2], 'base64url')), token: m[2] };
}
const pushServer = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', async () => {
    const b = browsers.get(req.url.replace('/send/', '')), status = answer(b, req);
    const rec = { to: b && b.id, url: req.url, headers: req.headers, status };
    if (b) { try { rec.msg = await decrypt(b, Buffer.concat(parts)); } catch (e) { rec.error = e.message; } rec.sig = await goodSignature(req.headers.authorization); }
    inbox.push(rec);
    if (rec.msg) everything.push(JSON.stringify(rec.msg)); else if (b) everything.push('UNREADABLE');
    res.writeHead(status, status === 302 ? { Location: base + '/healthz?followed' } : {});
    res.end();
  });
}).listen(PUSH, '127.0.0.1');
const everything = [];
const got = (b) => inbox.filter((x) => x.to === b.id && x.msg).map((x) => x.msg);
const clear = () => { inbox.length = 0; };

function member() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.fork = () => { const c = member(); c.set(cookie); return c; };
  call.set = (c) => { cookie = c; };
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-push-')), clock = path.join(tmp, 'clock');
  const at = (day, time) => fs.writeFileSync(clock, String(Date.parse(day + 'T' + time + ':00+05:30')));
  at('2030-03-10', '03:00');
  const adminName = 'nadm_' + rnd();
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: adminName, KEEP_AWAKE: 'off', PUSH_TEST_ORIGIN: ORIGIN, PUSH_TEST_CLOCK: clock, PUSH_TICK_MS: '250',
    RENDER_EXTERNAL_URL: 'https://bench.example', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9'
  });
  let mem, turso, child, log = '';
  if (mode === 'hosted') { mem = new DatabaseSync(':memory:'); turso = startTurso(mem); Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' }); }
  const start = async (more) => {
    log = '';
    child = spawn(process.execPath, [serverJs], { env: Object.assign({}, env, more), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
    for (let i = 0; i < 80 && !/running at|Could not start/.test(log); i++) await wait(100);
  };
  const stop = async () => { child.kill(); await wait(400); };
  const rows = (sql, ...args) => { const db = mem || new DatabaseSync(path.join(tmp, 'bench.db'), { readOnly: true }); const out = db.prepare(sql).all(...args); if (!mem) db.close(); return out; };
  try {
    // ---- pieces ----
    const ex = w.encrypt('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { priv: w.unb64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), salt: w.unb64('DGv6ra1nlYgDCS1FRnbzlw') });
    check('matches the example in RFC 8291', w.b64(ex) === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
    const good = ['https://fcm.googleapis.com/fcm/send/abc:def', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-pn1p.notify.windows.com/w/?token=x'];
    check('real push services accepted', good.every((u) => w.goodEndpoint(u)));
    const bad = ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x', 'https://a@fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://xnotify.windows.com/x', 'https://notify.windows.com/x', 'file:///etc/passwd', 'javascript:1', '', null, {}, 'https://evilpush.apple.com/x', 'https://fcm.googleapis.com/' + 'x'.repeat(2000), 'https://fcm.googleapis.com/#x', ORIGIN + '/send/x'];
    check('everything else refused', bad.every((u) => !w.goodEndpoint(u)), bad.filter((u) => w.goodEndpoint(u)));
    check('test address refused when not testing', !w.goodEndpoint(ORIGIN + '/x', ''));

    await start();
    check('starts', /running at/.test(log), log);
    const A = member(), B = member(), M = member(), pwA = crypto.randomUUID();
    const aName = 'na_' + rnd(), bName = 'nb_' + rnd();
    for (const [c, u, n, p] of [[A, aName, 'Asha', pwA], [B, bName, 'Bala', crypto.randomUUID()], [M, adminName, 'Mod', crypto.randomUUID()]]) { const r = await c('POST', '/api/signup', { username: u, name: n, password: p }); if (r.status !== 201) throw new Error(JSON.stringify(r)); }
    const a1 = await browser(), a2 = await browser(), b1 = await browser(), m1 = await browser();

    check('needs login', (await member()('GET', '/api/push')).status === 401 && (await member()('POST', '/api/push/on', a1.sub)).status === 401);
    let r = await A('GET', '/api/push');
    const siteKey = r.json.key;
    check('key and choices', Buffer.from(siteKey, 'base64url').length === 65 && r.json.devices === 0 && JSON.stringify(r.json.prefs) === JSON.stringify({ dm: true, buddy: true, due: true, interview: true }), r.json);
    check('moderators also get the reports choice', 'mod' in (await M('GET', '/api/push')).json.prefs);
    check('the private key is never sent', !JSON.stringify(r.json).includes(JSON.parse(rows("SELECT value FROM settings WHERE key = 'push_key'")[0].value).jwk.d));
    for (const [n, body] of [['odd address', { endpoint: 'https://evil.com/x', keys: a1.sub.keys }], ['own network', { endpoint: 'http://127.0.0.1:' + PORT + '/api/logout', keys: a1.sub.keys }], ['no keys', { endpoint: a1.sub.endpoint }], ['key not on the curve', { endpoint: a1.sub.endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: a1.sub.keys.auth } }], ['short secret', { endpoint: a1.sub.endpoint, keys: { p256dh: a1.sub.keys.p256dh, auth: 'abcd' } }]]) {
      check('refused: ' + n, (await A('POST', '/api/push/on', body)).status === 400);
    }
    check('nothing stored from those', rows('SELECT COUNT(*) AS n FROM push_subs')[0].n === 0);
    check('turn on', (await A('POST', '/api/push/on', a1.sub)).status === 200 && (await A('GET', '/api/push')).json.devices === 1);
    await A('POST', '/api/push/on', a1.sub);
    check('turning on twice is one device', (await A('GET', '/api/push')).json.devices === 1);

    // ---- private messages ----
    await B('POST', '/api/chat/dm/' + aName, { text: 'SECRETTEXT hello' }); await wait(500);
    let m = got(a1);
    check('message arrives and decrypts', m.length === 1 && m[0].title === 'Bala' && m[0].body === 'Sent you a private message.' && m[0].url === '/#/dm/' + bName, inbox);
    const h = inbox[0] && inbox[0].headers, s = inbox[0] && inbox[0].sig;
    check('headers', h && h['content-encoding'] === 'aes128gcm' && h.ttl === '86400' && h.urgency === 'high' && /^[\w-]{1,32}$/.test(h.topic), h);
    check('signature is ours and valid', s && s.ok && s.key === siteKey && s.head.alg === 'ES256' && s.claims.aud === ORIGIN && s.claims.sub === 'https://bench.example' && s.claims.exp - Date.now() / 1000 < 86400 && s.claims.exp > Date.now() / 1000, s);
    check('sender gets nothing', got(b1).length === 0);
    clear(); await B('POST', '/api/chat/dm/' + aName, { text: 'again' }); await wait(400);
    check('a burst of messages is one notification', inbox.length === 0);
    await B('POST', '/api/chat/room/lobby', { text: 'hello room' }); await wait(300); check('rooms do not notify', inbox.length === 0);
    await M('POST', '/api/chat/dm/' + aName, { text: 'from M' }); await wait(400); check('another person does', got(a1).length === 1 && got(a1)[0].title === 'Mod');
    check('signature is re-used, not remade each time', inbox[0].sig.token === s.token);

    // ---- choices ----
    clear();
    r = await A('PUT', '/api/push/prefs', { dm: false, buddy: true, due: true, interview: true, mod: true, evil: 1 });
    check('choices saved and cleaned', JSON.stringify(r.json.prefs) === JSON.stringify({ dm: false, buddy: true, due: true, interview: true }), r.json);
    const C = member(), cName = 'nc_' + rnd(); await C('POST', '/api/signup', { username: cName, name: 'Chitra', password: crypto.randomUUID() });
    await C('POST', '/api/chat/dm/' + aName, { text: 'x' }); await wait(400); check('switched-off kind is not sent', inbox.length === 0, inbox);
    await A('PUT', '/api/push/prefs', { dm: true });

    // ---- buddies ----
    await B('POST', '/api/push/on', b1.sub);
    await A('PUT', '/api/buddy/prefs', { seeking: true, goal: 'GOALTEXT' }); await B('PUT', '/api/buddy/prefs', { seeking: true, goal: 'x' });
    clear(); r = await B('POST', '/api/buddy/requests', { username: aName, note: 'NOTETEXT' }); if (r.status === 404) r = await B('POST', '/api/buddy/request', { username: aName, note: 'NOTETEXT' });
    await wait(500);
    check('buddy request arrives', got(a1).some((x) => x.body === 'Bala would like to be your accountability buddy.' && x.url === '/#/buddy'), [r, inbox]);
    r = await A('GET', '/api/buddy'); const rq = (r.json.incoming || r.json.requests || [])[0];
    if (rq) { r = await A('POST', '/api/buddy/requests/' + rq.id, { action: 'accept' }); if (r.status >= 400) r = await A('POST', '/api/buddy/requests/' + rq.id + '/accept', {}); }
    await wait(500); check('acceptance arrives', got(b1).some((x) => /said yes/.test(x.body)), [r, inbox.map((x) => x.msg)]);
    clear(); for (let i = 0; i < 3; i++) await A('PUT', '/api/buddy/checkin', { plan: 'PLANTEXT ' + i }).then((x) => x.status === 404 ? A('POST', '/api/buddy/checkin', { plan: 'PLANTEXT ' + i }) : x);
    await wait(500); check('three check-ins, one notification', got(b1).filter((x) => /checked in/.test(x.body)).length === 1, inbox.map((x) => x.msg));

    // ---- reports ----
    await M('POST', '/api/push/on', m1.sub); clear();
    const msg = (await B('POST', '/api/chat/room/lobby', { text: 'bad' })).json.msg;
    await A('POST', '/api/chat/msg/' + msg.id + '/report', { reason: 'REASONTEXT' }); await wait(500);
    check('report goes to moderators only', got(m1).length === 1 && got(m1)[0].url === '/#/admin' && got(a1).length === 0 && got(b1).length === 0, inbox.map((x) => x.msg));
    const rep = (await M('GET', '/api/admin/reports')).json.reports[0]; clear(); await M('POST', '/api/admin/reports/' + rep.id, { action: 'dismiss' }); await wait(300); check('closing one does not notify', inbox.length === 0);

    // ---- who gets it: only devices still logged in ----
    const A2 = member(); await A2('POST', '/api/login', { username: aName, password: pwA }); await A2('POST', '/api/push/on', a2.sub);
    check('two devices', (await A('GET', '/api/push')).json.devices === 2);
    const say = async (who) => { clear(); const X = member(); await X('POST', '/api/signup', { username: 'nx_' + rnd(), name: 'Xx', password: crypto.randomUUID() }); await X('POST', '/api/chat/dm/' + who, { text: 'hi' }); await wait(450); };
    await say(aName); check('both get it', got(a1).length === 1 && got(a2).length === 1);
    await A2('POST', '/api/logout'); await say(aName); check('logged-out device gets nothing', got(a1).length === 1 && got(a2).length === 0);
    const A3 = member(); await A3('POST', '/api/login', { username: aName, password: pwA }); await A3('POST', '/api/push/on', a2.sub);
    const npw = crypto.randomUUID(); await A('POST', '/api/me/password', { password: pwA, newPassword: npw }); await say(aName);
    check('password change cuts off every device', got(a1).length === 0 && got(a2).length === 0);
    await A('POST', '/api/push/on', a1.sub); await say(aName); check('this device is back after registering again', got(a1).length === 1);
    // someone else uses the same browser
    await C('POST', '/api/push/on', a1.sub); await say(aName); check('a shared browser belongs to the latest person only', got(a1).length === 0);
    await say(cName); check('and gets theirs', got(a1).length === 1);
    check('cannot switch off someone else\'s device', (await A('POST', '/api/push/off', { endpoint: a1.sub.endpoint })).status === 200 && rows('SELECT COUNT(*) AS n FROM push_subs WHERE endpoint = ?', a1.sub.endpoint)[0].n === 1);
    check('cannot send a test to someone else\'s device', (await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint })).status === 404);
    await C('POST', '/api/push/off', { endpoint: a1.sub.endpoint }); await say(cName); check('turned off', inbox.length === 0);

    // ---- push service trouble ----
    await A('POST', '/api/push/on', a1.sub);
    clear(); r = await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('test button works', r.status === 200 && got(a1)[0].tag === 'test', r);
    answer = () => 500; r = await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('trouble is reported', r.status === 502, r); check('device kept after one failure', rows('SELECT fails FROM push_subs WHERE endpoint = ?', a1.sub.endpoint)[0].fails === 1);
    answer = () => 302; clear(); await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('redirects are not followed', inbox.length === 1);
    answer = () => 201; await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('a success clears the count', rows('SELECT fails FROM push_subs WHERE endpoint = ?', a1.sub.endpoint)[0].fails === 0);
    answer = () => 410; r = await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('a device that is gone is forgotten', r.status === 502 && rows('SELECT COUNT(*) AS n FROM push_subs WHERE endpoint = ?', a1.sub.endpoint)[0].n === 0, r);
    answer = () => 201; await A('POST', '/api/push/on', a1.sub);
    await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint }); check('test button is limited', (await A('POST', '/api/push/test', { endpoint: a1.sub.endpoint })).status === 429);
    for (let i = 0; i < 8; i++) await C('POST', '/api/push/on', (await browser()).sub); check('at most 6 devices each', (await C('GET', '/api/push')).json.devices === 6, (await C('GET', '/api/push')).json);

    // ---- tracker reminders ----
    const T = member(), tName = 'nt_' + rnd(), t1 = await browser(); await T('POST', '/api/signup', { username: tName, name: 'Tara', password: crypto.randomUUID() }); await T('POST', '/api/push/on', t1.sub);
    const app = (id, o) => Object.assign({ id, title: 'TITLETEXT', company: 'COMPANYTEXT', note: 'NOTETEXT', stage: 'Applied' }, o);
    clear();
    await T('PUT', '/api/me/data', { apps: [app('f1', { followUp: '2030-03-10' }), app('f2', { followUp: '2030-03-09' }), app('f3', { followUp: '2030-03-01' }), app('f4', { followUp: '2030-03-12' }), app('f5', { followUp: '2030-03-10', stage: 'Rejected' }),
      app('i1', { stage: 'Interview', interview: '2030-03-11', itime: '15:00' }), app('i2', { stage: 'Offer', interview: '2030-03-11' }), app('bad', { followUp: 'soon', interview: '<b>' }), null, 7] });
    await wait(700); check('nothing in the middle of the night', got(t1).length === 0, got(t1));
    at('2030-03-10', '09:05'); await wait(900);
    check('one morning reminder, with everything due', got(t1).length === 1 && got(t1)[0].body === 'Interview tomorrow at 3:00 PM · 2 follow-ups are due' && got(t1)[0].url === '/#/tracker', got(t1));
    await wait(900); check('not repeated', got(t1).length === 1, got(t1));
    await stop(); await start(); await wait(900); check('not repeated after a restart', got(t1).length === 1, got(t1));
    check('same site key after a restart', (await T('GET', '/api/push')).json.key === siteKey);
    clear(); at('2030-03-11', '09:10'); await wait(900); check('on the day', got(t1).length === 1 && got(t1)[0].body === 'Interview today at 3:00 PM', got(t1));
    clear(); at('2030-03-11', '13:30'); await wait(700); check('not yet', got(t1).length === 0);
    at('2030-03-11', '13:50'); await wait(900); check('about an hour before', got(t1).length === 1 && got(t1)[0].body === 'Your interview is at 3:00 PM. Good luck!', got(t1));
    await wait(700); check('once', got(t1).length === 1); check('urgent', inbox[0].headers.urgency === 'high');
    // moved to a new time: reminded for the new one
    clear(); await T('PUT', '/api/me/data', { apps: [app('i1', { stage: 'Interview', interview: '2030-03-11', itime: '18:00' })] }); at('2030-03-11', '17:00'); await wait(900); check('a moved interview is reminded again', got(t1).length === 1 && /6:00 PM/.test(got(t1)[0].body), got(t1));
    // added on the day itself, within the hour: one notification, not two
    clear(); await T('PUT', '/api/me/data', { apps: [app('i9', { stage: 'Interview', interview: '2030-03-11', itime: '17:40' })] }); await wait(900); check('short notice: one reminder only', got(t1).length === 1 && /5:40 PM/.test(got(t1)[0].body), got(t1));
    clear(); at('2030-03-11', '22:30'); await T('PUT', '/api/me/data', { apps: [app('n1', { followUp: '2030-03-11' })] }); await wait(700); check('nothing late at night', got(t1).length === 0);
    // the push service is down at 9: tried again
    answer = () => 503; at('2030-03-12', '09:00'); await wait(800); const tries = inbox.length; answer = () => 201; await wait(800);
    check('tried again when the service was down', tries >= 1 && inbox.filter((x) => x.status === 201).length === 1 && inbox.filter((x) => x.status === 201)[0].msg.body === '1 follow-up is due', inbox.map((x) => [x.status, x.msg && x.msg.body]));
    clear(); await T('PUT', '/api/push/prefs', { due: false, interview: false }); await T('PUT', '/api/me/data', { apps: [app('z1', { followUp: '2030-03-12' }), app('z2', { stage: 'Interview', interview: '2030-03-12', itime: '09:30' })] }); await wait(800); check('reminders off', inbox.length === 0, inbox.map((x) => x.msg));
    await T('PUT', '/api/push/prefs', { due: true, interview: false }); await wait(800); check('only follow-ups on', got(t1).length === 1 && got(t1)[0].body === '1 follow-up is due', got(t1));
    clear(); await T('POST', '/api/logout'); await wait(100); await T('POST', '/api/me/data', {}); at('2030-03-13', '09:00'); await wait(800); check('no reminders after logging out', inbox.length === 0, inbox.map((x) => x.msg));
    check('every notification could be read, and none held private text', everything.length > 25 && !everything.some((x) => /UNREADABLE|SECRETTEXT|TITLETEXT|COMPANYTEXT|NOTETEXT|GOALTEXT|PLANTEXT|REASONTEXT/.test(x)), everything.filter((x) => /TEXT|UNREAD/.test(x)));

    // ---- your data ----
    r = await A('GET', '/api/me/export'); const text = JSON.stringify(r.json);
    check('download shows settings but not device addresses', r.json.notificationSettings.length === 1 && r.json.notificationDevices.length === 1 && !text.includes('/send/') && !text.includes(a1.sub.keys.auth), r.json.notificationSettings);
    const id = rows('SELECT id FROM users WHERE username = ?', aName)[0].id; await A('POST', '/api/me/delete', { password: npw, confirm: aName });
    check('deleting the account removes all of it', ['push_subs', 'push_prefs', 'push_sent'].every((t) => rows('SELECT COUNT(*) AS n FROM ' + t + ' WHERE user_id = ?', id)[0].n === 0));
    // ---- without the test switch, the test address and clock are ignored ----
    await stop(); await start({ PUSH_TEST_ORIGIN: '' }); check('test switch off: local addresses refused', (await B('POST', '/api/push/on', b1.sub)).status === 400);
    const X = member(); await X('POST', '/api/signup', { username: 'ny_' + rnd(), name: 'Y', password: crypto.randomUUID() }); clear(); await X('POST', '/api/chat/dm/' + bName, { text: 'hi' }); await wait(500); check('and stored ones are dropped, not contacted', inbox.length === 0 && rows('SELECT COUNT(*) AS n FROM push_subs WHERE endpoint = ?', b1.sub.endpoint)[0].n === 0);
    check('no errors logged', !/failed:/i.test(log.replace(/Job feeds? failed[^\n]*|Job refresh failed[^\n]*|[^\n]*feed[^\n]*/gi, '')), log.slice(-400));
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  if (child) await stop();
  pushServer.close(); if (turso) turso.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
