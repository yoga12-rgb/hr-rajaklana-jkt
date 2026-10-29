import { describe, expect, it, vi } from 'vitest';
import { MfaRecoveryError, recoverMfa } from '../../supabase/functions/hr-api/mfa-recovery';
import { newPasswordError } from '../../supabase/functions/hr-api/password-policy';

describe('MFA recovery service boundary', () => {
  function fixture(status = 'pending') {
    const actor = vi.fn(async () => ({ data: { employee_id: 'employee-b', auth_user_id: 'auth-b', request_id: 'original-request', factor_ids: ['original-factor'], status }, error: null }));
    const service = vi.fn(async () => ({ data: { request_id: 'original-request', employee_id: 'employee-b', status: 'completed' }, error: null }));
    const factors = { listFactors: vi.fn(async () => ({ data: { factors: [{ id: 'original-factor' }, { id: 'new-factor' }] }, error: null })),
      deleteFactor: vi.fn(async () => ({ data: { id: 'original-factor' }, error: null })) };
    return { actor, service, factors };
  }
  it('denies an aal1/wrong-role authorization before privileged Auth calls', async () => {
    const f = fixture();
    f.actor.mockResolvedValueOnce({ data: null as any, error: { code: '42501' } as any });
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).rejects.toThrow('ditolak');
    expect(f.factors.listFactors).not.toHaveBeenCalled();
    expect(f.factors.deleteFactor).not.toHaveBeenCalled();
    expect(f.service).not.toHaveBeenCalled();
  });
  it('removes only the original audited factor IDs and records completion', async () => {
    const f = fixture();
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).resolves.toEqual({ ok: true, request_id: 'original-request' });
    expect(f.factors.deleteFactor).toHaveBeenCalledExactlyOnceWith({ userId: 'auth-b', id: 'original-factor' });
    expect(f.service).toHaveBeenCalledWith('auth_mfa_recovery_complete', { p_request_id: 'original-request', p_succeeded: true });
  });
  it('replays completion without deleting a newly enrolled factor', async () => {
    const f = fixture('completed');
    await recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR');
    expect(f.factors.listFactors).not.toHaveBeenCalled();
    expect(f.factors.deleteFactor).not.toHaveBeenCalled();
  });
  it('retries an ambiguous deletion using the captured list without touching a new factor', async () => {
    const f = fixture();
    f.factors.listFactors.mockResolvedValueOnce({ data: { factors: [{ id: 'new-factor' }] }, error: null });
    await recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR');
    expect(f.factors.deleteFactor).not.toHaveBeenCalled();
    expect(f.service).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed delete retryable and does not record success', async () => {
    const f = fixture();
    f.factors.deleteFactor.mockResolvedValueOnce({ data: null as any, error: new Error('private-provider-detail') as any });
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).rejects.toThrow('tertunda');
    expect(f.service).not.toHaveBeenCalled();
  });

  it.each([
    null, { employee_id: 'employee-c', auth_user_id: 'auth-c', request_id: 'original-request', factor_ids: ['factor-c'], status: 'pending' },
    { employee_id: 'employee-b', auth_user_id: '', request_id: 'original-request', factor_ids: ['original-factor'], status: 'pending' },
    { employee_id: 'employee-b', auth_user_id: 'auth-b', request_id: 'replacement-request', factor_ids: ['original-factor'], status: 'pending' }
  ])('rejects an invalid authorization receipt before accessing Auth: %j', async data => {
    const f = fixture();
    f.actor.mockResolvedValueOnce({ data: data as any, error: null });
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).rejects.toThrow('tidak valid');
    expect(f.factors.listFactors).not.toHaveBeenCalled();
    expect(f.factors.deleteFactor).not.toHaveBeenCalled();
    expect(f.service).not.toHaveBeenCalled();
  });

  it('does not report success when the completion receipt is missing or belongs to another request', async () => {
    for (const data of [null, {}, { request_id: 'replacement-request', employee_id: 'employee-b', status: 'completed' },
      { request_id: 'original-request', employee_id: 'employee-c', status: 'completed' },
      { request_id: 'original-request', employee_id: 'employee-b', status: 'pending' }]) {
      const f = fixture();
      f.service.mockResolvedValueOnce({ data: data as any, error: null });
      await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR'))
        .rejects.toMatchObject({ status: 503, message: expect.stringContaining('pencatatan pemulihan tertunda') });
    }
  });

  it('replays the original authorization after an ambiguous completion without deleting new factors', async () => {
    const f = fixture();
    f.service.mockResolvedValueOnce({ data: null as any, error: new Error('synthetic-provider-detail') as any });
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).rejects.toThrow('tertunda');
    f.actor.mockResolvedValueOnce({ data: { employee_id: 'employee-b', auth_user_id: 'auth-b', request_id: 'original-request', factor_ids: ['original-factor'], status: 'completed' }, error: null });
    await expect(recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR')).resolves.toMatchObject({ ok: true });
    expect(f.actor.mock.calls).toEqual([
      ['auth_mfa_recovery_authorize', { p_employee_id: 'employee-b', p_request_id: 'original-request', p_reason: 'Identity verified by HR' }],
      ['auth_mfa_recovery_authorize', { p_employee_id: 'employee-b', p_request_id: 'original-request', p_reason: 'Identity verified by HR' }]
    ]);
    expect(f.factors.deleteFactor).toHaveBeenCalledTimes(1);
    expect(f.service).toHaveBeenCalledTimes(1);
  });

  it.each(['actor', 'list', 'delete', 'complete'])('does not expose a thrown %s SDK/transport exception', async stage => {
    const f = fixture();
    const failure = new Error('synthetic-provider-secret-detail');
    if (stage === 'actor') f.actor.mockRejectedValueOnce(failure);
    if (stage === 'list') f.factors.listFactors.mockRejectedValueOnce(failure);
    if (stage === 'delete') f.factors.deleteFactor.mockRejectedValueOnce(failure);
    if (stage === 'complete') f.service.mockRejectedValueOnce(failure);
    const result = await recoverMfa(f.actor, f.service, f.factors, 'employee-b', 'original-request', 'Identity verified by HR').catch(error => error);
    expect(result).toBeInstanceOf(MfaRecoveryError);
    expect(result.status).toBe(503);
    expect(result.message).not.toContain('synthetic-provider');
  });
});

describe('new-password compensating control', () => {
  it.each(['short', '1234567890', 'aaaaaaaaaaaa', 'RK000000001', 'Password123!', 'DemoRajaklana123!'])('rejects a guessable new password: %s', value => {
    expect(newPasswordError(value)).not.toBeNull();
  });
  it('allows a long unique passphrase without arbitrary composition requirements', () => {
    expect(newPasswordError('tiga perahu menyusuri sungai senja')).toBeNull();
  });
  it('never normalizes the accepted password', () => {
    expect(newPasswordError('  kalimat unik untuk ruang kerja  ')).toBeNull();
    expect(newPasswordError(' '.repeat(12))).not.toBeNull();
    expect(newPasswordError('x'.repeat(129))).not.toBeNull();
  });
});
