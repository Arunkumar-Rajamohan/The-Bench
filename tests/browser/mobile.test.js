// Phone layout on every main page: nothing wider than the screen, no zoom when tapping a text box (16px text),
// nothing too small to tap, nothing hidden behind the bottom bar. At 320px (small Android) and 390px (iPhone).
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9511), B = await device(9512);
  const call = (d, method, url, body) => d.js(`const r = await fetch('${url}', { method: '${method}', headers: { 'Content-Type': 'application/json' }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }); return r.json().catch(() => ({}));`);
  try {
    const pw = crypto.randomUUID(), a = 'pa_' + crypto.randomBytes(3).toString('hex'), b = 'pb_' + crypto.randomBytes(3).toString('hex');
    await A.load('home'); await call(A, 'POST', '/api/signup', { username: a, name: 'Asha Krishnan', password: pw });
    await B.load('home'); await call(B, 'POST', '/api/signup', { username: b, name: 'Bala Murugan', password: pw });
    const ist = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const day = (n) => new Date(Date.parse(ist + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    // enough content that every page has real things on it, including long words
    await call(B, 'PUT', '/api/profile', { name: 'Bala Murugan', status: 'interviewing', headline: 'Customer support', location: 'Chennai', bio: 'Six years in a call centre.', skills: ['Tamil', 'English', 'Excel'], link: 'https://example.com/bala', color: 'sage', openTo: ['Remote'] });
    await call(B, 'POST', '/api/posts', { text: 'Got an interview call today! Supercalifragilisticexpialidocious.', tag: 'Win' });
    await call(B, 'POST', '/api/chat/room/lobby', { text: 'Morning everyone, @' + a + ' see https://example.com/a-really-long-link-that-keeps-going-and-going' });
    await call(B, 'POST', '/api/chat/dm/' + a, { text: 'Want to practise together tomorrow?' });
    await call(B, 'POST', '/api/leads', { title: 'Customer support executive (Tamil)', company: 'Kettle & Co', location: 'Chennai', url: 'https://example.com/job', note: 'Freshers welcome' });
    await call(A, 'POST', '/api/referrals', { company: 'Northwind Analytics', kind: 'refer', roles: 'Data analyst', note: 'Happy to refer.' });
    await call(B, 'POST', '/api/events', { kind: 'walkin', org: 'Kettle & Co', title: 'Walk-in drive: customer support (Tamil, English)', day: day(2), until: day(3), start: '10:00', finish: '13:00', city: 'Chennai', venue: '4th floor, Tidel Park, Taramani', details: 'Bring two resumes.' });
    await call(B, 'POST', '/api/interviews', { company: 'Infosys Ltd.', role: 'Process executive', rounds: ['Online test', 'HR'], difficulty: 3, outcome: 'offer', waitDays: 12, tips: 'Speak clearly.' });
    await call(A, 'PUT', '/api/buddy/prefs', { seeking: true, goal: 'Apply to 5 jobs a week' }); await call(B, 'PUT', '/api/buddy/prefs', { seeking: true, goal: 'Practise twice a week' });
    await call(A, 'POST', '/api/buddy/requests', { username: b, note: 'Hi!' });
    const inc = (await call(B, 'GET', '/api/buddy')).incoming || []; if (inc[0]) await call(B, 'POST', '/api/buddy/requests/' + inc[0].id + '/accept', {});
    const d = (await A.data()) || {};
    await call(A, 'PUT', '/api/me/data', Object.assign({}, d, {
      apps: ['Wishlist', 'Applied', 'Interview', 'Offer', 'Rejected'].map((s, i) => ({ id: 'j' + i, title: 'Junior business analyst ' + i, company: 'Northwind Analytics', stage: s, applied: day(-5), interview: s === 'Interview' ? day(1) : '', itime: '11:00', t: Date.now() })),
      routine: Object.assign({}, d.routine, { log: { [day(0)]: ['t1'], [day(-1)]: ['t1'] }, moods: { [day(0)]: 3, [day(-1)]: 1 } })
    }));
    const views = ['home', 'feed', 'feed/wins', 'chat', 'chat/lobby', 'dm/' + b, 'fun', 'jobs/leads', 'jobs/refs', 'jobs/events', 'tracker', 'routine', 'tools', 'resume', 'cover', 'prep',
      'interview', 'salary', 'learn', 'mood', 'milestones', 'review', 'experiences', 'experiences/infosys', 'buddy', 'people', 'u/' + b, 'edit-profile', 'account', 'privacy'];
    const measure = (W) => `
      const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('.sr-only,[hidden],details:not([open]) > :not(summary)'); };
      const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || e.name || e.tagName).replace(/\\s+/g, ' ').trim().slice(0, 30);
      const small = [], zoom = [];
      document.querySelectorAll('#main a[href], #main button, #main input:not([type=hidden]), #main select, #main textarea, #main summary, #nav a').forEach((e) => {
        if (!vis(e) || e.matches('.chip-check input, .swatch input')) return;
        const r = e.getBoundingClientRect(), p = e.parentElement;
        if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && p && p.innerText.trim().length > e.innerText.trim().length + 3) return; // a link inside a sentence
        if ((e.type === 'checkbox' || e.type === 'radio') && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 32) return;
        if (r.height < 28 || r.width < 28) small.push(name(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      document.querySelectorAll('#main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #main select, #main textarea').forEach((e) => { if (vis(e) && parseFloat(getComputedStyle(e).fontSize) < 16) zoom.push(name(e)); });
      const wide = [...document.querySelectorAll('#main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > ${W} + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.chips,.msgs,.ivx-chips,.goal-ideas,.win-prompts'); }).slice(0, 3).map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]);
      const nav = document.querySelector('.side'); window.scrollTo(0, document.documentElement.scrollHeight);
      const last = Math.max(0, ...[...document.querySelectorAll('#main > *, #main > * > *')].filter(vis).map((e) => e.getBoundingClientRect().bottom));
      const covered = !document.querySelector('.chat') && nav && last > nav.getBoundingClientRect().top + 1;
      window.scrollTo(0, 0);
      return { over: document.documentElement.scrollWidth > ${W} || innerWidth > ${W}, wide, small, zoom, covered };`;
    for (const [w, h] of [[320, 640], [390, 844]]) {
      await A.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      const problems = { over: [], small: [], zoom: [], covered: [] };
      for (const v of views) {
        await A.load(v); await wait(v.indexOf('jobs') === 0 || v === 'fun' ? 1200 : 500);
        const r = await A.js(measure(w));
        if (r.over || r.wide.length) problems.over.push(v + (r.wide.length ? ' (' + r.wide.join(', ') + ')' : ''));
        if (r.small.length) problems.small.push(v + ': ' + r.small.join(' | '));
        if (r.zoom.length) problems.zoom.push(v + ': ' + r.zoom.join(' | '));
        if (r.covered) problems.covered.push(v);
      }
      check(w + 'px: no page is wider than the screen', !problems.over.length, problems.over);
      check(w + 'px: text boxes do not make the phone zoom in', !problems.zoom.length, problems.zoom);
      check(w + 'px: nothing too small to tap', !problems.small.length, problems.small);
      check(w + 'px: nothing hidden behind the bottom bar', !problems.covered.length, problems.covered);
    }
    // the tracker shows every stage on a phone, not only the first two
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await A.load('tracker'); await wait(400);
    const cols = await A.js(`return [...document.querySelectorAll('.board .col')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.right]; });`);
    check('tracker: all five stages fit the width of a phone', cols.length === 5 && cols.every((c) => c[0] >= 0 && c[1] <= 360), cols);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('mobile: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 600));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
