import { expect, test, type Page, type Route } from '@playwright/test';

// This suite reproduces the production privacy boundary on purpose: a cashier
// session reads only its own employees row and its own roster rows, and
// employee_directory() has no account_status.  The swap picker therefore has to
// come from shift_exchange_peer_options instead of the local roster cache.
const backend = 'http://127.0.0.1:54329';
const cashierId = 'employee-exchange-cashier';
const cashierAuthId = 'auth-employee-exchange-cashier';
const peerId = 'employee-exchange-peer';
const outletId = 'outlet-exchange';
const selfAssignmentId = 'assignment-exchange-self';
const peerAssignmentId = 'assignment-exchange-peer';

type PeerOptionPayload = { p_requester_assignment_id: string };
type SubmitPayload = { p_request_type: string; p_requester_assignment_id: string; p_peer_employee_id: string; p_reason: string; p_idempotency_key: string };

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

function dayAfter(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function signIn(page: Page, employeeNumber: string) {
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan').fill(employeeNumber);
  await page.getByLabel('Kata sandi').fill('Simulasi-Uji-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function openExchangeMock(page: Page, options: { peerOptionsUnavailable?: boolean } = {}) {
  const now = new Date().toISOString();
  const workDate = dayAfter(2);
  const authUser = {
    id: cashierAuthId, aud: 'authenticated', role: 'authenticated', email: 'kasir-exchange-mock@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now
  };
  const session = {
    access_token: jwt({ sub: cashierAuthId, aud: 'authenticated', role: 'authenticated', aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'simulated-cashier-exchange-mock-refresh', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: authUser
  };
  const peerOptionRequests: PeerOptionPayload[] = [];
  const submitRequests: SubmitPayload[] = [];
  let submitted: Record<string, unknown> | null = null;

  // RLS simulation: the cashier's own profile and roster row are the only
  // private rows this session may read.
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [
      { id: cashierId, employee_number: 'RK000009', full_name: 'Kasir Uji Tukar', whatsapp: '081200000009', department_id: 'department-sales',
        position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active',
        auth_user_id: cashierAuthId, can_clock: true, can_middle_shift: false, weekly_off_days: [] }
    ],
    employee_roles: [{ employee_id: cashierId, role: 'employee' }],
    departments: [{ id: 'department-sales', name: 'Penjualan', code: 'PSD', active: true }],
    positions: [{ id: 'position-cashier', name: 'Kasir', department_id: 'department-sales', active: true, is_cashier: true }],
    outlets: [{ id: outletId, code: 'UJI-TKR', name: 'Outlet Uji Tukar', address: 'Jakarta', active: true, production_location: false,
      latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00',
      morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 0, max_accuracy_m: 100 }],
    leave_requests: [], leave_adjustments: [], attendance: [], leave_ledger: [], notifications: [],
    cashier_assignments: [
      { id: selfAssignmentId, employee_id: cashierId, work_date: workDate, outlet_id: outletId, shift: 'morning', status: 'active',
        reason: 'Jadwal pengusul untuk uji tukar', created_by: cashierId, created_at: now, updated_at: now }
    ],
    attendance_correction_requests: [], staffing_requirements: [], audit_events: [], supervisor_capabilities: []
  };

  await page.route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') { await respond(route, authUser); return; }
    if (path === '/auth/v1/token') { await respond(route, session); return; }
    if (path === '/rest/v1/rpc/auth_access_context') {
      await respond(route, { employee_id: cashierId, requires_mfa: false, current_level: 'aal2', allowed: true, reason: null }); return;
    }
    // Deliberately without account_status: the picker must not depend on it.
    if (path === '/rest/v1/rpc/employee_directory') {
      await respond(route, [
        { id: cashierId, employee_number: 'RK000009', full_name: 'Kasir Uji Tukar', department_id: 'department-sales',
          position_id: 'position-cashier', outlet_id: outletId, approver_employee_id: null, approval_mode: 'internal',
          status: 'active', can_clock: true, can_middle_shift: false },
        { id: peerId, employee_number: 'RK000010', full_name: 'Rekan Kasir', department_id: 'department-sales',
          position_id: 'position-cashier', outlet_id: outletId, approver_employee_id: null, approval_mode: 'internal',
          status: 'active', can_clock: true, can_middle_shift: false }
      ]); return;
    }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { remaining: 12, expired: false }); return; }
    if (path === '/rest/v1/rpc/supervisor_issue_category_page') { await respond(route, { items: [] }); return; }
    if (path === '/rest/v1/rpc/outlet_issue_page') {
      await respond(route, { items: [], total: 0, has_more: false, next_cursor: null, as_of: now, categories: [] }); return;
    }
    if (path === '/rest/v1/rpc/shift_handover_page' || path === '/rest/v1/rpc/shift_exchange_page') {
      await respond(route, { items: submitted ? [submitted] : [], total: submitted ? 1 : 0, has_more: false, next_cursor: null, as_of: now }); return;
    }
    if (path === '/rest/v1/rpc/shift_exchange_peer_options') {
      const payload = route.request().postDataJSON() as PeerOptionPayload;
      peerOptionRequests.push(structuredClone(payload));
      if (options.peerOptionsUnavailable) {
        await respond(route, { code: 'PGRST202', message: 'Could not find the function public.shift_exchange_peer_options with parameter p_requester_assignment_id in the schema cache.' }, 404);
        return;
      }
      await respond(route, [
        { employee_id: peerId, employee_number: 'RK000010', full_name: 'Rekan Kasir', assignment_id: peerAssignmentId,
          shift: 'afternoon', outlet_id: outletId, work_date: workDate, has_active_assignment: true, blocked_reason: null }
      ]); return;
    }
    if (path === '/rest/v1/rpc/shift_exchange_submit') {
      const payload = route.request().postDataJSON() as SubmitPayload;
      submitRequests.push(structuredClone(payload));
      submitted = {
        id: 'exchange-created-1', request_number: 1, request_type: payload.p_request_type, work_date: workDate,
        requester_employee_id: cashierId, peer_employee_id: payload.p_peer_employee_id,
        requester_assignment_id: payload.p_requester_assignment_id, peer_assignment_id: peerAssignmentId,
        requester_assignment_updated_at: now, peer_assignment_updated_at: now, reason: payload.p_reason,
        status: 'pending_peer', peer_note: '', decision_note: '', decided_by: null, revision: 1,
        created_at: now, updated_at: now, decided_at: null
      };
      await respond(route, structuredClone(submitted)); return;
    }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, []); return; }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      await respond(route, tables[table] ?? []); return;
    }
    await route.continue();
  });

  return { peerOptionRequests, submitRequests };
}

test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires the isolated Vite server configured for the Supabase mock.');

test('a cashier can pick a swap peer even though peer profiles and rosters stay private', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|EXCHANGE-PEERS|swap candidates and the peer assignment preview come from shift_exchange_peer_options, not the private roster cache' });
  const backendState = await openExchangeMock(page);
  await signIn(page, 'RK000009');
  await page.goto('/operations?exchange');
  await expect(page.getByRole('heading', { name: 'Tukar atau pengganti', exact: true })).toBeVisible();

  const requester = page.locator('.exchange-form form select').nth(1);
  await expect(requester.locator('option')).toHaveCount(2);
  await requester.selectOption(selfAssignmentId);

  const peers = page.locator('.exchange-form form select').nth(2);
  await expect(peers.locator('option')).toHaveCount(2);
  await expect(peers.locator('option').nth(1)).toHaveText('Rekan Kasir · RK000010');
  await expect.poll(() => backendState.peerOptionRequests.length).toBe(1);
  expect(backendState.peerOptionRequests[0]).toEqual({ p_requester_assignment_id: selfAssignmentId });

  await peers.selectOption(peerId);
  await expect(page.getByText(/Rekan: Outlet Uji Tukar · Sore/)).toBeVisible();
  await page.locator('.exchange-form form textarea').fill('Perlu bertukar shift karena keperluan keluarga.');
  await page.getByRole('button', { name: 'Kirim ke rekan', exact: true }).click();

  await expect.poll(() => backendState.submitRequests.length).toBe(1);
  expect(backendState.submitRequests[0]).toMatchObject({
    p_request_type: 'swap', p_requester_assignment_id: selfAssignmentId, p_peer_employee_id: peerId,
    p_reason: 'Perlu bertukar shift karena keperluan keluarga.'
  });
  expect(backendState.submitRequests[0].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Tukar shift dua arah', exact: true })).toBeVisible();
  await expect(page.getByText('Menunggu rekan', { exact: true }).first()).toBeVisible();
});

test('a server without the peer-options migration routes the cashier to Admin HR instead of leaking PostgREST text', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|EXCHANGE-PEERS-MIGRATION|a missing shift_exchange_peer_options RPC shows an actionable Indonesian hint and keeps submits closed' });
  const backendState = await openExchangeMock(page, { peerOptionsUnavailable: true });
  await signIn(page, 'RK000009');
  await page.goto('/operations?exchange');
  await expect(page.getByRole('heading', { name: 'Tukar atau pengganti', exact: true })).toBeVisible();

  await page.locator('.exchange-form form select').nth(1).selectOption(selfAssignmentId);
  await expect(page.getByText('Daftar rekan belum tersedia di server. Hubungi Admin HR untuk memperbarui basis data.', { exact: true })).toBeVisible();
  await expect(page.locator('.exchange-form form select').nth(2).locator('option')).toHaveCount(1);
  await expect.poll(() => backendState.peerOptionRequests.length).toBe(1);
  expect(backendState.submitRequests).toHaveLength(0);
});


