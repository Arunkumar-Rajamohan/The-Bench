// Awkward situations, through the app's own UI in two real browsers.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9343), B = await device(9344);
  const stashes = (d) => d.js(`return Object.keys(localStorage).filter(k => k.startsWith('bench:unsaved:')).length;`);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  try {
    const u = 'hard_' + crypto.randomBytes(3).toString('hex'), pw = crypto.randomUUID();
    await A.load('home'); await post(A, '/api/signup', { username: u, name: 'Hard', password: pw });
    await B.load('home'); await post(B, '/api/login', { username: u, password: pw });

    // live: a change on one shows on the other, without disturbing typing there
    await A.load('tracker'); await B.load('tracker');
    await A.type('form[data-form=app] [name=title]', 'Half typed title');
    await A.js(`document.querySelector('form[data-form=app] [name=title]').setSelectionRange(4, 4);`);
    await B.js(`const f = document.querySelector('form[data-form=app]'); f.title.value = 'Job from B'; f.company.value = 'Bco'; f.requestSubmit();`); await wait(2500);
    let r = await A.js(`const t = document.querySelector('form[data-form=app] [name=title]'); return { shown: document.body.innerText.includes('Job from B'), draft: t.value, focused: document.activeElement === t, at: t.selectionStart };`);
    check('change appears on the other device by itself', r.shown, r);
    check('half-typed form, focus and cursor survive', r.draft === 'Half typed title' && r.focused && r.at === 4, r);

    // both edit while apart
    await A.load('tracker'); await B.load('tracker');
    await A.offline(true); await B.offline(true);
    await A.js(`const f = document.querySelector('form[data-form=app]'); f.title.value = 'Only on A'; f.company.value = 'Aco'; f.requestSubmit();`);
    await B.js(`const f = document.querySelector('form[data-form=app]'); f.title.value = 'Only on B'; f.company.value = 'Bco'; f.requestSubmit();`);
    await wait(1500);
    r = await A.js(`const e = document.getElementById('savestate'); return e && !e.hidden ? e.textContent : '';`);
    check('says it is not saved yet', /Not saved yet/.test(r), r);
    await A.offline(false); await wait(5500); await B.offline(false); await wait(6500);
    let d = await A.data();
    check('jobs added offline on both survive', ['Job from B', 'Only on A', 'Only on B'].every((t) => d.apps.some((x) => x.title === t)) && d.apps.length === 3, d.apps.map((x) => x.title));
    r = await A.js(`const e = document.getElementById('savestate'); return { msg: e && !e.hidden ? e.textContent : '', all: ['Only on A', 'Only on B'].every(t => document.body.innerText.includes(t)) };`);
    check('message clears and both screens agree', r.msg === '' && r.all, r);
    check('nothing left behind in either browser', (await stashes(A)) === 0 && (await stashes(B)) === 0);

    // the same sentence edited on both while apart
    await A.load('resume'); await B.load('resume');
    await A.type('#cv-summary', 'Shared starting summary'); await wait(2500);
    r = await B.js(`return document.getElementById('cv-summary').value;`); check('resume text arrives live', r === 'Shared starting summary', r);
    await A.offline(true); await B.offline(true);
    await A.type('#cv-summary', 'Version written on device A'); await B.type('#cv-summary', 'Version written on device B'); await wait(1200);
    await A.offline(false); await wait(5000); await B.offline(false); await wait(6000);
    d = await A.data();
    const texts = [d.cv.summary].concat((d.kept || []).map((k) => k.text));
    check('both versions of the sentence still exist', texts.includes('Version written on device A') && texts.includes('Version written on device B'), texts);
    await B.load('account');
    r = await B.js(`return document.getElementById('keptcopies').innerText;`); check('kept copy listed on Account', /Kept copies/.test(r) && /Resume builder/.test(r), r);
    await B.click('[data-act=kept-del]'); await wait(1500); d = await A.data(); check('and can be removed', d.kept.length === 0, d.kept);

    // resume entries: add on one, delete on the other
    await A.load('resume'); await A.click('[data-act=cv-add][data-k=experience]'); await A.type('#cv-experience-0-role', 'First job'); await wait(2200);
    await B.load('resume'); await A.offline(true); await B.offline(true);
    await A.click('[data-act=cv-add][data-k=experience]'); await A.type('#cv-experience-1-role', 'Added on A');
    await B.click('[data-act=cv-add][data-k=experience]'); await B.type('#cv-experience-1-role', 'Added on B'); await wait(1000);
    await A.offline(false); await wait(5000); await B.offline(false); await wait(6000);
    d = await A.data(); check('resume jobs added on both survive', ['First job', 'Added on A', 'Added on B'].every((t) => d.cv.experience.some((e) => e.role === t)) && d.cv.experience.length === 3, d.cv.experience);

    // server goes away mid-edit and the page is closed before it returns
    await A.load('resume'); await stopServer();
    await A.type('#cv-phone', 'typed while server down'); await wait(1500);
    check('kept in this browser', (await stashes(A)) >= 1);
    await A.cmd('Page.navigate', { url: 'about:blank' }); await wait(500);
    await startServer(); await A.load('resume'); await wait(2500);
    d = await A.data(); check('edit survives server restart and closed page', d.cv.phone === 'typed while server down', d.cv.phone);
    check('browser copy removed after saving', (await stashes(A)) === 0);

    // logged out elsewhere while something is unsaved
    await A.load('resume'); await A.offline(true); await A.type('#cv-languages', 'Unsaved at expiry'); await wait(900);
    const npw = crypto.randomUUID();
    await B.js(`await fetch('/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '${pw}', newPassword: '${npw}' }) });`);
    await A.offline(false); await wait(7000);
    r = await A.js(`return !!document.querySelector('form[data-form=auth]');`); check('signed out page shows login', r);
    check('unsaved copy waits for the next login', (await stashes(A)) >= 1);
    // another person logs in on the same device first: must not receive it
    const o = 'oth_' + crypto.randomBytes(3).toString('hex');
    await post(A, '/api/signup', { username: o, name: 'Other', password: npw }); await A.load('resume'); await wait(1500);
    d = await A.data(); check('another person on this device does not get it', !JSON.stringify(d).includes('Unsaved at expiry'), d);
    await post(A, '/api/logout', {}); await post(A, '/api/login', { username: u, password: npw }); await A.load('resume'); await wait(3000);
    d = await A.data(); check('restored after logging in again', d.cv.languages === 'Unsaved at expiry', d.cv.languages);

    // logging out on purpose with unsaved changes
    await A.load('home'); await A.offline(true);
    await A.js(`location.hash = '#/resume'; await new Promise(r => setTimeout(r, 600));`); await A.type('#cv-city', 'Never saved'); await wait(700);
    A.acceptDialogs = false; await A.js(`location.hash = '#/home'; await new Promise(r => setTimeout(r, 500)); document.querySelector('[data-act=logout]').click();`); await wait(1500);
    r = await A.js(`return !document.querySelector('form[data-form=auth]');`); check('asks before losing changes; "cancel" stays in', r);
    A.acceptDialogs = true; await A.click('[data-act=logout]'); await wait(2000);
    r = await A.js(`return !!document.querySelector('form[data-form=auth]');`); check('"ok" logs out', r);
    check('and leaves nothing private in the browser', (await stashes(A)) === 0);
    await A.offline(false);

    // an older tab that does not know about a newer feature must not erase it
    await B.load('resume');
    await B.js(`const j = await (await fetch('/api/me')).json(); j.data.futureFeature = { x: 1 }; await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(j.rev) }, body: JSON.stringify(j.data) });`); await wait(1500);
    await B.type('#cv-headline', 'After future'); await wait(2500);
    d = await B.data(); check('unknown newer data survives', d.futureFeature && d.futureFeature.x === 1 && d.cv.headline === 'After future', Object.keys(d));

    // fast typing while the other device keeps saving
    await post(A, '/api/login', { username: u, password: npw }); await A.load('salary'); await B.load('resume');
    const typing = B.js(`const e = document.getElementById('cv-summary'); e.focus(); e.value = ''; const s = 'The quick brown fox jumps over the lazy dog again and again'; for (const c of s) { const x = document.activeElement; x.value += c; x.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 70)); } return document.activeElement.id;`);
    for (let i = 0; i < 8; i++) { await A.type('#sal-a-ctc', String(5 + i)); await wait(500); }
    const where = await typing; await wait(3500);
    d = await B.data(); check('typing is not scrambled by live updates', where === 'cv-summary' && d.cv.summary === 'The quick brown fox jumps over the lazy dog again and again' && d.salary.a.ctc === '12', [where, d.cv.summary, d.salary && d.salary.a.ctc]);
    check('no needless kept copies', (d.kept || []).length === 0, d.kept);

    // quiet when idle: no save loop
    await wait(1500); const r1 = await B.js(`return (await (await fetch('/api/me')).json()).rev;`); await wait(5000); const r2 = await B.js(`return (await (await fetch('/api/me')).json()).rev;`);
    check('no endless saving between two open devices', r1 === r2, [r1, r2]);
    // old account data without entry ids
    await B.js(`const j = await (await fetch('/api/me')).json(); j.data.cv.experience.forEach(e => delete e.id); await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(j.rev) }, body: JSON.stringify(j.data) });`); await wait(3000);
    d = await B.data(); check('old entries without ids load fine', d.cv.experience.length === 3, d.cv.experience);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('hard cases: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); console.log('page errors: ' + errs.length, errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
