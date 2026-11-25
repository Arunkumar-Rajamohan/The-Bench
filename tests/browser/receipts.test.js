// Read receipts through the real screens, two people in two browsers.
'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { device, startServer, stopServer, wait, tmp } = require('./devices.js');
(async () => {
  await startServer();
  const out = []; const check = (n, ok, x) => out.push([n, !!ok, x]);
  const A = await device(9391), B = await device(9392), B2 = await device(9393);
  const post = (d, url, body, method) => d.js(`const r = await fetch('${url}', { method: '${method || 'POST'}', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }); return r.status;`);
  const say = (d, text) => d.js(`const b = document.getElementById('chatbox'); b.value = ${JSON.stringify(text)}; b.form.requestSubmit();`);
  // what the last lines of the open chat look like, e.g. ['hello', 'Seen']
  const tail = (d) => d.js(`return [...document.querySelectorAll('#msgs > .msg, #msgs > .seen-mark')].slice(-3).map(e => e.classList.contains('seen-mark') ? 'Seen' : e.querySelector('.msg-text').innerText);`);
  const note = (d) => d.js(`const n = document.getElementById('receiptnote'); return !!n && !n.hidden;`);
  const until = async (f, secs) => { for (let i = 0; i < secs * 4; i++) { if (await f()) return true; await wait(250); } return false; };
  const seenAfter = (d, text) => until(async () => { const t = await tail(d); const i = t.indexOf(text); return i > -1 && t[i + 1] === 'Seen'; }, 5);
  // pretend the page is hidden (another tab, or the phone locked), or visible again
  const hide = (d, yes) => d.js(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${yes ? 'hidden' : 'visible'}' }); document.dispatchEvent(new Event('visibilitychange'));`);
  try {
    const pw = crypto.randomUUID(), a = 'ra_' + crypto.randomBytes(3).toString('hex'), b = 'rb_' + crypto.randomBytes(3).toString('hex');
    await A.load('home'); await post(A, '/api/signup', { username: a, name: 'Asha', password: pw });
    await B.load('home'); await post(B, '/api/signup', { username: b, name: 'Bala', password: pw });
    await A.load('dm/' + b); await B.load('dm/' + a);
    check('both see the note first', (await note(A)) && (await note(B)));
    await say(A, 'before choosing'); await wait(1500);
    check('nothing shown before choosing', !(await tail(A)).includes('Seen'), await tail(A));
    await A.load('chat/lobby'); check('no note in rooms', !(await note(A))); await A.load('dm/' + b);
    await A.click('[data-act=receipts-ok]'); await wait(1200); check('note goes away', !(await note(A)));
    check('still nothing: the other has not chosen', !(await tail(A)).includes('Seen'), await tail(A));
    await B.click('[data-act=receipts-ok]'); check('once both chose, what is on screen counts as read', await seenAfter(A, 'before choosing'), await tail(A));
    check('no Seen under the other person\'s own message', !(await tail(B)).includes('Seen'), await tail(B));

    await say(A, 'hello'); check('seen live while the chat is open', await seenAfter(A, 'hello'), await tail(A));
    check('only one Seen on screen', (await A.js(`return document.querySelectorAll('.seen-mark').length;`)) === 1);
    await say(B, 'hi back'); await until(async () => (await tail(A)).includes('hi back'), 5); check('hidden once they reply', !(await tail(A)).includes('Seen'), await tail(A));
    check('and their reply shows Seen to them', await seenAfter(B, 'hi back'), await tail(B));

    // not really looking
    await hide(B, true); await say(A, 'are you there'); await wait(2000); check('page hidden: not seen', !(await tail(A)).includes('Seen'), await tail(A));
    await hide(B, false); check('seen when they look again', await seenAfter(A, 'are you there'), await tail(A));
    await B.go('chat/lobby'); await say(A, 'second'); await wait(2000); let t = await tail(A); check('in another chat: not seen, and the earlier one stays Seen', t[t.length - 1] === 'second' && t.includes('Seen'), t);
    await B.go('home'); await wait(800); check('unread badge is not a read', (await tail(A)).pop() === 'second', await tail(A));
    await B.go('dm/' + a); check('opening the chat is', await seenAfter(A, 'second'), await tail(A));
    await A.load('dm/' + b); check('still there after reloading', await seenAfter(A, 'second'), await tail(A));
    await A.go('home'); await A.go('dm/' + b); check('and after coming back to the chat', await seenAfter(A, 'second'), await tail(A));
    // delete the seen message
    A.acceptDialogs = true; await A.js(`const m = [...document.querySelectorAll('#msgs .msg')].find(x => x.querySelector('.msg-text').innerText === 'second'); m.querySelector('[data-act=del-msg]').click();`); await wait(1500);
    check('deleting it leaves no stray Seen', (await A.js(`const s = document.querySelector('.seen-mark'); return !s || s.previousElementSibling.classList.contains('msg');`)));

    // the switch, and another device of the same person
    await B2.load('home'); await post(B2, '/api/login', { username: b, password: pw }); await B2.load('account'); await wait(800);
    check('not asked again on another device', await B2.js(`return document.getElementById('receiptbox').checked;`));
    await say(A, 'third'); await seenAfter(A, 'third');
    await B2.js(`const x = document.getElementById('receiptbox'); x.checked = false; x.dispatchEvent(new Event('change', { bubbles: true }));`);
    check('turned off elsewhere: Seen disappears for the sender', await until(async () => !(await tail(A)).includes('Seen'), 5), await tail(A));
    await say(A, 'fourth'); await wait(2000); check('off: reading shares nothing', !(await tail(A)).includes('Seen'), await tail(A));
    await say(B, 'fifth'); await wait(2000); check('off: you do not see theirs', !(await tail(B)).includes('Seen'), await tail(B));
    await B2.load('account'); await wait(800); check('switch is remembered', !(await B2.js(`return document.getElementById('receiptbox').checked;`)));
    await B2.js(`const x = document.getElementById('receiptbox'); x.checked = true; x.dispatchEvent(new Event('change', { bubbles: true }));`); await wait(1200);
    await say(A, 'sixth'); check('back on works at once on the first device', await seenAfter(A, 'sixth'), await tail(A));

    // blocking
    await B.js(`document.querySelector('#chatpane .pane-head [data-act=block]').click();`); await wait(1500);
    check('blocked: Seen disappears', await until(async () => !(await tail(A)).includes('Seen'), 5), await tail(A));

    // saying no
    const c = 'rc_' + crypto.randomBytes(3).toString('hex'); await post(B2, '/api/logout', {}); await post(B2, '/api/signup', { username: c, name: 'Chitra', password: pw }); await B2.load('dm/' + a); await wait(500);
    check('next person on the device is asked for themselves', await note(B2)); await B2.click('[data-act=receipts-no]'); await wait(1000); check('no is respected', !(await note(B2))); await B2.load('dm/' + a); check('and not asked again', !(await note(B2)));
    // phone
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true }); const d = 'rd_' + crypto.randomBytes(3).toString('hex'); await post(A, '/api/logout', {}); await post(A, '/api/signup', { username: d, name: 'Dev', password: pw }); await A.load('dm/' + c);
    const p = await A.js(`const n = document.getElementById('receiptnote').getBoundingClientRect(), b = document.getElementById('chatbox').getBoundingClientRect(); return { over: document.documentElement.scrollWidth > innerWidth, box: b.bottom <= innerHeight && b.height > 30, list: document.getElementById('msgs').clientHeight };`);
    check('note fits a small phone, with room to type', !p.over && p.box, p);
  } catch (e) { out.push(['crashed: ' + e.stack, false]); }
  console.log('receipts: ' + out.filter((x) => x[1]).length + '/' + out.length + ' passed');
  for (const [n, ok, x] of out) if (!ok) console.log('FAIL ' + n, x === undefined ? '' : JSON.stringify(x).slice(0, 400));
  const errs = A.errors.concat(B.errors, B2.errors); if (errs.length) console.log('FAIL page errors', errs.slice(0, 3));
  A.close(); B.close(); B2.close(); await stopServer(); await wait(500);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* closing */ }
  process.exit(0);
})();
