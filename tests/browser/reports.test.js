// The report badge, in two real browsers: a moderator and a member.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  const mod = 'mod_' + crypto.randomBytes(3).toString('hex');
  await startServer({ ADMIN_USERNAMES: mod + ',not_signed_up_yet' });
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const M = await device(9361), U = await device(9362);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const get = (d, url) => d.js(`const r = await fetch('${url}'); return { status: r.status, json: await r.json() };`);
  const badge = (d) => d.js(`const b = document.getElementById('homebadge'); return b.hidden ? '' : b.textContent;`);
  try {
    const pw = crypto.randomUUID();
    await M.load('home'); await post(M, '/api/signup', { username: mod, name: 'Mod', password: pw }); await M.load('home');
    await U.load('home'); await post(U, '/api/signup', { username: 'u_' + crypto.randomBytes(3).toString('hex'), name: 'Member', password: pw }); await U.load('home');
    check('no badge to start', (await badge(M)) === '' && !(await M.js(`return /to look at/.test(document.getElementById('main').innerText);`)));
    check('members cannot read the count', (await get(U, '/api/admin/count')).status === 403);
    const say = async (text) => M.js(`return (await (await fetch('/api/chat/room/lobby', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '${text}' }) })).json()).msg.id;`);
    const m1 = await say('one'), m2 = await say('two');
    await post(U, '/api/chat/msg/' + m1 + '/report', { reason: 'x' }); await wait(900);
    check('badge appears by itself', (await badge(M)) === '1', await badge(M));
    check('and a line on Home', /1 report from members to look at/.test(await M.js(`return document.getElementById('main').innerText;`)));
    check('a member sees neither', (await badge(U)) === '' && !/to look at/.test(await U.js(`return document.getElementById('main').innerText;`)));
    await post(U, '/api/chat/msg/' + m1 + '/report', { reason: 'again' }); await wait(600); check('reporting twice counts once', (await badge(M)) === '1', await badge(M));
    await M.go('admin'); await wait(500);
    await post(U, '/api/chat/msg/' + m2 + '/report', { reason: 'y' }); await wait(1200);
    check('open Moderation page updates itself', (await badge(M)) === '2' && /Open reports \(2\)/.test(await M.js(`return document.getElementById('main').innerText;`)));
    await M.go('account'); check('count on Account', /2 reports to look at/.test(await M.js(`return document.getElementById('reportcount').innerText;`)));
    // other kinds of report
    await post(M, '/api/referrals', { company: 'Acme' }); const o = (await get(U, '/api/referrals')).json.offers[0]; await post(U, '/api/referrals/' + o.id + '/report', { reason: 'z' });
    await post(M, '/api/leads', { title: 'T', company: 'C', url: 'https://example.com/x' }); const l = (await get(U, '/api/leads')).json.leads[0]; await post(U, '/api/leads/' + l.id + '/report', { reason: 'z' });
    await M.js(`await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Mod', headline: 'H', bio: 'B', location: '', link: '', since: '', skills: [], openTo: [], status: 'looking', color: 'tomato' }) });`);
    const ps = await post(U, '/api/profile/' + mod + '/report', { reason: 'z' }); await wait(1200);
    check('offers, leads and profiles count too', (await badge(M)) === '5', [await badge(M), ps]);
    await M.load('home'); check('badge is there after reopening', (await badge(M)) === '5', await badge(M));
    // clear them
    const list = (await get(M, '/api/admin/reports')).json.reports;
    for (const r of list.slice(0, 4)) await post(M, '/api/admin/reports/' + r.id, { action: 'dismiss' });
    await wait(900); check('goes down as reports are handled', (await badge(M)) === '1', await badge(M));
    await post(M, '/api/admin/reports/' + list[4].id, { action: 'delete' }); await wait(900);
    check('gone when all are handled', (await badge(M)) === '' && !/to look at/.test(await M.js(`return document.getElementById('main').innerText;`)), await badge(M));
    // one more, then log out: the next person here must not see it
    const m3 = await say('three'); await post(U, '/api/chat/msg/' + m3 + '/report', { reason: 'x' }); await wait(900);
    await M.js(`document.querySelector('[data-act=logout]').click();`); await wait(1500); await post(M, '/api/signup', { username: 'n_' + crypto.randomBytes(3).toString('hex'), name: 'Next', password: pw }); await M.load('home');
    check('not shown to the next person on the device', (await badge(M)) === '');
    await M.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 740, deviceScaleFactor: 1, mobile: true });
    await post(M, '/api/logout', {}); await post(M, '/api/login', { username: mod, password: pw }); await M.load('home');
    const box = await M.js(`const b = document.getElementById('homebadge').getBoundingClientRect(); return { seen: b.width > 0 && b.bottom <= innerHeight && b.left >= 0, over: document.documentElement.scrollWidth > innerWidth };`);
    check('visible in the phone menu', box.seen && !box.over, box);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('reports: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  if (M.errors.length + U.errors.length) console.log('FAIL page errors', M.errors, U.errors);
  M.close(); U.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
