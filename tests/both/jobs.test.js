// Jobs v2 test: node tests/both/jobs.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const EMPLOYERS = require(path.join(path.dirname(serverJs), 'employers.js'));
const PORT = 5191, FEEDS = 8091, TURSO = 8090;
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');
const now = Date.now();

// ---- stand-in for Greenhouse, Lever and Ashby ----
let feedCalls = 0;
const feeds = http.createServer((req, res) => {
  feedCalls++;
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let m;
  if ((m = /^\/v1\/boards\/([^/]+)\/jobs$/.exec(u.pathname))) {
    if (m[1] === 'okta') return send(500, { error: 'down' }); // one broken feed must not break the rest
    if (m[1] !== 'stripe') return send(200, { jobs: [] });
    return send(200, { meta: { name: 'Stripe' }, jobs: [
      { id: 1, title: 'Account Executive, India', absolute_url: 'https://stripe.com/jobs/1', location: { name: 'Bangalore' }, first_published: new Date(now - 864e5).toISOString() },
      { id: 2, title: 'Support Specialist &amp; Ops', absolute_url: 'https://stripe.com/jobs/2', location: { name: 'Remote - India' }, updated_at: new Date(now - 2 * 864e5).toISOString() },
      { id: 3, title: 'US Only Engineer', absolute_url: 'https://stripe.com/jobs/3', location: { name: 'San Francisco, CA' }, updated_at: new Date(now).toISOString() },
      { id: 4, title: 'Insecure Link Role', absolute_url: 'http://stripe.example/4', location: { name: 'Mumbai' }, updated_at: new Date(now).toISOString() }
    ] });
  }
  if ((m = /^\/v0\/postings\/([^/]+)$/.exec(u.pathname))) {
    if (m[1] !== 'cred') return send(200, []);
    return send(200, [
      { id: 'a1', text: 'Finance Manager', hostedUrl: 'https://jobs.lever.co/cred/a1', createdAt: now - 3 * 864e5, workplaceType: 'onsite', country: 'IN',
        categories: { location: 'Hyderabad', allLocations: ['Hyderabad', 'Bengaluru'], team: 'Finance', commitment: 'Full Time' } },
      { id: 'a2', text: 'Country-only role', hostedUrl: 'https://jobs.lever.co/cred/a2', createdAt: now - 4 * 864e5, country: 'IN', categories: {} },
      { id: 'a3', text: 'London role', hostedUrl: 'https://jobs.lever.co/cred/a3', createdAt: now, country: 'GB', categories: { location: 'London' } }
    ]);
  }
  if ((m = /^\/posting-api\/job-board\/([^/]+)$/.exec(u.pathname))) {
    if (m[1] !== 'notion') return send(200, { jobs: [] });
    return send(200, { jobs: [
      { id: 'n1', title: 'Product Support Specialist', jobUrl: 'https://jobs.ashbyhq.com/notion/n1', location: 'Hyderabad, India', isRemote: true,
        publishedAt: new Date(now - 5 * 864e5).toISOString(), employmentType: 'FullTime', department: 'Support' },
      { id: 'n2', title: 'Hidden Role', jobUrl: 'https://jobs.ashbyhq.com/notion/n2', location: 'Mumbai', isListed: false, publishedAt: new Date(now).toISOString() },
      { id: 'n3', title: 'NYC Role', jobUrl: 'https://jobs.ashbyhq.com/notion/n3', location: 'New York', publishedAt: new Date(now).toISOString() }
    ] });
  }
  if ((m = /^\/v1\/companies\/([^/]+)\/postings$/.exec(u.pathname))) {
    if (u.searchParams.get('country') !== 'in') return send(400, {});
    if (m[1] !== 'swiggy') return send(200, { content: [], totalFound: 0 });
    return send(200, { totalFound: 2, content: [
      { id: '6000000001', name: 'Partner Success Manager', releasedDate: new Date(now - 6 * 864e5).toISOString(), location: { city: 'kolkata', country: 'in', remote: false },
        typeOfEmployment: { label: 'Full-time' }, department: {}, function: { label: 'Sales' } },
      { id: '6000000002', name: 'Executive Maintenance', releasedDate: new Date(now - 7 * 864e5).toISOString(), location: { city: 'Delhi', country: 'in', remote: false },
        typeOfEmployment: { label: 'Full-time' }, department: {}, function: { label: 'Engineering' } }
    ] });
  }
  send(404, {});
}).listen(FEEDS, '127.0.0.1');

// ---- stand-in for Turso (hosted mode) ----
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
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
}

(async () => {
  const admin = 'mod_' + rnd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-jobs2-'));
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: admin,
    GREENHOUSE_BASE_URL: 'http://127.0.0.1:' + FEEDS, SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:' + FEEDS, LEVER_BASE_URL: 'http://127.0.0.1:' + FEEDS, ASHBY_BASE_URL: 'http://127.0.0.1:' + FEEDS
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
  const A = member(), B = member(), M = member();
  const ua = 'la_' + rnd(), ub = 'lb_' + rnd();
  try {
    for (const [c, u] of [[A, ua], [B, ub], [M, admin]]) {
      const r = await c('POST', '/api/signup', { username: u, name: 'N ' + u, password: crypto.randomUUID() });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }

    // ----- employer feeds -----
    check('anonymous blocked', (await member()('GET', '/api/jobs')).status === 401);
    let r = await A('GET', '/api/jobs');
    const titles = (r.json.jobs || []).map((j) => j.title);
    check('first load gathers all feeds', r.status === 200 && feedCalls === EMPLOYERS.length && r.json.companies === EMPLOYERS.length, { status: r.status, feedCalls, n: EMPLOYERS.length });
    check('only India roles, unsafe links dropped, hidden skipped', r.json.total === 7 &&
      JSON.stringify(titles.slice().sort()) === JSON.stringify(['Account Executive, India', 'Country-only role', 'Executive Maintenance', 'Finance Manager', 'Partner Success Manager', 'Product Support Specialist', 'Support Specialist & Ops']), titles);
    check('newest first', titles[0] === 'Account Executive, India' && titles[6] === 'Executive Maintenance', titles);
    const sw = r.json.jobs.find((j) => j.title === 'Partner Success Manager');
    check('smartrecruiters job tidy', sw.company === 'Swiggy' && sw.location === 'Kolkata' && sw.type === 'Full-time' && sw.url === 'https://jobs.smartrecruiters.com/swiggy/6000000001', sw);
    const fieldOf = (t) => r.json.jobs.find((j) => j.title === t).field;
    check('fields guessed', fieldOf('Account Executive, India') === 'sales' && fieldOf('Support Specialist & Ops') === 'support' && fieldOf('Finance Manager') === 'finance' &&
      fieldOf('Product Support Specialist') === 'support' && fieldOf('Partner Success Manager') === 'support' && fieldOf('Executive Maintenance') === 'operations',
      r.json.jobs.map((j) => j.title + '=' + j.field));
    check('field counts returned', r.json.fields.find((f) => f.key === 'support').count === 3 && r.json.nontech === 7 && r.json.partial === false, r.json.fields);
    const fin = r.json.jobs.find((j) => j.title === 'Finance Manager');
    check('lever job tidy', fin.company === 'CRED' && fin.location === 'Hyderabad · Bengaluru' && fin.team === 'Finance' && fin.type === 'Full Time' && fin.url === 'https://jobs.lever.co/cred/a1' && !fin.remote, fin);
    const co = r.json.jobs.find((j) => j.title === 'Country-only role');
    check('country-only lever role shows India', co.location === 'India', co);
    const no = r.json.jobs.find((j) => j.company === 'Notion');
    check('ashby job tidy', no.remote === true && no.type === 'Full-time' && no.team === 'Support' && no.location === 'Hyderabad, India', no);
    const sup = r.json.jobs.find((j) => j.title.startsWith('Support'));
    check('greenhouse remote India', sup.remote === true && sup.company === 'Stripe', sup);

    const calls = feedCalls;
    r = await A('GET', '/api/jobs?what=support');
    check('search by word', r.json.total === 2 && r.json.jobs.every((j) => /support/i.test(j.title)), r.json.jobs.map((j) => j.title));
    check('field filter', (await A('GET', '/api/jobs?field=support')).json.total === 3 && (await A('GET', '/api/jobs?field=sales')).json.total === 1);
    r = await A('GET', '/api/jobs?field=finance&what=cred');
    check('field + search, counts ignore the field', r.json.total === 1 && r.json.fields.reduce((n, f) => n + f.count, 0) === 2, r.json);
    check('unknown field is ignored', (await A('GET', '/api/jobs?field=astronaut')).json.total === 7);
    check('served from memory, no new feed calls', feedCalls === calls);
    check('search by company', (await A('GET', '/api/jobs?what=cred')).json.total === 2);
    check('search by team', (await A('GET', '/api/jobs?what=finance')).json.total === 1);
    check('multi-word search', (await A('GET', '/api/jobs?what=account%20india')).json.total === 1);
    r = await A('GET', '/api/jobs?where=bangalore');
    check('city alias: bangalore finds Bengaluru too', r.json.total === 2, r.json.jobs.map((j) => j.location));
    check('remote filter', (await A('GET', '/api/jobs?remote=1')).json.total === 2);
    check('city with lowercase source data', (await A('GET', '/api/jobs?where=kolkata')).json.total === 1);
    check('city + remote', (await A('GET', '/api/jobs?where=hyderabad&remote=1')).json.jobs.map((j) => j.title).join() === 'Product Support Specialist');
    check('paging past the end is empty', (await A('GET', '/api/jobs?page=2')).json.jobs.length === 0);

    // ----- member leads -----
    check('leads start empty', (await A('GET', '/api/leads')).json.leads.length === 0);
    const lead = { title: 'Customer Support Executive', company: 'Kettle & Co', location: 'Chennai', url: 'https://kettle.example/careers/42', note: 'I can refer you' };
    check('rejects missing title', (await A('POST', '/api/leads', Object.assign({}, lead, { title: ' ' }))).status === 400);
    check('rejects missing link', (await A('POST', '/api/leads', Object.assign({}, lead, { url: '' }))).status === 400);
    check('rejects javascript link', (await A('POST', '/api/leads', Object.assign({}, lead, { url: 'javascript:alert(1)' }))).status === 400);
    check('rejects link with password', (await A('POST', '/api/leads', Object.assign({}, lead, { url: 'https://a:b@x.com' }))).status === 400);
    check('rejects long note', (await A('POST', '/api/leads', Object.assign({}, lead, { note: 'x'.repeat(281) }))).status === 400);
    check('share a lead', (await A('POST', '/api/leads', lead)).status === 201);
    r = await B('GET', '/api/leads');
    const L = r.json.leads[0];
    check('others see it', L && L.title === lead.title && L.company === 'Kettle & Co' && L.url === lead.url && L.note === lead.note && L.own === false && L.votes === 0 && L.username === ua, L);
    check('owner sees own flag', (await A('GET', '/api/leads')).json.leads[0].own === true);
    check('vote', (await B('POST', '/api/leads/' + L.id + '/vote', {})).status === 200);
    r = await B('GET', '/api/leads');
    check('vote counted and mine', r.json.leads[0].votes === 1 && r.json.leads[0].mine === true, r.json.leads[0]);
    await B('POST', '/api/leads/' + L.id + '/vote', {});
    check('vote toggles off', (await B('GET', '/api/leads')).json.leads[0].votes === 0);
    check('others cannot delete', (await B('DELETE', '/api/leads/' + L.id)).status === 403);
    check('cannot report own', (await A('POST', '/api/leads/' + L.id + '/report', {})).status === 400);

    await B('POST', '/api/blocks/' + ua);
    check('blocked author hidden', (await B('GET', '/api/leads')).json.leads.length === 0);
    await B('DELETE', '/api/blocks/' + ua);

    check('B reports lead', (await B('POST', '/api/leads/' + L.id + '/report', { reason: 'asks for fee' })).status === 201);
    r = await M('GET', '/api/admin/reports');
    const rep = (r.json.reports || [])[0];
    check('moderator sees job lead report', rep && rep.where === 'a job lead' && rep.text.includes('Customer Support Executive at Kettle & Co') && rep.text.includes(lead.url) && rep.reason === 'asks for fee', r.json);
    check('moderator deletes lead from report', (await M('POST', '/api/admin/reports/' + rep.id, { action: 'delete' })).status === 200);
    check('lead gone for everyone', (await B('GET', '/api/leads')).json.leads.length === 0 && (await A('GET', '/api/leads')).json.leads.length === 0);
    check('acting on gone lead 404', (await B('POST', '/api/leads/' + L.id + '/vote', {})).status === 404);

    for (let i = 0; i < 4; i++) await A('POST', '/api/leads', Object.assign({}, lead, { title: 'Lead ' + i }));
    check('owner deletes own', (await A('DELETE', '/api/leads/' + (await A('GET', '/api/leads')).json.leads[0].id)).status === 200);
    check('daily limit of 5', (await A('POST', '/api/leads', lead)).status === 429);
    const other = (await B('GET', '/api/leads')).json.leads[0];
    check('moderator deletes any', (await M('DELETE', '/api/leads/' + other.id)).status === 200);

    // ban hides leads
    await B('POST', '/api/leads', lead);
    await A('POST', '/api/chat/room/lobby', { text: 'spam' });
    const msgId = (await M('GET', '/api/chat/room/lobby')).json.messages[0].id;
    await B('POST', '/api/chat/msg/' + msgId + '/report', {});
    await M('POST', '/api/admin/reports/' + (await M('GET', '/api/admin/reports')).json.reports[0].id, { action: 'ban' });
    check('banned member\'s leads hidden', !(await B('GET', '/api/leads')).json.leads.some((x) => x.username === ua));
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); feeds.close(); if (turso) turso.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error(?!.*Job feeds failed)/.test(log.replace(/ExperimentalWarning[^\n]*/g, '').replace(/Job feeds failed[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-1500));
  process.exit(0);
})();
