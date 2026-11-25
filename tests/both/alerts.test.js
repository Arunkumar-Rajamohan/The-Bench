// Job alerts test: node tests/both/alerts.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5189, FEEDS = 8089, TURSO = 8088;
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-alerts-'));
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, JOBS_REFRESH_MINUTES: '0.02', // refresh after ~1 second, for the test
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
  const A = member(), B = member();
  try {
    for (const c of [A, B]) {
      const r = await c('POST', '/api/signup', { username: 'al_' + rnd(), name: 'N', password: crypto.randomUUID() });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }
    check('anonymous blocked', (await member()('GET', '/api/alerts')).status === 401);
    let r = await A('GET', '/api/alerts');
    check('no alerts to start', r.status === 200 && r.json.alerts.length === 0 && r.json.totalNew === 0, r.json);
    check('needs at least one filter', (await A('POST', '/api/alerts', {})).status === 400);
    r = await A('POST', '/api/alerts', { what: '  Support ', where: 'CHENNAI', remote: false, field: 'support' });
    const al = r.json.alert;
    check('save alert', r.status === 201 && al && al.what === 'support' && al.where === 'chennai' && al.field === 'support' && al.total === 1 && al.newCount === 0, r.json);
    check('readable name', al.name === 'Customer support “support” in Chennai', al.name);
    check('same search refused', (await A('POST', '/api/alerts', { what: 'support', where: 'chennai', field: 'support' })).status === 409);
    check('unknown field is ignored, not stored', (await A('POST', '/api/alerts', { field: 'astronaut', what: 'x' })).json.alert.field === '');
    for (const f of ['sales', 'finance', 'nontech']) await A('POST', '/api/alerts', { field: f });
    check('limit of 5 alerts', (await A('POST', '/api/alerts', { field: 'people' })).status === 400);
    r = await A('GET', '/api/alerts');
    check('lists all five', r.json.alerts.length === 5 && r.json.alerts.find((a) => a.field === 'nontech').name === 'Non-tech', r.json.alerts.map((a) => a.name));
    check('others cannot see them', (await B('GET', '/api/alerts')).json.alerts.length === 0);
    check('others cannot delete them', (await B('DELETE', '/api/alerts/' + al.id)).status === 404);
    check('others cannot mark seen', (await B('POST', '/api/alerts/' + al.id + '/seen', {})).status === 404);

    // A brand new matching job is posted; the next refresh picks it up and pings open pages.
    await A.stream();
    addNew = true;
    await wait(1500);
    await A('GET', '/api/jobs'); // stale, so this starts a background refresh
    for (let i = 0; i < 40 && !A.events.some((e) => e.type === 'jobs-updated'); i++) await wait(100);
    check('open pages told about fresh listings', A.events.some((e) => e.type === 'jobs-updated'));
    r = await A('GET', '/api/alerts');
    const a1 = r.json.alerts.find((a) => a.id === al.id);
    check('new job counted', a1.newCount === 1 && a1.total === 2, a1);
    check('non-tech alert counts it too', r.json.alerts.find((a) => a.field === 'nontech').newCount === 1);
    check('sales alert does not', r.json.alerts.find((a) => a.field === 'sales').newCount === 0);
    check('total new across alerts', r.json.totalNew === 2, r.json.totalNew);

    r = await A('POST', '/api/alerts/' + al.id + '/seen', {});
    check('mark seen returns previous time', r.status === 200 && r.json.previous === a1.lastSeen, r.json);
    r = await A('GET', '/api/alerts');
    check('count resets after seen', r.json.alerts.find((a) => a.id === al.id).newCount === 0 && r.json.totalNew === 1, r.json.totalNew);

    check('delete alert', (await A('DELETE', '/api/alerts/' + al.id)).status === 200);
    check('gone', (await A('GET', '/api/alerts')).json.alerts.length === 4);
    check('can add again after deleting', (await A('POST', '/api/alerts', { where: 'pune' })).status === 201);
    if (A.stop) A.stop();
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); feeds.close(); if (turso) turso.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  process.exit(0);
})();
