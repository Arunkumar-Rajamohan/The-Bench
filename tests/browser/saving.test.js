// Two devices on one account: nothing typed may be lost.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = [];
  const A = await device(9341), B = await device(9342);
  try {
    const u = 'sync_' + crypto.randomBytes(3).toString('hex'), pw = crypto.randomUUID();
    await A.load('home');
    await A.js(`await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${u}', name: 'Sync', password: '${pw}' }) });`);
    await B.load('home');
    await B.js(`await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '${u}', password: '${pw}' }) });`);
    await A.load('resume'); await B.load('routine');
    // 1. A edits the resume; B, opened earlier, ticks a task
    await A.type('#cv-summary', 'Edited on laptop'); await wait(1500);
    await B.click('.task'); await wait(2000);
    let d = await A.data();
    out.push(['two devices: resume edit survives a tick on the other', d.cv && d.cv.summary === 'Edited on laptop']);
    out.push(['two devices: the tick survives too', Object.keys(d.routine.log).length === 1]);
    // 2. a failed save is retried when the connection returns
    await A.load('resume');
    await A.offline(true); await A.type('#cv-headline', 'Typed offline'); await wait(2000);
    await A.offline(false); await wait(6000);
    d = await B.data();
    out.push(['offline edit reaches the server after reconnecting', d.cv && d.cv.headline === 'Typed offline']);
    // 3. closing the page straight after an edit, with a lot saved
    await A.js(`const d = (await (await fetch('/api/me')).json()).data; d.resume = 'x'.repeat(19000); d.practice = Array.from({ length: 450 }, (_, i) => ({ q: 'Question number ' + i + ' ' + 'y'.repeat(90), r: 'Okay', t: i + 1 })); await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });`);
    await A.load('resume');
    await A.js(`const e = document.querySelector('#cv-city'); e.value = 'Last second'; e.dispatchEvent(new Event('input', { bubbles: true })); location.href = 'about:blank';`).catch(() => {});
    await wait(2500);
    await A.load('resume'); await wait(2500);
    d = await B.data();
    out.push(['edit made just before closing is not lost (large account)', d.cv && d.cv.city === 'Last second']);
  } catch (e) { out.push(['crashed: ' + e.message, false]); }
  console.log('saving: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok] of out) if (!ok) console.log('FAIL lost: ' + n);
  if (A.errors.length + B.errors.length) console.log('page errors', A.errors, B.errors);
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
