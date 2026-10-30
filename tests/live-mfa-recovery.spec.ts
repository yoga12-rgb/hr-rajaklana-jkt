import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const authId = 'auth-recovery-retired', employeeId = 'employee-recovery-retired';
function jwt() { const e = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url'); return `${e({ alg: 'HS256', typ: 'JWT' })}.${e({ sub: authId, aud: 'authenticated', role: 'authenticated', aal: 'aal1', session_id: 'retired-session', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`; }
async function respond(route: Route, data: unknown, status = 200) { const rows = Array.isArray(data) ? data : null; await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) }); }
async function fixture(page: Page) {
  let factorCalls = 0, recoveryCalls = 0;
  const user = { id: authId, aud: 'authenticated', role: 'authenticated', email: 'retired@example.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const session = { access_token: jwt(), refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const tables: Record<string, unknown[]> = { employees: [{ id: employeeId, employee_number: 'RK000001', full_name: 'Admin Retire', whatsapp: '0812', department_id: 'd', position_id: 'p', outlet_id: 'o', starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: authId, weekly_off_days: [] }], employee_roles: [{ employee_id: employeeId, role: 'admin_hr' }], departments: [{ id: 'd', name: 'Uji', active: true }], positions: [{ id: 'p', name: 'Admin', department_id: 'd', active: true, is_cashier: false }], outlets: [{ id: 'o', name: 'Outlet', active: true, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', radius_m: 500 }] };
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/functions/v1/hr-api') { const body = request.postDataJSON(); if (body.action === 'recover_mfa') { recoveryCalls += 1; await respond(route, { error: 'Pemulihan autentikator sudah dihentikan.' }, 410); } else await respond(route, { session }); return; }
    if (path.startsWith('/auth/v1/factors')) { factorCalls += 1; await respond(route, { error: 'factor API must not be called' }, 500); return; }
    if (path === '/auth/v1/user') { await respond(route, user); return; }
    if (path === '/auth/v1/token') { await respond(route, session); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: employeeId, requires_mfa: false, current_level: 'aal1', allowed: true, reason: null }); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { expired: false, remaining: 12 }); return; }
    if (path === '/rest/v1/rpc/spv_followup_page') { await respond(route, { items: [], total: 0 }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) { await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []); return; }
    await respond(route, {});
  });
  return { get factorCalls() { return factorCalls; }, get recoveryCalls() { return recoveryCalls; } };
}
async function login(page: Page) { await page.goto('/login'); await page.getByLabel('Nomor karyawan').fill('RK000001'); await page.getByLabel('Kata sandi').fill('Synthetic-Password-123'); await page.getByRole('button', { name: 'Masuk', exact: false }).click(); await expect(page).toHaveURL(/\/dashboard$/); }

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated live-mock server.');

test('retired recovery action returns fixed 410 and never reaches factor API', async ({ page }) => {
  const mock = await fixture(page); await login(page);
  const result = await page.evaluate(async ({ url, token }) => (await fetch(`${url}/functions/v1/hr-api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'recover_mfa' }) })).status, { url: backend, token: jwt() });
  expect(result).toBe(410); expect(mock.factorCalls).toBe(0); expect(mock.recoveryCalls).toBe(1);
  await page.goto('/employees'); await expect(page.getByText('Pulihkan verifikasi dua langkah')).toHaveCount(0);
});
