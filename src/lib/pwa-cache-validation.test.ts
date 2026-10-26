import { describe, expect, it } from 'vitest';
import { validatePwaResponse } from './pwa-cache-validation';

const origin = 'https://preview.example.test';

describe('PWA cache response validation', () => {
  it('accepts same-origin JavaScript assets', () => {
    const response = new Response('export default 1', { status: 200, headers: { 'Content-Type': 'text/javascript' } });
    Object.defineProperty(response, 'url', { value: `${origin}/_app/immutable/entry/start.js` });
    expect(validatePwaResponse(response, '/_app/immutable/entry/start.js', origin, 'asset')).toEqual({ ok: true });
  });

  it('rejects an SSO HTML page masquerading as a JavaScript asset', () => {
    const response = new Response('<html><title>Sign in</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: `${origin}/sso` });
    expect(validatePwaResponse(response, '/_app/immutable/entry/start.js', origin, 'asset')).toMatchObject({ ok: false });
  });

  it('rejects a redirected shell from another origin', () => {
    const response = new Response('<html>protected</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: 'https://vercel.com/sso-api' }
    });
    expect(validatePwaResponse(response, '/', origin, 'shell')).toMatchObject({ ok: false });
  });

  it('accepts the local application shell', () => {
    const response = new Response('<!doctype html><div data-sveltekit-preload-data="hover"></div>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    Object.defineProperty(response, 'url', { value: `${origin}/` });
    expect(validatePwaResponse(response, '/', origin, 'shell')).toEqual({ ok: true });
  });
});
