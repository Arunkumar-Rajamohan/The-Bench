// Notifications through a real browser and its real push service (needs the internet).
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp, BASE } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9373), B = await device(9374), D = await device(9375);
  const post = (d, url, body, method) => d.js(`return (await fetch('${url}', { method: '${method || 'POST'}', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const shown = (d) => d.js(`const r = await navigator.serviceWorker.ready; return (await r.getNotifications()).map(x => ({ title: x.title, body: x.body, tag: x.tag, url: x.data.url }));`);
  const wipe = (d) => d.js(`const r = await navigator.serviceWorker.ready; (await r.getNotifications()).forEach(x => x.close());`);
  const until = async (f, secs) => { for (let i = 0; i < secs * 2; i++) { const x = await f(); if (x) return x; await wait(500); } return null; };
  const card = (d) => d.js(`return document.getElementById('pushcard').innerText;`);
  const sub = (d) => d.js(`const r = await navigator.serviceWorker.ready; const s = await r.pushManager.getSubscription(); return s ? s.endpoint : null;`);
  const signup = (d, u, n, p) => post(d, '/api/signup', { username: u, name: n, password: p });
  try {
    const pw = crypto.randomUUID(), a = 'na_' + crypto.randomBytes(3).toString('hex'), b = 'nb_' + crypto.randomBytes(3).toString('hex'), c = 'nc_' + crypto.randomBytes(3).toString('hex');
    await A.cmd('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] });
    await A.load('home'); await signup(A, a, 'Asha', pw); await B.load('home'); await signup(B, b, 'Bala', pw);
    await A.load('account'); await wait(800);
    check('off by default, even when the browser allows it', /Turn on for this device/.test(await card(A)) && !(await sub(A)), await card(A));
    await A.click('[data-act=push-on]');
    check('turns on', await until(async () => /On for this device/.test(await card(A)), 15), await card(A));
    check('moderator choice hidden from members', !/moderators/.test(await card(A)));
    await A.click('[data-act=push-test]'); check('test notification appears', await until(async () => (await shown(A)).find((x) => x.tag === 'test'), 20)); await wipe(A);

    // page not being looked at (minimised/another site): a private message
    const t = (await A.cmd('Target.createTarget', { url: 'about:blank' })).result.targetId; await A.cmd('Target.activateTarget', { targetId: t }); await A.cmd('Emulation.setFocusEmulationEnabled', { enabled: false }); await wait(800);
    await post(B, '/api/chat/dm/' + a, { text: 'SECRET words' });
    const dm = await until(async () => (await shown(A)).find((x) => x.tag === 'dm-' + b), 20);
    check('message notification while in the background', dm && dm.title === 'Bala' && dm.body === 'Sent you a private message.' && dm.url === '/#/dm/' + b, [dm, await shown(A)]);
    await wipe(A);
    // tapping it opens the right chat
    await A.js(`const r = await navigator.serviceWorker.ready; navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: '/#/dm/${b}' } }));`); await wait(500);
    check('a tap opens that chat', (await A.js(`return location.hash;`)) === '#/dm/' + b);
    await A.js(`navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: 'https://evil.example/' } }));`); await wait(300);
    check('but never another website', (await A.js(`return location.href;`)).startsWith(BASE));

    // choices stick
    await A.load('account'); await until(async () => /On for this device/.test(await card(A)), 8);
    await A.js(`const x = document.querySelector('[data-push=dm]'); x.checked = false; x.dispatchEvent(new Event('change', { bubbles: true }));`); await wait(700);
    await A.load('account'); await until(async () => /On for this device/.test(await card(A)), 8);
    check('choice is remembered', (await A.js(`return document.querySelector('[data-push=dm]').checked;`)) === false && (await A.js(`return document.querySelector('[data-push=due]').checked;`)));
    await A.js(`const x = document.querySelector('[data-push=dm]'); x.checked = true; x.dispatchEvent(new Event('change', { bubbles: true }));`); await wait(500);

    // password change on this device: still on afterwards
    const npw = crypto.randomUUID();
    await A.js(`const f = document.querySelector('form[data-form=password]'); f.password.value = '${pw}'; f.newPassword.value = '${npw}'; f.requestSubmit();`); await wait(2500);
    await A.load('account'); await until(async () => /On for this device/.test(await card(A)), 8); await A.click('[data-act=push-test]');
    check('still works after changing the password', await until(async () => (await shown(A)).find((x) => x.tag === 'test'), 15), await A.js(`return document.getElementById('toast').innerText;`)); await wipe(A);

    // logging out
    await A.load('home'); await A.js(`document.querySelector('[data-act=logout]').click();`); await wait(4000);
    check('logging out removes this device', !(await sub(A)) && (await A.js(`return localStorage.getItem('bench:push');`)) === null);
    await post(B, '/api/chat/dm/' + a, { text: 'after logout' }); await wait(4000); check('nothing arrives after logging out', (await shown(A)).length === 0, await shown(A));

    // the log-in ended without logging out, and someone else uses the device
    await post(A, '/api/login', { username: a, password: npw }); await A.load('account'); await wait(800); await A.click('[data-act=push-on]'); await until(async () => /On for this device/.test(await card(A)), 15);
    const first = await sub(A); check('on again', !!first);
    await A.js(`await fetch('/api/logout', { method: 'POST' });`); await signup(A, c, 'Chitra', pw); await A.load('account'); await wait(3500);
    check('next person does not inherit it', (await sub(A)) !== first && /Turn on for this device/.test(await card(A)), [await card(A)]);

    // a browser that never answers must not leave the button stuck
    await B.cmd('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] }); await B.load('account'); await wait(800);
    await B.js(`PushManager.prototype.subscribe = () => new Promise(() => {}); document.querySelector('[data-act=push-on]').click();`); await wait(1000);
    check('button waits', await B.js(`return document.querySelector('[data-act=push-on]').disabled;`)); await wait(25500);
    check('gives up with a clear message', /could not reach its notification service/.test(await B.js(`return document.getElementById('toast').innerText;`)) && !(await B.js(`return document.querySelector('[data-act=push-on]').disabled;`)));

    // asking on Home: only when useful, and it can be refused
    await A.js(`await fetch('/api/logout', { method: 'POST' });`); await D.load('home'); const d = 'nd_' + crypto.randomBytes(3).toString('hex'); await signup(D, d, 'Dev', pw);
    await D.js(`const j = await (await fetch('/api/me')).json(); j.data.steps = { hide: true }; await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j.data) });`);
    // headless browsers say "denied" until told otherwise; a real one says "default" (not asked yet)
    await D.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Notification, 'permission', { get: () => window.__perm || 'default' }); Notification.requestPermission = async () => (window.__perm = 'denied');` });
    await D.load('home'); check('not asked when there is nothing to tell', !(await D.js(`return /Want a nudge/.test(document.getElementById('main').innerText);`)));
    await D.js(`const j = await (await fetch('/api/me')).json(); j.data.apps = [{ id: 'x', title: 'T', company: 'C', stage: 'Applied', followUp: '2030-01-01', t: 1 }]; await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j.data) });`);
    await D.load('home'); check('asked once there is', await D.js(`return /Want a nudge/.test(document.getElementById('main').innerText);`));
    await D.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true }); await D.load('home'); check('fits a phone', !(await D.js(`return document.documentElement.scrollWidth > innerWidth;`)));
    await D.click('#pushbanner [data-act=push-on]'); await wait(1200);
    check('saying no is explained and respected', /blocked/i.test(await D.js(`return document.getElementById('toast').innerText;`)) && !(await D.js(`return /Want a nudge/.test(document.getElementById('main').innerText);`)));
    await D.go('account'); await wait(900); check('account explains how to allow it', /blocked for The Bench/.test(await card(D)), await card(D)); check('account fits a phone', !(await D.js(`return document.documentElement.scrollWidth > innerWidth;`)));
    await D.load('home'); await D.click('[data-act=push-later]'); await wait(300); await D.load('home'); check('"Not now" sticks', !(await D.js(`return /Want a nudge/.test(document.getElementById('main').innerText);`)));
    // an iPhone in Safari, not added to the Home Screen
    await D.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `delete window.PushManager; Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });` });
    await D.load('account'); await wait(900); check('iPhone: told to add to Home Screen first', /first add The Bench to your Home Screen/.test(await card(D)), await card(D));
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('notifications: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = A.errors.concat(B.errors, D.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); D.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
