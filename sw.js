/* The Bench — service worker. Makes the app installable and lets the shell open without a connection.
   Pages and code: network first (so updates arrive straight away), cached copy when offline.
   Fonts and icons: cache first (they never change). API calls and the live stream are never cached. */
'use strict';

const CACHE = 'bench-shell-v14';
const SHELL = [
  '/', '/styles.css', '/app.js', '/favicon.svg', '/manifest.webmanifest',
  '/fonts/inter.woff2', '/fonts/fraunces.woff2', '/fonts/fraunces-italic.woff2',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>The Bench: offline</title><body style="font:16px/1.6 system-ui,sans-serif;background:#f5efe6;color:#1d1a16;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
  '<div><h1 style="font-family:Georgia,serif;font-weight:600">You are offline</h1><p>The Bench needs an internet connection. Check your connection and try again.</p></div>';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return; // always live

  // Fonts and icons never change: serve from cache, fill it on first use.
  if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Everything else: try the network, keep a fresh copy, fall back to the cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((hit) =>
      hit || (req.mode === 'navigate' ? new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error())))
  );
});

// ---------- notifications ----------
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data.json(); } catch (x) { /* show something anyway: Safari withdraws permission if nothing appears */ }
  const url = typeof m.url === 'string' && m.url.startsWith('/#/') ? m.url : '/#/home';
  const safari = /AppleWebKit/.test(self.navigator.userAgent) && !/Chrome|Chromium|Edg/.test(self.navigator.userAgent);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    // Already looking at The Bench: the page shows it itself.
    if (!safari && m.tag !== 'test' && all.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined;
    return self.registration.showNotification(String(m.title || 'The Bench'), {
      body: String(m.body || 'Something new is waiting for you.'), tag: String(m.tag || 'bench'), renotify: true,
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url }
    });
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    const c = all.find((x) => new URL(x.url).origin === self.location.origin);
    if (!c) return self.clients.openWindow(url);
    c.postMessage({ type: 'open', url });
    return c.focus ? c.focus() : undefined;
  }));
});
