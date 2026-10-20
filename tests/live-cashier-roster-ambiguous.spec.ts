import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const adminId = 'hr-admin-test';
const adminAuthId = 'auth-admin-test';
const cashierId = 'cashier-test';
const outletId = 'outlet-test';

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.simulated-signature`;
}

function nextMonday() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

async function respond(route: Route, data: unknown, status = 200) {
  const rows = Array.isArray(data) ? data : null;
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: rows ? { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } : {},
    body: JSON.stringify(data)
  });
}

async function openRosterMock(page: Page, loseResponse = false, failReconciliationRead = false, commitBeforeLoss = true) {
  const savedAssignments: Record<string, unknown>[] = [];
  const rpcPayloads: Record<string, unknown>[] = [];
  const committed = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
  let saveCalls = 0;
  let commitCount = 0;
  let loseNextRpcResponse = loseResponse;
  let failNextAssignmentRead = false;
  const now = new Date().toISOString();
  const authUser = {
    id: adminAuthId, aud: 'authenticated', role: 'authenticated', email: 'admin@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now
  };
  const session = {
    access_token: jwt({ sub: adminAuthId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'simulated-refresh-token', token_type: 'bearer', expires_in: 3600, user: authUser
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [
      { id: adminId, employee_number: 'RK000001', full_name: 'Admin HR Uji', whatsapp: '081200000001', department_id: 'department-test', position_id: 'position-admin', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: adminAuthId },
      { id: cashierId, employee_number: 'RK000002', full_name: 'Kasir Uji', whatsapp: '081200000002', department_id: 'department-test', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', can_middle_shift: true, weekly_off_days: [] }
    ],
    employee_roles: [{ employee_id: adminId, role: 'admin_hr' }],
    departments: [{ id: 'department-test', name: 'Operasional', code: 'OPS', active: true }],
    positions: [
      { id: 'position-admin', name: 'Admin HR', department_id: 'department-test', active: true, is_cashier: false },
      { id: 'position-cashier', name: 'Kasir', department_id: 'department-test', active: true, is_cashier: true }
    ],
    outlets: [{ id: outletId, code: 'UJI', name: 'Outlet Uji', address: 'Jakarta', active: true, production_location: false, latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5, max_accuracy_m: 100 }],
    leave_requests: [], leave_adjustments: [], attendance: [], leave_ledger: [], notifications: [],
    attendance_correction_requests: [], staffing_requirements: [], spv_followups: [], audit_events: []
  };

  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, authUser); return; }
    if (path === '/auth/v1/token') { await respond(route, { ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }); return; }
    if (path === '/rest/v1/rpc/cashier_roster_batch_save') {
      const payload = route.request().postDataJSON() as { p_idempotency_key: string; p_week_start: string; p_changes: Record<string, unknown>[] };
      rpcPayloads.push(structuredClone(payload));
      const fingerprint = JSON.stringify({ weekStart: payload.p_week_start, changes: payload.p_changes });
      const previous = committed.get(payload.p_idempotency_key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) { await respond(route, { code: 'P0001', message: 'Kunci batch sudah dipakai untuk perubahan jadwal lain' }, 400); return; }
        await respond(route, previous.result);
        return;
      }
      saveCalls += 1;
      if (loseNextRpcResponse && !commitBeforeLoss) {
        // The server never committed this attempt. Its retry must reuse the
        // same key and body, then create exactly one server batch.
        loseNextRpcResponse = false;
        failNextAssignmentRead = failReconciliationRead;
        await route.abort('internetdisconnected');
        return;
      }
      commitCount += 1;
      const assignments = payload.p_changes.map((change, index) => {
        const row = {
          id: change.id ?? `assignment-${commitCount}-${index + 1}`,
          employee_id: change.employee_id, work_date: change.work_date, outlet_id: change.outlet_id,
          shift: change.shift, status: change.cancel ? 'cancelled' : 'active', reason: change.reason,
          created_by: adminId, created_at: now, updated_at: new Date(Date.now() + commitCount * 1000).toISOString()
        };
        const existingIndex = savedAssignments.findIndex(item => item.employee_id === row.employee_id && item.work_date === row.work_date);
        if (existingIndex < 0) savedAssignments.push(row);
        else savedAssignments[existingIndex] = row;
        return row;
      });
      const result = { batch_id: `batch-${commitCount}`, week_start: payload.p_week_start, saved_count: assignments.length, assignments };
      committed.set(payload.p_idempotency_key, { fingerprint, result });
      if (loseNextRpcResponse) {
        // Model commit success followed by a dropped HTTP response. One variant
        // also makes the immediate reconciliation read fail, forcing recovery
        // through local persistence, page reload and exact idempotent replay.
        loseNextRpcResponse = false;
        failNextAssignmentRead = failReconciliationRead;
        await route.abort('internetdisconnected');
        return;
      }
      await respond(route, result);
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const result = path.endsWith('/employee_directory') ? [] : path.endsWith('/leave_balance') ? { remaining: 12, expired: false } : [];
      await respond(route, result); return;
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      if (table === 'cashier_assignments' && failNextAssignmentRead) {
        failNextAssignmentRead = false;
        await respond(route, { code: 'MOCK_REFRESH_FAILED', message: 'Simulasi refresh gagal setelah commit ambigu.' }, 503);
        return;
      }
      await respond(route, table === 'cashier_assignments' ? savedAssignments : tables[table] ?? []);
      return;
    }
    await route.continue();
  });

  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill('RK000001');
  await page.getByLabel('Kata sandi').fill('Simulasi-Uji-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Penugasan harian', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jadwal kasir', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mingguan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jadwal mingguan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minggu berikutnya', exact: true }).click();
  const weekStart = nextMonday();
  const shift = page.locator('select[aria-label^="Shift Kasir Uji,"]').first();
  await expect(shift).toBeVisible();
  return { weekStart, shift, savedAssignments, rpcPayloads, getSaveCalls: () => saveCalls, getCommitCount: () => commitCount };
}

async function reopenNextWeekAfterReload(page: Page) {
  // Auth is preserved, while a hard reload restarts the SPA on its dashboard.
  // Reopen the same next-week planner through the real navigation so the
  // account-scoped local draft is restored from storage.
  await expect(page.getByRole('heading', { name: /Halo, Admin/ })).toBeVisible();
  await page.getByRole('link', { name: 'Penugasan harian', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jadwal kasir', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jadwal mingguan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minggu berikutnya', exact: true }).click();
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('live UI reconciles a committed weekly roster when the save response is lost', async ({ page }) => {
  const mock = await openRosterMock(page, true, false);
  await mock.shift.selectOption('morning');
  await page.getByLabel('Alasan perubahan batch').fill('Simulasi respons hilang setelah commit');
  await page.getByRole('button', { name: 'Simpan jadwal mingguan', exact: true }).click();

  await expect(page.getByText('Semua perubahan sudah terlihat pada jadwal dan draft telah disinkronkan.', { exact: true })).toBeVisible();
  await expect(page.getByText('0 perubahan draft', { exact: true })).toBeVisible();
  await expect(mock.shift).toHaveValue('morning');
  expect(mock.getSaveCalls()).toBe(1);
  expect(mock.getCommitCount()).toBe(1);
  expect(mock.rpcPayloads).toHaveLength(1);
  expect(mock.savedAssignments).toHaveLength(1);
  expect(mock.savedAssignments[0]).toMatchObject({ employee_id: cashierId, work_date: mock.weekStart, outlet_id: outletId, shift: 'morning', status: 'active' });
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rajaklana-hr-roster-draft-v1:')))).toEqual([]);
});

test('live UI persists and replays the original payload/key after reload when reconciliation failed', async ({ page }) => {
  const mock = await openRosterMock(page, true, true);
  await mock.shift.selectOption('morning');
  await page.getByLabel('Alasan perubahan batch').fill('Commit berhasil tetapi respons dan refresh hilang');
  await page.getByRole('button', { name: 'Simpan jadwal mingguan', exact: true }).click();
  await expect(page.getByText('Ada percobaan simpan sebelumnya yang belum dipastikan', { exact: true })).toBeVisible();
  expect(mock.getSaveCalls()).toBe(1);
  expect(mock.getCommitCount()).toBe(1);
  expect(mock.rpcPayloads).toHaveLength(1);
  const originalRequest = structuredClone(mock.rpcPayloads[0]);
  expect(mock.savedAssignments).toHaveLength(1);

  await page.reload();
  await reopenNextWeekAfterReload(page);
  await expect(mock.shift).toHaveValue('morning');
  await expect(page.getByText('Ada percobaan simpan sebelumnya yang belum dipastikan', { exact: true })).toBeVisible();

  // A second SPV changes the committed source while the original attempt is
  // still pending locally. Exact replay must confirm the original transaction
  // without writing its older value over this newer assignment.
  mock.savedAssignments[0].shift = 'middle';
  mock.savedAssignments[0].updated_at = new Date(Date.now() + 9000).toISOString();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.review-cell')).toContainText('Jadwal terbaru: Middle · Outlet Uji');
  await page.getByRole('button', { name: 'Ulangi percobaan simpan sebelumnya', exact: true }).click();

  await expect(page.getByText(/perubahan jadwal tersimpan bersama\./i)).toBeVisible();
  await expect(mock.shift).toHaveValue('middle');
  await expect(page.getByText('0 perubahan draft', { exact: true })).toBeVisible();
  expect(mock.getSaveCalls()).toBe(1);
  expect(mock.rpcPayloads).toHaveLength(2);
  expect(mock.rpcPayloads[1]).toEqual(originalRequest);
  expect(mock.savedAssignments).toHaveLength(1);
  expect(mock.savedAssignments[0].shift).toBe('middle');
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rajaklana-hr-roster-draft-v1:')))).toEqual([]);
});

test('live UI retries an uncommitted ambiguous attempt once with its persisted original key and payload', async ({ page }) => {
  const mock = await openRosterMock(page, true, true, false);
  await mock.shift.selectOption('morning');
  await page.getByLabel('Alasan perubahan batch').fill('Percobaan pertama belum commit di server');
  await page.getByRole('button', { name: 'Simpan jadwal mingguan', exact: true }).click();
  await expect(page.getByText('Ada percobaan simpan sebelumnya yang belum dipastikan', { exact: true })).toBeVisible();
  expect(mock.getCommitCount()).toBe(0);
  expect(mock.savedAssignments).toHaveLength(0);
  const originalRequest = structuredClone(mock.rpcPayloads[0]);

  await page.reload();
  await reopenNextWeekAfterReload(page);
  await expect(page.getByText('Ada percobaan simpan sebelumnya yang belum dipastikan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ulangi percobaan simpan sebelumnya', exact: true }).click();

  await expect(page.getByText('1 perubahan jadwal tersimpan bersama.', { exact: true })).toBeVisible();
  expect(mock.rpcPayloads).toHaveLength(2);
  expect(mock.rpcPayloads[1]).toEqual(originalRequest);
  expect(mock.getCommitCount()).toBe(1);
  expect(mock.savedAssignments).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rajaklana-hr-roster-draft-v1:')))).toEqual([]);
});

test('live UI shows conflict review as soon as a source store refresh arrives', async ({ page }) => {
  const mock = await openRosterMock(page);
  await mock.shift.selectOption('afternoon');
  const secondShift = page.locator('select[aria-label^="Shift Kasir Uji,"]').nth(1);
  await secondShift.selectOption('morning');
  await page.getByLabel('Alasan perubahan batch').fill('Draft sore untuk uji konflik realtime');

  const updatedAt = new Date(Date.now() + 5000).toISOString();
  const nextDate = new Date(`${mock.weekStart}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const secondDate = nextDate.toISOString().slice(0, 10);
  mock.savedAssignments.push(
    { id: 'assignment-from-another-session-1', employee_id: cashierId, work_date: mock.weekStart,
      outlet_id: outletId, shift: 'middle', status: 'active', reason: 'Diperbarui SPV lain', created_by: adminId,
      created_at: updatedAt, updated_at: updatedAt },
    { id: 'assignment-from-another-session-2', employee_id: cashierId, work_date: secondDate,
      outlet_id: outletId, shift: 'morning', status: 'active', reason: 'Diperbarui SPV lain', created_by: adminId,
      created_at: updatedAt, updated_at: updatedAt }
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  let reviews = page.locator('.review-cell');
  await expect(reviews).toHaveCount(2);
  await expect(reviews.nth(0)).toContainText('Draft Anda: Sore · Outlet Uji');
  await expect(reviews.nth(0)).toContainText('Jadwal terbaru: Middle · Outlet Uji');
  await expect(reviews.nth(1)).toContainText('Draft Anda: Pagi · Outlet Uji');
  await expect(reviews.nth(1)).toContainText('Jadwal terbaru: Pagi · Outlet Uji');
  await expect(page.getByRole('button', { name: 'Gunakan jadwal terbaru', exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Terapkan kembali draft saya', exact: true })).toHaveCount(2);
  await expect(page.getByText('2 konflik harus ditinjau', { exact: true })).toBeVisible();

  mock.savedAssignments[0].shift = 'off';
  mock.savedAssignments[0].updated_at = new Date(Date.now() + 7000).toISOString();
  mock.savedAssignments[1].status = 'cancelled';
  mock.savedAssignments[1].updated_at = new Date(Date.now() + 8000).toISOString();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(reviews.nth(0)).toContainText('Jadwal terbaru: Libur · Outlet Uji');
  await expect(reviews.nth(1)).toContainText('Jadwal terbaru: Dibatalkan · Pagi');

  await reviews.nth(0).getByRole('button', { name: 'Gunakan jadwal terbaru', exact: true }).click();
  reviews = page.locator('.review-cell');
  await expect(reviews).toHaveCount(1);
  await expect(reviews.first()).toContainText('Jadwal terbaru: Dibatalkan · Pagi');
  await expect(page.getByText('1 konflik harus ditinjau', { exact: true })).toBeVisible();
  await reviews.first().getByRole('button', { name: 'Terapkan kembali draft saya', exact: true }).click();
  await expect(page.locator('.review-cell')).toHaveCount(0);
  await expect(page.getByText('0 konflik harus ditinjau', { exact: true })).toBeHidden();
  expect(mock.getSaveCalls()).toBe(0);
});
