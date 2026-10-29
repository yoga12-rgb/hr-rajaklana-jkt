import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const adminId = 'hr-admin-followup';
const adminAuthId = 'auth-admin-followup';
const outletId = 'outlet-followup';
const caseId = 'followup-old-case';

type UpdatePayload = {
  p_id: string;
  p_expected_revision: number;
  p_idempotency_key: string;
  p_status: 'new' | 'in_progress' | 'completed';
  p_owner_id: string | null;
  p_note: string;
  p_resolution_note: string;
  p_due_at: string | null;
  p_reason: string;
};

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.simulated-signature`;
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

async function openFollowupMock(page: Page) {
  const now = new Date().toISOString();
  const authUser = {
    id: adminAuthId, aud: 'authenticated', role: 'authenticated', email: 'followup@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now
  };
  const session = {
    access_token: jwt({ sub: adminAuthId, aud: 'authenticated', role: 'authenticated', aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'simulated-followup-refresh', token_type: 'bearer', expires_in: 3600, user: authUser
  };
  let followup: Record<string, unknown> = {
    id: caseId, case_key: 'missing_clockin:assignment-old', issue_type: 'missing_clockin', source_type: 'assignment', source_id: 'assignment-old',
    work_date: '2026-10-20', outlet_id: outletId, employee_id: 'cashier-followup', shift: 'morning', owner_id: null, status: 'new',
    note: '', resolution_note: '', created_by: adminId, updated_by: adminId, created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z', reopened_count: 0, revision: 1, due_at: null
  };
  const requests: UpdatePayload[] = [];
  const receipts = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
  let commitCount = 0;
  let loseNextCommittedResponse = true;
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [
      { id: adminId, employee_number: 'RK000001', full_name: 'Admin Follow-up', whatsapp: '081200000001', department_id: 'department-followup', position_id: 'position-admin', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: adminAuthId },
      { id: 'cashier-followup', employee_number: 'RK000002', full_name: 'Kasir Lama', whatsapp: '081200000002', department_id: 'department-followup', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', weekly_off_days: [] }
    ],
    employee_roles: [{ employee_id: adminId, role: 'admin_hr' }],
    departments: [{ id: 'department-followup', name: 'Operasional', code: 'OPS', active: true }],
    positions: [{ id: 'position-admin', name: 'Admin HR', department_id: 'department-followup', active: true, is_cashier: false },
      { id: 'position-cashier', name: 'Kasir', department_id: 'department-followup', active: true, is_cashier: true }],
    outlets: [{ id: outletId, code: 'UJI', name: 'Outlet Uji', address: 'Jakarta', active: true, production_location: false,
      latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5, max_accuracy_m: 200 }],
    leave_requests: [], leave_adjustments: [], attendance: [], leave_ledger: [], notifications: [], cashier_assignments: [],
    attendance_correction_requests: [], staffing_requirements: [], audit_events: []
  };

  await page.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, authUser); return; }
    if (path === '/auth/v1/token') { await respond(route, { ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: adminId, requires_mfa: true, current_level: 'aal2', allowed: true, reason: null }); return; }
    if (path === '/rest/v1/rpc/spv_followup_page') {
      await respond(route, { items: [structuredClone(followup)], total: 1, has_more: false, next_cursor: null, as_of: new Date().toISOString() });
      return;
    }
    if (path === '/rest/v1/rpc/spv_followup_update_v2') {
      const payload = route.request().postDataJSON() as UpdatePayload;
      requests.push(structuredClone(payload));
      const fingerprint = JSON.stringify(payload);
      const receipt = receipts.get(payload.p_idempotency_key);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          await respond(route, { code: 'P0001', message: 'Kunci tindak lanjut sudah dipakai untuk perubahan lain' }, 400);
          return;
        }
        await respond(route, structuredClone(receipt.result));
        return;
      }
      if (payload.p_expected_revision !== Number(followup.revision)) {
        await respond(route, { code: '40001', message: 'Tindak lanjut berubah sejak dibuka. Tinjau nilai terbaru sebelum menyimpan.' }, 409);
        return;
      }
      commitCount += 1;
      followup = {
        ...followup, owner_id: payload.p_owner_id, status: payload.p_status, note: payload.p_note.trim(),
        resolution_note: payload.p_status === 'completed' ? payload.p_resolution_note.trim() : '', due_at: payload.p_due_at,
        updated_by: adminId, updated_at: new Date().toISOString(), revision: Number(followup.revision) + 1
      };
      receipts.set(payload.p_idempotency_key, { fingerprint, result: structuredClone(followup) });
      if (loseNextCommittedResponse) {
        loseNextCommittedResponse = false;
        await route.abort('internetdisconnected');
        return;
      }
      await respond(route, structuredClone(followup));
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      await respond(route, path.endsWith('/leave_balance') ? { remaining: 12, expired: false } : []);
      return;
    }
    if (path.startsWith('/rest/v1/')) {
      await respond(route, tables[path.slice('/rest/v1/'.length)] ?? []);
      return;
    }
    await route.continue();
  });

  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill('RK000001');
  await page.getByLabel('Kata sandi').fill('Simulasi-Uji-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/supervisor?case=${caseId}`);
  await expect(page.getByRole('heading', { name: 'Tindak lanjut operasional' })).toBeVisible();
  await expect(page.getByText('KASUS missing_clockin:assignment-old')).toBeVisible();

  return {
    requests,
    commits: () => commitCount,
    externalUpdate: (note: string) => {
      followup = { ...followup, note, revision: Number(followup.revision) + 1, updated_at: new Date().toISOString() };
    }
  };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('follow-up survives committed response loss, reload and exact retry, then reviews a stale conflict', async ({ page }) => {
  const mock = await openFollowupMock(page);
  const note = page.getByLabel('Catatan tindak lanjut');
  await note.fill('Hubungi kasir untuk konfirmasi');
  await page.getByRole('button', { name: 'Simpan dengan pemeriksaan revisi' }).click();
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();
  expect(mock.commits()).toBe(1);

  await page.reload();
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();
  await page.getByRole('button', { name: 'Coba lagi permintaan yang sama' }).click();
  await expect(page.getByText('Tindak lanjut tersimpan. Revisi server dan riwayat telah diperbarui.')).toBeVisible();
  expect(mock.commits()).toBe(1);
  expect(mock.requests).toHaveLength(2);
  expect(mock.requests[1]).toEqual(mock.requests[0]);

  mock.externalUpdate('Catatan dari SPV lain');
  await page.getByLabel('Catatan tindak lanjut').fill('Draft lokal sesudah replay');
  await page.getByRole('button', { name: 'Simpan dengan pemeriksaan revisi' }).click();
  await expect(page.getByText('Data berubah di sesi lain')).toBeVisible();
  await expect(page.getByLabel('Catatan tindak lanjut')).toHaveValue('Draft lokal sesudah replay');
  await page.getByRole('button', { name: 'Pertahankan draft & pakai revisi terbaru' }).click();
  await page.getByRole('button', { name: 'Simpan dengan pemeriksaan revisi' }).click();
  await expect(page.getByText('Tindak lanjut tersimpan. Revisi server dan riwayat telah diperbarui.')).toBeVisible();
  expect(mock.commits()).toBe(2);
  expect(mock.requests.at(-1)?.p_expected_revision).toBe(3);
  expect(mock.requests.at(-1)?.p_idempotency_key).not.toBe(mock.requests[0].p_idempotency_key);
});
