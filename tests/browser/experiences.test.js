// Interview experiences through the real screens: sharing, reading a company, nameless posts, the tracker links, phones.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9461), B = await device(9462);
  const post = (d, url, body, method) => d.js(`return (await fetch('${url}', { method: '${method || 'POST'}', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const toast = (d) => d.js(`const t = document.getElementById('toast'); return t.hidden ? '' : t.innerText;`);
  const body = (d) => d.js(`const b = document.getElementById('ivxbody'); return b ? b.innerText : '';`);
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  const size = (d, w, h, m) => d.cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!m });
  try {
    const pw = crypto.randomUUID(), a = 'xa_' + crypto.randomBytes(3).toString('hex'), b = 'xb_' + crypto.randomBytes(3).toString('hex');
    await size(A, 1200, 900);
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw });
    await A.load('tools'); await wait(300);
    check('Tools lists interview experiences', /Interview experiences/.test(await A.js(`return document.getElementById('main').innerText;`)));
    await A.js(`[...document.querySelectorAll('.tool')].find(t => /Interview experiences/.test(t.innerText)).click();`); await wait(1200);
    check('an empty page invites the first share', /No experiences yet/.test(await body(A)) && (await A.js(`return location.hash;`)) === '#/experiences');

    // share one through the form
    await A.js(`document.querySelector('details.share-ivx').open = true;`);
    await A.js(`const f = document.querySelector('form[data-form="ivx"]');
      f.company.value = 'Infosys Ltd.'; f.role.value = 'Support analyst'; f.month.value = '2026-10'; f.level.value = 'fresher';
      [...f.querySelectorAll('input[name="rounds"]')].forEach(x => { x.checked = x.value === 'Online test' || x.value === 'HR'; });
      f.querySelector('input[name="difficulty"][value="4"]').checked = true; f.outcome.value = 'offer'; f.waitDays.value = '9'; f.mode.value = 'online';
      f.questions.value = ${JSON.stringify('Tell me about yourself. '.repeat(25))}; f.tips.value = 'Keep answers short.'; f.requestSubmit();`);
    check('sharing earns "Paid it forward"', await until(async () => /Paid it forward/.test(await toast(A))), await toast(A));
    check('and opens that company\'s page', await until(async () => decodeURIComponent(await A.js(`return location.hash;`)) === '#/experiences/Infosys Ltd.' && /1 experience from members/.test(await body(A))), [await A.js(`return location.hash;`), (await body(A)).slice(0, 200)]);
    let t = await body(A);
    check('the summary shows difficulty, offers and waiting time', /4\s*\/5/.test(t) && /1\s*of 1/.test(t) && /9\s*days to hear back/i.test(t) && /Online test \(1\), HR \(1\)/.test(t), t.slice(0, 500));
    const card = await A.js(`const c = document.querySelector('.ivx'); return { text: c.innerText, rounds: [...c.querySelectorAll('.ivx-rounds li')].map(l => l.innerText), dots: c.querySelectorAll('.ivx-hard i.on').length, more: !!c.querySelector('.ivx-more') };`);
    check('the card shows rounds in order, the result and how hard', card.rounds.join() === 'Online test,HR' && card.dots === 4 && /Got an offer/.test(card.text) && /Heard back in 9 days/.test(card.text) && /Fresher or student/.test(card.text), card);
    check('long answers fold, with "Read more"', card.more);
    await A.js(`document.querySelector('.ivx-more summary').click();`);
    check('and open in full', (await A.js(`return document.querySelector('.ivx-more').open;`)) === true);

    // a nameless one from someone else, with something nasty in it
    await post(B, '/api/interviews', { company: 'infosys', role: 'Analyst', rounds: ['Technical'], difficulty: 2, outcome: 'rejected', waitDays: 20, anonymous: true, questions: '<img src=x onerror="window.__x=1"> SQL joins' });
    await A.load('experiences/infosys'); await wait(800);
    const html = await A.js(`return document.getElementById('ivxbody').innerHTML;`);
    t = await body(A);
    check('a nameless experience shows "A member" and never who', /A member/.test(t) && !html.includes(b) && !/Bala/.test(t), t.slice(0, 300));
    check('what people type stays text', !(await A.js(`return document.querySelectorAll('#ivxbody img').length;`)) && !(await A.js(`return window.__x || 0;`)) && /<img src=x/.test(t));
    check('the company page brings both spellings together', /2 experiences from members/.test(t));
    await A.click('.ivx [data-act="ivx-helpful"]');
    check('mark one as helpful', await until(async () => /Helpful · 1/.test(await body(A))));
    await A.type('#ivxq', 'sql');
    check('search within a company', (await A.js(`return document.querySelectorAll('#ivxlist .ivx').length;`)) === 1);
    await A.go('experiences/Zoho'); await wait(800);
    check('a company nobody has written about invites a share, filled in', /Nobody has shared an interview at Zoho yet/.test(await body(A)) && (await A.js(`return document.querySelector('details.share-ivx').open && document.querySelector('form[data-form="ivx"]').company.value;`)) === 'Zoho');
    await A.go('experiences'); await wait(800);
    check('companies to browse, with counts', /infosys\s*2|Infosys Ltd\.\s*2|infosys 2/i.test(await A.js(`return document.querySelector('.ivx-tools .chips').innerText;`)), await A.js(`return document.querySelector('.ivx-tools .chips') && document.querySelector('.ivx-tools .chips').innerText;`));
    await shot(A, 'experiences.png');

    // from the tracker
    const tomorrow = await A.js(`const d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');`);
    const data = await A.data();
    await post(A, '/api/me/data', Object.assign({}, data, { apps: [{ id: 'j1', title: 'Analyst', company: 'INFOSYS LIMITED', stage: 'Interview', interview: tomorrow, itime: '10:00', t: Date.now() }, { id: 'j2', title: 'Clerk', company: 'Nobody Co', stage: 'Applied', t: Date.now() }] }), 'PUT');
    await A.load('tracker'); await wait(1200);
    const links = await A.js(`return [...document.querySelectorAll('.ivx-link')].map(l => [l.innerText.trim(), l.getAttribute('href')]);`);
    check('tracked jobs link to what members said, only where there is something', links.length === 2 && links.every((l) => /2 interview stories/.test(l[0]) && decodeURIComponent(l[1]) === '#/experiences/INFOSYS LIMITED'), links);
    await A.click('.app .ivx-link'); await wait(1000);
    check('and the link opens that company', /2 experiences from members/.test(await body(A)));
    await A.go('interview'); await wait(300);
    check('interview practice points to it', !!(await A.js(`return document.querySelector('#main a[href="#/experiences"]');`)));

    // phones
    for (const w of [375, 320]) {
      await size(A, w, 760, true); await A.load('experiences/infosys'); await wait(800);
      await A.js(`document.querySelector('details.share-ivx').open = true;`); await wait(200);
      const p = await A.js(`return { over: document.documentElement.scrollWidth > innerWidth, cut: [...document.querySelectorAll('#ivxbody .chip-check, #ivxbody .ivx, #ivxbody input, #ivxbody select, #ivxbody textarea')].some(e => e.getBoundingClientRect().right > innerWidth + 1) };`);
      check('fits a ' + w + 'px phone, form open', !p.over && !p.cut, p);
      if (w === 320) { await A.js(`document.getElementById('main').classList.remove('enter'); window.scrollTo(0, 0);`); await shot(A, 'experiences-320.png'); }
    }
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('experiences: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
