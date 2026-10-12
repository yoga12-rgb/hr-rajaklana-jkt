export interface OriginPolicy {
  /** Canonical destination for account invitations; request headers never change it. */
  appOrigin: string;
  allowedOrigins: ReadonlySet<string>;
}

export type OriginConfiguration =
  | { policy: OriginPolicy; error: null }
  | { policy: null; error: string };

function explicitOrigin(value: string, setting: string): string {
  const candidate = value.trim();
  if (!candidate || /[\s\\*]/.test(candidate)) throw new Error(`${setting} harus berisi origin eksplisit`);
  if (!/^https?:\/\/[^/?#@]+\/?$/.test(candidate)) {
    throw new Error(`${setting} hanya boleh berisi origin HTTPS (HTTP hanya untuk localhost)`);
  }
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error(`${setting} harus berisi origin yang valid`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new Error(`${setting} harus menggunakan HTTPS (HTTP hanya untuk localhost)`);
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${setting} hanya boleh berisi origin tanpa path, kredensial, query, atau fragment`);
  }
  return parsed.origin;
}

export function configureOrigins(appOrigin: string | undefined, additionalOrigins?: string): OriginConfiguration {
  try {
    if (!appOrigin?.trim()) throw new Error('APP_ORIGIN belum dikonfigurasi');
    const canonical = explicitOrigin(appOrigin, 'APP_ORIGIN');
    const allowed = new Set([canonical]);
    if (additionalOrigins?.trim()) {
      for (const entry of additionalOrigins.split(',')) {
        allowed.add(explicitOrigin(entry, 'APP_ALLOWED_ORIGINS'));
      }
    }
    return { policy: { appOrigin: canonical, allowedOrigins: allowed }, error: null };
  } catch (error) {
    return { policy: null, error: error instanceof Error ? error.message : 'Konfigurasi origin tidak valid' };
  }
}

/** CORS runs before request bodies, rate limits, Auth writes, or database calls. */
export function guardOriginRequest(req: Request, configuration: OriginConfiguration, allowedHeaders: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  });
  const reject = (error: string, status: number) => ({
    headers,
    response: new Response(JSON.stringify({ error }), { status, headers })
  });
  if (!configuration.policy) return reject(configuration.error, 503);
  const requestOrigin = req.headers.get('Origin');
  if (requestOrigin !== null && !configuration.policy.allowedOrigins.has(requestOrigin)) {
    return reject('Origin tidak diizinkan', 403);
  }
  if (requestOrigin !== null) headers.set('Access-Control-Allow-Origin', requestOrigin);
  return {
    headers,
    response: req.method === 'OPTIONS' ? new Response(null, { status: 204, headers }) : null
  };
}
