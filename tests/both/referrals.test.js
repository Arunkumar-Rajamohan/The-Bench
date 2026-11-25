// Referral board test: node tests/both/referrals.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5188, FEEDS = 8087, TURSO = 8086;
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const start = Date.now();

// stand-in feeds: Stripe (Greenhouse) has two old India jobs; a third, brand new one appears when addNew is set.
let addNew = false;
const feeds = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname === '/v1/boards/stripe/jobs') {
    const jobs = [
      { id: 1, title: 'Customer Support Specialist', absolute_url: 'https://stripe.com/jobs/1', location: { name: 'Chennai, India' }, first_published: new Date(start - 3 * 864e5).toISOString() },
      { id: 2, title: 'Account Executive', absolute_url: 'https://stripe.com/jobs/2', location: { name: 'Bengaluru, India' }, first_published: new Date(start - 2 * 864e5).toISOString() }
    ];
    if (addNew) jobs.push({ id: 3, title: 'Support Team Lead', absolute_url: 'https://stripe.com/jobs/3', location: { name: 'Chennai' }, first_published: new Date().toISOString() });
    return send({ jobs });
  }
  if (u.pathname.startsWith('/v1/boards/')) return send({ jobs: [] });
  if (u.pathname.startsWith('/v0/postings/')) return send([]);
  if (u.pathname.startsWith('/posting-api/')) return send({ jobs: [] });
  if (u.pathname.startsWith('/v1/companies/')) return send({ content: [], totalFound: 0 });
  res.writeHead(404); res.end();
}).listen(FEEDS, '127.0.0.1');

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
          const st = db.prepare(r.stmt.sql);
          const args = (r.stmt.args || []).map(dec);
          let rows = [], cols = [], info = { changes: 0, lastInsertRowid: null };
          if (/^\s*select/i.test(r.stmt.sql)) {
            const out = st.all(...args);
            cols = out.length ? Object.keys(out[0]).map((name) => ({ name, decltype: null })) : [];
            rows = out.map((o) => Object.values(o).map(enc));
          } else info = st.run(...args);
          return { type: 'ok', response: { type: 'execute', result: { cols, rows, affected_row_count: Number(info.changes), last_insert_rowid: info.lastInsertRowid === null ? null : String(info.lastInsertRowid) } } };
        } catch (e) { return { type: 'error', error: { message: e.message } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  }).listen(TURSO, '127.0.0.1');
}

function member() {
  let cookie = '';
  const events = [];
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  call.events = events;
  call.stream = async () => {
    const r = await fetch(base + '/api/stream', { headers: { Cookie: cookie } });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); for (const l of c.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); } } } catch (e) { /* closed */ } })();
    call.stop = () => reader.cancel().catch(() => {});
  };
  return call;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-refs-'));
  const adminName = 'rfadm_' + rnd();
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: adminName, KEEP_AWAKE: 'off',
    GREENHOUSE_BASE_URL: 'http://127.0.0.1:' + FEEDS, LEVER_BASE_URL: 'http://127.0.0.1:' + FEEDS,
    ASHBY_BASE_URL: 'http://127.0.0.1:' + FEEDS, SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:' + FEEDS
  });
  let turso;
  if (mode === 'hosted') {
    turso = startTurso(new DatabaseSync(':memory:'));
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + TURSO, TURSO_AUTH_TOKEN: 'x', NODE_ENV: 'production' });
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);

  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
  const A = member(), B = member(), C = member(), D = member();
  const names = {};
  try {
    for (const [c, key, uname] of [[A, 'A', 'rfa_' + rnd()], [B, 'B', 'rfb_' + rnd()], [C, 'C', adminName], [D, 'D', 'rfd_' + rnd()]]) {
      const r = await c('POST', '/api/signup', { username: uname, name: key + ' Person', password: crypto.randomUUID() });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
      names[key] = uname;
    }
    check('anonymous blocked', (await member()('GET', '/api/referrals')).status === 401);
    let r = await A('GET', '/api/referrals');
    check('empty board', r.status === 200 && r.json.offers.length === 0 && r.json.maxOffers === 8, r.json);
    check('company required', (await A('POST', '/api/referrals', { company: '  ' })).status === 400);
    r = await A('POST', '/api/referrals', { company: 'Acme', note: 'Referral fee Rs 2000' });
    check('paid referral refused', r.status === 400 && /always free/.test(r.json.error || ''), r.json);
    check('rupee amount refused', (await A('POST', '/api/referrals', { company: 'Acme', roles: 'pay ₹500 first' })).status === 400);
    check('payments team is fine', (await A('POST', '/api/referrals', { company: 'Razorpay', roles: 'Payments operations', kind: 'astronaut' })).status === 201);
    r = await A('POST', '/api/referrals', { company: 'Freshworks', kind: 'refer', roles: 'Support roles, Chennai', note: 'Send the job link' });
    check('add offer', r.status === 201, r.json);
    check('duplicate company refused (any case)', (await A('POST', '/api/referrals', { company: 'FRESHWORKS' })).status === 409);
    for (const co of ['Zoho', 'Swiggy', 'Infosys', 'TCS', 'Wipro', 'Kettle']) await A('POST', '/api/referrals', { company: co, kind: 'contact' });
    r = await A('POST', '/api/referrals', { company: 'Ninth Co' });
    check('limit of 8 offers', r.status === 400, r.json);

    r = await B('GET', '/api/referrals');
    const fw = r.json.offers.find((o) => o.company === 'Freshworks');
    check('others see the offer', fw && !fw.own && fw.kind === 'refer' && fw.asks === 0 && fw.myAsk === null && fw.username === names.A, fw);
    check('unknown kind falls back to refer', r.json.offers.find((o) => o.company === 'Razorpay').kind === 'refer');
    check('owner sees it as own', (await A('GET', '/api/referrals')).json.offers.every((o) => o.own));
    check('contact kind kept', r.json.offers.find((o) => o.company === 'Zoho').kind === 'contact');

    check('role required to ask', (await B('POST', '/api/referrals/' + fw.id + '/ask', { message: 'hi' })).status === 400);
    check('bad link refused', (await B('POST', '/api/referrals/' + fw.id + '/ask', { role: 'Support', url: 'javascript:alert(1)', message: 'hi' })).status === 400);
    check('message required', (await B('POST', '/api/referrals/' + fw.id + '/ask', { role: 'Support' })).status === 400);
    r = await B('POST', '/api/referrals/' + fw.id + '/ask', { role: 'Customer success associate', url: 'https://example.com/job/1', message: 'Hi, could you refer me?' });
    check('ask sends', r.status === 201 && r.json.username === names.A, r.json);
    r = await B('GET', '/api/chat/dm/' + names.A);
    const dm = r.json.messages && r.json.messages[r.json.messages.length - 1];
    check('request arrives as a DM', dm && /^Referral request for Freshworks: Customer success associate\nhttps:\/\/example\.com\/job\/1\n\nHi, could you refer me\?/.test(dm.text) && dm.username === names.B, dm);
    r = await A('GET', '/api/chat/summary');
    check('offerer sees the conversation', r.json.dms.some((d) => d.username === names.B && /Referral request/.test(d.lastText)), r.json.dms);
    check('asking twice refused', (await B('POST', '/api/referrals/' + fw.id + '/ask', { role: 'x', message: 'again' })).status === 409);
    r = await B('GET', '/api/referrals');
    const fw2 = r.json.offers.find((o) => o.id === fw.id);
    check('ask is remembered', fw2.asks === 1 && typeof fw2.myAsk === 'number', fw2);
    check('cannot ask yourself', (await A('POST', '/api/referrals/' + fw.id + '/ask', { role: 'x', message: 'y' })).status === 400);

    const zoho = r.json.offers.find((o) => o.company === 'Zoho');
    check('others cannot pause', (await B('POST', '/api/referrals/' + zoho.id + '/open', { open: false })).status === 403);
    check('owner pauses', (await A('POST', '/api/referrals/' + zoho.id + '/open', { open: false })).status === 200);
    check('paused offer cannot be asked', (await C('POST', '/api/referrals/' + zoho.id + '/ask', { role: 'x', message: 'y' })).status === 400);
    r = await C('GET', '/api/profile/' + names.A);
    check('profile lists open offers only', r.status === 200 && r.json.referrals.length === 7 && !r.json.referrals.some((x) => x.company === 'Zoho') && r.json.referrals.some((x) => x.company === 'Freshworks' && x.kind === 'refer'), r.json.referrals);
    check('owner resumes', (await A('POST', '/api/referrals/' + zoho.id + '/open', { open: true })).status === 200);

    await A('POST', '/api/blocks/' + names.D, {});
    r = await D('GET', '/api/referrals');
    check('blocked member does not see offers', r.json.offers.length === 0, r.json.offers.length);
    check('blocked member cannot ask', (await D('POST', '/api/referrals/' + fw.id + '/ask', { role: 'x', message: 'y' })).status === 403);
    check('blocked ask not recorded', (await A('GET', '/api/referrals')).json.offers.find((o) => o.id === fw.id).asks === 1);

    check('cannot report own offer', (await A('POST', '/api/referrals/' + zoho.id + '/report', { reason: 'x' })).status === 400);
    check('report offer', (await B('POST', '/api/referrals/' + zoho.id + '/report', { reason: 'Looks fake' })).status === 201);
    r = await C('GET', '/api/admin/reports');
    const rep = r.json.reports && r.json.reports.find((x) => x.where === 'a referral offer');
    check('moderators see the report', rep && /Knows people at Zoho/.test(rep.text) && rep.reason === 'Looks fake', r.json.reports);
    check('moderator removes it', (await C('POST', '/api/admin/reports/' + rep.id, { action: 'delete' })).status === 200);
    r = await B('GET', '/api/referrals');
    check('removed offer is gone', !r.json.offers.some((o) => o.id === zoho.id), r.json.offers.map((o) => o.company));
    check('removed offer cannot be asked', (await B('POST', '/api/referrals/' + zoho.id + '/ask', { role: 'x', message: 'y' })).status === 404);

    check('others cannot delete', (await B('DELETE', '/api/referrals/' + fw.id)).status === 403);
    check('owner deletes', (await A('DELETE', '/api/referrals/' + fw.id)).status === 200);
    check('can list the company again after deleting', (await A('POST', '/api/referrals', { company: 'Freshworks' })).status === 201);
    check('moderator can delete any offer', (await C('DELETE', '/api/referrals/' + r.json.offers.find((o) => o.company === 'Swiggy').id)).status === 200);
    r = await B('POST', '/api/chat/dm/' + names.A, { text: 'normal chat still works' });
    check('ordinary DMs still work', r.status === 201 && r.json.msg.text === 'normal chat still works', r.json);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); feeds.close(); if (turso) turso.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (results.some((x) => x.startsWith('FAIL'))) console.log(log.split('\n').slice(-15).join('\n'));
  process.exit(0);
})();
