// The owner's usage page and the quiet counting behind it, in real browsers.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  const owner = 'own_' + crypto.randomBytes(3).toString('hex'), mod = 'mod_' + crypto.randomBytes(3).toString('hex');
  await startServer({ ADMIN_USERNAMES: owner + ',' + mod });
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const O = await device(9401), A = await device(9402);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const db = (text, ...args) => { const x = new DatabaseSync(path.join(tmp, 'db', 'bench.db')); const st = x.prepare(text); const r = /^select/i.test(text) ? st.all(...args) : st.run(...args); x.close(); return r; };
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  const size = (d, w, h, m) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!m });
  const theme = (d, v) => d.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });
  const main = (d) => d.js(`return document.getElementById('main').innerText;`);
  try {
    const pw = crypto.randomUUID();
    await size(O, 1280, 1000); await theme(O, 'light');
    await O.load('home'); await post(O, '/api/signup', { username: owner, name: 'Owner', password: pw });
    await A.load('home'); await post(A, '/api/signup', { username: 'ua_' + crypto.randomBytes(3).toString('hex'), name: 'Asha', password: pw });
    // what a member's browser sends
    await A.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__sent = []; const f = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf('/api/usage') === 0) window.__sent.push(o.body); return f.apply(this, arguments); };` });
    await A.load('home'); for (const v of ['jobs', 'resume', 'jobs', 'mood', 'account', 'tools', 'home']) await A.go(v);
    const sent = (await A.js(`return window.__sent;`)).map((x) => JSON.parse(x).view);
    check('each page is told once', sent.filter((x) => x === 'jobs').length === 1 && sent.includes('resume') && sent.includes('tools'), sent);
    check('wellbeing and account are never named', !sent.includes('mood') && !sent.includes('account'), sent);
    await A.cmd('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });` });
    await A.load('feed'); await A.go('fun'); check('a browser that asks not to be tracked sends nothing', (await A.js(`return window.__sent.length;`)) === 0);
    await A.load('account'); await wait(500); check('members have no usage card', !/See usage/.test(await main(A)));
    await A.go('usage'); await wait(500); check('and cannot open the page', /Only the site owner/.test(await main(A)) && !/members/.test(await main(A)));
    await post(A, '/api/logout', {}); await post(A, '/api/signup', { username: mod, name: 'Mod', password: pw }); await A.load('account'); await wait(600);
    const t = await main(A); check('other moderators neither', /Moderation/.test(t) && !/See usage/.test(t));

    // the page, first with almost nothing
    await O.load('account'); await wait(500); await O.js(`[...document.querySelectorAll('a')].find(x => x.innerText === 'See usage').click();`); await wait(1200);
    let m = await O.js(`return document.getElementById('usagebody').innerText;`);
    check('opens from Account', /People each day/.test(m) && /under 5/.test(m), m.slice(0, 300));
    check('owner\'s own visits are not there', db('SELECT last_day FROM users WHERE username = ?', owner)[0].last_day === null);
    // then with a month of made-up totals
    const day = (n) => new Date(Date.now() + 19800000 - n * 864e5).toISOString().slice(0, 10), monday = (d) => new Date(Date.parse(d) - ((new Date(d).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    db("UPDATE settings SET value = ? WHERE key = 'usage_from'", day(60)); db('DELETE FROM usage_days');
    const ns = [2, 3, 3, 5, 4, 1, 0, 6, 7, 5, 8, 9, 4, 3, 10, 12, 11, 9, 13, 6, 5, 14, 12, 15, 17, 16, 8, 11];
    ns.forEach((n, i) => { if (n) db('INSERT INTO usage_days VALUES (?, ?)', day(27 - i), n); });
    for (let i = 1; i < 8; i++) {
      const w = monday(day(7 * i));
      for (const [k, n] of [['active', 30 - 3 * i], ['back1', 4], ['v:jobs', 22], ['v:resume', 14], ['v:chat', 18], ['v:salary', 3], ['a:room', 12]]) db('INSERT OR REPLACE INTO usage_weeks VALUES (?, ?, ?)', w, k, n);
    }
    for (let i = 0; i < 40; i++) db("INSERT INTO users (username, name, pass, salt, created) VALUES (?, 'x', 'x', 'x', ?)", 'made_' + i, Date.now() - (i % 8) * 7 * 864e5 - 864e5);
    await O.load('usage'); await wait(1200); await O.js(`document.getElementById('main').classList.remove('enter');`); await wait(200); await shot(O, 'usage-light.png');
    m = await O.js(`return document.getElementById('usagebody').innerText;`);
    check('came back is worked out', /\d+ of \d+/.test(m) && /came back/i.test(m));
    const bars = await O.js(`const b = [...document.querySelectorAll('.ubar')]; return { n: b.length, w: Math.max(...b.map(x => x.getBBox().width)), val: [...document.querySelectorAll('.uval')].map(x => x.textContent), hits: document.querySelectorAll('.uhit').length };`);
    check('one bar per day with anyone, one label on the highest', bars.n === 27 && bars.hits === 28 && bars.val.join() === '17' && bars.w <= 24, bars);
    const ratio = await O.js(`const rows = [...document.querySelectorAll('.udetails tbody tr')].reverse().map(r => Number(r.cells[1].textContent)); const hs = [...document.querySelectorAll('.ubar')].map(b => b.getBBox().height); const k = rows.filter(Boolean); return k.map((n, i) => hs[i] / n);`);
    check('bar heights match the table', ratio.length === 27 && Math.max(...ratio) - Math.min(...ratio) < 0.5, [Math.min(...ratio), Math.max(...ratio)]);
    await O.js(`document.querySelector('.uhit[data-i="24"]').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));`);
    let tip = await O.js(`const t = document.getElementById('utip'); const b = t.getBoundingClientRect(), c = document.getElementById('uchart').getBoundingClientRect(); return { text: t.innerText, hidden: t.hidden, inside: b.left >= c.left - 1 && b.right <= c.right + 1 };`);
    check('pointing at a day says what it is', /17 people/.test(tip.text) && !tip.hidden && tip.inside, tip);
    for (const i of [0, 27]) {
      await O.js(`document.querySelector('.uhit[data-i="${i}"]').dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));`);
      tip = await O.js(`const b = document.getElementById('utip').getBoundingClientRect(), c = document.getElementById('uchart').getBoundingClientRect(); return b.left >= c.left - 1 && b.right <= c.right + 1;`);
      check('tooltip stays inside at the ' + (i ? 'right' : 'left') + ' edge', tip);
    }
    await O.js(`const s = document.querySelector('#uchart svg'); s.focus(); const k = (x) => s.dispatchEvent(new KeyboardEvent('keydown', { key: x, bubbles: true, cancelable: true })); k('Escape'); k('ArrowRight'); k('ArrowLeft');`);
    tip = await O.js(`return document.getElementById('utip').innerText;`); check('arrow keys work', /8 people/.test(tip), tip);
    check('there is a table with every day', (await O.js(`return document.querySelectorAll('.udetails tbody tr').length;`)) === 28);
    // dark, and phones
    await theme(O, 'dark'); await O.load('usage'); await wait(1000);
    const c = await O.js(`return getComputedStyle(document.querySelector('.ubar')).fill;`); check('dark theme has its own bar colour', c !== 'rgb(60, 100, 160)' && c !== 'rgb(0, 0, 0)', c);
    await O.js(`document.getElementById('main').classList.remove('enter');`); await shot(O, 'usage-dark.png');
    for (const w of [375, 320]) {
      await size(O, w, 760, true); await O.load('usage'); await wait(1000); await O.js(`document.getElementById('main').classList.remove('enter');`);
      const p = await O.js(`const s = document.querySelector('#uchart svg').getBoundingClientRect(); const l = [...document.querySelectorAll('.utick')].map(x => x.getBoundingClientRect()); const bottom = l.filter(x => x.top > s.bottom - 26); return { over: document.documentElement.scrollWidth > innerWidth, cut: l.some(x => x.left < s.left - 1 || x.right > s.right + 1), clash: bottom.some((x, i) => i && x.left < bottom[i - 1].right && x.top < bottom[i - 1].bottom && x.bottom > bottom[i - 1].top), tables: [...document.querySelectorAll('.utable')].every(t => t.getBoundingClientRect().right <= innerWidth) };`);
      check('fits a ' + w + 'px phone', !p.over && !p.cut && !p.clash && p.tables, p);
      await O.js(`document.querySelector('#uchart').scrollIntoView(); window.scrollBy(0, -90);`); await shot(O, 'usage-' + w + '.png');
    }
    // the next person on the owner's device sees nothing of it
    await O.go('home'); await O.js(`document.querySelector('[data-act=logout]').click();`); await wait(2000); await post(O, '/api/signup', { username: 'nx_' + crypto.randomBytes(3).toString('hex'), name: 'Next', password: pw }); await O.load('usage'); await wait(600);
    check('gone after logging out', /Only the site owner/.test(await main(O)));
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('usage: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = O.errors.concat(A.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  O.close(); A.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
