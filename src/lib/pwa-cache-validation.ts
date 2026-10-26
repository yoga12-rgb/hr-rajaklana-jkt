export type PwaResponseKind = 'asset' | 'shell';

export type PwaResponseCheck = { ok: true } | { ok: false; reason: string };

function contentType(response: Response) {
  return response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function expectedTypes(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.js')) return ['text/javascript', 'application/javascript', 'application/x-javascript'];
  if (lower.endsWith('.css')) return ['text/css'];
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) return ['application/json', 'application/manifest+json'];
  if (lower.endsWith('.svg')) return ['image/svg+xml'];
  if (/\.(png|jpg|jpeg|gif|webp|avif|ico)$/.test(lower)) return [`image/${lower.split('.').pop() === 'jpg' ? 'jpeg' : lower.split('.').pop()}`];
  if (/\.(woff2?|ttf|otf|eot)$/.test(lower)) return ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff', 'application/font-woff2', 'application/octet-stream'];
  if (lower.endsWith('.wasm')) return ['application/wasm', 'application/octet-stream'];
  return [];
}

/** Reject redirect/SSO responses before they can enter the public PWA shell cache. */
export async function validatePwaResponse(response: Response, path: string, origin: string, kind: PwaResponseKind): Promise<PwaResponseCheck> {
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  if (response.redirected) return { ok: false, reason: 'redirected response' };
  if (response.url) {
    try {
      if (new URL(response.url).origin !== origin) return { ok: false, reason: 'unexpected response origin' };
    } catch {
      return { ok: false, reason: 'invalid response URL' };
    }
  }
  const type = contentType(response);
  if (kind === 'shell') {
    if (!type.includes('text/html')) return { ok: false, reason: `unexpected shell type ${type || 'missing'}` };
    const body = await response.clone().text();
    return /<body\b[^>]*\bdata-rajaklana-app-shell\s*=\s*["']true["']/i.test(body)
      ? { ok: true }
      : { ok: false, reason: 'shell identity marker missing' };
  }
  if (!type || type.includes('text/html')) return { ok: false, reason: 'asset is not a non-HTML response' };
  const expected = expectedTypes(path);
  if (expected.length && !expected.includes(type)) return { ok: false, reason: `unexpected asset type ${type}` };
  return { ok: true };
}
