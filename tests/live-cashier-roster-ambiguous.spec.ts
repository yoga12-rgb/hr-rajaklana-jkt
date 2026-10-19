import { expect, test, type Route } from '@playwright/test';

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

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('live UI reconciles a committed weekly roster when the save response is lost', async ({ page }) => {
  const savedAssignments: Record<string, unknown>[] = [];
  let saveCalls = 0;
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
    if (path === '/functions/v1/hr-api') {
      await respond(route, { session });
      return;
    }
    if (path === '/auth/v1/user') {
      await respond(route, authUser);
      return;
    }
    if (path === '/auth/v1/token') {
      await respond(route, { ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      return;
    }
    if (path === '/rest/v1/rpc/cashier_roster_batch_save') {
      saveCalls += 1;
      const payload = route.request().postDataJSON() as { p_idempotency_key: string; p_changes: Record<string, unknown>[] };
      const savedAt = new Date().toISOString();
      for (const change of payload.p_changes) {
        const row = {
          id: change.id ?? `assignment-${saveCalls}-${savedAssignments.length + 1}`,
          employee_id: change.employee_id,
          work_date: change.work_date,
          outlet_id: change.outlet_id,
          shift: change.shift,
          status: change.cancel ? 'cancelled' : 'active',
          reason: change.reason,
          created_by: adminId,
          created_at: savedAt,
          updated_at: savedAt
        };
        const existingIndex = savedAssignments.findIndex(item => item.employee_id === row.employee_id && item.work_date === row.work_date);
        if (existingIndex < 0) savedAssignments.push(row);
        else savedAssignments[existingIndex] = row;
      }
      // Model a successful database commit followed by a dropped HTTP response.
      await route.abort('internetdisconnected');
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const result = path.endsWith('/employee_directory') ? [] : path.endsWith('/leave_balance') ? { remaining: 12, expired: false } : [];
      await respond(route, result);
      return;
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const rows = table === 'cashier_assignments' ? savedAssignments : tables[table] ?? [];
      await respond(route, rows);
      return;
    }
    await route.continue();
  });

  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill('RK000001');
  await page.getByLabel('Kata sandi').fill('Simulasi-Uji-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const weekStart = nextMonday();
  await page.goto(`/assignments?week=${weekStart}`);
  await expect(page.getByRole('heading', { name: 'Jadwal mingguan', exact: true })).toBeVisible();
  const shift = page.locator('select[aria-label^="Shift Kasir Uji,"]').first();
  await expect(shift).toBeVisible();
  await shift.selectOption('morning');
  await page.getByLabel('Alasan perubahan batch').fill('Simulasi respons hilang setelah commit');
  await page.getByRole('button', { name: 'Simpan jadwal mingguan', exact: true }).click();

  await expect(page.getByText('Semua perubahan sudah terlihat pada jadwal dan draft telah disinkronkan.', { exact: true })).toBeVisible();
  await expect(page.getByText('0 perubahan', { exact: true })).toBeVisible();
  await expect(shift).toHaveValue('morning');
  expect(saveCalls).toBe(1);
  expect(savedAssignments).toHaveLength(1);
  expect(savedAssignments[0]).toMatchObject({ employee_id: cashierId, work_date: weekStart, outlet_id: outletId, shift: 'morning', status: 'active' });
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rajaklana-hr-roster-draft-v1:')))).toEqual([]);
});
