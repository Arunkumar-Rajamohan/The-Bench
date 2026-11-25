// Profiles test: node tests/both/profile.test.js <server.js> <mode: local|hosted>
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const [serverJs, mode] = process.argv.slice(2);
const PORT = 5193, MOCK = 8093;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prof-'));
const base = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => crypto.randomBytes(3).toString('hex');

function startMock(db) {
  const dec = (a) => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.value;
  const enc = (v) => v === null ? { type: 'null' } : typeof v === 'number' || typeof v === 'bigint' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) };
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end(); }
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
        } catch (e) { return { type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } }; }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  }).listen(MOCK, '127.0.0.1');
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
  const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: tmp, ADMIN_USERNAMES: admin });
  let mock;
  if (mode === 'hosted') {
    mock = startMock(new DatabaseSync(':memory:'));
    Object.assign(env, { TURSO_DATABASE_URL: 'http://127.0.0.1:' + MOCK, TURSO_AUTH_TOKEN: 'test-token', NODE_ENV: 'production' });
  }
  const child = spawn(process.execPath, [serverJs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => log += d); child.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/running at|Could not start/.test(log); i++) await wait(100);

  const results = [];
  const check = (name, ok, extra) => results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300)));
  const A = member(), B = member(), M = member();
  const ua = 'pa_' + rnd(), ub = 'pb_' + rnd(), pwA = crypto.randomUUID();
  const now = new Date(); const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const future = (now.getFullYear() + 1) + '-01';
  try {
    for (const [c, u, pw] of [[A, ua, pwA], [B, ub, crypto.randomUUID()], [M, admin, crypto.randomUUID()]]) {
      const r = await c('POST', '/api/signup', { username: u, name: 'N ' + u, password: pw });
      if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r));
    }
    check('anonymous blocked', (await member()('GET', '/api/profile/' + ua)).status === 401 && (await member()('GET', '/api/people')).status === 401);
    let r = await A('GET', '/api/profile/' + ua);
    check('blank profile to start', r.status === 200 && r.json.me === true && r.json.profile.status === 'looking' && r.json.profile.headline === '' && r.json.stats.posts === 0, r.json);
    check('profileDone false at first', (await A('GET', '/api/me')).json.user.profileDone === false);
    check('unknown member 404', (await A('GET', '/api/profile/nobody_zz')).status === 404);

    const good = { name: 'Arun <b>K</b>', status: 'interviewing', headline: '  Junior   frontend developer ', since: '2026-03', location: 'Chennai',
      openTo: ['Remote', 'Hybrid', 'Space'], skills: 'React, css, CSS, Figma, ', bio: 'Line one\n\n\n\nLine two', link: 'https://example.com/me', color: 'sage' };
    const bad = [
      ['missing name', Object.assign({}, good, { name: '  ' })],
      ['headline too long', Object.assign({}, good, { headline: 'x'.repeat(61) })],
      ['bio too long', Object.assign({}, good, { bio: 'x'.repeat(281) })],
      ['future month', Object.assign({}, good, { since: future })],
      ['bad month format', Object.assign({}, good, { since: '2026-13' })],
      ['javascript link', Object.assign({}, good, { link: 'javascript:alert(1)' })],
      ['ftp link', Object.assign({}, good, { link: 'ftp://example.com' })],
      ['link with password', Object.assign({}, good, { link: 'https://user:pw@example.com' })],
      ['not a link', Object.assign({}, good, { link: 'hello' })],
      ['too many skills', Object.assign({}, good, { skills: 'a,b,c,d,e,f,g,h,i' })],
      ['skill too long', Object.assign({}, good, { skills: 'x'.repeat(25) })]
    ];
    for (const [label, body] of bad) check('rejects ' + label, (await A('PUT', '/api/profile', body)).status === 400);
    check('this month is allowed', (await A('PUT', '/api/profile', Object.assign({}, good, { since: thisMonth }))).status === 200);

    r = await A('PUT', '/api/profile', good);
    const p = r.json.profile;
    check('save profile', r.status === 200 && r.json.name === 'Arun <b>K</b>', r.json);
    check('cleans text', p.headline === 'Junior frontend developer' && p.bio === 'Line one\n\nLine two', p);
    check('filters open-to and dedupes skills', JSON.stringify(p.openTo) === '["Remote","Hybrid"]' && JSON.stringify(p.skills) === '["React","css","Figma"]', p);
    check('keeps colour, status, link', p.color === 'sage' && p.status === 'interviewing' && p.link === 'https://example.com/me', p);
    r = await A('PUT', '/api/profile', Object.assign({}, good, { color: 'neon', status: 'boss' }));
    check('unknown colour/status fall back', r.json.profile.color === 'tomato' && r.json.profile.status === 'looking');
    await A('PUT', '/api/profile', good);

    check('name change shows in session', (await A('GET', '/api/me')).json.user.name === 'Arun <b>K</b>');
    check('profileDone true after saving', (await A('GET', '/api/me')).json.user.profileDone === true);
    check('login reports profileDone', (await member()('POST', '/api/login', { username: ua, password: pwA })).json.user.profileDone === true);

    await A('POST', '/api/posts', { text: 'hello', tag: 'Win' });
    await A('POST', '/api/fun/qotd', { text: 'my answer' });
    r = await B('GET', '/api/profile/' + ua);
    check('others can view', r.status === 200 && r.json.me === false && r.json.profile.headline === 'Junior frontend developer' && r.json.blockedByMe === false, r.json);
    check('stats count posts and answers', r.json.stats.posts === 1 && r.json.stats.answers === 1 && r.json.stats.solved === 0, r.json.stats);
    await B('POST', '/api/blocks/' + ua);
    check('blockedByMe shows', (await B('GET', '/api/profile/' + ua)).json.blockedByMe === true);
    await B('DELETE', '/api/blocks/' + ua);

    r = await B('GET', '/api/people');
    const pa = (r.json.people || []).find((x) => x.username === ua);
    check('people list', r.status === 200 && r.json.people.length === 3 && pa && pa.headline === 'Junior frontend developer' && pa.color === 'sage' && pa.status === 'interviewing', r.json);
    check('people list marks me', r.json.people.find((x) => x.username === ub).me === true && pa.me === false);
    check('people list is newest profile first', r.json.people[0].username === ua);

    // reporting
    check('cannot report own profile', (await A('POST', '/api/profile/' + ua + '/report', {})).status === 400);
    check('cannot report empty profile', (await A('POST', '/api/profile/' + ub + '/report', {})).status === 400);
    check('B reports A profile', (await B('POST', '/api/profile/' + ua + '/report', { reason: 'spam link' })).status === 201);
    check('non-moderator cannot see reports', (await B('GET', '/api/admin/reports')).status === 403);
    r = await M('GET', '/api/admin/reports');
    const rep = (r.json.reports || [])[0];
    check('moderator sees profile snapshot', rep && rep.where === 'a profile' && rep.author === ua && rep.reason === 'spam link' &&
      rep.text.includes('Looking for: Junior frontend developer') && rep.text.includes('https://example.com/me'), r.json);
    check('snapshot not in any room or feed', !(await B('GET', '/api/chat/summary')).json.rooms.some((x) => x.lastId > 0) &&
      !(await B('GET', '/api/fun/qotd')).json.answers.some((x) => x.text.includes('Looking for')));
    check('clear profile', (await M('POST', '/api/admin/reports/' + rep.id, { action: 'delete' })).status === 200);
    r = await B('GET', '/api/profile/' + ua);
    check('profile cleared, name and account kept', r.status === 200 && r.json.profile.headline === '' && r.json.profile.bio === '' && r.json.name === 'Arun <b>K</b>', r.json);
    check('report resolved', (await M('GET', '/api/admin/reports')).json.reports.length === 0);
    check('owner can log in still', (await A('GET', '/api/me')).status === 200);

    await A('PUT', '/api/profile', good);
    await B('POST', '/api/profile/' + ua + '/report', { reason: 'again' });
    r = await M('GET', '/api/admin/reports');
    check('ban from profile report', (await M('POST', '/api/admin/reports/' + r.json.reports[0].id, { action: 'ban' })).status === 200);
    check('banned profile hidden', (await B('GET', '/api/profile/' + ua)).status === 404);
    check('banned person gone from people', !(await B('GET', '/api/people')).json.people.some((x) => x.username === ua));
    check('banned person signed out', (await A('GET', '/api/me')).status === 401);
  } catch (e) { results.push('FAIL crashed: ' + e.stack); }
  child.kill(); if (mock) mock.close();
  await wait(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* locked */ }
  console.log(mode + ': ' + results.filter((x) => x.startsWith('PASS')).length + '/' + results.length + ' passed');
  results.filter((x) => x.startsWith('FAIL')).forEach((x) => console.log(x));
  if (/Error/.test(log.replace(/ExperimentalWarning[^\n]*/g, ''))) console.log('server log:\n' + log.slice(-2000));
  process.exit(0);
})();
