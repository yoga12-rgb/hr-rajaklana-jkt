import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const caseId = '11111111-1111-4111-8111-111111111111', issueId = '22222222-2222-4222-8222-222222222222';
const firstNotification = '33333333-3333-4333-8333-333333333333', secondNotification = '44444444-4444-4444-8444-444444444444';
async function respond(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: Array.isArray(body) ? { 'content-range': body.length ? `0-${body.length - 1}/${body.length}` : '*/0' } : {}, body: JSON.stringify(body) });
}
function auth(scope: 'a' | 'b') {
  const now = new Date().toISOString();
  const user = { id: `auth-notification-${scope}`, aud: 'authenticated', role: 'authenticated', email: `${scope}@example.test`, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`, refresh_token: `synthetic-notification-${scope}`, token_type: 'bearer', expires_in: 3600 };
}
async function setup(page: Page, options: { hold?: boolean; rejectFirst?: boolean; invalidLink?: boolean } = {}) {
  const gate = Promise.withResolvers<void>();
  const firstReadDone = Promise.withResolvers<void>();
  let scope: 'a' | 'b' = 'a', first = true;
  const calls: string[] = [], notifications = new Map<string, Record<string, any>[]>();
  for (const account of ['a', 'b'] as const) {
    notifications.set(account, account === 'a' ? [
      { id: firstNotification, employee_id: 'employee-notification-a', entity_id: caseId, entity_type: 'spv_followup', title: 'Kasus SPV perlu ditinjau', body: 'Buka kasus fixture', href: options.invalidLink ? `//evil.test/supervisor?case=${caseId}` : `/supervisor?case=${caseId}`, created_at: new Date().toISOString(), read_at: null },
      { id: secondNotification, employee_id: 'employee-notification-a', entity_id: issueId, entity_type: 'outlet_issue', title: 'Laporan outlet perlu ditinjau', body: 'Buka laporan fixture', href: `/operations?issue=${issueId}`, created_at: new Date().toISOString(), read_at: null }
    ] : [{ id: '55555555-5555-4555-8555-555555555555', employee_id: 'employee-notification-b', entity_id: issueId, entity_type: 'outlet_issue', title: 'Notifikasi khusus akun B', body: 'Hanya akun B', href: `/operations?issue=${issueId}`, created_at: new Date().toISOString(), read_at: null }]);
  }
  await page.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/functions/v1/hr-api' || path === '/auth/v1/token') { await respond(route, { ...auth(scope), session: auth(scope) }); return; }
    if (path === '/auth/v1/user') { await respond(route, auth(scope).user); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: `employee-notification-${scope}`, allowed: true, requires_mfa: false, current_level: 'aal1', reason: null }); return; }
    if (path === '/rest/v1/rpc/notifications_mark_read') {
      const input = route.request().postDataJSON(), account = scope, initial = first; first = false;
      calls.push(input.p_id);
      try {
        if (options.hold && initial) await gate.promise;
        if (options.rejectFirst && initial) { await respond(route, { code: 'PGRST000', message: 'Notification marker temporarily unavailable' }, 503); return; }
        for (const row of notifications.get(account)!) if (!input.p_id || row.id === input.p_id) row.read_at ??= new Date().toISOString();
        await respond(route, null); return;
      } finally { if (initial) firstReadDone.resolve(); }
    }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { remaining: 12, expired: false }); return; }
    if (path === '/rest/v1/rpc/supervisor_operation_configuration_page') { await respond(route, { categories: [], routes: [], capabilities: [], as_of: new Date().toISOString() }); return; }
    if (path.startsWith('/rest/v1/rpc/') && /(?:page|coverage)$/.test(path)) { await respond(route, { items: [], total: 0, has_more: false, next_cursor: null, as_of: new Date().toISOString(), categories: [] }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const tables: Record<string, unknown[]> = {
        employees: [{ id: `employee-notification-${scope}`, employee_number: scope === 'a' ? 'RK000071' : 'RK000072', full_name: `Admin Notifikasi ${scope.toUpperCase()}`, auth_user_id: auth(scope).user.id, status: 'active', account_status: 'active', starts_on: '2020-01-01', department_id: 'notification-dept', position_id: 'notification-position', outlet_id: 'notification-outlet', weekly_off_days: [], can_clock: false }],
        employee_roles: [{ employee_id: `employee-notification-${scope}`, role: 'admin_hr' }], departments: [{ id: 'notification-dept', name: 'SDM', active: true }],
        positions: [{ id: 'notification-position', name: 'SPV', department_id: 'notification-dept', active: true, is_cashier: false }],
        outlets: [{ id: 'notification-outlet', name: 'Outlet Fixture', code: 'FIXTURE', active: true, latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }],
        notifications: notifications.get(scope)!
      };
      await respond(route, tables[table] ?? []); return;
    }
    await respond(route, {});
  });
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000071');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-Notification-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: /^Notifikasi,/ })).toBeVisible();
  return { calls, async release() { gate.resolve(); if (options.hold && calls.length) await firstReadDone.promise; }, async switchAccount() {
    scope = 'b';
    await page.evaluate(async session => {
      const clientPath: string = '/src/lib/state/client.ts', appPath: string = '/src/lib/state/app.ts';
      const { supabase } = await import(/* @vite-ignore */ clientPath);
      const { actions } = await import(/* @vite-ignore */ appPath);
      const { error } = await supabase.auth.setSession(session); if (error) throw error;
      await actions.refresh();
    }, auth('b'));
    await expect(page.getByText('Admin Notifikasi B', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Beranda', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  } };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated Supabase SDK mock server.');

test('notification destinations open before a held marker RPC and another notification stays usable', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-NOTIFY-01|supervisor and outlet destinations open before held read marker; pending marker does not block another notification' });
  const mock = await setup(page, { hold: true });
  try {
    await page.getByRole('button', { name: /^Notifikasi,/ }).click();
    await page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ }).click();
    await expect(page).toHaveURL(new RegExp(`/supervisor\\?case=${caseId}$`));
    expect(mock.calls).toEqual([firstNotification]);
    await page.getByRole('button', { name: /^Notifikasi,/ }).click();
    await page.getByRole('button', { name: /Laporan outlet perlu ditinjau/ }).click();
    await expect(page).toHaveURL(new RegExp(`/operations\\?issue=${issueId}$`));
    expect(mock.calls).toEqual([firstNotification, secondNotification]);
  } finally { await mock.release(); }
});

test('failed read marker remains visible after navigation and retries without false read status', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-NOTIFY-02|read marker failure remains visible after navigation and original notification stays unread until confirmed retry' });
  const mock = await setup(page, { rejectFirst: true });
  await page.getByRole('button', { name: /^Notifikasi,/ }).click();
  await page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ }).click();
  await expect(page).toHaveURL(new RegExp(`/supervisor\\?case=${caseId}$`));
  await expect(page.getByRole('alert').filter({ hasText: 'Status dibaca belum dapat dikonfirmasi' })).toBeVisible();
  await page.getByRole('button', { name: 'Buka notifikasi', exact: true }).click();
  const row = page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ });
  await expect(row).toHaveClass(/unread/);
  await row.click();
  await expect.poll(() => mock.calls.length).toBe(2);
  await page.getByRole('button', { name: /^Notifikasi,/ }).click();
  await expect(page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ })).not.toHaveClass(/unread/);
});

test('late account A marker failure cannot publish a notice or navigate account B', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-NOTIFY-03|late notification marker from account A cannot publish feedback, read state or navigation after account B takes over' });
  const mock = await setup(page, { hold: true, rejectFirst: true });
  try {
    await page.getByRole('button', { name: /^Notifikasi,/ }).click();
    await page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ }).click();
    await expect(page).toHaveURL(new RegExp(`/supervisor\\?case=${caseId}$`));
    await mock.switchAccount();
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/notifications_mark_read') && response.status() === 503);
    await mock.release();
    await lateResponse;
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('Status dibaca belum dapat dikonfirmasi', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: /^Notifikasi,/ }).click();
    await expect(page.getByRole('button', { name: /Notifikasi khusus akun B/ })).toHaveClass(/unread/);
    await expect(page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ })).toHaveCount(0);
  } finally { await mock.release(); }
});

test('invalid notification destination remains in inbox without navigation or read mutation', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-NOTIFY-04|invalid notification destination cannot navigate or mark a notification read' });
  const mock = await setup(page, { invalidLink: true });
  await page.getByRole('button', { name: /^Notifikasi,/ }).click();
  await page.getByRole('button', { name: /Kasus SPV perlu ditinjau/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Tautan notifikasi belum dapat dibuka. Muat ulang data atau hubungi HR.', { exact: true })).toBeVisible();
  expect(mock.calls).toEqual([]);
});
