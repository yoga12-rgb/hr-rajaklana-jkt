import { describe, expect, it, vi } from 'vitest';
import { classifyLoginEmployeeFailure, classifyPasswordLoginFailure } from '../../supabase/functions/hr-api/login-errors';

const active = { status: 'active', account_status: 'active' };
const credentialsMessage = 'Nomor karyawan atau kata sandi tidak sesuai';
const privateDetail = 'private-password private-email private-token';

describe('HR password login failure classification', () => {
  it.each(['invalid_credentials', 'email_not_confirmed', 'phone_not_confirmed', 'user_banned', 'user_not_found'])('does not reveal whether an account exists: %s', (code) => {
    expect(classifyPasswordLoginFailure({ code, status: 422, message: privateDetail })).toEqual({ status: 401, message: credentialsMessage });
  });

  it('recognizes the SDK invalid credentials error without matching its message', () => {
    expect(classifyPasswordLoginFailure({ name: 'AuthInvalidCredentialsError', message: privateDetail }).status).toBe(401);
    expect(classifyPasswordLoginFailure({ name: 'UnexpectedError', message: 'Invalid login credentials' }).status).toBe(503);
  });

  it.each([
    { code: 'email_provider_disabled', status: 422, message: privateDetail },
    { code: 'unexpected_failure', status: 500, message: privateDetail },
    { code: 'captcha_failed', status: 422, message: privateDetail },
    { name: 'AuthRetryableFetchError', status: 0, message: privateDetail },
    { name: 'AuthRetryableFetchError', status: 503, message: privateDetail },
    { name: 'AuthInvalidTokenResponseError', message: privateDetail },
    { status: 401, message: privateDetail }, null, undefined
  ])('keeps provider, infrastructure and missing-session failures distinct from passwords', (error) => {
    const result = classifyPasswordLoginFailure(error);
    expect(result.status).toBe(503);
    expect(result.message).toContain('Layanan autentikasi');
    expect(JSON.stringify(result)).not.toContain(privateDetail);
    expect(result.message).not.toBe(credentialsMessage);
  });

  it.each([
    { status: 429, message: privateDetail },
    { code: 'over_request_rate_limit', status: 422, message: privateDetail },
    { code: 'over_email_send_rate_limit', message: privateDetail },
    { code: 'over_sms_send_rate_limit', message: privateDetail }
  ])('preserves rate-limit responses', (error) => {
    const result = classifyPasswordLoginFailure(error);
    expect(result.status).toBe(429);
    expect(result.message).toContain('Terlalu banyak percobaan');
    expect(JSON.stringify(result)).not.toContain(privateDetail);
  });
});

describe('HR employee validation after password grant', () => {
  it('allows a fully active employee without revoking any session', async () => {
    const revoke = vi.fn();
    expect(await classifyLoginEmployeeFailure(active, null, revoke)).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('treats employee SELECT failure as service unavailable and revokes only this new session', async () => {
    const revoke = vi.fn().mockResolvedValue({ error: null });
    const result = await classifyLoginEmployeeFailure(null, { code: '42501', message: privateDetail }, revoke);
    expect(result?.status).toBe(503);
    expect(JSON.stringify(result)).not.toContain(privateDetail);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('local');
  });

  it('never accepts partially returned employee data when its lookup has an error', async () => {
    const revoke = vi.fn().mockResolvedValue({ error: null });
    expect((await classifyLoginEmployeeFailure(active, { message: privateDetail }, revoke))?.status).toBe(503);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('local');
  });

  it.each([null, { status: 'inactive', account_status: 'active' }, { status: 'active', account_status: 'disabled' }])('keeps missing and inactive employees private and preserves global revocation', async (employee) => {
    const revoke = vi.fn().mockResolvedValue({ error: null });
    expect(await classifyLoginEmployeeFailure(employee, null, revoke)).toEqual({ status: 401, message: credentialsMessage });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('global');
  });

  it('preserves the original 503 when session cleanup itself throws', async () => {
    const revoke = vi.fn().mockRejectedValue(new Error(privateDetail));
    expect((await classifyLoginEmployeeFailure(null, { message: privateDetail }, revoke))?.status).toBe(503);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('local');
  });

  it('preserves the original 503 when the SDK returns a cleanup error', async () => {
    const revoke = vi.fn().mockResolvedValue({ error: new Error(privateDetail) });
    expect((await classifyLoginEmployeeFailure(null, { message: privateDetail }, revoke))?.status).toBe(503);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('local');
  });
});
