import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sessionFor(name: string, nonce = 'initial') {
  const user = { id: `auth-${name}`, aud: 'authenticated', role: 'authenticated', email: `${name}@example.test`,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: new Date().toISOString(), factors: [] };
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', aud: 'authenticated', session_id: `session-${name}`, aal: 'aal1', exp: Math.floor(Date.now()/1000)+3600 })}.${encode({ signature: 'synthetic', nonce })}`,
    refresh_token: `synthetic-refresh-${name}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
}
async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length-1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) });
}
async function setup(page: Page, options: { reject?: boolean; existing?: boolean; loseReply?: boolean } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const gate = Promise.withResolvers<void>(), session = sessionFor('a');
  let records: Record<string, any>[] = [], clockIns = 0, attendanceReads = 0;
  const row = () => ({ id: 'attendance-a', employee_id: 'cashier-a', outlet_id: 'outlet', assignment_id: 'assignment-a', work_date: today, shift: 'middle',
    clock_in: new Date(Date.now()-60*60000).toISOString(), clock_out: null, worked_minutes: null, expected_in: null, late_minutes: 0,
    selfie_path: 'auth-a/photo.jpg', selfie_captured_at: new Date().toISOString(), selfie_outlet_name: 'Outlet UX', corrected: false,
    in_latitude: -6.2, in_longitude: 106.816666, in_accuracy_m: 10, in_distance_m: 0,
    morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', tolerance_minutes: 5, outlet_latitude: -6.2, outlet_longitude: 106.816666, radius_m: 500, source: 'device' });
  if (options.existing) records = [row()];
  const employee = (name: string) => ({ id: `cashier-${name}`, employee_number: name === 'a' ? 'RK000041' : 'RK000042', full_name: `Kasir ${name.toUpperCase()}`,
    whatsapp: '0812', department_id: 'department', position_id: 'position', outlet_id: 'outlet', starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: `auth-${name}`, can_clock: true, can_middle_shift: true, weekly_off_days: [] });
  await page.route('**/api/attendance-selfie', route => respond(route, { verificationToken: '00000000-0000-4000-8000-000000000041' }));
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let name = 'a';
    try { const payload = JSON.parse(Buffer.from((request.headers().authorization ?? '').split('.')[1], 'base64url').toString()); name = payload.sub === 'auth-b' ? 'b' : 'a'; } catch {}
    if (path === '/functions/v1/hr-api') return respond(route, { session });
    if (path === '/auth/v1/user') return respond(route, sessionFor(name).user);
    if (path === '/auth/v1/token') return respond(route, sessionFor(name));
    if (path === '/rest/v1/rpc/auth_access_context') return respond(route, { employee_id: `cashier-${name}`, allowed: true, requires_mfa: false, current_level: 'aal1', reason: null });
    if (path === '/rest/v1/rpc/leave_balance') return respond(route, { expired: false, remaining: 12 });
    if (path === '/rest/v1/rpc/attendance_clock_in_selfie') {
      clockIns++;
      const input = request.postDataJSON();
      const saved = { ...row(), clock_in: new Date().toISOString(), selfie_path: input.p_selfie_path, selfie_captured_at: input.p_selfie_captured_at };
      if (!options.reject) records = [saved];
      await gate.promise;
      if (options.loseReply) { await route.abort('failed'); return; }
      return respond(route, options.reject ? { code: 'P0001', message: 'Penugasan berubah. Periksa jadwal sebelum mencoba kembali.' } : saved, options.reject ? 400 : 200);
    }
    if (path.startsWith('/rest/v1/rpc/')) return respond(route, []);
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      if (table === 'attendance') attendanceReads++;
      const tables: Record<string, unknown> = {
        employees: [employee(name)], employee_roles: [],
        departments: [{ id: 'department', name: 'Operasional', active: true }],
        positions: [{ id: 'position', name: 'Kasir', department_id: 'department', active: true, is_cashier: true }],
        outlets: [{ id: 'outlet', code: 'UX', name: 'Outlet UX', active: true, latitude: -6.2, longitude: 106.816666, radius_m: 500, max_accuracy_m: 100, opens_at: '00:00:00', closes_at: '23:59:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }],
        cashier_assignments: [{ id: `assignment-${name}`, employee_id: `cashier-${name}`, outlet_id: 'outlet', work_date: today, shift: 'middle', status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        attendance: records.filter(record => record.employee_id === `cashier-${name}`)
      };
      return respond(route, tables[table] ?? []);
    }
    if (path.startsWith('/storage/v1/object/sign/attendance-selfies/')) return respond(route, { signedURL: '/object/sign/attendance-selfies/fixture.png?token=synthetic' });
    if (path === '/storage/v1/object/sign/attendance-selfies') return respond(route, (request.postDataJSON().paths ?? []).map((path: string) => ({ path, signedURL: '/object/sign/attendance-selfies/fixture.png?token=synthetic' })));
    if (path.startsWith('/storage/v1/object/attendance-selfies/') && request.method() === 'POST') return respond(route, { Key: path.slice('/storage/v1/object/'.length), Id: 'object-a' });
    if (path === '/storage/v1/object/attendance-selfies' && request.method() === 'DELETE') return respond(route, []);
    return respond(route, {});
  });
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
      const context = canvas.getContext('2d')!;
      const draw = () => { context.fillStyle = '#d8c590'; context.fillRect(0,0,640,640); requestAnimationFrame(draw); };
      draw(); return canvas.captureStream(15);
    } });
  });
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000041');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-UX-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { release: gate.resolve, get clockIns() { return clockIns; }, get attendanceReads() { return attendanceReads; }, sessionB: sessionFor('b'), rotatedSessionA: sessionFor('a', 'rotated'),
    correctRecord() { records = [{ ...records[0], clock_out: new Date().toISOString(), worked_minutes: 60, corrected: true }]; },
    removeRecord() { records = []; } };
}
async function prepare(page: Page) {
  await page.goto('/attendance');
  await page.getByRole('button', { name: 'Clock in · Masuk', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Lokasi sesuai', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Buka kamera', exact: true }).click();
  await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Ambil selfie', exact: true }).click();
  await expect(dialog.getByText('Selfie bertag siap', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
  return dialog;
}
test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated Supabase SDK mock server.');

test('closing a pending clock form retains operation status and duplicate protection across SPA navigation', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-01|pending attendance survives modal close and same-account SPA navigation; one RPC receipt publishes the final result' });
  const mock = await setup(page);
  try {
    const dialog = await prepare(page);
    await expect.poll(() => mock.clockIns).toBe(1);
    await expect(page.locator('.clock-progress')).toBeVisible();
    await dialog.getByRole('button', { name: 'Tutup formulir', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toBeDisabled();
    await page.locator('aside nav a[href="/profile"]').click();
    await expect(page).toHaveURL(/\/profile$/);
    await page.locator('aside nav a[href="/attendance"]').click();
    await expect(page.locator('.clock-progress')).toBeVisible();
    // Entering the operational route re-reads its canonical context. The
    // committed row can already be visible while its RPC response is held.
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeDisabled();
    mock.release();
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.clock-progress')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeEnabled();
    expect(mock.clockIns).toBe(1);
  } finally { mock.release(); }
});

test('a rejected receipt remains visible after Escape closes the form without claiming cancellation', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-02|closing a pending form with Escape retains the later server rejection and permits only an explicit retry' });
  const mock = await setup(page, { reject: true });
  try {
    const dialog = await prepare(page);
    await expect.poll(() => mock.clockIns).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    mock.release();
    await expect(page.getByText('Penugasan berubah. Periksa jadwal sebelum mencoba kembali.', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toBeEnabled();
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true })).toHaveCount(0);
    expect(mock.clockIns).toBe(1);
  } finally { mock.release(); }
});

test('a late account A attendance receipt cannot publish pending or success state into account B', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-03|account switch clears attendance operation UI and rejects a late old-account receipt without leaking its record' });
  const mock = await setup(page);
  try {
    const dialog = await prepare(page);
    await expect.poll(() => mock.clockIns).toBe(1);
    await dialog.getByRole('button', { name: 'Tutup formulir', exact: true }).click();
    await page.evaluate(async session => {
      const clientPath: string = '/src/lib/state/client.ts', statePath: string = '/src/lib/state/app.ts';
      const { supabase } = await import(/* @vite-ignore */ clientPath);
      await supabase.auth.setSession(session);
      const { actions } = await import(/* @vite-ignore */ statePath); await actions.refresh();
    }, mock.sessionB);
    await expect(page.locator('.account strong')).toHaveText('Kasir B');
    mock.release();
    await expect(page.locator('.clock-progress')).toHaveCount(0);
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toHaveCount(0);
    expect(mock.clockIns).toBe(1);
  } finally { mock.release(); }
});

test('open attendance detail follows refreshed corrections and stops showing a removed record', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-04|open detail derives the current attendance ID after refresh and shows unavailable state when its record disappears' });
  const mock = await setup(page, { existing: true });
  await page.goto('/attendance');
  await page.getByRole('button', { name: /Lihat catatan Kasir A/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Sedang bekerja', { exact: true })).toBeVisible();
  mock.correctRecord();
  await page.evaluate(async () => { const path: string = '/src/lib/state/app.ts'; const { actions } = await import(/* @vite-ignore */ path); await actions.refresh(); });
  await expect(dialog.getByText('Koreksi HR', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Sedang bekerja', { exact: true })).toHaveCount(0);
  await expect(dialog.locator('dt').filter({ hasText: 'Durasi aktual' }).locator('..')).toContainText('1 j');
  mock.removeRecord();
  await page.evaluate(async () => { const path: string = '/src/lib/state/app.ts'; const { actions } = await import(/* @vite-ignore */ path); await actions.refresh(); });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Catatan ini belum tersedia atau aksesnya telah berubah. Tutup detail dan periksa kembali daftar kehadiran.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Koreksi HR', { exact: true })).toHaveCount(0);
});

test('an ambiguous committed response triggers a status read without resending attendance or claiming success', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-05|lost attendance reply checks scoped history once without automatic resubmission or false success' });
  const mock = await setup(page, { loseReply: true });
  try {
    const dialog = await prepare(page);
    await expect.poll(() => mock.clockIns).toBe(1);
    const before = mock.attendanceReads;
    await dialog.getByRole('button', { name: 'Tutup formulir', exact: true }).click();
    mock.release();
    await expect(page.locator('.clock-outcome-hint')).toContainText('Riwayat sudah diperbarui');
    await expect.poll(() => mock.attendanceReads).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeEnabled();
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true })).toHaveCount(0);
    expect(mock.clockIns).toBe(1);
  } finally { mock.release(); }
});

test('same-account token rotation preserves the pending photo and blocks resubmission when refreshed attendance is already recorded', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-ATTENDANCE-06|same-account token rotation retains the pending capture and lease; a guarded late receipt checks history and disables already-recorded submission' });
  const mock = await setup(page);
  try {
    const dialog = await prepare(page);
    await expect.poll(() => mock.clockIns).toBe(1);
    const preview = await dialog.locator('.camera-preview img').getAttribute('src');
    await page.evaluate(async session => {
      const clientPath: string = '/src/lib/state/client.ts', statePath: string = '/src/lib/state/app.ts';
      const { supabase } = await import(/* @vite-ignore */ clientPath);
      await supabase.auth.setSession(session);
      const { actions } = await import(/* @vite-ignore */ statePath); await actions.refresh();
    }, mock.rotatedSessionA);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.camera-preview img')).toHaveAttribute('src', preview!);
    await expect(page.locator('.clock-progress')).toBeVisible();
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    mock.release();
    await expect(page.locator('.clock-progress')).toHaveCount(0);
    await expect(page.locator('.clock-outcome-hint')).toContainText('Riwayat sudah diperbarui');
    await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
    await expect(dialog.getByText('Status kehadiran sudah berubah. Tutup formulir dan periksa catatan terbaru.', { exact: true })).toBeVisible();
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tutup formulir', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeEnabled();
    expect(mock.clockIns).toBe(1);
  } finally { mock.release(); }
});
