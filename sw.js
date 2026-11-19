/* The Bench — service worker. Makes the app installable and lets the shell open without a connection.
   Pages and code: network first (so updates arrive straight away), cached copy when offline.
   Fonts and icons: cache first (they never change). API calls and the live stream are never cached. */
'use strict';

const CACHE = 'bench-shell-v4';
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
