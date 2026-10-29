/** The server decides whether the account needs MFA. Never infer privileges from JWT metadata. */
export interface AuthAccessContext {
  employeeId: string | null;
  requiresMfa: boolean;
  currentLevel: 'aal1' | 'aal2';
  allowed: boolean;
  reason: 'inactive' | 'mfa_required' | 'session_revoked' | null;
}

// This hint may only remove cached access while the server revalidates it.
// It never grants access, which is always the access-context RPC's decision.
export function tokenHintsAal2(token: string | undefined): boolean {
  try {
    const value = token?.split('.')[1];
    if (!value) return false;
    return JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))).aal === 'aal2';
  } catch { return false; }
}

export function authAccessContext(value: unknown): AuthAccessContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pemeriksaan keamanan akun belum tersedia. Coba lagi.');
  const row = value as Record<string, unknown>;
  if ((row.employee_id !== null && (typeof row.employee_id !== 'string' || !row.employee_id)) || typeof row.requires_mfa !== 'boolean'
    || typeof row.allowed !== 'boolean' || !['aal1', 'aal2'].includes(String(row.current_level))
    || ![null, 'inactive', 'mfa_required', 'session_revoked'].includes(row.reason as null)
    || (row.allowed && (!row.employee_id || row.reason !== null || (row.requires_mfa && row.current_level !== 'aal2')))) {
    throw new Error('Pemeriksaan keamanan akun belum tersedia. Coba lagi.');
  }
  return { employeeId: row.employee_id as string | null, requiresMfa: row.requires_mfa, currentLevel: row.current_level as 'aal1' | 'aal2', allowed: row.allowed, reason: row.reason as AuthAccessContext['reason'] };
}

type AuthError = { message: string } | null;
export type MfaSession = { access_token: string; refresh_token: string; user: { id: string } };
export type MfaFactor = { id: string; status: string; factor_type?: string; friendly_name?: string };
export type MfaClient = { auth: {
  getSession(): Promise<{ data: { session: MfaSession | null }; error?: AuthError }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ data: { session: MfaSession | null; user?: { id: string } | null }; error: AuthError }>;
  mfa: {
    listFactors(): Promise<{ data: { all: MfaFactor[]; totp: MfaFactor[] } | null; error: AuthError }>;
    enroll(input: { factorType: 'totp'; friendlyName: string }): Promise<{ data: { id: string; totp: { qr_code: string; secret: string; uri: string } } | null; error: AuthError }>;
    challengeAndVerify(input: { factorId: string; code: string }): Promise<{ data: MfaSession | null; error: AuthError }>;
    unenroll(input: { factorId: string }): Promise<{ error: AuthError }>;
  };
} };

export class MfaAccountChanged extends Error {
  constructor() { super('Akun telah berubah. Buka kembali keamanan akun.'); }
}

/**
 * Uses an isolated, non-persistent Auth client. A delayed MFA response for A
 * cannot let Supabase's verify() persist A's session over a newer login B.
 * QR/secret remain owned by the page and never enter app state or storage.
 */
export class MfaFlow {
  private generation = 0;
  private userId: string | null = null;
  private disposed = false;
  private pendingFactorId: string | null = null;
  constructor(private shared: MfaClient, private isolated: MfaClient,
    private publishSession: (session: MfaSession, expectedUserId: string) => ReturnType<MfaClient['auth']['setSession']>,
    private enrollmentScope: string) {}

  private async check(generation: number) {
    const { data: { session } } = await this.shared.auth.getSession();
    if (this.disposed || generation !== this.generation || !this.userId || session?.user.id !== this.userId) throw new MfaAccountChanged();
  }

  async open(): Promise<{ userId: string; factors: MfaFactor[] }> {
    const generation = ++this.generation;
    const { data: { session }, error } = await this.shared.auth.getSession();
    if (error || !session) throw new Error('Silakan login kembali sebelum melanjutkan verifikasi.');
    if (this.disposed || generation !== this.generation) throw new MfaAccountChanged();
    this.userId = session.user.id;
    const { data, error: setError } = await this.isolated.auth.setSession(session);
    if (setError || data.session?.user.id !== this.userId) throw new Error('Sesi verifikasi belum dapat disiapkan. Silakan login kembali.');
    await this.check(generation);
    const factors = await this.isolated.auth.mfa.listFactors();
    await this.check(generation);
    if (factors.error || !factors.data) throw new Error('Daftar autentikator belum dapat dimuat. Coba lagi.');
    return { userId: this.userId, factors: factors.data.totp.filter(factor => factor.status === 'verified') };
  }

  async enroll(backup = false) {
    const generation = this.generation;
    await this.check(generation);
    // Reload may abandon an unverified factor. The scope is held by this tab;
    // another tab's pending or verified factor must never be removed here.
    const factors = await this.isolated.auth.mfa.listFactors();
    await this.check(generation);
    if (factors.error || !factors.data) throw new Error('Daftar autentikator belum dapat dimuat. Coba lagi.');
    const marker = `[tab:${this.enrollmentScope}]`;
    for (const factor of factors.data.all.filter(f => f.factor_type === 'totp' && f.status === 'unverified' && f.friendly_name?.startsWith('Rajaklana HR ') && f.friendly_name.endsWith(marker))) {
      const removed = await this.isolated.auth.mfa.unenroll({ factorId: factor.id });
      await this.check(generation);
      if (removed.error) throw new Error('Pendaftaran sebelumnya belum dapat dibersihkan. Coba lagi.');
    }
    const label = backup ? 'Rajaklana HR cadangan' : 'Rajaklana HR utama';
    const result = await this.isolated.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${label} ${crypto.randomUUID().slice(0, 8)} ${marker}` });
    await this.check(generation);
    if (result.error || !result.data) throw new Error('Autentikator belum dapat didaftarkan. Coba lagi.');
    this.pendingFactorId = result.data.id;
    return { factorId: result.data.id, qrCode: result.data.totp.qr_code, secret: result.data.totp.secret };
  }

  async verify(factorId: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw new Error('Masukkan 6 digit kode dari aplikasi autentikator.');
    const generation = this.generation;
    await this.check(generation);
    const result = await this.isolated.auth.mfa.challengeAndVerify({ factorId, code });
    await this.check(generation);
    if (result.error || !result.data) throw new Error('Kode belum sesuai atau sudah kedaluwarsa. Gunakan kode terbaru.');
    if (result.data.user.id !== this.userId) throw new MfaAccountChanged();
    const installed = await this.publishSession(result.data, this.userId!);
    await this.check(generation);
    if (installed.error || installed.data.session?.user.id !== this.userId) throw new Error('Sesi verifikasi belum tersimpan. Coba kembali.');
    this.pendingFactorId = null;
  }

  async cancelEnrollment() {
    const generation = this.generation;
    const factorId = this.pendingFactorId;
    this.pendingFactorId = null;
    if (!factorId) return;
    await this.check(generation);
    const result = await this.isolated.auth.mfa.unenroll({ factorId });
    await this.check(generation);
    if (result.error) throw new Error('Pendaftaran belum dapat dibatalkan. Coba kembali.');
  }

  dispose() { this.disposed = true; this.generation += 1; this.userId = null; this.pendingFactorId = null; }
}
