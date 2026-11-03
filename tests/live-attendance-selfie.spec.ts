import { expect, test, type Page, type Route } from '@playwright/test';

// Real browser + Supabase SDK, synthetic HTTP responses only; no hosted data.
const backend = 'http://127.0.0.1:54329';
const authId = 'auth-selfie-only', employeeId = 'cashier-selfie-only', outletId = 'outlet-selfie-only';
const receiptId = '00000000-0000-4000-8000-000000000032';

function jwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: authId, role: 'authenticated', aud: 'authenticated', session_id: 'session-selfie-only', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`;
}
async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({ status, contentType: 'application/json', headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {}, body: JSON.stringify(data) });
}

async function setup(page: Page, options: { holdVerify?: boolean; rejectFirst?: boolean; holdBackgroundReads?: boolean; holdClockInReply?: boolean; rejectClockIn?: boolean; holdWorkspaceReads?: boolean; skipLogin?: boolean } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const now = new Date().toISOString();
  const user = { id: authId, aud: 'authenticated', role: 'authenticated', email: 'selfie@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, factors: [] };
  const session = { access_token: jwt(), refresh_token: 'synthetic-selfie-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [{ id: employeeId, employee_number: 'RK000032', full_name: 'Kasir Selfie Uji', whatsapp: '081200000032', department_id: 'department-selfie', position_id: 'position-selfie', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: authId, weekly_off_days: [], can_clock: true, can_middle_shift: true }],
    employee_roles: [],
    departments: [{ id: 'department-selfie', name: 'Operasional', active: true }],
    positions: [{ id: 'position-selfie', name: 'Kasir', department_id: 'department-selfie', is_cashier: true, active: true }],
    outlets: [{ id: outletId, code: 'SELFIE', name: 'Outlet Selfie Uji', active: true, latitude: -6.2, longitude: 106.816666, radius_m: 500, max_accuracy_m: 100, opens_at: '00:00:00', closes_at: '23:59:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }],
    cashier_assignments: [{ id: 'assignment-selfie', employee_id: employeeId, outlet_id: outletId, work_date: today, shift: 'middle', status: 'active', reason: 'Fixture kamera', created_by: 'admin-selfie', created_at: now, updated_at: now }],
    attendance: []
  };
  const uploads: string[] = [], verifies: Record<string, any>[] = [], clockIns: Record<string, any>[] = [], clockOuts: Record<string, any>[] = [], legacyRequests: string[] = [];
  let rejectNextVerify = options.rejectFirst ?? true;
  const verifyGate = Promise.withResolvers<void>();
  const backgroundGate = Promise.withResolvers<void>(), clockInGate = Promise.withResolvers<void>(), workspaceGate = Promise.withResolvers<void>();
  let backgroundReadPending = false, workspaceReadPending = false;
  await page.route('**/api/attendance-selfie', async route => {
    const input = route.request().postDataJSON(); verifies.push(structuredClone(input));
    expect(route.request().headers().authorization).toBe(`Bearer ${session.access_token}`);
    if (options.holdVerify) await verifyGate.promise;
    if (rejectNextVerify) { rejectNextVerify = false; await respond(route, { code: 'selfie_invalid', error: 'Foto belum dapat diperiksa. Ambil ulang.' }, 400); return; }
    await respond(route, { verificationToken: receiptId, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  });
  await page.route('**/api/biometric', async route => { legacyRequests.push(route.request().url()); await respond(route, { code: 'feature_removed' }, 410); });
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, user); return; }
    if (path === '/auth/v1/token') { await respond(route, session); return; }
    if (/biometric/.test(path)) { legacyRequests.push(path); await respond(route, { message: 'Retired feature requested' }, 410); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: employeeId, allowed: true, requires_mfa: false, current_level: 'aal1', reason: null }); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { expired: false, remaining: 12 }); return; }
    if (path === '/rest/v1/rpc/attendance_clock_in_selfie') {
      const input = request.postDataJSON(); clockIns.push(structuredClone(input));
      expect(input.p_verification_token).toBe(receiptId);
      if (options.rejectClockIn) { await respond(route, { code: 'P0001', message: 'Penugasan sudah berubah. Muat ulang jadwal.' }, 400); return; }
      tables.attendance.push({ id: 'attendance-selfie', employee_id: employeeId, outlet_id: outletId, assignment_id: 'assignment-selfie', work_date: today, shift: 'middle', clock_in: new Date().toISOString(), clock_out: null, selfie_path: input.p_selfie_path, selfie_captured_at: input.p_selfie_captured_at, selfie_outlet_name: input.p_selfie_outlet_name, in_latitude: input.p_latitude, in_longitude: input.p_longitude, in_accuracy_m: input.p_accuracy_m, in_distance_m: 0, late_minutes: 0, worked_minutes: null, morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', tolerance_minutes: 5, outlet_latitude: -6.2, outlet_longitude: 106.816666, radius_m: 500, source: 'device' });
      // Production RPC returns the authoritative attendance composite, not its ID.
      const reply = structuredClone(tables.attendance[0]);
      if (options.holdClockInReply) await clockInGate.promise;
      await respond(route, reply); return;
    }
    if (path === '/rest/v1/rpc/attendance_clock_out_fresh') {
      const input = request.postDataJSON(); clockOuts.push(structuredClone(input));
      const row = tables.attendance[0];
      Object.assign(row, { clock_out: new Date().toISOString(), worked_minutes: 0, out_latitude: input.p_latitude, out_longitude: input.p_longitude, out_accuracy_m: input.p_accuracy_m, out_distance_m: 0 });
      await respond(route, row); return;
    }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) {
      if (options.holdWorkspaceReads && path === '/rest/v1/leave_requests') { workspaceReadPending = true; await workspaceGate.promise; }
      if (options.holdBackgroundReads && clockIns.length && path === '/rest/v1/employees') { backgroundReadPending = true; await backgroundGate.promise; }
      await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []); return;
    }
    if (path.startsWith('/storage/v1/object/sign/attendance-selfies/')) { await respond(route, { signedURL: '/object/sign/attendance-selfies/synthetic.jpg?token=synthetic' }); return; }
    if (path.startsWith('/storage/v1/object/attendance-selfies/') && request.method() === 'POST') { uploads.push(path); await respond(route, { Key: path.slice('/storage/v1/object/'.length), Id: `object-${uploads.length}` }); return; }
    if (path === '/storage/v1/object/attendance-selfies' && request.method() === 'DELETE') { await respond(route, []); return; }
    await respond(route, {});
  });
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
      const context = canvas.getContext('2d')!;
      const draw = () => { context.fillStyle = '#d8c590'; context.fillRect(0, 0, 640, 640); context.fillStyle = '#302b22'; context.beginPath(); context.arc(320, 240, 100, 0, 2 * Math.PI); context.fill(); context.fillRect(180, 350, 280, 240); requestAnimationFrame(draw); };
      draw(); return canvas.captureStream(15);
    } });
  });
  if (!options.skipLogin) {
    await page.goto('/login');
    await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000032');
    await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-Selfie-Password');
    await page.getByRole('button', { name: 'Masuk', exact: false }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  return { uploads, verifies, clockIns, clockOuts, legacyRequests, releaseVerify: verifyGate.resolve,
    releaseBackground: backgroundGate.resolve, releaseClockIn: clockInGate.resolve, get backgroundReadPending() { return backgroundReadPending; },
    releaseWorkspace: workspaceGate.resolve, get workspaceReadPending() { return workspaceReadPending; },
    revokeClockPermission() { tables.employees[0].can_clock = false; } };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated Supabase SDK mock server.');

test('selfie-only live SDK attendance validates camera GPS, retries failed photo and reloads saved attendance without enrollment', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|SELFIE-ONLY-01|live SDK camera/GPS clock-in needs no face reference, failed photo retry succeeds and saved attendance survives reload' });
  const mock = await setup(page);
  await page.goto('/attendance');
  await context.setGeolocation({ latitude: -6.3, longitude: 106.9, accuracy: 10 });
  await page.getByRole('button', { name: 'Clock in · Masuk', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Lokasi belum memenuhi syarat', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true })).toBeDisabled();
  expect(mock.uploads).toHaveLength(0);
  await context.setGeolocation({ latitude: -6.2, longitude: 106.816666, accuracy: 10 });
  await dialog.getByRole('button', { name: 'Periksa ulang lokasi', exact: true }).click();
  await expect(dialog.getByText('Lokasi sesuai', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Buka kamera', exact: true }).click();
  await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Ambil selfie', exact: true }).click();
  await expect(dialog.getByText('Selfie bertag siap', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
  await expect(page.getByText('Foto belum dapat diperiksa. Ambil ulang.', { exact: true }).first()).toBeVisible();
  expect(mock.clockIns).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Ambil ulang', exact: true }).click();
  await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Ambil selfie', exact: true }).click();
  await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeVisible();
  expect(mock.uploads).toHaveLength(2); expect(mock.verifies).toHaveLength(2); expect(mock.clockIns).toHaveLength(1);
  expect(mock.verifies[1]).toMatchObject({ action: 'verify', shift: 'middle', latitude: -6.2, longitude: 106.816666, selfieOutletName: 'Outlet Selfie Uji' });
  expect(mock.clockIns[0]).toMatchObject({ p_selfie_path: mock.verifies[1].selfiePath, p_selfie_captured_at: mock.verifies[1].selfieCapturedAt, p_geo_captured_at: mock.verifies[1].geoCapturedAt, p_verification_token: receiptId });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeVisible();
  expect(mock.clockIns).toHaveLength(1); expect(mock.legacyRequests).toEqual([]);
});

test('permission revoked while selfie verification is pending blocks the final attendance RPC', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|SELFIE-ONLY-02|revoked clock permission during pending selfie API prevents final attendance RPC and preserves account guard' });
  const mock = await setup(page, { holdVerify: true, rejectFirst: false });
  try {
    await page.goto('/attendance');
    await page.getByRole('button', { name: 'Clock in · Masuk', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Lokasi sesuai', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Buka kamera', exact: true }).click();
    await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Ambil selfie', exact: true }).click();
    await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
    await expect.poll(() => mock.verifies.length).toBe(1);
    mock.revokeClockPermission();
    await page.evaluate(async () => {
      const modulePath: string = '/src/lib/state/app.ts';
      const { actions } = await import(/* @vite-ignore */ modulePath);
      await actions.refresh();
    });
    mock.releaseVerify();
    await expect(page.getByText('Sesi atau akses absensi berubah. Silakan ulangi dengan akun Anda.', { exact: true }).first()).toBeVisible();
    expect(mock.clockIns).toHaveLength(0); expect(mock.legacyRequests).toEqual([]);
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toHaveCount(0);
  } finally { mock.releaseVerify(); }
});

async function prepareClockIn(page: Page) {
  await page.goto('/attendance');
  await page.getByRole('button', { name: 'Clock in · Masuk', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Lokasi sesuai', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Buka kamera', exact: true }).click();
  await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Ambil selfie', exact: true }).click();
  await expect(dialog.getByText('Selfie bertag siap', { exact: true })).toBeVisible();
  return dialog;
}

test('attendance resolves only after committed RPC response and never waits for unrelated background reads', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|RESPONSIVE-ATTENDANCE-01|camera/GPS RPC confirmation updates clock-in and clock-out before held background employee reads; reload retains server result' });
  const mock = await setup(page, { rejectFirst: false, holdBackgroundReads: true, holdClockInReply: true });
  try {
    const dialog = await prepareClockIn(page);
    await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
    await expect.poll(() => mock.clockIns.length).toBe(1);
    // A server-side commit without its response is still an unknown outcome.
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('button[type="submit"]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toHaveCount(0);
    mock.releaseClockIn();
    await expect(dialog).toBeHidden();
    await expect.poll(() => mock.backgroundReadPending).toBe(true);
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeVisible();
    await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true }).first()).toBeVisible();
    expect(mock.clockIns).toHaveLength(1);

    // The full refresh is still pending. Clock-out has an independent server
    // transaction and must publish its own confirmed result immediately.
    await page.getByRole('button', { name: 'Clock out · Pulang', exact: true }).click();
    await expect(dialog.getByText('Lokasi sesuai', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Konfirmasi clock out', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Sudah pulang.', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toHaveCount(0);
    expect(mock.clockOuts).toHaveLength(1);

    mock.releaseBackground();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sudah pulang.', exact: true })).toBeVisible();
    expect(mock.clockIns).toHaveLength(1); expect(mock.clockOuts).toHaveLength(1);
  } finally { mock.releaseClockIn(); mock.releaseBackground(); }
});

test('a rejected final attendance RPC keeps the form open and cannot display a saved record', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|RESPONSIVE-ATTENDANCE-02|final RPC rejection never publishes optimistic attendance or success while retaining retry form' });
  const mock = await setup(page, { rejectFirst: false, rejectClockIn: true });
  const dialog = await prepareClockIn(page);
  await dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Penugasan sudah berubah. Muat ulang jadwal.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Konfirmasi clock in', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toHaveCount(0);
  await expect(page.getByText('Clock in berhasil dicatat. Selamat bekerja!', { exact: true })).toHaveCount(0);
  expect(mock.clockIns).toHaveLength(1);
});

test('validated login opens the account shell before operational hydration without presenting empty data as final', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|RESPONSIVE-LOGIN-01|validated account reaches greeting and explicit workspace loading while operational reads are held; route actions wait for complete hydration' });
  const mock = await setup(page, { holdWorkspaceReads: true, skipLogin: true });
  try {
    await page.goto('/login');
    await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000032');
    await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-Selfie-Password');
    await page.getByRole('button', { name: 'Masuk', exact: false }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.account strong')).toHaveText('Kasir Selfie Uji');
    await expect(page.getByRole('heading', { name: 'Halo, Kasir 👋', exact: true })).toBeVisible();
    await expect.poll(() => mock.workspaceReadPending).toBe(true);
    await expect(page.locator('.workspace-loading')).toBeVisible();
    await expect(page.getByText('Menyiapkan data ruang kerja…', { exact: true })).toBeVisible();
    await expect(page.getByText('Belum ada pengajuan', { exact: true })).toHaveCount(0);
    await expect(page.locator('.metrics')).toHaveCount(0);
    // Navigating inside the verified shell cannot expose an attendance action
    // backed by incomplete assignment/session data.
    await page.locator('aside nav a[href="/attendance"]').click();
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.locator('.workspace-loading')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toHaveCount(0);
    mock.releaseWorkspace();
    await expect(page.locator('.workspace-loading')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toBeVisible();
  } finally { mock.releaseWorkspace(); }
});
