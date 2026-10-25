import { expect, test, type Page, type Route } from '@playwright/test';

// This suite deliberately uses the live Supabase client against an intercepted
// PostgREST surface.  It is not a demo-mode test: the UI has to survive the
// same ambiguous HTTP boundary that Preview uses, then replay the persisted
// idempotency key and payload after a hard reload.
const backend = 'http://127.0.0.1:54329';
const adminId = 'hr-admin-operations-planning';
const adminAuthId = 'auth-admin-operations-planning';
const cashierId = 'cashier-operations-planning';
const outletId = 'outlet-operations-planning';
const categoryId = 'category-operations-planning';

type IssuePayload = {
  p_outlet_id: string;
  p_category_id: string;
  p_description: string;
  p_urgency: string;
  p_photo_path: string | null;
  p_reporter_employee_id: string | null;
  p_idempotency_key: string;
};

type RequirementPayload = {
  p_id: string | null;
  p_expected_revision: number | null;
  p_idempotency_key: string;
  p_outlet_id: string;
  p_weekday: number;
  p_starts_at: string;
  p_ends_at: string;
  p_minimum: number;
  p_effective_from: string;
  p_effective_until: string | null;
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

function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

async function signIn(page: Page, destination: string) {
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill('RK000001');
  await page.getByLabel('Kata sandi').fill('Simulasi-Uji-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(destination);
}

async function openSupervisorMock(page: Page) {
  const now = new Date().toISOString();
  const workDate = localDate();
  const authUser = {
    id: adminAuthId, aud: 'authenticated', role: 'authenticated', email: 'supervisor-live-mock@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now
  };
  const session = {
    access_token: jwt({ sub: adminAuthId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'simulated-supervisor-live-mock-refresh', token_type: 'bearer', expires_in: 3600, user: authUser
  };
  const category = { id: categoryId, code: 'perangkat_kasir', name: 'Perangkat kasir', active: true, created_by: adminId, created_at: now, updated_at: now };
  const issueRequests: IssuePayload[] = [];
  const requirementRequests: RequirementPayload[] = [];
  const issueReceipts = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
  const requirementReceipts = new Map<string, { fingerprint: string; result: Record<string, unknown> }>();
  const issues: Record<string, unknown>[] = [];
  const requirements: Record<string, unknown>[] = [];
  let issueCommits = 0;
  let requirementCommits = 0;
  let loseIssueResponse = true;
  let loseRequirementResponse = true;

  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [
      { id: adminId, employee_number: 'RK000001', full_name: 'Admin Supervisor', whatsapp: '081200000001', department_id: 'department-supervisor', position_id: 'position-admin', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: adminAuthId, weekly_off_days: [] },
      { id: cashierId, employee_number: 'RK000002', full_name: 'Kasir Supervisor', whatsapp: '081200000002', department_id: 'department-supervisor', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', weekly_off_days: [], can_middle_shift: true }
    ],
    employee_roles: [{ employee_id: adminId, role: 'admin_hr' }],
    departments: [{ id: 'department-supervisor', name: 'Operasional', code: 'OPS', active: true }],
    positions: [
      { id: 'position-admin', name: 'Admin HR', department_id: 'department-supervisor', active: true, is_cashier: false },
      { id: 'position-cashier', name: 'Kasir', department_id: 'department-supervisor', active: true, is_cashier: true }
    ],
    outlets: [{ id: outletId, code: 'UJI-SPV', name: 'Outlet Supervisor Uji', address: 'Jakarta', active: true, production_location: false,
      latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5, max_accuracy_m: 200 }],
    leave_requests: [], leave_adjustments: [], attendance: [], leave_ledger: [], notifications: [], cashier_assignments: [],
    attendance_correction_requests: [], staffing_requirements: [], audit_events: [],
    supervisor_capabilities: [{ id: 'capability-configure', employee_id: adminId, capability: 'coverage_configure', outlet_id: outletId, category_id: null, granted_by: adminId, created_at: now }]
  };

  await page.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, authUser); return; }
    if (path === '/auth/v1/token') { await respond(route, { ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }); return; }

    if (path === '/rest/v1/rpc/employee_directory') { await respond(route, []); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { remaining: 12, expired: false }); return; }
    if (path === '/rest/v1/rpc/spv_followup_page') { await respond(route, { items: [], total: 0, has_more: false, next_cursor: null, as_of: now }); return; }
    if (path === '/rest/v1/rpc/supervisor_issue_category_page') { await respond(route, { items: [category] }); return; }
    if (path === '/rest/v1/rpc/supervisor_operation_configuration_page') {
      await respond(route, { categories: [category], routes: [], capabilities: [], as_of: now }); return;
    }
    if (path === '/rest/v1/rpc/outlet_issue_page') {
      await respond(route, { items: structuredClone(issues), total: issues.length, has_more: false, next_cursor: null, as_of: new Date().toISOString(), categories: [category] }); return;
    }
    if (path === '/rest/v1/rpc/shift_handover_page' || path === '/rest/v1/rpc/shift_exchange_page') {
      await respond(route, { items: [], total: 0, has_more: false, next_cursor: null, as_of: now }); return;
    }
    if (path === '/rest/v1/rpc/outlet_issue_submit') {
      const payload = route.request().postDataJSON() as IssuePayload;
      issueRequests.push(structuredClone(payload));
      const fingerprint = JSON.stringify(payload);
      const receipt = issueReceipts.get(payload.p_idempotency_key);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) { await respond(route, { code: 'P0001', message: 'Key laporan sudah dipakai untuk payload lain.' }, 400); return; }
        await respond(route, structuredClone(receipt.result)); return;
      }
      issueCommits += 1;
      const result = {
        id: `issue-${issueCommits}`, issue_number: issueCommits, outlet_id: payload.p_outlet_id, reporter_employee_id: payload.p_reporter_employee_id ?? adminId,
        created_by: adminId, category_id: payload.p_category_id, category_name_snapshot: category.name, routed_to_snapshot: null, owner_id: null,
        urgency: payload.p_urgency, description: payload.p_description, photo_path: payload.p_photo_path, status: 'new', due_at: null, resolution_note: '', revision: 1,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null
      };
      issues.push(result); issueReceipts.set(payload.p_idempotency_key, { fingerprint, result: structuredClone(result) });
      if (loseIssueResponse) { loseIssueResponse = false; await route.abort('internetdisconnected'); return; }
      await respond(route, structuredClone(result)); return;
    }
    if (path === '/rest/v1/rpc/supervisor_interval_coverage') {
      await respond(route, { outlet_id: outletId, work_date: workDate, as_of: new Date().toISOString(), configured: requirements.length > 0,
        coverage: [], unknown_middle_count: 0, unknown_middle_employee_ids: [], legacy_shift_requirements: [] }); return;
    }
    if (path === '/rest/v1/rpc/staffing_interval_requirement_save_v2') {
      const payload = route.request().postDataJSON() as RequirementPayload;
      requirementRequests.push(structuredClone(payload));
      const fingerprint = JSON.stringify(payload);
      const receipt = requirementReceipts.get(payload.p_idempotency_key);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) { await respond(route, { code: 'P0001', message: 'Key kebutuhan sudah dipakai untuk payload lain.' }, 400); return; }
        await respond(route, structuredClone(receipt.result)); return;
      }
      const existing = payload.p_id ? requirements.find(row => row.id === payload.p_id) : null;
      if (existing && Number(existing.revision) !== payload.p_expected_revision) {
        await respond(route, { code: '40001', message: 'Kebutuhan interval berubah sejak dibuka. Tinjau nilai terbaru sebelum menyimpan.' }, 409); return;
      }
      requirementCommits += 1;
      const result = {
        id: existing?.id ?? `interval-${requirementCommits}`, outlet_id: payload.p_outlet_id, weekday: payload.p_weekday, starts_at: payload.p_starts_at,
        ends_at: payload.p_ends_at, minimum: payload.p_minimum, effective_from: payload.p_effective_from, effective_until: payload.p_effective_until,
        revision: existing ? Number(existing.revision) + 1 : 1, created_by: adminId, created_at: existing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString()
      };
      if (existing) Object.assign(existing, result); else requirements.push(result);
      requirementReceipts.set(payload.p_idempotency_key, { fingerprint, result: structuredClone(result) });
      if (loseRequirementResponse) { loseRequirementResponse = false; await route.abort('internetdisconnected'); return; }
      await respond(route, structuredClone(result)); return;
    }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      if (table === 'staffing_interval_requirements') { await respond(route, structuredClone(requirements)); return; }
      await respond(route, tables[table] ?? []); return;
    }
    await route.continue();
  });

  return {
    issueRequests,
    requirementRequests,
    issueCommits: () => issueCommits,
    requirementCommits: () => requirementCommits,
    requirements,
    bumpRequirement() {
      const row = requirements[0];
      if (!row) throw new Error('Fixture requirement must exist before its revision is bumped.');
      row.revision = Number(row.revision) + 1;
      row.minimum = Number(row.minimum) + 1;
      row.updated_at = new Date(Date.now() + 10_000).toISOString();
    }
  };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('Operations replays one committed issue after response loss and a reload', async ({ page }) => {
  const mock = await openSupervisorMock(page);
  await signIn(page, '/operations');
  await expect(page.getByRole('heading', { name: 'Operasi outlet', exact: true })).toBeVisible();
  await page.getByLabel('Kategori aktif').selectOption(categoryId);
  await page.getByLabel('Uraian kendala').fill('Printer struk berhenti mencetak pada kasir utama.');
  await page.getByRole('button', { name: 'Kirim laporan kendala', exact: true }).click();

  await expect(page.getByText('Laporan sebelumnya belum mempunyai hasil pasti', { exact: false })).toBeVisible();
  expect(mock.issueCommits()).toBe(1);
  expect(mock.issueRequests).toHaveLength(1);
  const original = structuredClone(mock.issueRequests[0]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operasi outlet', exact: true })).toBeVisible();
  await expect(page.getByText('Laporan sebelumnya belum mempunyai hasil pasti', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Coba lagi laporan yang sama', exact: true }).click();

  // A successful mutation refreshes the shared live state, which may replace
  // a transient feedback toast.  The durable queue row and cleared recovery
  // are the stable proof that the receipt was accepted.
  await expect(page.getByText('Printer struk berhenti mencetak pada kasir utama.', { exact: true })).toBeVisible();
  await expect(page.getByText('Laporan sebelumnya belum mempunyai hasil pasti', { exact: false })).toHaveCount(0);
  expect(mock.issueCommits()).toBe(1);
  expect(mock.issueRequests).toHaveLength(2);
  expect(mock.issueRequests[1]).toEqual(original);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.includes(':operations:') && key.includes(':issue-submit:')))).toEqual([]);
});

test('Planning restores an ambiguous interval request, retries its exact body, then preserves an edit during an external refresh conflict', async ({ page }) => {
  const mock = await openSupervisorMock(page);
  await signIn(page, '/planning');
  await expect(page.getByRole('heading', { name: 'Perencanaan & ringkasan', exact: true })).toBeVisible();
  await page.getByLabel('Minimum kasir').fill('2');
  await page.getByLabel('Alasan perubahan').fill('Kebutuhan layanan outlet meningkat.');
  await page.getByRole('button', { name: 'Simpan kebutuhan', exact: true }).click();

  await expect(page.getByText('Permintaan belum memiliki hasil pasti.', { exact: true })).toBeVisible();
  expect(mock.requirementCommits()).toBe(1);
  expect(mock.requirementRequests).toHaveLength(1);
  const original = structuredClone(mock.requirementRequests[0]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Perencanaan & ringkasan', exact: true })).toBeVisible();
  await expect(page.getByText('Permintaan perencanaan sebelumnya belum memiliki hasil pasti.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Coba lagi permintaan yang sama', exact: true }).click();

  await expect(page.locator('.requirement-row').first()).toBeVisible();
  await expect(page.getByText('Permintaan belum memiliki hasil pasti.', { exact: true })).toHaveCount(0);
  expect(mock.requirementCommits()).toBe(1);
  expect(mock.requirementRequests).toHaveLength(2);
  expect(mock.requirementRequests[1]).toEqual(original);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('supervisor-planning-pending-v2')))).toEqual([]);

  await page.locator('.requirement-row').first().click();
  await page.getByLabel('Minimum kasir').fill('7');
  mock.bumpRequirement();
  // The app refreshes on focus in live mode.  A newer server revision must
  // never silently overwrite this still-local input.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Kebutuhan interval berubah di sesi lain', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Minimum kasir')).toHaveValue('7');
});
