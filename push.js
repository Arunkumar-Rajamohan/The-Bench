// Web Push, without libraries: message encryption (RFC 8291), the site's signature (VAPID, RFC 8292),
// and working out which tracker reminders are due.
'use strict';
const crypto = require('node:crypto');

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Only the real push services. The address comes from a member's browser, so without this list the server could be
// told to send requests anywhere, including to machines on its own network.
const HOSTS = [/^fcm\.googleapis\.com$/, /^jmt17\.google\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)+notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];
function goodEndpoint(v, testOrigin) {
  let u;
  if (typeof v !== 'string' || v.length > 1000) return false;
  try { u = new URL(v); } catch (e) { return false; }
  if (u.username || u.password || u.hash) return false;
  if (testOrigin && u.origin === testOrigin) return true;
  return u.protocol === 'https:' && u.port === '' && HOSTS.some((h) => h.test(u.hostname));
}

// The browser's keys: a point on the P-256 curve, and a 16-byte secret.
function goodKeys(p256dh, auth) {
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 120 || auth.length > 40) return false;
  const pub = unb64(p256dh);
  if (pub.length !== 65 || pub[0] !== 4 || unb64(auth).length !== 16) return false;
  try { const e = crypto.createECDH('prime256v1'); e.generateKeys(); e.computeSecret(pub); return true; } catch (e) { return false; }
}

// `fixed` (salt and sender key) is only for checking against the published example.
function encrypt(text, p256dh, auth, fixed) {
  const theirs = unb64(p256dh), mine = crypto.createECDH('prime256v1');
  if (fixed) mine.setPrivateKey(fixed.priv); else mine.generateKeys();
  const pub = mine.getPublicKey(), salt = fixed ? fixed.salt : crypto.randomBytes(16);
  const ikm = hmac(hmac(unb64(auth), mine.computeSecret(theirs)), Buffer.concat([Buffer.from('WebPush: info\0'), theirs, pub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', key, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(4096);
  return Buffer.concat([salt, size, Buffer.from([pub.length]), pub, body]);
}

// The site's own key pair: { pub, jwk }. Browsers are given pub when they subscribe.
function newSiteKey() {
  const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  return { pub: b64(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)])), jwk };
}
// Proves to the push service who is sending. Re-used for an hour, as Apple asks.
const tokens = new Map();
function authorization(endpoint, site, contact) {
  const aud = new URL(endpoint).origin, had = tokens.get(aud);
  if (had && had.until > Date.now() && had.pub === site.pub) return had.value;
  const part = (o) => b64(JSON.stringify(o));
  const head = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact });
  const sig = crypto.sign('sha256', Buffer.from(head), { key: crypto.createPrivateKey({ key: site.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  const value = 'vapid t=' + head + '.' + b64(sig) + ', k=' + site.pub;
  tokens.set(aud, { until: Date.now() + 3600000, pub: site.pub, value });
  return value;
}

// ---------- tracker reminders ----------
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ist = (ms) => { const s = new Date(ms + 19800000).toISOString(); return { day: s.slice(0, 10), time: s.slice(11, 16) }; }; // India is UTC+5:30 all year
const shift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const clockText = (t) => { const h = Number(t.slice(0, 2)); return (h % 12 || 12) + ':' + t.slice(3) + (h < 12 ? ' AM' : ' PM'); };

// Only what reminders need: ids, stages and dates. Titles, companies and notes are left alone.
function datesOf(data) {
  const apps = data && Array.isArray(data.apps) ? data.apps : [];
  return apps.filter((a) => a && typeof a === 'object' && typeof a.id === 'string').slice(0, 1000).map((a) => ({
    id: a.id.slice(0, 40), stage: a.stage,
    followUp: DAY.test(a.followUp) ? a.followUp : '', interview: DAY.test(a.interview) ? a.interview : '', time: TIME.test(a.itime) ? a.itime : ''
  })).filter((a) => a.followUp || a.interview);
}
// Reminders to send now. Each has the keys that mark it as sent, so nothing is ever sent twice.
function dueNow(items, ms, prefs) {
  const now = ist(ms), out = [], at = minutes(now.time), daytime = at >= 9 * 60 && at < 21 * 60, soonIds = new Set();
  const open = (a) => a.stage !== 'Offer' && a.stage !== 'Rejected';
  if (prefs.interview) {
    for (const a of items) {
      if (!open(a) || a.interview !== now.day || !a.time) continue;
      const left = minutes(a.time) - at;
      if (left > 0 && left <= 75) {
        soonIds.add(a.id);
        out.push({ keys: ['is:' + a.id + ':' + a.interview + 'T' + a.time, 'i0:' + a.id + ':' + a.interview], text: 'Your interview is at ' + clockText(a.time) + '. Good luck!', urgent: true, tag: 'interview-' + a.id });
      }
    }
  }
  if (daytime) {
    const keys = [];
    const interviews = (day, word, code) => {
      const list = items.filter((a) => open(a) && a.interview === day && !soonIds.has(a.id) && !(code === 'i0' && a.time && minutes(a.time) <= at));
      for (const a of list) keys.push({ key: code + ':' + a.id + ':' + a.interview, kind: code, time: a.time, word });
    };
    if (prefs.interview) { interviews(now.day, 'today', 'i0'); interviews(shift(now.day, 1), 'tomorrow', 'i1'); }
    if (prefs.due) {
      for (const a of items) {
        // A few days' grace, in case the site was asleep; older ones are not dug up.
        if ((a.stage === 'Applied' || a.stage === 'Interview') && a.followUp && a.followUp <= now.day && a.followUp >= shift(now.day, -3)) keys.push({ key: 'f:' + a.id + ':' + a.followUp, kind: 'f' });
      }
    }
    if (keys.length) out.push({ digest: keys, tag: 'due' });
  }
  return out;
}
// The sentence for whichever digest items had not been sent before.
function digestText(list) {
  const bits = [];
  for (const [code, word] of [['i0', 'today'], ['i1', 'tomorrow']]) {
    const l = list.filter((x) => x.kind === code);
    if (l.length === 1) bits.push('Interview ' + word + (l[0].time ? ' at ' + clockText(l[0].time) : ''));
    else if (l.length) bits.push(l.length + ' interviews ' + word);
  }
  const f = list.filter((x) => x.kind === 'f').length;
  if (f) bits.push(f === 1 ? '1 follow-up is due' : f + ' follow-ups are due');
  return bits.join(' · ');
}

module.exports = { goodEndpoint, goodKeys, encrypt, newSiteKey, authorization, datesOf, dueNow, digestText, ist, unb64, b64 };
