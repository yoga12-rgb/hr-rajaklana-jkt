import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const authId = '10000000-0000-4000-8000-000000000071', employeeId = '20000000-0000-4000-8000-000000000071';
const outletId = '30000000-0000-4000-8000-000000000071', recordId = '40000000-0000-4000-8000-000000000071';
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) });
}
async function fixture(page: Page, options: { rejectFirst?: boolean; holdSigning?: boolean } = {}) {
  const now = new Date().toISOString(), clockIn = new Date(Date.now() - 3600_000).toISOString(), clockOut = new Date(Date.now() - 1800_000).toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: authId, aud: 'authenticated', role: 'authenticated', aal: 'aal1', session_id: 'private-media-fixture', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`;
  const user = { id: authId, aud: 'authenticated', role: 'authenticated', email: 'private-media@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now };
  const session = { access_token: token, refresh_token: 'synthetic-private-media', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [{ id: employeeId, employee_number: 'RK000071', full_name: 'Kasir Media Privat', department_id: 'department', position_id: 'position', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: authId, can_clock: true, weekly_off_days: [], photo_path: `${authId}/profile.jpg` }],
    employee_roles: [], departments: [{ id: 'department', name: 'Operasional', active: true }],
    positions: [{ id: 'position', name: 'Kasir', department_id: 'department', is_cashier: true, active: true }],
    outlets: [{ id: outletId, code: 'MEDIA', name: 'Outlet Media', active: true, latitude: -6.2, longitude: 106.816666, radius_m: 500, max_accuracy_m: 100, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }],
    attendance: [{ id: recordId, employee_id: employeeId, outlet_id: outletId, work_date: today, shift: 'morning', clock_in: clockIn, clock_out: clockOut, expected_in: clockIn, late_minutes: 0, worked_minutes: 30, selfie_path: `${authId}/selfie.jpg`, selfie_captured_at: clockIn, selfie_outlet_name: 'Outlet Media', corrected: false, source: 'device', in_latitude: -6.2, in_longitude: 106.816666, in_accuracy_m: 10, in_distance_m: 0, morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', tolerance_minutes: 5, outlet_latitude: -6.2, outlet_longitude: 106.816666, radius_m: 500 }],
    leave_requests: [{ id: '50000000-0000-4000-8000-000000000071', employee_id: employeeId, kind: 'personal', extent: 'full_day', starts_on: today, ends_on: today, status: 'approved', reason: 'Fixture lampiran privat', created_at: now, deductions: {}, attachment_path: `${authId}/leave.pdf` }]
  };
  const signRequests: string[] = [];
  let rejectNext = options.rejectFirst ?? false, allowed = true;
  const signingGate = Promise.withResolvers<void>();
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, user); return; }
    if (path === '/auth/v1/token') { await respond(route, session); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: employeeId, allowed, requires_mfa: false, current_level: 'aal1', reason: allowed ? null : 'session_revoked' }); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { expired: false, remaining: 12 }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) { await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []); return; }
    if (path.startsWith('/storage/v1/object/sign/') && request.method() === 'POST') {
      signRequests.push(path);
      if (options.holdSigning) await signingGate.promise;
      if (rejectNext) { rejectNext = false; await respond(route, { statusCode: '503', error: 'temporary', message: 'Storage sementara tidak tersedia' }, 503); return; }
      const bucketAndPath = path.slice('/storage/v1/object/sign/'.length);
      const paths = request.postDataJSON().paths;
      if (Array.isArray(paths)) await respond(route, paths.map(filePath => ({ path: filePath, signedURL: `/object/sign/${bucketAndPath}/${filePath}?token=synthetic-${signRequests.length}` })));
      else await respond(route, { signedURL: `/object/sign/${bucketAndPath}?token=synthetic-${signRequests.length}` });
      return;
    }
    if (path.startsWith('/storage/v1/object/sign/') && request.method() === 'GET') { await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng }); return; }
    await respond(route, {});
  });
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000071');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-Private-Media');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Menyiapkan data ruang kerja…', { exact: true })).toBeHidden();
  return { signRequests, releaseSigning: signingGate.resolve, revoke() { allowed = false; } };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated Supabase SDK fixture.');

test('private photos are signed only when their detail is opened and a failed signing read can be retried', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|PRIVATE-MEDIA-01|workspace hydration makes no photo or attachment signing requests; opening a selfie signs on demand and failed signing retries safely' });
  const mock = await fixture(page, { rejectFirst: true });
  expect(mock.signRequests).toHaveLength(0);
  await page.goto('/attendance');
  await expect(page.getByRole('button', { name: /^Lihat catatan / })).toBeVisible();
  expect(mock.signRequests).toHaveLength(0);
  await page.getByRole('button', { name: /^Lihat catatan / }).click();
  // Scope to the visible dialog; title wording is intentionally independent of
  // the storage behavior tested here.
  const visibleDialog = page.locator('dialog[open]');
  await expect(visibleDialog.getByText('Berkas belum dapat dibuka. Periksa koneksi atau coba lagi.', { exact: true })).toBeVisible();
  await visibleDialog.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(visibleDialog.getByRole('img', { name: 'Selfie masuk Kasir Media Privat' })).toBeVisible();
  await expect(visibleDialog.getByRole('link', { name: 'Lihat foto penuh', exact: true })).toBeVisible();
  expect(mock.signRequests).toHaveLength(2);
  expect(mock.signRequests.every(path => path.includes('attendance-selfies'))).toBe(true);
  await visibleDialog.getByRole('button', { name: 'Tutup', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Lihat catatan / })).toBeVisible();
  expect(mock.signRequests).toHaveLength(2);
});

test('late signed photo cannot reappear after the live session is revoked', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|PRIVATE-MEDIA-02|revoked live session clears an open private photo detail and rejects its late signing response' });
  const mock = await fixture(page, { holdSigning: true });
  try {
    await page.goto('/attendance');
    await page.getByRole('button', { name: /^Lihat catatan / }).click();
    await expect.poll(() => mock.signRequests.length).toBe(1);
    await expect(page.getByText('Memuat foto…', { exact: true })).toBeVisible();
    mock.revoke();
    await page.evaluate(async () => { const modulePath: string = '/src/lib/state/app.ts'; const { actions } = await import(/* @vite-ignore */ modulePath); await actions.refresh(); });
    await expect(page).toHaveURL(/\/login$/);
    mock.releaseSigning();
    await expect(page.getByRole('img', { name: 'Selfie masuk Kasir Media Privat' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Lihat foto penuh', exact: true })).toHaveCount(0);
  } finally { mock.releaseSigning(); }
});
