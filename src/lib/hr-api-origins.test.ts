import { describe, expect, it, vi } from 'vitest';
import { configureOrigins, guardOriginRequest } from '../../supabase/functions/hr-api/origins';

const production = 'https://hr.rajaklana.example';
const preview = 'https://hr-preview.rajaklana.example';
const allowedHeaders = 'authorization, x-client-info, apikey, content-type';

function request(method = 'POST', origin?: string) {
  return new Request('https://database.example/functions/v1/hr-api', {
    method,
    headers: origin === undefined ? {} : { Origin: origin },
    ...(method === 'POST' ? { body: '{"action":"login"}' } : {})
  });
}

describe('Isolated HR API origins', () => {
  it('normalizes canonical URL but keeps invitations separate from allowed preview URLs', () => {
    const result = configureOrigins(`${production}/`, ` ${preview}/,${preview},http://localhost:5173 `);
    expect(result.error).toBeNull();
    expect(result.policy?.appOrigin).toBe(production);
    expect([...result.policy!.allowedOrigins]).toEqual([production, preview, 'http://localhost:5173']);
  });

  it('uses only the canonical origin when additional origins are unset', () => {
    expect([...configureOrigins(production).policy!.allowedOrigins]).toEqual([production]);
    expect([...configureOrigins(production, ' ').policy!.allowedOrigins]).toEqual([production]);
  });

  it.each([
    undefined, '', 'https://*.vercel.app', '*', 'https://good.example/path',
    'https://good.example/?token=x', 'https://good.example/#hash', 'https://name:secret@good.example',
    'http://good.example', 'ftp://good.example', 'https://good.example https://other.example',
    'https://good.example\\@evil.example', 'not a URL', 'https:good.example',
    'https://good.example/..', 'https://good.example?', 'https://good.example#', 'https://@good.example'
  ])('fails closed on invalid canonical origin %s', (origin) => {
    const result = configureOrigins(origin, preview);
    expect(result.policy).toBeNull();
    expect(result.error).toContain('APP_ORIGIN');
  });

  it.each([
    `${preview},`, `,${preview}`, `${preview},*`, `${preview},https://*.vercel.app`,
    `${preview},http://untrusted.example`, `${preview},https://other.example/path`,
    `${preview},https://name:secret@other.example`, `${preview},https://other.example/?token=x`
  ])('rejects the entire policy if one additional origin is malformed: %s', (additional) => {
    const result = configureOrigins(production, additional);
    expect(result.policy).toBeNull();
    expect(result.error).toContain('APP_ALLOWED_ORIGINS');
  });

  it.each(['http://localhost:5173', 'http://127.0.0.1:4173', 'http://[::1]:5173'])('allows local HTTP origin %s', (local) => {
    expect(configureOrigins(local).policy?.appOrigin).toBe(local);
  });

  it.each(['POST', 'OPTIONS'])('rejects a disallowed %s before reading its body', async (method) => {
    const req = request(method, preview);
    const body = vi.spyOn(req, 'text');
    const result = guardOriginRequest(req, configureOrigins(production), allowedHeaders);
    expect(result.response?.status).toBe(403);
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(body).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
    expect(await result.response!.json()).toEqual({ error: 'Origin tidak diizinkan' });
  });

  it.each(['null', '', 'https://hr.rajaklana.example.evil.example', 'https://hr.rajaklana.example:444', 'https://hr.rajaklana.example/'])('does not accept a lookalike or non-browser Origin %s', (origin) => {
    expect(guardOriginRequest(request('POST', origin), configureOrigins(production), allowedHeaders).response?.status).toBe(403);
  });

  it('responds to allowed preflight with that exact origin and narrow methods', () => {
    const result = guardOriginRequest(request('OPTIONS', preview), configureOrigins(production, preview), allowedHeaders);
    expect(result.response?.status).toBe(204);
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    expect(result.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(result.headers.get('Access-Control-Allow-Headers')).toBe(allowedHeaders);
    expect(result.headers.get('Vary')).toBe('Origin');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes an allowed POST to existing auth handling without reading its body', () => {
    const req = request('POST', production);
    const result = guardOriginRequest(req, configureOrigins(production), allowedHeaders);
    expect(result.response).toBeNull();
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe(production);
    expect(req.bodyUsed).toBe(false);
  });

  it('retains no-Origin server-client flows without granting a browser origin', () => {
    const result = guardOriginRequest(request(), configureOrigins(production), allowedHeaders);
    expect(result.response).toBeNull();
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it.each(['POST', 'OPTIONS'])('rejects %s during invalid deployment configuration, including no-Origin requests', (method) => {
    const req = request(method);
    const result = guardOriginRequest(req, configureOrigins(production, '*'), allowedHeaders);
    expect(result.response?.status).toBe(503);
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });
});
