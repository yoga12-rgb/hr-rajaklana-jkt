/**
 * Compatibility parser for the account/session context RPC.
 *
 * The file name is retained for older imports during the rollout, but it no
 * longer contains an authenticator flow or calls the Supabase MFA SDK. AAL is
 * informational only; authorization is decided by live session, account,
 * role and RLS checks on the server.
 */
export interface AuthAccessContext {
  employeeId: string | null;
  requiresMfa: false;
  currentLevel: 'aal1' | 'aal2';
  allowed: boolean;
  reason: 'inactive' | 'session_revoked' | null;
}

export function authAccessContext(value: unknown): AuthAccessContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pemeriksaan keamanan akun belum tersedia. Coba lagi.');
  const row = value as Record<string, unknown>;
  if ((row.employee_id !== null && (typeof row.employee_id !== 'string' || !row.employee_id))
    || row.requires_mfa !== false
    || typeof row.allowed !== 'boolean'
    || !['aal1', 'aal2'].includes(String(row.current_level))
    || ![null, 'inactive', 'session_revoked'].includes(row.reason as null)
    || (row.allowed && (!row.employee_id || row.reason !== null))) {
    throw new Error('Pemeriksaan keamanan akun belum tersedia. Coba lagi.');
  }
  return {
    employeeId: row.employee_id as string | null,
    requiresMfa: false,
    currentLevel: row.current_level as 'aal1' | 'aal2',
    allowed: row.allowed,
    reason: row.reason as AuthAccessContext['reason']
  };
}
