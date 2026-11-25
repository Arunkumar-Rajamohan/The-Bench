// Helpers for the browser tests: a throwaway server, and real browser windows driven through the app's own screens.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const EDGE = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
if (!EDGE) { console.log('FAIL no Edge or Chrome found. Set BROWSER_PATH to one.'); process.exit(1); }
const PORT = 5186, BASE = 'http://localhost:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-sync-'));
let server;
const startServer = async (extra) => {
  server = spawn(process.execPath, [process.argv[2]], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: path.join(tmp, 'db'), KEEP_AWAKE: 'off', GREENHOUSE_BASE_URL: 'http://127.0.0.1:9', LEVER_BASE_URL: 'http://127.0.0.1:9', ASHBY_BASE_URL: 'http://127.0.0.1:9', SMARTRECRUITERS_BASE_URL: 'http://127.0.0.1:9' }, extra), stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch (e) { /* starting */ } await wait(100); }
};
const stopServer = async () => { server.kill(); await wait(500); };
async function device(port) {
  const profile = path.join(tmp, 'p' + port);
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 80; i++) { try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (targets.some((t) => t.type === 'page')) break; } catch (e) { /* starting */ } await wait(150); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') cmd('Page.handleJavaScriptDialog', { accept: d.acceptDialogs !== false });
  });
  const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const d = {
    errors, cmd,
    js: async (code) => { const r = await cmd('Runtime.evaluate', { expression: '(async () => {' + code + '})()', awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception.description); return r.result.result.value; },
    go: async (hash) => { await cmd('Page.navigate', { url: BASE + '/#/' + hash }); await wait(900); },
    load: async (hash) => { await cmd('Page.navigate', { url: 'about:blank' }); await wait(200); await cmd('Page.navigate', { url: BASE + '/#/' + hash }); await wait(3200); },
    type: (sel, text) => d.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true }));`),
    click: (sel) => d.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.click();`),
    offline: (on) => cmd('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    data: () => d.js(`return (await (await fetch('/api/me')).json()).data;`),
    close: () => { try { ws.close(); } catch (e) { /* closed */ } proc.kill(); }
  };
  await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('Network.enable');
  return d;
}
module.exports = { device, startServer, stopServer, wait, tmp, BASE };

