import { createClient } from 'npm:@supabase/supabase-js@2';

// Service credentials never leave this worker. Public actions have narrow inputs;
// admin actions additionally use getUser and the database's role checks.
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const origin = Deno.env.get('APP_ORIGIN');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const passwordClient = () => createClient(url, anonKey, options);

class ApiError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
function required(body: Record<string, unknown>, key: string, max = 2000) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(`${key} wajib diisi`);
  return value.trim();
}
function password(body: Record<string, unknown>) {
  const value = body.password;
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new ApiError('Kata sandi harus 10–128 karakter');
  return value;
}
function identifier(body: Record<string, unknown>) {
  const number = required(body, 'employee_number', 20).toUpperCase();
  if (!/^RK\d{6,}$/.test(number)) throw new ApiError('Nomor karyawan atau kata sandi tidak sesuai', 401);
  return number;
}
function accountEmail(number: string) { return `${number.toLowerCase()}@login.rajaklana.internal`; }
async function rateLimit(req: Request, action: string, subject: string) {
  const ip = req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'unknown';
  const { data, error } = await admin.rpc('auth_rate_limit', {
    p_key_hash: await hash(`${action}:${ip}:${subject}`), p_limit: action === 'login' ? 10 : 30
  });
  if (error) throw new ApiError('Layanan autentikasi belum siap', 503);
  if (!data) throw new ApiError('Terlalu banyak percobaan. Coba lagi dalam 10 menit', 429);
}
async function authenticated(req: Request) {
  const authorization = req.headers.get('Authorization') ?? '';
  const jwt = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) throw new ApiError('Silakan login terlebih dahulu', 401);
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new ApiError('Sesi tidak berlaku. Silakan login kembali', 401);
  return createClient(url, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${jwt}` } } });
}
function baseOrigin() {
  if (!origin) throw new ApiError('APP_ORIGIN belum dikonfigurasi', 503);
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new ApiError('APP_ORIGIN harus menggunakan HTTPS', 503);
  }
  return parsed.origin;
}
function cors(req: Request): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  const requestOrigin = req.headers.get('Origin');
  if (requestOrigin && requestOrigin === origin) headers.set('Access-Control-Allow-Origin', requestOrigin);
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return headers;
}

Deno.serve(async (req: Request) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  let body: Record<string, unknown>;
  try {
    if (Number(req.headers.get('Content-Length') ?? 0) > 12_000) throw new ApiError('Permintaan terlalu besar', 413);
    const text = await req.text();
    if (text.length > 12_000) throw new ApiError('Permintaan terlalu besar', 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Permintaan tidak valid');
    const action = required(body, 'action', 50);
    let result: unknown;

    if (action === 'login') {
      const number = identifier(body);
      await rateLimit(req, action, number);
      const suppliedPassword = body.password;
      if (typeof suppliedPassword !== 'string' || suppliedPassword.length === 0 || suppliedPassword.length > 128) {
        throw new ApiError('Nomor karyawan atau kata sandi tidak sesuai', 401);
      }
      // GoTrue checks the password; the bridge never stores or hashes passwords.
      const { data, error } = await passwordClient().auth.signInWithPassword({ email: accountEmail(number), password: suppliedPassword });
      if (error || !data.session) throw new ApiError('Nomor karyawan atau kata sandi tidak sesuai', 401);
      const { data: employee } = await admin.from('employees').select('id,status,account_status,auth_user_id')
        .eq('employee_number', number).eq('auth_user_id', data.user.id).maybeSingle();
      if (!employee || employee.status !== 'active' || employee.account_status !== 'active') {
        await admin.auth.admin.signOut(data.session.access_token, 'global');
        throw new ApiError('Nomor karyawan atau kata sandi tidak sesuai', 401);
      }
      result = { session: data.session, user: data.user };
    } else if (action === 'issue_activation' || action === 'issue_reset') {
      const frontendOrigin = baseOrigin();
      const client = await authenticated(req);
      const employeeId = required(body, 'employee_id', 36);
      const plainToken = token();
      const purpose = action === 'issue_activation' ? 'activation' : 'reset';
      const { data, error } = await client.rpc('issue_account_token', { p_employee_id: employeeId, p_purpose: purpose, p_token_hash: await hash(plainToken) });
      if (error) throw new ApiError(error.message, 403);
      // Fragment keeps the secret out of request URLs, web logs and referrers.
      const activationUrl = `${frontendOrigin}/activate#token=${plainToken}`;
      result = { ...data, url: activationUrl, message: `Halo ${data.full_name}, ${purpose === 'activation' ? 'aktifkan akun' : 'atur ulang kata sandi'} HR Rajaklana Anda (${data.employee_number}) melalui ${activationUrl}. Berlaku 24 jam dan hanya dapat digunakan sekali.` };
    } else if (action === 'inspect_token') {
      const plainToken = required(body, 'token', 64);
      await rateLimit(req, action, 'token');
      const { data, error } = await admin.rpc('inspect_account_token', { p_token_hash: await hash(plainToken) });
      if (error) throw new ApiError('Tautan tidak berlaku atau sudah digunakan');
      result = data;
    } else if (action === 'activate' || action === 'reset_password') {
      const plainToken = required(body, 'token', 64);
      const newPassword = password(body);
      await rateLimit(req, 'consume_token', 'token');
      const claimId = crypto.randomUUID();
      const { data: claim, error: claimError } = await admin.rpc('claim_account_token', { p_token_hash: await hash(plainToken), p_claim_id: claimId });
      if (claimError) throw new ApiError('Tautan tidak berlaku, sedang diproses, atau sudah digunakan');
      if (claim.purpose !== (action === 'activate' ? 'activation' : 'reset')) {
        await admin.rpc('release_account_token', { p_token_id: claim.token_id, p_claim_id: claimId });
        throw new ApiError('Jenis tautan tidak sesuai');
      }
      let authId = claim.auth_user_id;
      try {
        if (authId) {
          const { error } = await admin.auth.admin.updateUserById(authId, { password: newPassword });
          if (error) throw new ApiError('Kata sandi belum dapat disimpan. Coba kembali');
        } else {
          const { data, error } = await admin.auth.admin.createUser({ email: accountEmail(claim.employee_number), password: newPassword,
            email_confirm: true, app_metadata: { employee_id: claim.employee_id } });
          if (error || !data.user) throw new ApiError('Akun belum dapat diaktifkan. Coba kembali');
          authId = data.user.id;
        }
      } catch (error) {
        await admin.rpc('release_account_token', { p_token_id: claim.token_id, p_claim_id: claimId });
        throw error;
      }
      // Never release after a possibly-successful Auth write. A timed-out worker
      // can recover via the deterministic identifier after five minutes.
      let { error: finishError } = await admin.rpc('finish_account_token', { p_token_id: claim.token_id, p_claim_id: claimId, p_auth_user_id: authId });
      if (finishError) {
        ({ error: finishError } = await admin.rpc('finish_account_token', { p_token_id: claim.token_id, p_claim_id: claimId, p_auth_user_id: authId }));
      }
      if (finishError) throw new ApiError('Penyelesaian aktivasi tertunda. Coba tautan ini lagi dalam 5 menit', 503);
      result = { ok: true, employee_number: claim.employee_number };
    } else if (action === 'bootstrap') {
      await rateLimit(req, action, 'bootstrap');
      const expected = Deno.env.get('HR_BOOTSTRAP_SECRET');
      const supplied = required(body, 'bootstrap_secret', 300);
      if (!expected || expected.length < 32 || await hash(expected) !== await hash(supplied)) throw new ApiError('Bootstrap tidak diizinkan', 403);
      const fullName = required(body, 'full_name', 150);
      const whatsapp = required(body, 'whatsapp', 30);
      const outletName = required(body, 'outlet_name', 100);
      const newPassword = password(body);
      const { count, error: countError } = await admin.from('employee_roles').select('*', { count: 'exact', head: true }).eq('role', 'admin_hr');
      if (countError || count) throw new ApiError('Admin awal sudah dibuat atau bootstrap belum siap', 403);
      const { data: number, error: reserveError } = await admin.rpc('reserve_employee_number');
      if (reserveError || !number) throw new ApiError('Nomor admin awal belum dapat dibuat', 503);
      const { data, error } = await admin.auth.admin.createUser({ email: accountEmail(number), password: newPassword, email_confirm: true });
      if (error || !data.user) throw new ApiError('Admin awal belum dapat dibuat', 503);
      const { data: employee, error: employeeError } = await admin.rpc('bootstrap_admin', { p_auth_user_id: data.user.id, p_full_name: fullName, p_whatsapp: whatsapp, p_outlet_name: outletName });
      if (employeeError) {
        // Only delete if no linkage exists; an HTTP failure may follow DB commit.
        const { data: linked, error: linkedError } = await admin.from('employees').select('employee_number').eq('auth_user_id', data.user.id).maybeSingle();
        if (!linkedError && !linked) await admin.auth.admin.deleteUser(data.user.id);
        if (linked) result = { ok: true, employee_number: linked.employee_number };
        else throw new ApiError('Admin awal belum dapat dibuat', 503);
      } else result = { ok: true, employee_number: employee.employee_number };
    } else throw new ApiError('Aksi tidak dikenal');
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    const known = error instanceof ApiError;
    return new Response(JSON.stringify({ error: known ? error.message : 'Layanan belum dapat memproses permintaan' }), { status: known ? error.status : 500, headers });
  }
});
