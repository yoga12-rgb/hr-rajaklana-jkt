import { describe, expect, it } from 'vitest';
import { installPwaCache } from './pwa-install';

class MemoryCache {
  private entries = new Map<string, Response>();
  private key(request: RequestInfo) { return new URL(typeof request === 'string' ? request : request.url, origin).href; }
  async put(request: RequestInfo, response: Response) { this.entries.set(this.key(request), response.clone()); }
  async match(request: RequestInfo) { const response = this.entries.get(this.key(request)); return response?.clone(); }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)); }
}

class MemoryCaches {
  readonly stores = new Map<string, MemoryCache>();
  async open(name: string) { let cache = this.stores.get(name); if (!cache) { cache = new MemoryCache(); this.stores.set(name, cache); } return cache; }
  async delete(name: string) { return this.stores.delete(name); }
  async has(name: string) { return this.stores.has(name); }
}

const origin = 'https://preview.example.test';
const response = (body: string, type: string, path: string, status = 200) => {
  const result = new Response(body, { status, headers: { 'Content-Type': type } });
  Object.defineProperty(result, 'url', { value: `${origin}${path}` });
  return result;
};
const shell = () => response('<!doctype html><body data-rajaklana-app-shell="true"></body>', 'text/html', '/');

describe('PWA install cache transaction', () => {
  it('cleans a failed asset install while preserving the active cache', async () => {
    const caches = new MemoryCaches();
    const old = await caches.open('rajaklana-shell-old');
    await old.put('/200.html', shell());
    const fetcher: typeof fetch = async (input) => String(input).endsWith('bad.js')
      ? response('<html>Sign in</html>', 'text/html', '/sso')
      : response('export default 1', 'text/javascript', '/good.js');

    await expect(installPwaCache({ cacheStorage: caches, fetcher, origin, cacheName: 'rajaklana-shell-new', paths: ['/good.js', '/bad.js'] })).rejects.toThrow('PWA asset unavailable');
    expect(caches.stores.has('rajaklana-shell-new-install')).toBe(false);
    expect(caches.stores.has('rajaklana-shell-new')).toBe(false);
    expect(caches.stores.has('rajaklana-shell-old')).toBe(true);
  });

  it('cleans a failed shell install and retries into a complete cache', async () => {
    const caches = new MemoryCaches();
    let validShell = false;
    const fetcher: typeof fetch = async (input) => String(input) === '/' ? (validShell ? shell() : response('<html>Vercel Authentication</html>', 'text/html', '/')) : response('export default 1', 'text/javascript', String(input));
    const options = { cacheStorage: caches, fetcher, origin, cacheName: 'rajaklana-shell-new', paths: ['/good.js'] };

    await expect(installPwaCache(options)).rejects.toThrow('SPA shell unavailable');
    expect(caches.stores.has('rajaklana-shell-new-install')).toBe(false);
    validShell = true;
    await installPwaCache(options);
    expect(caches.stores.has('rajaklana-shell-new-install')).toBe(false);
    const complete = await caches.open('rajaklana-shell-new');
    expect(await complete.match('/good.js')).toBeTruthy();
    expect(await complete.match('/200.html')).toBeTruthy();
  });
});
