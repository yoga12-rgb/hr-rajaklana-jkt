/// <reference lib="webworker" />
import { version } from '$app/env';
import { immutable, assets } from '$app/manifest';

const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const CACHE = `rajaklana-shell-${version}`;
const paths = [...immutable, ...assets].map(item => item.path.startsWith('/') ? item.path : `/${item.path}`).filter(path => !['/_redirects', '/_headers'].includes(path));
const shellFiles = [...new Set([...paths, '/200.html'])];
sw.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(paths);
  // Static hosts and the preview server expose the SPA shell at `/` even when
  // the generated fallback file is not a publicly addressable route.
  const shell = await fetch('/', { cache: 'reload' });
  if (!shell.ok || !shell.headers.get('Content-Type')?.includes('text/html')) throw new Error('SPA shell unavailable');
  await cache.put('/200.html', shell);
})()));
sw.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('rajaklana-shell-') && key !== CACHE) await caches.delete(key);
  await sw.clients.claim();
})()));
sw.addEventListener('message', event => { if(event.data?.type === 'SKIP_WAITING') void sw.skipWaiting(); });
sw.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== sw.location.origin || url.pathname === '/service-worker.js') return;
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
