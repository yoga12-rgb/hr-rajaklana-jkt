import { describe, expect, it } from 'vitest';
import { validatePwaResponse } from './pwa-cache-validation';

const origin = 'https://preview.example.test';

describe('PWA cache response validation', () => {
  it('accepts same-origin JavaScript assets', async () => {
    const response = new Response('export default 1', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    Object.defineProperty(response, 'url', { value: `${origin}/_app/immutable/entry/start.js` });
    await expect(validatePwaResponse(response, '/_app/immutable/entry/start.js', origin, 'asset')).resolves.toEqual({ ok: true });
  });

  it('rejects an SSO HTML page masquerading as a JavaScript asset', async () => {
    const response = new Response('<html><title>Sign in</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: `${origin}/sso` });
    await expect(validatePwaResponse(response, '/_app/immutable/entry/start.js', origin, 'asset')).resolves.toMatchObject({ ok: false });
  });

  it('rejects a redirected shell from another origin', async () => {
    const response = new Response('<html>protected</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://vercel.com/sso-api' }
    });
    await expect(validatePwaResponse(response, '/', origin, 'shell')).resolves.toMatchObject({ ok: false });
  });

  it('rejects same-origin HTML without the application shell marker', async () => {
    const response = new Response('<!doctype html><title>Vercel Authentication</title><body>Sign in</body>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    Object.defineProperty(response, 'url', { value: `${origin}/` });
    await expect(validatePwaResponse(response, '/', origin, 'shell')).resolves.toMatchObject({ ok: false, reason: 'shell identity marker missing' });
  });

  it('accepts the local application shell', async () => {
    const response = new Response('<!doctype html><body data-sveltekit-preload-data="hover" data-rajaklana-app-shell="true"></body>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    Object.defineProperty(response, 'url', { value: `${origin}/` });
    await expect(validatePwaResponse(response, '/', origin, 'shell')).resolves.toEqual({ ok: true });
  });
});
