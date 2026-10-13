export interface LoginFailure { message: string; status: number }

const credentialsFailure = (): LoginFailure => ({ message: 'Nomor karyawan atau kata sandi tidak sesuai', status: 401 });
const serviceFailure = (): LoginFailure => ({ message: 'Layanan autentikasi belum tersedia. Coba kembali nanti', status: 503 });

/** Classify SDK fields only; upstream messages can contain private request data. */
export function classifyPasswordLoginFailure(error: unknown): LoginFailure {
  const detail = error && typeof error === 'object' ? error as { code?: unknown; name?: unknown; status?: unknown } : {};
  if (detail.status === 429 || ['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'].includes(String(detail.code))) {
    return { message: 'Terlalu banyak percobaan. Tunggu beberapa saat lalu coba kembali', status: 429 };
  }
  if (['invalid_credentials', 'email_not_confirmed', 'phone_not_confirmed', 'user_banned', 'user_not_found'].includes(String(detail.code))
    || detail.name === 'AuthInvalidCredentialsError') return credentialsFailure();
  // Configuration/provider errors, network failures and missing session responses
  // are service failures; none of them establish that a password was incorrect.
  return serviceFailure();
}

export interface LoginEmployee { status?: string | null; account_status?: string | null }

/** Revoke the failed new session locally on a DB outage, preserving other devices. */
export async function classifyLoginEmployeeFailure(
  employee: LoginEmployee | null | undefined,
  readError: unknown,
  revokeSession: (scope: 'local' | 'global') => Promise<unknown>
): Promise<LoginFailure | null> {
  const failure = readError ? serviceFailure()
    : !employee || employee.status !== 'active' || employee.account_status !== 'active' ? credentialsFailure() : null;
  if (!failure) return null;
  // A cleanup failure must not replace the truthful original login error. The
  // session is never returned to the caller, and normal RLS/account checks remain.
  try { await revokeSession(readError ? 'local' : 'global'); } catch { /* best effort */ }
  return failure;
}
