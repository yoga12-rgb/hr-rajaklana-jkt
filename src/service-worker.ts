/// <reference lib="webworker" />
import { version } from '$app/env';
import { immutable, assets } from '$app/manifest';
import { installPwaCache } from './lib/pwa-install';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const CACHE = `rajaklana-shell-${version}`;
const paths = [...immutable, ...assets].map(item => item.path.startsWith('/') ? item.path : `/${item.path}`).filter(path => !['/_redirects', '/_headers'].includes(path));
const shellFiles = [...new Set([...paths, '/200.html'])];
sw.addEventListener('install', event => event.waitUntil(installPwaCache({
  cacheStorage: caches,
  fetcher: fetch,
  origin: sw.location.origin,
  cacheName: CACHE,
  paths
})));
sw.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('rajaklana-shell-') && key !== CACHE) await caches.delete(key);
  await sw.clients.claim();
})()));
sw.addEventListener('message', event => { if(event.data?.type === 'SKIP_WAITING') void sw.skipWaiting(); });
sw.addEventListener('push', event => {
  // Deliberately do not render arbitrary payload text, reasons, names or HR
  // decisions on a device lock screen, even if a sender payload is malformed.
  event.waitUntil(sw.registration.showNotification('HR Rajaklana', {
    body: 'Ada pembaruan di aplikasi HR Anda. Buka aplikasi untuk melihatnya.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'hr-update',
    data: { url: '/dashboard' }
  }));
});
sw.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('/dashboard', sw.location.origin).href;
    for (const client of await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(client.url).origin === sw.location.origin) {
        await (client as WindowClient).navigate(target); await (client as WindowClient).focus(); return;
      }
    }
    await sw.clients.openWindow(target);
  })());
});
sw.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== sw.location.origin || url.pathname === '/service-worker.js' || url.pathname.startsWith('/api/')) return;
  // Never cache Supabase APIs, private data, signed media URLs, or form submissions.
  if(shellFiles.includes(url.pathname)) event.respondWith((async () => {
    // These allowlisted files have identical public content for every Origin.
    // Module requests can carry Origin while precache requests do not; static
    // servers may return Vary: Origin, which must not cause an offline miss.
    const cache = await caches.open(CACHE), cached = await cache.match(request, { ignoreVary: true });
    if(cached) return cached;
    return fetch(request);
  })());
  else if(request.mode === 'navigate') event.respondWith((async () => {
    try { return await fetch(request); }
    catch { return (await caches.open(CACHE)).match('/200.html').then(r => r ?? new Response('Aplikasi memerlukan koneksi saat pertama kali dibuka.', {status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}})); }
  })());
});
