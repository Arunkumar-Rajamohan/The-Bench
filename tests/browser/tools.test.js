// Tools page and first steps in a real browser.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9351), B = await device(9352);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const size = (d, w, h, mobile) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  const theme = (d, v) => d.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });
  const shot = async (d, f) => { const r = await d.cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(tmp, f), Buffer.from(r.result.data, 'base64')); };
  const steps = (d) => d.js(`const s = document.querySelector('.steps'); return s ? { text: s.innerText, done: [...s.querySelectorAll('li.done b')].map(b => b.innerText) } : null;`);
  try {
    const u = 'tool_' + crypto.randomBytes(3).toString('hex'), pw = crypto.randomUUID();
    await size(A, 1280, 900); await theme(A, 'light');
    // sign up through the real form, as a new person would
    await A.load('home');
    await A.js(`const f = document.getElementById('authform'); f.name.value = 'Asha'; f.username.value = '${u}'; f.password.value = '${pw}'; f.requestSubmit();`); await wait(1500);
    await A.js(`document.getElementById('saved').click(); document.getElementById('codedone').click();`); await wait(800);
    let s = await steps(A);
    check('new member sees first steps, none done', s && /0 of 5 done/.test(s.text) && s.done.length === 0, s);
    let t = await A.js(`return document.getElementById('main').innerText;`);
    check('doubled-up nudges are hidden', !/Say who you are/.test(t) && !/Play now/.test(t));
    await A.js(`document.getElementById('main').classList.remove('enter');`); await wait(200); await shot(A, 'tools-home.png');
    const links = await A.js(`return [...document.querySelectorAll('.steps li a')].map(a => a.getAttribute('href'));`);
    check('each step links somewhere', links.join(' ') === '#/edit-profile #/tracker #/chat/lobby #/resume #/routine', links);

    // do each step through the app; each ticks itself
    await A.js(`location.hash = '#/tracker'; await new Promise(r => setTimeout(r, 500)); const f = document.querySelector('form[data-form=app]'); f.title.value = 'Support'; f.company.value = 'Kettle'; f.requestSubmit();`); await wait(500); await A.go('home');
    s = await steps(A); check('tracking a job ticks', s.done.join() === 'Track one job' && /1 of 5/.test(s.text), s);
    await A.js(`document.querySelector('.task').click();`); await wait(600); s = await steps(A); check('routine tick on Home ticks at once', s.done.includes('Tick one routine task') && /2 of 5/.test(s.text), s);
    await A.go('resume'); await wait(800); await A.go('home'); s = await steps(A); check('only opening the resume does not count', !s.done.includes('Start your resume'), s);
    await A.go('resume'); await A.type('#cv-email', 'a@example.com'); await wait(300); await A.go('home'); s = await steps(A); check('typing in it does', s.done.includes('Start your resume'), s);
    await A.go('chat/lobby'); await wait(1200); await A.js(`const b = document.getElementById('chatbox'); b.value = 'Hello from Asha'; b.form.requestSubmit();`); await wait(1500); await A.go('home'); s = await steps(A); check('saying hi ticks', s.done.includes('Say hi') && /4 of 5/.test(s.text), s);
    await A.load('home'); s = await steps(A); check('progress survives a reload', /4 of 5/.test(s.text), s);
    await post(B, '/x', {}).catch(() => {}); await B.load('home'); await post(B, '/api/login', { username: u, password: pw }); await B.load('home'); s = await steps(B); check('and shows on another device', /4 of 5/.test(s.text), s);
    await A.go('edit-profile'); await wait(1200);
    await A.js(`const f = document.querySelector('#editbody form'); const h = f.querySelector('[name=headline]'); h.value = 'Support specialist'; f.requestSubmit();`); await wait(1500); await A.go('home'); await wait(400);
    s = await steps(A); check('all done shows the finish card', s && /You are all set/.test(s.text), s);
    await A.click('[data-act=steps-hide]'); await wait(600); check('can be hidden', (await steps(A)) === null);
    t = await A.js(`return document.getElementById('main').innerText;`); check('then the usual Home returns', /Play now/.test(t));
    await wait(1500); check('hidden on the other device too', (await steps(B)) === null);

    // tools page
    await A.go('tools'); await A.js(`document.getElementById('main').classList.remove('enter');`); await wait(200); await shot(A, 'tools-page.png');
    const tools = await A.js(`return [...document.querySelectorAll('.tool')].map(a => [a.querySelector('b').innerText, a.getAttribute('href'), a.querySelector('small') ? a.querySelector('small').innerText : '']);`);
    check('fourteen tools', tools.length === 14, tools);
    check('shows what you have so far', tools.find((x) => x[0] === 'Resume builder')[2] === 'Started' && tools.find((x) => x[0] === 'Wellbeing')[2] === '', tools);
    for (const [name] of tools) {
      await A.go('tools');
      await A.js(`[...document.querySelectorAll('.tool')].find(a => a.querySelector('b').innerText === ${JSON.stringify(name)}).click();`); await wait(900);
      const r = await A.js(`const on = [...document.querySelectorAll('#nav a.on')].map(a => a.innerText.trim()); return { hash: location.hash, h1: document.querySelector('#main h1') && document.querySelector('#main h1').innerText, on, crumb: !!document.querySelector('.crumb'), tab: (document.querySelector('[data-act=jobs-tab].on') || {}).innerText };`);
      const inside = !['Referrals', 'Accountability buddy', 'Wins wall', 'Walk-ins and events'].includes(name);
      check('opens: ' + name, r.h1 && r.h1 !== 'Tools' && (inside ? r.on.join() === 'Tools' && r.crumb : !r.crumb) && (name !== 'Referrals' || (r.hash === '#/jobs' && r.tab === 'Referrals')) &&
        (name !== 'Wins wall' || (r.hash === '#/feed/wins' && r.on.join() === 'Feed')) &&
        (name !== 'Walk-ins and events' || (r.hash === '#/jobs/events' && r.tab === 'Walk-ins & events' && r.on.join() === 'Jobs')), r);
    }
    await A.go('salary'); await A.click('.crumb'); await wait(500); check('back link returns to Tools', (await A.js(`return location.hash;`)) === '#/tools');
    await A.go('mood'); await A.click('[data-act=mood][data-v="3"]'); await wait(400); await A.go('tools'); check('mood status updates', /Checked in today/.test(await A.js(`return document.getElementById('main').innerText;`)));
    await A.go('prep'); t = await A.js(`return document.getElementById('main').innerText;`); check('old Prep address still works', /Resume checker/.test(t) && /Mock interview/.test(t) && !/New: Resume builder/.test(t));
    await A.go('home'); const bar = await A.js(`return document.querySelector('.account-bar').innerText;`); check('tool links left the account bar, the rest stayed', !/Salary|Wellbeing|Cover/.test(bar) && /People/.test(bar) && /Account/.test(bar) && /Log out/.test(bar), bar);
    const nav = await A.js(`return [...document.querySelectorAll('#nav a')].map(a => a.querySelector('b').innerText);`); check('menu still has 8 items', nav.join(' ') === 'Home Feed Chat Fun Jobs Tracker Tools Routine', nav);
    const svg = await A.js(`return document.querySelector('#nav a[data-view=tools] svg').innerHTML.length;`); check('menu icon drawn', svg > 50, svg);

    // phone
    for (const [w, scheme] of [[375, 'dark'], [320, 'light']]) {
      await size(B, w, 740, true); await theme(B, scheme); await B.load('tools'); await B.js(`document.getElementById('main').classList.remove('enter');`);
      const p = await B.js(`const nav = [...document.querySelectorAll('#nav a b')]; return { over: document.documentElement.scrollWidth > innerWidth, cut: nav.filter(b => b.scrollWidth > b.clientWidth).map(b => b.innerText), last: Math.round(document.querySelectorAll('#nav a')[7].getBoundingClientRect().right) };`);
      check('phone ' + w + ': no sideways scroll, menu labels fit', !p.over && !p.cut.length && p.last <= w, p); await shot(B, 'tools-phone-' + w + '.png');
    }
    // resume still prints clean (the back link must not appear on paper)
    await A.go('resume'); await wait(500); await A.cmd('Emulation.setEmulatedMedia', { media: 'print' }); const pr = await A.js(`const c = document.querySelector('.crumb'); return c.offsetParent === null || getComputedStyle(c.closest('.head')).display === 'none';`); check('back link is not printed', pr); await A.cmd('Emulation.setEmulatedMedia', { media: '' });

    // an older account does not get first steps
    const db = new DatabaseSync(path.join(tmp, 'db', 'bench.db'));
    await B.js(`await fetch('/api/logout', { method: 'POST' });`); const u2 = 'old_' + crypto.randomBytes(3).toString('hex'); await post(B, '/api/signup', { username: u2, name: 'Oldie', password: pw });
    db.prepare('UPDATE users SET created = ? WHERE username = ?').run(Date.now() - 40 * 864e5, u2); db.close();
    await B.load('home'); check('accounts over 30 days old do not see it', (await steps(B)) === null); t = await B.js(`return document.getElementById('main').innerText;`); check('they keep the usual nudges', /Say who you are/.test(t) && /Play now/.test(t));
    // hide early
    await B.js(`await fetch('/api/logout', { method: 'POST' });`); await post(B, '/api/signup', { username: 'hid_' + crypto.randomBytes(3).toString('hex'), name: '<b>X</b>', password: pw }); await B.load('home'); await B.click('[data-act=steps-hide]'); await wait(1500); await B.load('home'); check('hiding early sticks', (await steps(B)) === null);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('tools + first steps: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); console.log('page errors: ' + errs.length, errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
