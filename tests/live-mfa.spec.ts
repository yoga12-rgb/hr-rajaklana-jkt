import { expect, test, type Page, type Route } from '@playwright/test';

// Password-only live-mock contract. The fixture may expose a legacy factor in
// the Auth user response, but the application must never call the MFA API.
const backend = 'http://127.0.0.1:54329';
const authId = 'auth-password-only-synthetic', employeeId = 'employee-password-only-synthetic';
function jwt(user = authId, session = 'synthetic-session', aal = 'aal1') {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user, aud: 'authenticated', role: 'authenticated', aal, session_id: session, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`;
}
async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) });
}
async function fixture(page: Page, revoked = false, legacyFactor = false) {
  let protectedReads = 0, factorCalls = 0;
  const now = new Date().toISOString();
  const user = { id: authId, aud: 'authenticated', role: 'authenticated', email: 'password-only@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now,
    // The default fixture is genuinely factor-free. The legacy test opts into a
    // verified historical factor to prove it remains informational only.
    factors: legacyFactor ? [{ id: 'legacy-factor', factor_type: 'totp', status: 'verified', friendly_name: 'Historis' }] : [] };
  const session = { access_token: jwt(), refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [{ id: employeeId, employee_number: 'RK000001', full_name: 'Akun Password Only', whatsapp: '081200000000', department_id: 'department', position_id: 'position', outlet_id: 'outlet', starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: authId, weekly_off_days: [] }],
    employee_roles: [{ employee_id: employeeId, role: 'admin_hr' }],
    departments: [{ id: 'department', name: 'Uji', active: true }],
    positions: [{ id: 'position', name: 'Admin HR', department_id: 'department', is_cashier: false, active: true }],
    outlets: [{ id: 'outlet', name: 'Outlet Sintetis', active: true, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', radius_m: 500 }]
  };
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, user); return; }
    if (path === '/auth/v1/token') { await respond(route, session); return; }
    if (path.startsWith('/auth/v1/factors')) { factorCalls += 1; await respond(route, { error: 'MFA API must not be called' }, 500); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: employeeId, requires_mfa: false, current_level: 'aal1', allowed: !revoked, reason: revoked ? 'session_revoked' : null }); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { expired: false, remaining: 12 }); return; }
    if (path === '/rest/v1/rpc/spv_followup_page') { await respond(route, { items: [], total: 0 }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) { protectedReads += 1; await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []); return; }
    await respond(route, {});
  });
  return { get protectedReads() { return protectedReads; }, get factorCalls() { return factorCalls; } };
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill('RK000001');
  await page.getByLabel('Kata sandi').fill('Synthetic-Password-123');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('admin with no factor reaches Dashboard using password only and never calls MFA API', async ({ page }) => {
  const mock = await fixture(page); await login(page);
  await expect(page).toHaveURL(/\/dashboard$/); await expect(page.locator('.shell')).toBeVisible();
  expect(mock.protectedReads).toBeGreaterThan(0); expect(mock.factorCalls).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).toLowerCase().includes('mfa'))).toBe(false);
});

test('legacy verified factor does not create an OTP challenge or enrollment route', async ({ page }) => {
  const mock = await fixture(page, false, true); await login(page); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/mfa'); await expect(page).toHaveURL(/\/dashboard$/); expect(mock.factorCalls).toBe(0);
});

test('revoked live session fails closed before protected reads', async ({ page }) => {
  const mock = await fixture(page, true); await login(page);
  await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole('alert')).toContainText('Sesi akun tidak berlaku');
  expect(mock.protectedReads).toBe(0); expect(mock.factorCalls).toBe(0);
});
