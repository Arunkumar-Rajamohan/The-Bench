// Walk-in drives and events through the real Jobs page: sharing, going (and the tracker), calendars, cities, phones.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9471), B = await device(9472);
  const post = (d, url, body, method) => d.js(`return (await fetch('${url}', { method: '${method || 'POST'}', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const toast = (d) => d.js(`const t = document.getElementById('toast'); return t.hidden ? '' : t.innerText;`);
  const list = (d) => d.js(`const l = document.getElementById('evlist'); return l ? l.innerText : '';`);
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  const size = (d, w, h, m) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!m });
  const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = (n) => new Date(Date.parse(ist + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  try {
    const pw = crypto.randomUUID(), a = 'wa_' + crypto.randomBytes(3).toString('hex'), b = 'wb_' + crypto.randomBytes(3).toString('hex');
    await size(A, 1200, 900); await size(B, 1200, 900);
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw });
    await A.load('tools'); await wait(300);
    await A.js(`[...document.querySelectorAll('.tool')].find(t => /Walk-ins and events/.test(t.innerText)).click();`); await wait(1200);
    check('Tools opens the Walk-ins tab of Jobs', (await A.js(`return location.hash + ' ' + document.querySelector('[data-act=jobs-tab].on').innerText;`)) === '#/jobs/events Walk-ins & events');
    check('an empty list invites the first share', /No upcoming walk-ins or events yet/.test(await list(A)) && (await A.js(`return document.querySelector('details.share-ev').open;`)));

    // online hides the place fields
    await A.js(`const f = document.querySelector('form[data-form="event"]'); f.online.checked = true; f.online.dispatchEvent(new Event('change', { bubbles: true }));`);
    check('"It is online" hides city and venue', await A.js(`return document.querySelector('.ev-place').hidden && document.querySelector('.ev-place').offsetHeight === 0;`));
    await A.js(`const f = document.querySelector('form[data-form="event"]'); f.online.checked = false; f.online.dispatchEvent(new Event('change', { bubbles: true }));`);
    // a scam is refused
    const fill = (o) => A.js(`const f = document.querySelector('form[data-form="event"]'); const o = ${JSON.stringify(o)}; for (const k in o) f[k].value = o[k]; f.requestSubmit();`);
    const base = { kind: 'walkin', org: 'Kettle & Co', title: 'Walk-in drive: customer support', day: day(3), until: day(5), start: '10:00', finish: '13:00', city: 'Chennai', venue: 'Tidel Park, Taramani', url: 'https://example.com/drive', details: 'Freshers welcome. Bring two resumes.' };
    await fill(Object.assign({}, base, { details: 'Registration fee Rs 500 at the gate.' }));
    check('a "registration fee" is refused, with why', await until(async () => /never charge you/.test(await toast(A))), await toast(A));
    await fill(base);
    check('share a walk-in', await until(async () => /Walk-in drive: customer support/.test(await list(A))), await list(A));
    const card = await A.js(`const c = document.querySelector('.ev'); return { badge: c.querySelector('.ev-date b').innerText, kind: c.querySelector('.ev-kind').innerText, when: c.querySelector('.ev-when').innerText, where: c.querySelector('.ev-where').innerText, google: c.querySelector('a[href*="calendar.google.com"]').getAttribute('href') };`);
    check('the card shows the date, kind, days, hours and place', card.badge === String(Number(day(3).slice(8))) && card.kind === 'Walk-in' && /–/.test(card.when) && /10:00/.test(card.when) && card.where === 'Tidel Park, Taramani', card);
    check('Google Calendar gets the right hours (10 am India time is 04:30 UTC)', card.google.includes('dates=' + day(3).replace(/-/g, '') + 'T043000Z/' + day(3).replace(/-/g, '') + 'T073000Z') && /location=Tidel/.test(card.google), card.google);
    await A.js(`window.__ics = null; const o = URL.createObjectURL; URL.createObjectURL = function (b) { b.text().then(t => { window.__ics = t; }); return o.call(URL, b); }; document.querySelector('[data-act="ev-ics"]').click();`);
    await until(async () => !!(await A.js(`return window.__ics;`)), 3);
    const ics = await A.js(`return window.__ics || '';`);
    check('the calendar file has the right time and place', ics.includes('DTSTART:' + day(3).replace(/-/g, '') + 'T043000Z') && /SUMMARY:Walk-in drive: customer support \(Kettle & Co\)/.test(ics) && /LOCATION:Tidel Park\\, Taramani\\, Chennai/.test(ics), ics.slice(0, 400));

    // someone else is going
    await post(A, '/api/events', { kind: 'webinar', org: 'Pune Jobs Club', title: 'Resume clinic', day: day(1), start: '18:00', online: true });
    await post(A, '/api/events', { kind: 'walkin', org: 'Chai Co', title: 'Walk-in: cashier', day: day(2), city: 'Pune' });
    await B.load('jobs/events'); await wait(1200);
    const walk = await B.js(`return [...document.querySelectorAll('.ev')].findIndex(c => /customer support/.test(c.innerText));`);
    await B.js(`document.querySelectorAll('.ev')[${walk}].querySelector('[data-act="ev-going"]').click();`);
    check('"I\'m going" counts you in', await until(async () => /Going · 1/.test(await B.js(`return document.querySelectorAll('.ev')[${walk}].innerText;`))));
    check('and says it went into your tracker', /in your tracker as an interview/.test(await toast(B)), await toast(B));
    const evApp = async () => ((await B.data()).apps || []).find((x) => x.jobId && x.jobId.indexOf('ev:') === 0);
    await until(async () => !!(await evApp()), 5); // saving takes a moment
    const app = await evApp();
    check('a milestone message waits its turn', await until(async () => /new milestones/.test(await toast(B)), 6));
    check('your tracker has it as an interview, with the day and time', app && app.stage === 'Interview' && app.interview === day(3) && app.itime === '10:00' && app.company === 'Kettle & Co' && /Tidel Park/.test(app.note), app);
    await B.go('tracker'); await wait(500);
    check('so it shows under "Coming up" with calendar buttons', /Coming up[\s\S]*Walk-in drive: customer support/.test(await B.js(`return document.getElementById('main').innerText;`)));
    await B.go('jobs/events'); await wait(1000);
    await B.js(`document.querySelectorAll('.ev')[${walk}].querySelector('[data-act="ev-going"]').click();`);
    check('changing your mind leaves the tracker alone, and says so', await until(async () => /still in your tracker/.test(await toast(B))) && (await B.data()).apps.filter((x) => x.jobId && x.jobId.indexOf('ev:') === 0).length === 1);
    const webIdx = await B.js(`return [...document.querySelectorAll('.ev')].findIndex(c => /Resume clinic/.test(c.innerText));`);
    await B.js(`document.querySelectorAll('.ev')[${webIdx}].querySelector('[data-act="ev-going"]').click();`); await wait(800);
    check('a webinar is not added to the tracker', ((await B.data()).apps || []).length === 1);

    // cities
    check('city chips appear when there is more than one', /All\s*3[\s\S]*Chennai/.test(await B.js(`return document.querySelector('#evlist .chips') ? document.querySelector('#evlist .chips').innerText : '';`)));
    await B.js(`[...document.querySelectorAll('[data-act="ev-city"]')].find(x => /Pune/.test(x.innerText)).click();`); await wait(200);
    check('pick a city', (await B.js(`return [...document.querySelectorAll('.ev h3')].map(h => h.innerText);`)).join() === 'Walk-in: cashier');

    // tabs keep the address in step
    await B.js(`document.querySelector('[data-act="jobs-tab"][data-t="leads"]').click();`); await wait(800);
    check('switching tabs updates the address', (await B.js(`return location.hash;`)) === '#/jobs/leads');
    await B.go('jobs/events'); await wait(800);
    check('and the address opens the tab', (await B.js(`return document.querySelector('[data-act=jobs-tab].on').innerText;`)) === 'Walk-ins & events');
    await shot(B, 'events.png');

    // phones
    for (const w of [375, 320]) {
      await size(B, w, 760, true); await B.load('jobs/events'); await wait(1000);
      await B.js(`document.querySelector('details.share-ev').open = true;`); await wait(200);
      const p = await B.js(`const tabs = [...document.querySelectorAll('[data-act=jobs-tab]')].map(t => t.getBoundingClientRect()); return { over: document.documentElement.scrollWidth > innerWidth, tabs: tabs.every(t => t.right <= innerWidth && t.left >= 0), rows: new Set(tabs.map(t => Math.round(t.top))).size, oneLine: tabs.every(t => t.height < 44), cut: [...document.querySelectorAll('#jobpane .ev, #jobpane input, #jobpane select, #jobpane textarea, #jobpane .btn')].some(e => e.getBoundingClientRect().right > innerWidth + 1) };`);
      check('fits a ' + w + 'px phone: four tabs in two rows, one line each', !p.over && p.tabs && p.rows === 2 && p.oneLine && !p.cut, p);
      if (w === 320) { await B.js(`document.querySelector('details.share-ev').open = false; document.getElementById('main').classList.remove('enter');`); await wait(200); await shot(B, 'events-320.png'); }
    }
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('events: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
