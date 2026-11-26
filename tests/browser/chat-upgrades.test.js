// Replies, reactions, edits and links, through the real chat screens, two people in two browsers.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9411), B = await device(9412);
  const post = (d, url, body) => d.js(`return (await fetch('${url}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })).status;`);
  const until = async (f, secs) => { for (let i = 0; i < (secs || 5) * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const key = async (d, k) => {
    const codes = { Enter: 13, Escape: 27, ArrowUp: 38 };
    await d.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: codes[k], text: k === 'Enter' ? '\r' : undefined });
    await d.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: codes[k] });
  };
  // type like a person: into the focused message box
  const typeIn = async (d, text) => { await d.js(`document.getElementById('chatbox').focus();`); await d.cmd('Input.insertText', { text }); };
  const send = async (d, text) => { await typeIn(d, text); await key(d, 'Enter'); await wait(700); };
  const msgId = (d, text) => d.js(`const m = [...document.querySelectorAll('#msgs .msg')].find(x => x.querySelector('.msg-text').innerText === ${JSON.stringify(text)}); return m ? Number(m.dataset.id) : 0;`);
  // open a message's menu, then press one of its buttons
  const menu = (d, id, act, r) => d.js(`const m = document.querySelector('#msgs .msg[data-id="${id}"]'); m.querySelector('details.msg-menu summary').click(); await new Promise(r => setTimeout(r, 150)); m.querySelector('.menu [data-act="${act}"]${r ? `[data-r="${r}"]` : ''}').click();`);
  const msg = (d, id) => d.js(`const m = document.querySelector('#msgs .msg[data-id="${id}"]'); if (!m) return null; const q = m.querySelector('.msg-quote'); return { text: m.querySelector('.msg-text').innerText, edited: !!m.querySelector('.edited'), quote: q ? q.innerText : '', gone: !!(q && q.classList.contains('gone')), chips: [...m.querySelectorAll('.msg-reacts .react')].map(c => c.innerText + (c.classList.contains('on') ? '*' : '')) };`);
  const bar = (d) => d.js(`const b = document.getElementById('composebar'); return b && !b.hidden ? b.innerText.replace(/\\s+/g, ' ').trim() : '';`);
  const box = (d) => d.js(`return document.getElementById('chatbox').value;`);
  const shot = async (d, f) => { if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, f), Buffer.from((await d.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
  try {
    const pw = crypto.randomUUID(), a = 'ca_' + crypto.randomBytes(3).toString('hex'), b = 'cb_' + crypto.randomBytes(3).toString('hex');
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw });
    await A.load('chat/lobby'); await B.load('chat/lobby');

    // ---- links ----
    await send(A, 'see https://example.com/path). and www.test.org, or (https://en.wikipedia.org/wiki/Bench_(furniture))');
    await until(async () => (await B.js(`return document.querySelectorAll('#msgs .msg-text a').length;`)) === 3);
    const links = await B.js(`return [...document.querySelectorAll('#msgs .msg-text a')].map(a => ({ href: a.getAttribute('href'), text: a.innerText, target: a.target, rel: a.rel }));`);
    check('web addresses become links, without the full stop or bracket after them', links.length === 3 && links[0].href === 'https://example.com/path' && links[1].href === 'https://www.test.org' && links[1].text === 'www.test.org' && links[2].href === 'https://en.wikipedia.org/wiki/Bench_(furniture)', links);
    check('links open in a new tab, safely', links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel) && /nofollow/.test(l.rel)), links);
    await send(A, 'javascript:alert(1) <img src=x onerror="window.__x=1"> mail me@www.site.com https://ok.example/?a=<b>x</b>');
    await until(async () => !!(await msgId(B, 'javascript:alert(1) <img src=x onerror="window.__x=1"> mail me@www.site.com https://ok.example/?a=<b>x</b>')));
    const bad = await B.js(`return { img: document.querySelectorAll('#msgs img').length, js: [...document.querySelectorAll('#msgs a')].filter(a => /^javascript/i.test(a.getAttribute('href') || '')).length, email: [...document.querySelectorAll('#msgs .msg-text a')].some(a => /site\\.com/.test(a.href)), last: [...document.querySelectorAll('#msgs .msg-text a')].pop().getAttribute('href'), x: window.__x || 0 };`);
    check('nothing typed can become code or a fake link', bad.img === 0 && bad.js === 0 && !bad.email && bad.last === 'https://ok.example/?a=' && bad.x === 0, bad);

    // ---- replies ----
    const first = await msgId(B, 'see https://example.com/path). and www.test.org, or (https://en.wikipedia.org/wiki/Bench_(furniture))');
    await menu(B, first, 'reply-msg');
    check('Reply shows who you are answering', /^Replying to Asha see https:\/\/example\.com/.test(await bar(B)), await bar(B));
    check('and puts you in the box', await B.js(`return document.activeElement.id === 'chatbox';`));
    await key(B, 'Escape'); check('Esc cancels it', (await bar(B)) === '');
    await menu(B, first, 'reply-msg'); await send(B, 'nice links');
    const rep = await msgId(B, 'nice links');
    let mb = await msg(B, rep);
    check('the reply shows what it answers', mb && /^Asha/.test(mb.quote) && /see https:\/\/example\.com/.test(mb.quote), mb);
    check('and the reply bar goes away after sending', (await bar(B)) === '');
    await until(async () => !!(await msg(A, rep)));
    let ma = await msg(A, rep); check('the other person sees the quote live', ma && /^Asha/.test(ma.quote), ma);
    await A.js(`document.querySelector('#msgs .msg[data-id="${rep}"] .msg-quote').click();`); await wait(200);
    check('tapping the quote jumps to the original', await A.js(`return document.querySelector('#msgs .msg[data-id="${first}"]').classList.contains('flash');`));

    // ---- reactions ----
    await menu(A, rep, 'mreact', '👍');
    check('react from the menu', await until(async () => ((await msg(A, rep)) || {}).chips.join() === '👍 1*'), await msg(A, rep));
    check('the other person sees the count live, not marked as theirs', await until(async () => ((await msg(B, rep)) || {}).chips.join() === '👍 1'), await msg(B, rep));
    await B.click(`#msgs .msg[data-id="${rep}"] .msg-reacts .react`);
    check('tap a reaction to add yours', await until(async () => ((await msg(B, rep)) || {}).chips.join() === '👍 2*') && await until(async () => ((await msg(A, rep)) || {}).chips.join() === '👍 2*'), [await msg(B, rep), await msg(A, rep)]);
    await A.click(`#msgs .msg[data-id="${rep}"] .msg-reacts .react`);
    check('and again to take it back', await until(async () => ((await msg(A, rep)) || {}).chips.join() === '👍 1') && await until(async () => ((await msg(B, rep)) || {}).chips.join() === '👍 1*'));
    check('reactions have names for screen readers', /Thumbs up: 1, including you/.test(await B.js(`return document.querySelector('#msgs .msg[data-id="${rep}"] .msg-reacts .react').getAttribute('aria-label');`)));
    await shot(B, 'chat-reply-react.png');

    // ---- edits ----
    await typeIn(A, 'half-typed thought');
    await menu(A, first, 'edit-msg');
    check('Edit puts the message in the box', (await box(A)).startsWith('see https://example.com') && (await bar(A)) === 'Editing your message' && (await A.js(`return document.getElementById('chatsend').innerText;`)) === 'Save', [await box(A), await bar(A)]);
    await key(A, 'Escape');
    check('Esc gives back what you were typing', (await box(A)) === 'half-typed thought' && (await bar(A)) === '');
    await A.js(`const b = document.getElementById('chatbox'); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true }));`);
    await menu(A, first, 'edit-msg');
    await A.js(`const b = document.getElementById('chatbox'); b.select();`); await A.cmd('Input.insertText', { text: 'see www.fixed.example now' }); await key(A, 'Enter'); await wait(800);
    ma = await msg(A, first);
    check('saved, and marked as edited', ma.text === 'see www.fixed.example now' && ma.edited && (await bar(A)) === '' && (await box(A)) === '', [ma, await box(A)]);
    check('the other person sees the change live', await until(async () => { const x = await msg(B, first); return x && x.text === 'see www.fixed.example now' && x.edited; }), await msg(B, first));
    check('and the quote in the reply follows', await until(async () => /see www\.fixed\.example now/.test(((await msg(B, rep)) || {}).quote)), await msg(B, rep));
    check('the edited link works', (await B.js(`return document.querySelector('#msgs .msg[data-id="${first}"] .msg-text a').getAttribute('href');`)) === 'https://www.fixed.example');
    // Up arrow in an empty box edits your last message
    await send(A, 'tpyo here');
    await A.js(`document.getElementById('chatbox').focus();`); await key(A, 'ArrowUp');
    check('Up in an empty box edits your last message', (await box(A)) === 'tpyo here' && (await bar(A)) === 'Editing your message', await box(A));
    await A.js(`document.getElementById('chatbox').select();`); await A.cmd('Input.insertText', { text: 'typo here' }); await key(A, 'Enter'); await wait(800);
    check('and saves it', (await msg(A, await msgId(A, 'typo here'))).edited && !(await msgId(A, 'tpyo here')));
    check('the other person\'s messages have no Edit', !(await B.js(`return !!document.querySelector('#msgs .msg[data-id="${first}"] [data-act="edit-msg"]');`)) && (await A.js(`return !!document.querySelector('#msgs .msg[data-id="${first}"] [data-act="edit-msg"]');`)));

    // ---- deleting the original ----
    A.acceptDialogs = true; await menu(A, first, 'del-msg');
    check('a reply to a deleted message says so', await until(async () => { const x = await msg(B, rep); return x && x.gone && /deleted/.test(x.quote) && !/fixed/.test(x.quote); }), await msg(B, rep));
    check('also after reloading', (await B.load('chat/lobby'), await until(async () => { const x = await msg(B, rep); return x && x.gone; })));
    check('reactions are still there after reloading', ((await msg(B, rep)) || {}).chips.join() === '👍 1*', await msg(B, rep));

    // ---- private chat ----
    await A.load('dm/' + b); await B.load('dm/' + a);
    await send(A, 'are you free at 5?');
    await until(async () => !!(await msgId(B, 'are you free at 5?')));
    const q = await msgId(B, 'are you free at 5?');
    await menu(B, q, 'reply-msg'); await send(B, 'yes');
    check('replies work in private chats', await until(async () => /are you free at 5\?/.test(((await msg(A, await msgId(A, 'yes'))) || {}).quote)));
    await menu(A, await msgId(A, 'yes'), 'mreact', '❤️');
    check('and reactions', await until(async () => ((await msg(B, await msgId(B, 'yes'))) || {}).chips.join() === '❤️ 1'));

    // ---- small phone ----
    await B.cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await B.load('dm/' + a); await wait(300);
    if (await B.js(`return !!document.querySelector('[data-act=receipts-no]');`)) { await B.click('[data-act=receipts-no]'); await wait(800); } // a one-time question
    check('phones get the short safety note', await B.js(`const s = document.querySelector('.scam'); return getComputedStyle(s.querySelector('.wide-only')).display === 'none' && s.querySelector('.phone-only').offsetHeight > 0 && s.offsetHeight < 70;`));
    const yes = await msgId(B, 'yes');
    await B.js(`document.querySelector('#msgs .msg[data-id="${yes}"] details.msg-menu summary').click();`); await wait(200);
    let p = await B.js(`const m = document.querySelector('#msgs .msg[data-id="${yes}"] .menu').getBoundingClientRect(), l = document.getElementById('msgs').getBoundingClientRect(); const e = [...document.querySelectorAll('#msgs .msg[data-id="${yes}"] .menu-reacts button')].map(x => x.getBoundingClientRect()); return { left: m.left, right: m.right, top: m.top, bottom: m.bottom, ltop: l.top, lbottom: l.bottom, w: innerWidth, small: Math.min(...e.map(x => x.width)), tall: Math.min(...e.map(x => x.height)) };`);
    check('the menu and its reactions fit a small phone', p.left >= 0 && p.right <= p.w && p.small >= 28 && p.tall >= 28, p);
    check('the menu of the last message opens upwards, fully in view', p.top >= p.ltop && p.bottom <= p.lbottom, p);
    await shot(B, 'chat-menu-320.png');
    await B.js(`document.body.click();`);
    await menu(B, yes, 'reply-msg');
    p = await B.js(`const b = document.getElementById('composebar').getBoundingClientRect(), x = document.getElementById('chatbox').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth, barRight: b.right, w: innerWidth, box: x.bottom <= innerHeight && x.height > 30, list: document.getElementById('msgs').clientHeight };`);
    check('the reply bar fits, with room to type and read', !p.over && p.barRight <= p.w && p.box && p.list > 150, p);
    await shot(B, 'chat-reply-320.png');
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('chat-upgrades: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = A.errors.concat(B.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
