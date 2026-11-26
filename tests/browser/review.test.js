// The weekly review, through the real screens: the week's numbers, goals that count themselves, notes, other weeks.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9431);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const put = (d, data) => d.js(`return (await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(data))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const toast = (d) => d.js(`const t = document.getElementById('toast'); return t.hidden ? '' : t.innerText;`);
  const body = (d) => d.js(`const b = document.getElementById('reviewbody'); return b ? b.innerText : '';`);
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  const size = (d, w, h, m) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!m });
  // dates the same way the app works them out: local days, weeks from Monday
  const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const now = new Date(), today = key(now);
  const monDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
  const plus = (n) => key(new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() + n));
  const mon = plus(0), lastMon = plus(-7), nextMon = plus(7);
  const goals = () => A.js(`return [...document.querySelectorAll('.goal')].map(g => g.querySelector('.goal-text').innerText.replace(/\\s*\\(done\\)/, '') + (g.classList.contains('done') ? ' ✓' : ''));`);
  try {
    const pw = crypto.randomUUID(), a = 'wr_' + crypto.randomBytes(3).toString('hex');
    await size(A, 1200, 900);
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await A.load('home');
    check('home invites you to plan the week', /Weekly review\s*(Set up to three goals for this week|It is Sunday)/.test(await A.js(`return document.querySelector('.home-cards').innerText;`)));

    // a week of activity, and some from the week before
    const d = await A.data();
    const app = (id, o) => Object.assign({ id, title: 'Job ' + id, company: 'Co', stage: 'Applied', t: Date.now() }, o);
    const lastWeekNoon = new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() - 3, 12).getTime();
    await put(A, Object.assign({}, d, {
      apps: [app('a1', { applied: today }), app('a2', { applied: today }), app('a3', { applied: today }), app('b1', { applied: plus(-3), t: lastWeekNoon }),
        app('i1', { stage: 'Interview', applied: plus(-2), interview: today, t: lastWeekNoon }), app('w1', { stage: 'Wishlist' })],
      routine: Object.assign({}, d.routine, { log: { [today]: ['t1', 't2'], [plus(-1)]: ['t1'], [plus(-2)]: ['t1'] } }),
      practice: [{ id: 'q1', q: 'x', r: 'good', t: Date.now() }, { id: 'q2', q: 'y', r: 'ok', t: Date.now() - 1 }, { id: 'q3', q: 'z', r: 'good', t: lastWeekNoon }]
    }));
    await A.load('review'); await wait(400);
    const stats = await A.js(`return [...document.querySelectorAll('.week-stats .stat')].map(s => s.innerText.replace(/\\s+/g, ' ').trim());`);
    check('the week in numbers, next to the week before', stats.length === 4 && /^3 applications Week before: 2$/i.test(stats[0]) && /^1 interview Week before: 0$/i.test(stats[1]) && /^1\/7 routine days Week before: 2\/7$/i.test(stats[2]) && /^2 questions practised Week before: 1$/i.test(stats[3]), stats);
    const days = await A.js(`return [...document.querySelectorAll('.week-days li')].map(l => l.className);`);
    const ti = (now.getDay() + 6) % 7;
    check('day by day: today ticked, days to come left open', days.length === 7 && /\bon\b/.test(days[ti]) && /today/.test(days[ti]) && days.slice(ti + 1).every((c) => /later/.test(c)) && days.slice(0, ti).every((c) => /\boff\b/.test(c)), days);
    check('a wishlist job is not an application', !/4 applications/i.test(await body(A)));

    // goals
    await A.click('[data-act="goal-idea"][data-i="1"]'); // Apply to 5 jobs
    check('setting a goal earns "Planned your week"', await until(async () => /New milestone: Planned your week/.test(await toast(A))), await toast(A));
    let g = await A.js(`const x = document.querySelector('.goal'); return { auto: x.querySelector('.goal-auto').innerText, button: !!x.querySelector('button.goal-box') };`);
    check('a goal that counts itself, from the tracker', /3 of 5 · counts itself from your tracker/.test(g.auto) && !g.button, g);
    check('an idea already picked is not offered again', !(await A.js(`return !!document.querySelector('[data-act="goal-idea"][data-i="1"]');`)) && (await A.js(`return !!document.querySelector('[data-act="goal-idea"][data-i="0"]');`)));
    await A.click('[data-act="goal-idea"][data-i="6"]'); // Update my resume
    await A.js(`const f = document.querySelector('form[data-form="goal"]'); f.text.value = 'Call Priya about the opening'; f.requestSubmit();`); await wait(300);
    check('up to three goals, then no more to add', (await goals()).join('|') === 'Apply to 5 jobs|Update my resume|Call Priya about the opening' && !(await A.js(`return !!document.querySelector('form[data-form="goal"]');`)) && /Three is plenty/.test(await body(A)), await goals());
    await A.click('.goal-box[aria-label="Mark done: Update my resume"]');
    await A.click('.goal-box[aria-label="Mark done: Call Priya about the opening"]');
    check('tick your own goals off', (await goals()).join('|') === 'Apply to 5 jobs|Update my resume ✓|Call Priya about the opening ✓' && /2 of 3 done/.test(await body(A)), await goals());
    // two more applications through the tracker finish the last goal by themselves
    await A.go('tracker');
    for (const n of ['One', 'Two']) { await A.js(`const f = document.querySelector('form[data-form="app"]'); f.title.value = 'Role ${n}'; f.company.value = 'Firm'; f.stage.value = 'Applied'; f.requestSubmit();`); await wait(400); }
    check('finishing every goal earns "Goals met"', await until(async () => /New milestone: Goals met/.test(await toast(A))), await toast(A));
    await A.go('review'); await wait(300);
    check('the counted goal ticked itself', (await goals())[0] === 'Apply to 5 jobs ✓' && /3 of 3 done/.test(await body(A)), await goals());

    // notes
    await A.js(`document.getElementById('reviewnote').focus();`); await A.cmd('Input.insertText', { text: 'Good week. Mornings work best for applying.' });
    check('notes to yourself are saved', await until(async () => ((await A.data()).weeks || {})[mon] && (await A.data()).weeks[mon].note === 'Good week. Mornings work best for applying.'), (await A.data()).weeks);
    await A.click('.goal [data-act="goal-del"][aria-label="Remove goal: Call Priya about the opening"]'); await wait(300);
    check('remove a goal', (await goals()).length === 2);

    // other weeks
    await A.click('[data-act="review-week"][aria-label="Earlier week"]'); await wait(300);
    let t = await body(A);
    check('last week: its own numbers, and no adding goals after the fact', /Last week/.test(t) && /2\s+applications/i.test(t) && /No goals were set for this week/.test(t) && !(await A.js(`return !!document.querySelector('form[data-form="goal"]');`)), t.slice(0, 500));
    await A.click('[data-act="review-week"][aria-label="Later week"]'); await wait(300);
    await A.click('[data-act="review-week"][aria-label="Plan next week"]'); await wait(300);
    t = await body(A);
    check('next week: plan ahead, without numbers yet', /Next week/.test(t) && !(await A.js(`return !!document.querySelector('.week-stats');`)) && !!(await A.js(`return !!document.querySelector('form[data-form="goal"]');`)) && !(await A.js(`return !!document.querySelector('[aria-label="Later week"]');`)), t.slice(0, 400));
    await A.click('[data-act="goal-idea"][data-i="2"]'); await wait(300);
    check('a goal for next week is kept under next week', await until(async () => { const w = ((await A.data()).weeks || {})[nextMon]; return w && w.goals.length === 1 && w.goals[0].kind === 'practice' && w.goals[0].n === 5; }), (await A.data()).weeks);
    check('and shows 0 of 5 until then', /0 of 5 · counts itself from your interview practice/.test(await body(A)));
    await A.go('home'); await wait(300);
    check('home shows how the week is going', /Weekly review\s*(2 of 2 goals done this week|It is Sunday[^\n]*2 of 2 done)/.test(await A.js(`return document.querySelector('.home-cards').innerText;`)), await A.js(`return document.querySelector('.home-cards').innerText;`));
    await A.click('.home-cards a[href="#/review"]'); await wait(500);
    check('coming back starts at this week', /This week/.test(await body(A)));
    await A.go('tools'); await wait(300);
    check('Tools has the weekly review', /Weekly review[\s\S]*2 of 2 goals done/.test(await A.js(`return document.getElementById('main').innerText;`)));
    check('nothing from last week was touched', !((await A.data()).weeks || {})[lastMon]);
    await A.go('review'); await A.js(`document.getElementById('main').classList.remove('enter');`); await wait(200); await shot(A, 'review.png');

    // phones and dark mode
    for (const w of [375, 320]) {
      await size(A, w, 760, true); await A.load('review'); await wait(400);
      const p = await A.js(`const n = [...document.querySelectorAll('.week-nav > *')].map(x => x.getBoundingClientRect()); const b = [...document.querySelectorAll('.week-nav .btn')].map(x => x.getBoundingClientRect()); const dd = [...document.querySelectorAll('.week-days li')].map(x => x.getBoundingClientRect());
        return { over: document.documentElement.scrollWidth > innerWidth, nav: n.every(r => r.left >= 0 && r.right <= innerWidth), oneLine: b.every(r => r.height < 40) && b.length === 2 && Math.abs(b[0].top - b[1].top) < 2 && b[1].left > b[0].right, label: document.querySelector('.week-label').getBoundingClientRect().bottom <= b[0].top + 1, days: dd.every(r => r.right <= innerWidth) };`);
      check('fits a ' + w + 'px phone: week name on top, buttons on one line below', !p.over && p.nav && p.oneLine && p.label && p.days, p);
    }
    await A.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await A.load('review'); await wait(400); await A.js(`document.getElementById('main').classList.remove('enter');`); await shot(A, 'review-dark-320.png');
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('review: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  if (A.errors.length) console.log('FAIL page errors', A.errors.slice(0, 3));
  A.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
