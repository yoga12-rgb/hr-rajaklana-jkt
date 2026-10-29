import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

export class ApiError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
/** @param {string|Uint8Array} value */
export const sha256 = value => createHash('sha256').update(value).digest('hex');
/** @param {unknown} data @param {number} [status] */
export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' } });
/** @param {unknown} error */
export function fail(error) {
  if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
  // Never log JWTs, image bytes, descriptors, signed URLs, or service credentials.
  console.error('HR API request failed', { category: 'internal', errorName: error instanceof Error ? error.name : 'UnknownError' });
  return json({ error: 'Layanan belum dapat menyelesaikan permintaan. Coba kembali atau hubungi HR.', code: 'unavailable' }, 503);
}
/** @param {Request} request @param {NodeJS.ProcessEnv} [env] */
export async function authenticate(request, env = process.env) {
  const origin = request.headers.get('origin'), target = new URL(request.url);
  if (origin && origin !== target.origin) throw new ApiError('origin', 'Asal permintaan tidak diizinkan.', 403);
  const bearer = request.headers.get('authorization');
  if (!bearer?.match(/^Bearer [A-Za-z0-9._-]+$/)) throw new ApiError('unauthorized', 'Silakan login kembali.', 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError('unconfigured', 'Layanan belum dikonfigurasi. Hubungi HR.', 503);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
  const token = bearer.slice(7);
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new ApiError('unauthorized', 'Sesi berakhir. Silakan login kembali.', 401);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { ...options, global: { headers: { Authorization: bearer } } });
  // getUser verifies the bearer; the user-scoped RPC binds its signed claims
  // to the live account, session and factor. Never derive privilege or AAL
  // from user_metadata, a decoded unsigned JWT, or a service-role query.
  const { data: access, error: accessError } = await client.rpc('auth_access_context');
  if (accessError || !access || Array.isArray(access) || typeof access.requires_mfa !== 'boolean'
    || !['aal1','aal2'].includes(access.current_level) || typeof access.allowed !== 'boolean'
    || (access.employee_id !== null && (typeof access.employee_id !== 'string' || !access.employee_id))
    || ![null,'inactive','mfa_required','session_revoked'].includes(access.reason)
    || (access.allowed && (!access.employee_id || access.reason !== null))) {
    throw new ApiError('auth_unavailable', 'Pemeriksaan keamanan sesi belum berhasil. Coba kembali.', 503);
  }
  if (access.reason === 'session_revoked') throw new ApiError('unauthorized', 'Sesi berakhir. Silakan login kembali.', 401);
  if (!access.employee_id || access.reason === 'inactive') throw new ApiError('inactive', 'Akses akun tidak aktif. Hubungi HR.', 403);
  if (access.requires_mfa && (!access.allowed || access.current_level !== 'aal2')) {
    throw new ApiError('mfa_required', 'Selesaikan verifikasi dua langkah sebelum melanjutkan.', 403);
  }
  if (!access.allowed) throw new ApiError('unauthorized', 'Sesi berakhir. Silakan login kembali.', 401);
  const { data: employee, error: employeeError } = await admin.from('employees').select('id,auth_user_id,full_name,status,account_status,can_clock').eq('auth_user_id', user.id).single();
  if (employeeError || employee?.id !== access.employee_id || employee?.auth_user_id !== user.id
    || employee?.status !== 'active' || employee?.account_status !== 'active') throw new ApiError('inactive', 'Akses akun tidak aktif. Hubungi HR.', 403);
  return { admin, client, user, employee };
}
/** @param {Request} request @param {number} [maxBytes] @returns {Promise<Record<string,any>>} */
export async function bodyJSON(request, maxBytes = 3000000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('content_type', 'Gunakan JSON.', 415);
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ApiError('too_large', 'Ukuran foto terlalu besar.', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > maxBytes) throw new ApiError('too_large', 'Ukuran foto terlalu besar.', 413);
  try { const result = JSON.parse(new TextDecoder().decode(bytes)); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; }
  catch { throw new ApiError('invalid_json', 'Isi permintaan tidak valid.'); }
}
/** @param {unknown} value @param {number} [seconds] @param {number} [now] */
export function requireFresh(value, seconds = 60, now = Date.now()) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || now - time > seconds * 1000 || time - now > 10000) throw new ApiError('stale_capture', 'Foto atau lokasi sudah terlalu lama. Ambil lokasi dan selfie baru.');
}
/** @param {{data:any,error?:{message:string}|null}} result */
export function checkRPC(result) { if (result.error) throw new ApiError('operation_rejected', result.error.message); return result.data; }
