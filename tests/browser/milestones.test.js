// Milestones (private badges) and the wins wall, through the real screens.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9421), B = await device(9422);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const put = (d, data) => d.js(`return (await fetch('/api/me/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(data))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const toast = (d) => d.js(`const t = document.getElementById('toast'); return t.hidden ? '' : t.innerText;`);
  const main = (d) => d.js(`return document.getElementById('main').innerText;`);
  const badges = async (d) => Object.keys((await d.data()).badges || {}).sort();
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  const size = (d, w, h, m) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!m });
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  try {
    const pw = crypto.randomUUID(), a = 'ma_' + crypto.randomBytes(3).toString('hex'), b = 'mb_' + crypto.randomBytes(3).toString('hex');
    await size(A, 1200, 900); await size(B, 1200, 900);
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await A.load('home');
    check('home shows milestones, none yet', /Milestones\s*0 of 21 earned · Next:/.test(await main(A)), (await main(A)).slice(0, 600));
    check('nothing is celebrated for a new member', (await toast(A)) === '' && (await badges(A)).length === 0);

    // earning one through the real tracker
    await A.go('tracker');
    await A.js(`const f = document.querySelector('form[data-form="app"]'); f.title.value = 'Analyst'; f.company.value = 'Acme'; f.stage.value = 'Applied'; f.requestSubmit();`);
    check('tracking a first job earns a milestone, with a toast', await until(async () => /New milestone: On the board/.test(await toast(A))), await toast(A));
    check('and confetti', await A.js(`return !!document.querySelector('.confetti');`));
    check('it is saved to the account', await until(async () => (await badges(A)).join() === 'first-job'), await badges(A));

    // progress made before milestones existed counts when the app opens
    const old = await A.data();
    const apps = [];
    for (let i = 0; i < 12; i++) apps.push({ id: 'a' + i, title: 'Job ' + i, company: 'Co ' + i, stage: 'Applied', t: Date.now() });
    apps.push({ id: 'o1', title: 'Dream job', company: 'Best Co', stage: 'Offer', t: Date.now() });
    for (let i = 0; i < 5; i++) apps.push({ id: 'r' + i, title: 'Nope ' + i, company: 'No Co', stage: 'Rejected', t: Date.now() });
    const log = {}; for (let i = 0; i < 8; i++) log[day(i)] = ['t1']; log[day(20)] = ['t1'];
    const practice = []; for (let i = 0; i < 10; i++) practice.push({ id: 'q' + i, pack: 'general', q: 'Question ' + i, r: 'good', t: Date.now() - i });
    await put(A, Object.assign({}, old, { apps, routine: Object.assign({}, old.routine, { log }), practice, learn: { 'gcf-excel': 'done' }, cl: { tone: 'warm', company: 'Best Co', role: 'Analyst', manager: '', source: '', why: '', highlight: '', post: '', custom: '' } }));
    await A.load('home');
    check('several at once get one message', await until(async () => /You earned 9 new milestones/.test(await toast(A)), 8), await toast(A));
    const want = ['apps-10', 'cover', 'course-1', 'first-job', 'interview-1', 'kept-going', 'offer', 'practice-10', 'streak-3', 'streak-7'];
    check('exactly the right ones are earned', await until(async () => (await badges(A)).join() === want.slice().sort().join()), await badges(A));

    // the page
    await A.go('milestones'); await wait(300);
    let m = await A.js(`return { tiles: document.querySelectorAll('.mile').length, got: document.querySelectorAll('.mile.got').length, share: document.querySelectorAll('.mile.got [data-act="mile-share"]').length, text: document.getElementById('milebody').innerText };`);
    check('the page lists every milestone, earned ones first in colour', m.tiles === 21 && m.got === 10 && m.share === 10, m);
    check('locked ones show how far along you are', /25 applications[\s\S]*18 of 25/.test(m.text) && /A full week[\s\S]*Earned/.test(m.text) && /30-day streak[\s\S]*8 of 30/.test(m.text), m.text.slice(0, 900));
    check('opened from Tools, which lights up Tools', await A.js(`return !!document.querySelector('.crumb[href="#/tools"]');`));
    await shot(A, 'milestones.png');

    // once earned, it stays
    const now = await A.data();
    await put(A, Object.assign({}, now, { apps: [], practice: [] }));
    await A.load('milestones'); await wait(300);
    check('milestones stay even after the data behind them is removed', (await A.js(`return document.querySelectorAll('.mile.got').length;`)) === 10 && (await badges(A)).length === 10);
    await put(A, now); // put the jobs back

    // another device of the same person: no second celebration
    const A2 = await device(9423);
    await A2.load('home'); await post(A2, '/api/login', { username: a, password: pw }); await A2.load('home'); await wait(2800);
    check('another device does not celebrate again', (await toast(A2)) === '' && (await badges(A2)).length === 10, await toast(A2));
    A2.close();

    // share one as a win
    await A.load('milestones'); await wait(300);
    await A.click('.mile.got [data-act="mile-share"][data-id="apps-10"]'); await wait(1200);
    const draft = await A.js(`return { hash: location.hash, text: document.getElementById('posttext').value, tag: document.getElementById('posttag').value };`);
    check('Share as a win opens the wins wall with a draft to edit', draft.hash === '#/feed/wins' && draft.text === 'Small win: I just reached “10 applications” in my job search. 💪' && draft.tag === 'Win', draft);
    check('nothing is posted until you say so', !(await A.js(`return document.querySelector('.post') ? document.querySelector('.post').innerText : '';`)).includes('Small win'));
    await A.js(`document.querySelector('form[data-form="post"]').requestSubmit();`);
    check('posting a win earns "Shared a win"', await until(async () => /New milestone: Shared a win/.test(await toast(A))), await toast(A));
    check('and it is on the wall', await until(async () => /Small win: I just reached/.test(await A.js(`return [...document.querySelectorAll('.post.win')].map(p => p.innerText).join(' ');`))));
    check('the box is empty again', (await A.js(`return document.getElementById('posttext').value;`)) === '');
    await A.go('feed'); await A.js(`const f = document.querySelector('form[data-form="post"]'); f.text.value = 'How do I answer notice period questions?'; f.tag.value = 'Question'; f.requestSubmit();`); await wait(1200);

    // the wall, as someone else sees it
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw });
    await B.load('feed/wins'); await wait(500);
    let w = await B.js(`return { posts: [...document.querySelectorAll('.post')].map(p => p.querySelector('.body').innerText), head: document.querySelector('.wins-head').innerText, on: document.querySelector('.feed-tabs .chip.on').innerText, tag: document.getElementById('posttag').value };`);
    check('the wins wall shows only wins', w.posts.length === 1 && /Small win/.test(w.posts[0]), w.posts);
    check('with how many were shared this week', /1 win shared this week/.test(w.head) && w.on === 'Wins' && w.tag === 'Win', w);
    await B.go('feed/questions'); await wait(300);
    check('other tabs filter too', (await B.js(`return [...document.querySelectorAll('.post .body')].map(p => p.innerText);`)).join() === 'How do I answer notice period questions?');
    await B.go('feed'); await wait(300);
    check('All shows everything', (await B.js(`return document.querySelectorAll('.post').length;`)) === 2);
    check('wins stand out in the feed', (await B.js(`return document.querySelectorAll('.post.win').length;`)) === 1);

    // ideas to start from
    await B.go('feed/wins'); await wait(300);
    await B.click('[data-act="win-prompt"][data-i="0"]');
    check('an idea fills the box', (await B.js(`return document.getElementById('posttext').value;`)) === 'Got an interview call from ');
    await B.click('[data-act="win-prompt"][data-i="4"]');
    check('another idea swaps it, if you have not typed', (await B.js(`return document.getElementById('posttext').value;`)) === 'Got an offer!');
    await B.js(`document.getElementById('posttext').focus();`); await B.cmd('Input.insertText', { text: ' So happy.' });
    await B.click('[data-act="win-prompt"][data-i="5"]');
    check('but never replaces your own words', (await B.js(`return document.getElementById('posttext').value;`)) === 'Got an offer! So happy. Got through a hard day');
    // a half-written post survives the page redrawing (here: reacting to a post)
    await B.click('.post .react'); await wait(1200);
    check('a half-written post survives a redraw', (await B.js(`return document.getElementById('posttext').value;`)) === 'Got an offer! So happy. Got through a hard day');
    await B.go('feed'); await wait(300);
    check('and its type does not leak into another tab', (await B.js(`return document.getElementById('posttag').value;`)) === 'Win');

    // Tools, and the next person on the device
    await B.go('tools'); await wait(300);
    check('Tools has Milestones and the wins wall', /Milestones[\s\S]*0 of 21 earned/.test(await main(B)) && /Wins wall/.test(await main(B)));
    await B.go('milestones'); await wait(300);
    check('each person sees only their own', (await B.js(`return document.querySelectorAll('.mile.got').length;`)) === 0);

    // phones and dark mode
    for (const wd of [375, 320]) {
      await size(A, wd, 760, true); await A.load('milestones'); await wait(400);
      const p = await A.js(`return { over: document.documentElement.scrollWidth > innerWidth, cut: [...document.querySelectorAll('.mile')].some(t => t.getBoundingClientRect().right > innerWidth + 1) };`);
      check('milestones fit a ' + wd + 'px phone', !p.over && !p.cut, p);
      await A.go('feed/wins'); await wait(400);
      const f = await A.js(`const box = document.getElementById('posttext').getBoundingClientRect(), head = document.querySelector('.wins-head').getBoundingClientRect(); const tabs = [...document.querySelectorAll('.feed-tabs .chip')].map(c => c.getBoundingClientRect()); const idea = document.querySelector('.win-prompts .chip').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth, tabsIn: tabs.every(t => t.left >= head.left - 1 && t.right <= innerWidth), tabsLined: Math.abs(tabs[0].left - head.left) < 2, ideaLined: Math.abs(idea.left - box.left) < 2 };`);
      check('the wins wall fits a ' + wd + 'px phone, everything lined up', !f.over && f.tabsIn && f.tabsLined && f.ideaLined, f);
      if (wd === 320) await shot(A, 'wins-320.png');
    }
    await A.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await A.go('milestones'); await wait(300); await A.js(`document.getElementById('main').classList.remove('enter');`); await shot(A, 'milestones-dark-320.png');
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('milestones: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
