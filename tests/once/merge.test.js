// Merge rules for private data (the plain functions inside app.js)
'use strict';
const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app.js'), 'utf8');
const body = src.slice(src.indexOf('  // --- merge (plain'), src.indexOf('  // --- end merge ---'));
const { merge3, same, clone } = new Function('function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }' + body + '; return { merge3, same, clone };')();
let pass = 0, fail = 0;
const eq = (name, got, want) => { if (same(got, want) && JSON.stringify(got).length === JSON.stringify(want).length) pass++; else { fail++; console.log('FAIL ' + name, JSON.stringify(got), 'want', JSON.stringify(want)); } };
const M = (b, m, t, lost) => merge3(b, m, t, '', lost || []);
eq('different fields', M({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }), { a: 2, b: 3 });
let lost = []; eq('same field: mine wins', M({ a: 'x' }, { a: 'mine' }, { a: 'theirs' }, lost), { a: 'mine' }); eq('loser collected', lost, [{ path: 'a', text: 'theirs' }]);
eq('delete vs untouched', M({ a: 1, b: 1 }, { b: 1 }, { a: 1, b: 1 }), { b: 1 });
eq('delete vs edit keeps edit', M({ a: 1 }, {}, { a: 2 }), { a: 2 });
eq('edit vs delete keeps edit', M({ a: 1 }, { a: 2 }, {}), { a: 2 });
eq('both add to days', M({ log: {} }, { log: { d1: ['t1'] } }, { log: { d2: ['t2'] } }), { log: { d1: ['t1'], d2: ['t2'] } });
eq('ticks same day', M({ d: ['a'] }, { d: ['a', 'b'] }, { d: ['a', 'c'] }), { d: ['a', 'b', 'c'] });
eq('untick vs tick', M({ d: ['a'] }, { d: [] }, { d: ['a', 'c'] }), { d: ['c'] });
const app = (id, x) => Object.assign({ id, stage: 'Applied' }, x);
eq('both add jobs', M({ apps: [app('1')] }, { apps: [app('1'), app('2')] }, { apps: [app('1'), app('3')] }).apps.map((x) => x.id).sort(), ['1', '2', '3']);
eq('edit different jobs', M({ apps: [app('1'), app('2')] }, { apps: [app('1', { note: 'm' }), app('2')] }, { apps: [app('1'), app('2', { note: 't' })] }), { apps: [app('1', { note: 'm' }), app('2', { note: 't' })] });
eq('edit same job, other fields', M({ apps: [app('1')] }, { apps: [app('1', { stage: 'Offer' })] }, { apps: [app('1', { note: 't' })] }), { apps: [app('1', { stage: 'Offer', note: 't' })] });
eq('remove vs untouched job', M({ apps: [app('1'), app('2')] }, { apps: [app('2')] }, { apps: [app('1'), app('2', { n: 1 })] }), { apps: [app('2', { n: 1 })] });
eq('remove vs edited job keeps it', M({ apps: [app('1')] }, { apps: [] }, { apps: [app('1', { note: 'x' })] }), { apps: [app('1', { note: 'x' })] });
eq('reorder here, add there', M({ l: [{ id: 'a' }, { id: 'b' }] }, { l: [{ id: 'b' }, { id: 'a' }] }, { l: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }).l.map((x) => x.id), ['b', 'a', 'c']);
eq('reorder there, edit here', M({ l: [{ id: 'a' }, { id: 'b' }] }, { l: [{ id: 'a', n: 1 }, { id: 'b' }] }, { l: [{ id: 'b' }, { id: 'a' }] }), { l: [{ id: 'b' }, { id: 'a', n: 1 }] });
const p = (id, t, r) => ({ id, t, q: 'Q', r });
eq('same question practised on both', M({ practice: [] }, { practice: [p('g-1', 5, 'Okay')] }, { practice: [p('g-1', 3, 'Rough')] }).practice, [p('g-1', 3, 'Rough'), p('g-1', 5, 'Okay')]);
eq('old practice without ids', M({ practice: [{ q: 'a', t: 1 }] }, { practice: [{ q: 'a', t: 1 }, { q: 'b', t: 2 }] }, { practice: [{ q: 'a', t: 1 }, p('x', 3, 'Okay')] }).practice.length, 3);
eq('blank resume does not wipe a filled one', M({ cv: null }, { cv: { name: 'N', summary: '', experience: [] } }, { cv: { name: 'N', summary: 'full', experience: [{ id: 'n0', role: 'r' }] } }), { cv: { name: 'N', summary: 'full', experience: [{ id: 'n0', role: 'r' }] } });
eq('both add resume jobs', M({ e: [{ id: 'n0' }] }, { e: [{ id: 'n0' }, { id: 'm' }] }, { e: [{ id: 'n0' }, { id: 't' }] }).e.length, 3);
eq('bingo: same card merges ticks', M({ bingo: { card: [1, 2], ticks: [], total: 0 } }, { bingo: { card: [1, 2], ticks: [1], total: 0 } }, { bingo: { card: [1, 2], ticks: [2], total: 0 } }).bingo.ticks.sort(), [1, 2]);
eq('bingo: cards never mixed', M({ bingo: null }, { bingo: { card: [9, 8], ticks: [], total: 0 } }, { bingo: { card: [1, 2], ticks: [2], total: 0 } }).bingo, { card: [1, 2], ticks: [2], total: 0 });
eq('empty text here, edited there is collected', (() => { const l = []; const r = M({ n: 'old note here' }, { n: '' }, { n: 'a much longer note' }, l); return [r.n, l.length]; })(), ['', 1]);
// random: never throws; agreed changes stay; one-sided changes are taken; nobody's new list items vanish
let seed = 7; const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
const val = () => [rnd(5), 's' + rnd(4), null, '', true, undefined][rnd(6)];
const state = () => { const s = { f: {}, apps: [], days: {}, practice: [] }; for (let i = 0; i < 4; i++) { const v = val(); if (v !== undefined) s.f['k' + i] = v; if (rnd(2)) s.apps.push({ id: 'a' + i, n: rnd(3) }); if (rnd(2)) s.days['d' + i] = ['x', 'y', 'z'].filter(() => rnd(2)); if (rnd(2)) s.practice.push({ id: 'q' + rnd(2), q: 'q', t: i + 1 }); } return s; };
const mutate = (s, who) => { s = clone(s); for (let j = 0; j < 1 + rnd(4); j++) switch (rnd(5)) { case 0: s.f['k' + rnd(5)] = 'new' + who + rnd(3); break; case 1: s.apps.push({ id: who + j + rnd(1e6), n: 0 }); break; case 2: if (s.apps.length) s.apps.splice(rnd(s.apps.length), 1); break; case 3: s.practice.push({ id: 'q0', q: 'q', t: 100 + rnd(1e6) }); break; case 4: if (s.apps[0]) s.apps[0].n = who + rnd(9); } return s; };
let bad = 0;
for (let i = 0; i < 20000; i++) {
  const b = state(), m = mutate(b, 'm'), t = mutate(b, 't');
  const before = JSON.stringify([b, m, t]); let r;
  try { r = M(b, m, t); } catch (e) { bad++; if (bad < 3) console.log('threw', e.message); continue; }
  const ids = (s) => s.apps.map((x) => x.id), was = ids(b);
  const ok = JSON.stringify([b, m, t]) === before && same(M(b, m, b), m) && same(M(b, b, t), t) && same(M(b, m, m), m) &&
    ids(m).concat(ids(t)).filter((x) => !was.includes(x)).every((x) => ids(r).includes(x)) && new Set(ids(r)).size === ids(r).length &&
    m.practice.concat(t.practice).every((x) => r.practice.some((y) => y.t === x.t)) &&
    same(M(t, r, t), r) && Object.keys(r.f).every((k) => same(r.f[k], m.f[k]) || same(r.f[k], t.f[k]));
  if (!ok) { bad++; if (bad < 3) console.log('FAIL random', before, JSON.stringify(r)); }
}
if (bad) fail++; else pass++;
console.log('merge: ' + pass + '/' + (pass + fail) + ' passed (20,000 random cases, ' + bad + ' bad)');
process.exit(fail ? 1 : 0);
