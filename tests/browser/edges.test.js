// Edge cases in the real app: odd addresses, double taps on a slow connection, removing a job, a shared device.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9451);
  const post = (d, url, body, method) => d.js(`return (await fetch('${url}', { method: '${method || 'POST'}', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const posts = () => A.js(`return (await (await fetch('/api/posts')).json()).posts;`);
  // make the server slow to answer, the way a weak mobile connection feels
  const slow = (pattern, ms) => A.js(`const f = window.__realFetch || (window.__realFetch = window.fetch); window.fetch = function (u, o) { const go = () => f.call(window, u, o); return ${JSON.stringify(pattern)} && String(u).indexOf(${JSON.stringify(pattern)}) > -1 ? new Promise((r) => setTimeout(r, ${ms})).then(go) : go(); };`);
  const fast = () => A.js(`if (window.__realFetch) window.fetch = window.__realFetch;`);
  try {
    const pw = crypto.randomUUID(), a = 'ga_' + crypto.randomBytes(3).toString('hex'), b = 'gb_' + crypto.randomBytes(3).toString('hex');
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });

    // ---- addresses that are not pages ----
    for (const h of ['__proto__', 'constructor', 'toString', 'feed/constructor', 'feed/__proto__']) {
      const before = A.errors.length;
      await A.load(h); await wait(300);
      const t = await A.js(`return document.querySelector('#main h1') ? document.querySelector('#main h1').innerText : '';`);
      check('"#/' + h + '" shows a normal page, with no error', A.errors.length === before && t.length > 0, [A.errors.slice(before), t]);
    }

    // ---- double taps on a slow connection ----
    await A.load('feed'); await slow('/api/posts', 1500);
    await A.js(`const f = document.querySelector('form[data-form="post"]'); f.text.value = 'Only once please'; f.requestSubmit(); f.requestSubmit(); f.requestSubmit();`);
    check('the Post button is off while it sends', await A.js(`return document.querySelector('form[data-form="post"] button.primary').disabled;`));
    await wait(3500); await fast();
    check('three quick taps make one post', (await posts()).filter((p) => p.text === 'Only once please').length === 1, (await posts()).map((p) => p.text));
    check('and the box is empty again', (await A.js(`return document.getElementById('posttext').value;`)) === '');
    await slow('/replies', 1500);
    await A.js(`const f = document.querySelector('form[data-form="reply"]'); f.text.value = 'One reply'; f.requestSubmit(); f.requestSubmit();`);
    await wait(3500); await fast();
    check('two quick taps make one reply', (await posts())[0].replies.filter((r) => r.text === 'One reply').length === 1, (await posts())[0].replies);
    // a post that fails can be tried again
    await A.offline(true);
    await A.js(`const f = document.querySelector('form[data-form="post"]'); f.text.value = 'Offline post'; f.requestSubmit();`); await wait(800);
    check('when sending fails, the button comes back and the words stay', !(await A.js(`return document.querySelector('form[data-form="post"] button.primary').disabled;`)) && (await A.js(`return document.getElementById('posttext').value;`)) === 'Offline post');
    await A.offline(false);

    // ---- removing a tracked job asks first ----
    await A.go('tracker');
    await A.js(`const f = document.querySelector('form[data-form="app"]'); f.title.value = 'Analyst'; f.company.value = 'Acme'; f.requestSubmit();`); await wait(400);
    A.acceptDialogs = false;
    await A.click('[data-act="del-app"]'); await wait(400);
    check('saying no keeps the job', (await A.js(`return document.querySelectorAll('[data-act="del-app"]').length;`)) === 1);
    A.acceptDialogs = true;
    await A.click('[data-act="del-app"]'); await wait(400);
    check('saying yes removes it', (await A.js(`return document.querySelectorAll('[data-act="del-app"]').length;`)) === 0);

    // ---- one device, two people ----
    const B = await device(9452); await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw }); B.close();
    const scrambled = await A.js(`return (await (await fetch('/api/fun/today')).json()).puzzle.scrambled;`);
    let r = await A.js(`return (await (await fetch('/api/fun/puzzle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guess: ${JSON.stringify(scrambled)} }) })).json());`);
    const tried = r && Array.isArray(r.guesses) && r.guesses.includes(scrambled);
    await A.load('fun'); await wait(1500);
    check('setup: the first person has a guess on screen', tried && (await A.js(`return document.querySelector('#puzzle').innerText;`)).includes(scrambled), [scrambled, r]);
    // log out and in again through the app itself, without reloading the page
    await A.go('account'); await A.js(`document.querySelector('[data-act=logout]').click();`); await wait(1500);
    await A.js(`const f = document.querySelector('form[data-form="auth"]'); f.username.value = ${JSON.stringify(b)}; f.password.value = ${JSON.stringify(pw)}; f.requestSubmit();`); await wait(2500);
    check('setup: signed in as the second person, same page', /Bala/.test(await A.js(`return document.getElementById('main').innerText;`)));
    await slow('/api/fun/today', 2000);
    await A.js(`location.hash = '#/fun';`); await wait(400);
    const shown = await A.js(`return document.querySelector('#puzzle').innerText;`);
    check('the next person never sees the last one\'s puzzle guesses', !shown.includes(scrambled), shown.slice(0, 200));
    await fast();
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('edges: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = A.errors.filter((e) => !/Failed to fetch|NetworkError|Cannot reach/.test(String(e))); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
