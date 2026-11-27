// Loading while the server wakes up (Render's free plan sleeps after a quiet spell), in a real browser:
// compressed files, opening from the saved copy, a clear "waking up" message, and no log-in page for signed-in members.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp, BASE } = require('./devices.js');
(async () => {
  const delay = path.join(tmp, 'delay.txt');
  fs.writeFileSync(delay, '0');
  await startServer({ TEST_DELAY_FILE: delay });
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9491);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const safe = async (code) => { try { return await A.js(code); } catch (e) { return null; } }; // the page may be mid-load
  const state = () => safe(`const s = document.getElementById('splash-msg'); return { msg: s ? s.innerText : '', splash: !!document.getElementById('splash') && !document.getElementById('splash').classList.contains('done'), login: !!document.querySelector('form[data-form="auth"]'), home: /Asha/.test((document.getElementById('main') || {}).innerText || '') };`);
  try {
    // first visit: compressed downloads
    await A.load('home');
    const sizes = await A.js(`const e = performance.getEntriesByType('resource').find(x => /\\/app\\.js$/.test(x.name)); return e ? { enc: e.encodedBodySize, dec: e.decodedBodySize } : null;`);
    check('the app arrives compressed (about a quarter of its size)', sizes && sizes.enc > 0 && sizes.enc < sizes.dec / 3, sizes);
    const pw = crypto.randomUUID();
    await post(A, '/api/signup', { username: 'wk_' + crypto.randomBytes(3).toString('hex'), name: 'Asha', password: pw });
    await A.load('home'); await A.load('home'); // the offline helper takes over, and saves the page and code
    check('setup: the offline helper is in charge', await A.js(`return !!navigator.serviceWorker.controller;`));
    const revisit = await A.js(`const r = await fetch('/app.js', { cache: 'no-cache' }); return r.status;`);
    check('setup: the site still loads normally', revisit === 200);

    // the server is asleep: requests wait about nine seconds while it wakes, then everything is quick again
    await A.cmd('Page.navigate', { url: 'about:blank' }); await wait(200);
    fs.writeFileSync(delay, String(Date.now() + 9000));
    const t0 = Date.now(); A.cmd('Page.navigate', { url: BASE + '/#/home' }); // a real reload, not just a hash change
    let firstSplash = 0, wakingAt = 0, homeAt = 0, sawLogin = false;
    while (Date.now() - t0 < 25000) {
      const s = await state();
      if (s) {
        if (s.splash && !firstSplash) firstSplash = Date.now() - t0;
        if (/Waking up The Bench/.test(s.msg) && !wakingAt) wakingAt = Date.now() - t0;
        if (s.login) sawLogin = true;
        if (s.home && !s.splash) { homeAt = Date.now() - t0; break; }
      }
      await wait(250);
    }
    check('the page opens from the saved copy within about 4 seconds, not after the server', firstSplash > 0 && firstSplash < 5500, firstSplash);
    check('then it says the server is waking up', wakingAt > 0 && wakingAt < 10000, wakingAt);
    check('and opens Home as soon as the server is awake', homeAt > 8500 && homeAt < 14000, homeAt);
    check('a signed-in member never sees the log-in page meanwhile', !sawLogin);

    // the server answers "not ready" for a while
    fs.writeFileSync(delay, 'down');
    await A.cmd('Page.navigate', { url: 'about:blank' }); await wait(200);
    const t1 = Date.now(); A.cmd('Page.navigate', { url: BASE + '/#/home' }); // a real reload, not just a hash change
    sawLogin = false; homeAt = 0; let wakingDown = false;
    setTimeout(() => fs.writeFileSync(delay, '0'), 6000); // ready after six seconds
    while (Date.now() - t1 < 30000) {
      const s = await state();
      if (s) {
        if (s.login) sawLogin = true;
        if (/Waking up The Bench/.test(s.msg)) wakingDown = true;
        if (s.home && !s.splash) { homeAt = Date.now() - t1; break; }
      }
      await wait(250);
    }
    check('when the server is not ready yet, it says so and keeps trying', wakingDown, wakingDown);
    check('then carries on to Home, never to the log-in page', homeAt > 5000 && homeAt < 25000 && !sawLogin, { homeAt, sawLogin });

    // offline altogether: the saved copy and a clear message, not a broken page
    fs.writeFileSync(delay, '0');
    await A.offline(true);
    await A.cmd('Page.navigate', { url: 'about:blank' }); await wait(200); A.cmd('Page.navigate', { url: BASE + '/#/home' });
    await wait(9000);
    const off = await state();
    check('offline: the app still opens', off && (off.splash || off.login || off.home), off);
    await A.offline(false);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  fs.writeFileSync(delay, '0');
  console.log('waking: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = A.errors.filter((e) => !/Failed to fetch|Cannot reach|NetworkError|ERR_INTERNET/.test(String(e))); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
