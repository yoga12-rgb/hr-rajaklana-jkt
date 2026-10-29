import { describe, expect, it, vi } from 'vitest';
import { authAccessContext, MfaAccountChanged, MfaFlow, type MfaClient, type MfaSession } from './auth-mfa';

const session = (id = 'account-a'): MfaSession => ({ user: { id }, access_token: `access-${id}`, refresh_token: `refresh-${id}` });
function fixture() {
  let current: MfaSession | null = session();
  const shared = { auth: { getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    setSession: vi.fn(async (tokens: { access_token: string; refresh_token: string }) => ({ data: { session: { ...session(), ...tokens } }, error: null })), mfa: {} } };
  const factors = [{ id: 'verified', status: 'verified', factor_type: 'totp', friendly_name: 'Personal' }];
  const isolated = { auth: {
    getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    setSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    mfa: {
      listFactors: vi.fn(async () => ({ data: { all: factors, totp: factors }, error: null })),
      enroll: vi.fn(async () => ({ data: { id: 'new-factor', totp: { qr_code: 'data:image/svg+xml;utf-8,synthetic', secret: 'SYNTHETIC', uri: 'synthetic' } }, error: null })),
      challengeAndVerify: vi.fn(async () => ({ data: { ...session(), access_token: 'verified-access' }, error: null })),
      unenroll: vi.fn(async () => ({ data: {}, error: null }))
    }
  } };
  return { shared, isolated, factors, flow: new MfaFlow(shared as unknown as MfaClient, isolated, tokens => shared.auth.setSession(tokens), 'scope-a'), switchAccount: (value: MfaSession | null) => { current = value; } };
}

describe('server-owned MFA access context', () => {
  it('requires an explicit and internally consistent access decision', () => {
    expect(authAccessContext({ employee_id: 'employee', requires_mfa: true, current_level: 'aal1', allowed: false, reason: 'mfa_required' })).toEqual({ employeeId: 'employee', requiresMfa: true, currentLevel: 'aal1', allowed: false, reason: 'mfa_required' });
    expect(authAccessContext({ employee_id: null, requires_mfa: false, current_level: 'aal1', allowed: false, reason: 'inactive' }).allowed).toBe(false);
    for (const value of [null, [], {}, { employee_id: 'employee', requires_mfa: true, current_level: 'aal1', allowed: true, reason: null }, { employee_id: null, requires_mfa: false, current_level: 'aal2', allowed: true, reason: null }]) expect(() => authAccessContext(value)).toThrow('Pemeriksaan keamanan');
  });
});

describe('isolated MFA flow', () => {
  it('verifies on the isolated client and publishes only the verified current account session', async () => {
    const f = fixture();
    expect((await f.flow.open()).factors).toHaveLength(1);
    await f.flow.verify('verified', '123456');
    expect(f.isolated.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'verified', code: '123456' });
    expect(f.shared.auth.setSession).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'account-a' }, access_token: 'verified-access' }));
  });
  it('discards delayed verification after another account signs in without replacing its session', async () => {
    const f = fixture(); await f.flow.open();
    let resolve!: (value: { data: MfaSession; error: null }) => void;
    f.isolated.auth.mfa.challengeAndVerify.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const verification = f.flow.verify('verified', '123456');
    await vi.waitFor(() => expect(f.isolated.auth.mfa.challengeAndVerify).toHaveBeenCalled());
    f.switchAccount(session('account-b'));
    resolve({ data: session(), error: null });
    await expect(verification).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(f.shared.auth.setSession).not.toHaveBeenCalled();
  });
  it('does not expose an enrollment QR after logout or page disposal while enroll is pending', async () => {
    const f = fixture(); await f.flow.open();
    let resolve!: (value: { data: { id: string; totp: { qr_code: string; secret: string; uri: string } }; error: null }) => void;
    f.isolated.auth.mfa.enroll.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const enrollment = f.flow.enroll();
    await vi.waitFor(() => expect(f.isolated.auth.mfa.enroll).toHaveBeenCalled());
    f.flow.dispose(); f.switchAccount(null);
    resolve({ data: { id: 'orphan', totp: { qr_code: 'synthetic', secret: 'synthetic', uri: 'synthetic' } }, error: null });
    await expect(enrollment).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(f.shared.auth.setSession).not.toHaveBeenCalled();
  });
  it('cleans only own unverified stale enrollments and preserves every verified factor', async () => {
    const f = fixture();
    f.factors.push({ id: 'unverified-old', status: 'unverified', factor_type: 'totp', friendly_name: 'Rajaklana HR utama old [tab:scope-a]' }, { id: 'unverified-other', status: 'unverified', factor_type: 'totp', friendly_name: 'Rajaklana HR utama other [tab:scope-b]' });
    await f.flow.open(); const result = await f.flow.enroll(true);
    expect(f.isolated.auth.mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(f.isolated.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'unverified-old' });
    expect(f.isolated.auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: expect.stringMatching(/^Rajaklana HR cadangan [0-9a-f-]+ \[tab:scope-a\]$/) });
    expect(result.factorId).toBe('new-factor');
  });
  it('keeps a bad OTP retryable without persisting a session or generating a factor', async () => {
    const f = fixture(); await f.flow.open();
    f.isolated.auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: 'bad code' } } as never);
    await expect(f.flow.verify('verified', '000000')).rejects.toThrow('Kode belum sesuai');
    expect(f.shared.auth.setSession).not.toHaveBeenCalled();
    await f.flow.verify('verified', '123456');
    expect(f.shared.auth.setSession).toHaveBeenCalledTimes(1);
    expect(f.isolated.auth.mfa.enroll).not.toHaveBeenCalled();
  });
  it('rejects malformed OTPs before calling Auth and rejects session identity mismatch', async () => {
    const f = fixture(); await f.flow.open();
    await expect(f.flow.verify('verified', '12345x')).rejects.toThrow('6 digit');
    expect(f.isolated.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    f.isolated.auth.mfa.challengeAndVerify.mockResolvedValueOnce({ data: session('account-b'), error: null });
    await expect(f.flow.verify('verified', '123456')).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(f.shared.auth.setSession).not.toHaveBeenCalled();
  });
});
