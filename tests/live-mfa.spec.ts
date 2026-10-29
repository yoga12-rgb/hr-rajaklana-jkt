import { expect, test, type Page, type Route } from '@playwright/test';

// Real Supabase JS + browser storage, intercepted Auth/PostgREST endpoints.
// All identities, codes and enrollment material in this file are synthetic.
const backend = 'http://127.0.0.1:54329';
const authId = 'auth-mfa-synthetic', employeeId = 'employee-mfa-synthetic';
const syntheticSecret = 'SYNTHETIC-MFA-TEST-ONLY';
function jwt(aal: string, userId = authId) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', aal, session_id: 'synthetic-session', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`;
}
async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) });
}
async function mockMfa(page: Page, options: { cashier?: boolean; verified?: boolean; revoked?: boolean; identity?: { authId: string; employeeId: string } } = {}) {
  const identity = options.identity ?? { authId, employeeId };
  const now = new Date().toISOString();
  const factors: { id: string; factor_type: string; friendly_name: string; status: string }[] = options.verified ? [{ id: 'factor-existing', factor_type: 'totp', friendly_name: 'Autentikator uji', status: 'verified' }] : [];
  let protectedReads = 0, enrollmentCount = 0, verifiedCount = 0, rejectedCount = 0;
  const removed: string[] = [];
  let nextVerificationGate: { received(): void; wait: Promise<void> } | null = null;
  const authUser = () => ({ id: identity.authId, aud: 'authenticated', role: 'authenticated', email: 'mfa-synthetic@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, factors: structuredClone(factors) });
  const session = (level: string) => ({ access_token: jwt(level, identity.authId), refresh_token: `synthetic-refresh-${level}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: authUser() });
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [{ id: identity.employeeId, employee_number: 'RK000001', full_name: 'Akun MFA Sintetis', whatsapp: '081200000000', department_id: 'department', position_id: 'position', outlet_id: 'outlet', starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: identity.authId, weekly_off_days: [] }],
    employee_roles: [{ employee_id: identity.employeeId, role: options.cashier ? 'employee' : 'admin_hr' }],
    departments: [{ id: 'department', name: 'Uji', active: true }], positions: [{ id: 'position', name: options.cashier ? 'Kasir' : 'Admin HR', department_id: 'department', is_cashier: !!options.cashier, active: true }],
    outlets: [{ id: 'outlet', name: 'Outlet Sintetis', active: true, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', radius_m: 500 }]
  };
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization ?? '';
    let level = 'aal1';
    try { level = JSON.parse(Buffer.from(authorization.split('.')[1] ?? '', 'base64url').toString()).aal ?? 'aal1'; } catch { /* synthetic anon requests */ }
    if (path === '/functions/v1/hr-api') { await respond(route, { session: session('aal1') }); return; }
    if (path === '/auth/v1/user') { await respond(route, authUser()); return; }
    if (path === '/auth/v1/token') { await respond(route, session(level)); return; }
    if (path === '/auth/v1/factors' && request.method() === 'POST') {
      enrollmentCount += 1; const id = `factor-${enrollmentCount}`;
      factors.push({ id, factor_type: 'totp', friendly_name: request.postDataJSON().friendly_name, status: 'unverified' });
      await respond(route, { id, type: 'totp', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: syntheticSecret, uri: 'otpauth://totp/synthetic-test-only' } }); return;
    }
    if (/\/auth\/v1\/factors\/[^/]+\/challenge$/.test(path)) { await respond(route, { id: 'synthetic-challenge', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 120 }); return; }
    if (/\/auth\/v1\/factors\/[^/]+\/verify$/.test(path)) {
      const gate = nextVerificationGate; nextVerificationGate = null;
      if (gate) { gate.received(); await gate.wait; }
      if (request.postDataJSON().code !== '123456') { rejectedCount += 1; await respond(route, { code: 'mfa_verification_failed', message: 'Synthetic invalid code' }, 422); return; }
      verifiedCount += 1; const id = path.split('/')[4];
      const factor = factors.find(row => row.id === id); if (factor) factor.status = 'verified';
      await respond(route, session('aal2')); return;
    }
    if (/\/auth\/v1\/factors\/[^/]+$/.test(path) && request.method() === 'DELETE') { const id = path.split('/')[4]; removed.push(id); const index = factors.findIndex(row => row.id === id); if (index >= 0) factors.splice(index, 1); await respond(route, { id }); return; }
    if (path === '/rest/v1/rpc/auth_access_context') {
      await respond(route, { employee_id: identity.employeeId, requires_mfa: !options.cashier, current_level: level,
        allowed: !options.revoked && (options.cashier || level === 'aal2'), reason: options.revoked ? 'session_revoked' : (!options.cashier && level !== 'aal2') ? 'mfa_required' : null }); return;
    }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { expired: false, remaining: 12 }); return; }
    if (path === '/rest/v1/rpc/spv_followup_page') { await respond(route, { items: [], total: 0 }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) { protectedReads += 1; await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []); return; }
    await respond(route, {});
  });
  return { get protectedReads() { return protectedReads; }, get enrollmentCount() { return enrollmentCount; }, get verifiedCount() { return verifiedCount; }, get rejectedCount() { return rejectedCount; }, factors, removed,
    holdNextVerification() {
      let received!: () => void, release!: () => void;
      const requested = new Promise<void>(resolve => { received = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      nextVerificationGate = { received, wait };
      return { requested, release };
    }
  };
}
async function login(page: Page) {
  await page.goto('/login'); await page.getByLabel('Nomor karyawan').fill('RK000001'); await page.getByLabel('Kata sandi').fill('Synthetic-Password-123'); await page.getByRole('button', { name: 'Masuk', exact: false }).click();
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('privileged aal1 enrolls, retries a bad code, persists only session, and reloads at aal2', async ({ page }) => {
  const mock = await mockMfa(page); await login(page);
  await expect(page).toHaveURL(/\/mfa$/); await expect(page.getByRole('button', { name: 'Mulai pendaftaran' })).toBeVisible();
  expect(mock.protectedReads).toBe(0);
  await page.getByRole('button', { name: 'Mulai pendaftaran' }).click();
  await expect(page.getByText(syntheticSecret, { exact: true })).toBeVisible();
  await page.getByLabel('Kode autentikator').fill('000000'); await page.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expect(page.getByText('Kode belum sesuai atau sudah kedaluwarsa. Gunakan kode terbaru.')).toBeVisible();
  expect(mock.protectedReads).toBe(0);
  await page.getByLabel('Kode autentikator').fill('123456'); await page.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/); expect(mock.verifiedCount).toBe(1); expect(mock.rejectedCount).toBe(1); expect(mock.protectedReads).toBeGreaterThan(0);
  expect(await page.evaluate(secret => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret), syntheticSecret)).toBe(false);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/); await expect(page.locator('.shell')).toBeVisible();
});
test('verified factor challenges without enrolling a replacement', async ({ page }) => {
  const mock = await mockMfa(page, { verified: true }); await login(page); await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('Kode autentikator').fill('123456'); await page.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/); expect(mock.enrollmentCount).toBe(0);
});
test('ordinary cashier logs in without mandatory MFA', async ({ page }) => {
  const mock = await mockMfa(page, { cashier: true }); await login(page); await expect(page).toHaveURL(/\/dashboard$/); expect(mock.enrollmentCount).toBe(0); expect(mock.protectedReads).toBeGreaterThan(0);
});
test('revoked sessions fail closed before employee data and do not loop through enrollment', async ({ page }) => {
  const mock = await mockMfa(page, { revoked: true }); await login(page); await expect(page.getByRole('alert')).toContainText('Sesi akun tidak berlaku'); expect(mock.protectedReads).toBe(0); await expect(page).toHaveURL(/\/login$/);
});
test('reload discards enrollment secret and retry removes only the abandoned unverified factor', async ({ page }) => {
  const mock = await mockMfa(page); await login(page); await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole('button', { name: 'Mulai pendaftaran' }).click(); await expect(page.getByText(syntheticSecret, { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText(syntheticSecret, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mulai pendaftaran' }).click(); await expect(page.getByText(syntheticSecret, { exact: true })).toBeVisible(); expect(mock.removed).toEqual(['factor-1']); expect(mock.enrollmentCount).toBe(2);
});

test('a cloned active MFA tab gets a distinct enrollment scope and cannot remove the first tab factor', async ({ page, context }) => {
  const first = await mockMfa(page); await login(page); await expect(page).toHaveURL(/\/mfa$/);
  await page.getByRole('button', { name: 'Mulai pendaftaran' }).click();
  await expect(page.getByText(syntheticSecret, { exact: true })).toBeVisible();
  const copiedScope = await page.evaluate(() => sessionStorage.getItem('rk-mfa-enrollment-scope'));
  expect(copiedScope).toBeTruthy();
  const other = await context.newPage();
  await other.addInitScript(scope => { sessionStorage.setItem('rk-mfa-enrollment-scope', scope!); }, copiedScope);
  const second = await mockMfa(other);
  second.factors.push({ ...first.factors[0], id: 'other-tab-pending' });
  await other.goto('/mfa'); await expect(other.getByRole('button', { name: 'Mulai pendaftaran' })).toBeVisible();
  await other.getByRole('button', { name: 'Mulai pendaftaran' }).click();
  await expect(other.getByText(syntheticSecret, { exact: true })).toBeVisible();
  expect(await other.evaluate(() => sessionStorage.getItem('rk-mfa-enrollment-scope'))).not.toBe(copiedScope);
  expect(second.removed).toEqual([]);
  expect(second.factors.map(factor => factor.id)).toContain('other-tab-pending');
  await expect(page.getByText(syntheticSecret, { exact: true })).toBeVisible();
});

test('a delayed verification from account A cannot replace account B signed in through another tab', async ({ page, context }) => {
  const first = await mockMfa(page, { verified: true }); await login(page); await expect(page).toHaveURL(/\/mfa$/);
  const verification = first.holdNextVerification();
  await page.getByLabel('Kode autentikator').fill('123456'); await page.getByRole('button', { name: 'Verifikasi kode', exact: true }).click();
  await verification.requested;
  const other = await context.newPage();
  const secondIdentity = { authId: 'auth-cashier-synthetic-b', employeeId: 'employee-cashier-synthetic-b' };
  await mockMfa(other, { cashier: true, identity: secondIdentity });
  await other.goto('/mfa'); await other.getByRole('button', { name: 'Keluar akun', exact: true }).click();
  await expect(other).toHaveURL(/\/login$/); await login(other); await expect(other).toHaveURL(/\/dashboard$/);
  const response = page.waitForResponse(result => /\/auth\/v1\/factors\/[^/]+\/verify$/.test(new URL(result.url()).pathname));
  verification.release();
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('button', { name: 'Periksa ulang', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {
    const value = localStorage.getItem('sb-127-auth-token');
    return value ? JSON.parse(value).user?.id : null;
  })).toBe(secondIdentity.authId);
  await expect(page.locator('.setup-key')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => page.evaluate(() => {
    const value = localStorage.getItem('sb-127-auth-token');
    return value ? JSON.parse(value).user?.id : null;
  })).toBe(secondIdentity.authId);
});
