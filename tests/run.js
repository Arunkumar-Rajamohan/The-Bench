// Runs the tests.   node tests/run.js            everything except the browser tests (about 1 minute)
//                   node tests/run.js browser    the browser tests (needs Edge or Chrome; about 6 minutes)
//                   node tests/run.js chat       only tests whose name contains "chat"
// Each test starts its own throwaway server and database. Nothing touches the live site or ./data.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = path.join(root, 'server.js');
const want = process.argv[2] || '';
const list = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.test.js')).sort().map((f) => [dir, f]);
const jobs = [];
// "both" tests run twice: with a local database file, and with a stand-in for Turso.
for (const [dir, f] of [...list('both'), ...list('once'), ...list('browser')]) {
  const name = f.replace('.test.js', '');
  if (want === 'browser' ? dir !== 'browser' : want ? !name.includes(want) : dir === 'browser') continue;
  for (const mode of dir === 'both' ? ['local', 'hosted'] : ['']) jobs.push({ name: name + (mode ? ' (' + mode + ')' : ''), file: path.join(__dirname, dir, f), mode });
}
// Tests must never read real company feeds or use real keys.
const env = Object.assign({}, process.env, { KEEP_AWAKE: 'off', NODE_NO_WARNINGS: '1' });
for (const k of ['GREENHOUSE_BASE_URL', 'LEVER_BASE_URL', 'ASHBY_BASE_URL', 'SMARTRECRUITERS_BASE_URL']) env[k] = 'http://127.0.0.1:9';
for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ADMIN_USERNAMES', 'RENDER_EXTERNAL_URL', 'NODE_ENV', 'DATA_DIR', 'PORT']) delete env[k];

function one(job) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [job.file, server, ...(job.mode ? [job.mode] : [])], { env, cwd: root });
    let out = '';
    child.stdout.on('data', (d) => out += d);
    child.stderr.on('data', (d) => out += d);
    const timer = setTimeout(() => { out += '\nTimed out.'; child.kill(); }, 6 * 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const m = /(\d+)\/(\d+) passed/.exec(out);
      const ok = code === 0 && m && m[1] === m[2] && Number(m[2]) > 0 && !/^FAIL/m.test(out);
      console.log((ok ? 'ok    ' : 'FAIL  ') + job.name.padEnd(24) + (m ? m[0] : 'no result') + '  ' + Math.round((Date.now() - started) / 1000) + 's');
      if (!ok) console.log(out.trim().split('\n').slice(-25).map((l) => '      ' + l).join('\n'));
      done(ok);
    });
  });
}
(async () => {
  if (!jobs.length) { console.log('No test matches "' + want + '".'); process.exit(1); }
  let failed = 0;
  for (const j of jobs) if (!(await one(j))) failed++;
  console.log('\n' + (failed ? failed + ' of ' + jobs.length + ' FAILED' : 'All ' + jobs.length + ' passed'));
  process.exit(failed ? 1 : 0);
})();
