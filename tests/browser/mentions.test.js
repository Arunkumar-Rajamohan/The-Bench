// @mentions through the real chat: suggestions while typing, the badge and highlight for the person named, phones.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9481), B = await device(9482);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const key = async (d, k) => {
    const codes = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40, Tab: 9 };
    await d.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: codes[k], text: k === 'Enter' ? '\r' : undefined });
    await d.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: codes[k] });
  };
  const type = async (d, text) => { await d.js(`document.getElementById('chatbox').focus();`); await d.cmd('Input.insertText', { text }); await wait(150); };
  const pop = (d) => d.js(`const p = document.getElementById('mentionpop'); return p && !p.hidden ? [...p.querySelectorAll('button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim() + (b.classList.contains('on') ? ' *' : '')) : [];`);
  const box = (d) => d.js(`return document.getElementById('chatbox').value;`);
  const badge = (d) => d.js(`const b = document.getElementById('chatbadge'); return b.hidden ? '' : b.textContent;`);
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  try {
    const pw = crypto.randomUUID(), a = 'na_' + crypto.randomBytes(3).toString('hex'), b = 'nb_' + crypto.randomBytes(3).toString('hex');
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala Murugan', password: pw });
    await post(B, '/api/chat/room/lobby', { text: 'hello everyone' });
    await A.load('chat/lobby'); await B.load('home');

    // suggestions while typing
    await type(A, 'Hi @mu');
    check('typing @ and part of a name suggests people', (await pop(A)).some((x) => x.startsWith('B Bala Murugan @' + b)), await pop(A));
    await type(A, 'zzz');
    check('no match, no list', (await pop(A)).length === 0);
    await A.js(`const b = document.getElementById('chatbox'); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true }));`);
    await type(A, 'Hi @' + b.slice(0, 3));
    check('the first suggestion is picked out', ((await pop(A))[0] || '').endsWith('*'), await pop(A));
    await key(A, 'Escape');
    check('Esc closes the list and keeps the words', (await pop(A)).length === 0 && (await box(A)) === 'Hi @' + b.slice(0, 3));
    await type(A, b.slice(3, 4));
    await key(A, 'Enter');
    check('Enter picks the name instead of sending', (await box(A)) === 'Hi @' + b + ' ' && (await pop(A)).length === 0, await box(A));
    await type(A, 'welcome! mail me at x@' + b + '.com');
    await key(A, 'Enter'); await wait(800);
    check('then Enter sends', (await box(A)) === '' && /welcome!/.test(await A.js(`return document.getElementById('msgs').innerText;`)));
    const link = await A.js(`const l = [...document.querySelectorAll('#msgs .msg-text a.mention')].pop(); return l ? [l.innerText, l.getAttribute('href')] : null;`);
    check('the name in the message links to their profile', link && link[0] === '@' + b && link[1] === '#/u/' + b, link);
    check('an email address is not a mention', (await A.js(`return [...document.querySelectorAll('#msgs .msg-text a.mention')].length;`)) === 1);
    // picking with the mouse
    await type(A, ' @bal');
    await A.js(`document.querySelector('#mentionpop button').click();`);
    check('a tap picks a name too', /@ ?@?\S*\s*@?/.test(await box(A)) && (await box(A)).trim().endsWith('@' + b), await box(A));
    await A.js(`const b = document.getElementById('chatbox'); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true }));`);
    await shot(A, 'mention-typing.png');

    // the person named
    check('they get a badge on Chat', await until(async () => (await badge(B)) === '1'), await badge(B));
    await B.go('chat'); await wait(800);
    await B.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await B.go('chat/job-leads'); await wait(800);
    check('and an @ next to the room', await B.js(`const r = [...document.querySelectorAll('.ch')].find(x => /lobby/.test(x.innerText)); return !!(r && r.querySelector('.at'));`));
    await B.go('chat/lobby'); await wait(1200);
    const mine = await B.js(`const m = [...document.querySelectorAll('#msgs .msg')].find(x => /welcome!/.test(x.innerText)); return m ? { hi: m.classList.contains('mentioned'), me: !!m.querySelector('a.mention.me') } : null;`);
    check('the message stands out for them, with their name marked', mine && mine.hi && mine.me, mine);
    check('opening the room clears the @ and the badge', await until(async () => (await badge(B)) === '' && !(await B.js(`return !!document.querySelector('.ch .at');`))));
    check('and the server knows', await until(async () => JSON.stringify((await B.js(`return (await (await fetch('/api/chat/summary')).json()).mentions;`))) === '{}'));
    check('the writer\'s own copy is not highlighted', !(await A.js(`return [...document.querySelectorAll('#msgs .msg.mentioned')].length;`)));
    // while they are looking at the room, a new mention clears itself
    await post(A, '/api/chat/room/lobby', { text: 'one more @' + b }); await wait(1200);
    check('a mention while the room is open does not leave a badge', (await badge(B)) === '' && JSON.stringify((await B.js(`return (await (await fetch('/api/chat/summary')).json()).mentions;`))) === '{}');

    // private chats have no suggestions
    await A.load('dm/' + b); await type(A, 'hi @' + b.slice(0, 3));
    check('no suggestions in a private chat', (await pop(A)).length === 0);

    // phone
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await A.load('chat/lobby'); await type(A, '@b');
    const p = await A.js(`const r = document.getElementById('mentionpop').getBoundingClientRect(), c = document.getElementById('chatbox').getBoundingClientRect(); return { left: r.left, right: r.right, w: innerWidth, above: r.bottom <= c.top + 1, shown: r.height > 30, over: document.documentElement.scrollWidth > innerWidth };`);
    check('the list fits a small phone, above the box', p.left >= 0 && p.right <= p.w && p.above && p.shown && !p.over, p);
    await shot(A, 'mention-320.png');
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('mentions: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 500));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
