import { expect, test, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54329';
const adminId = 'hr-admin-followup';
const adminAuthId = 'auth-admin-followup';
const otherAuthId = 'auth-other-followup';
const otherEmployeeId = 'employee-other-followup';
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

function browserAcceptance(testInfo: { annotations: { type: string; description?: string }[] }, ...contracts: string[]) {
  for (const contract of contracts) testInfo.annotations.push({ type: 'browser-acceptance', description: `live-mock|${contract}` });
}

function requestAuthId(route: Route) {
  const authorization = route.request().headers().authorization ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
  if (!token) return null;
  try { return (JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { sub?: string }).sub ?? null; }
  catch { return null; }
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function rotateAppSession(page: Page) {
  return page.evaluate(async () => {
    const modulePath: string = '/src/lib/state/client.ts';
    const { supabase } = await import(modulePath);
    if (!supabase) throw new Error('The live-mock application SDK is not configured');
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw new Error(`Supabase SDK refresh failed: ${error.name}`);
    if (!data.session) throw new Error('Supabase SDK refresh returned no session');
    return { userId: data.session.user.id, accessToken: data.session.access_token };
  });
}

async function installRealtimeMock(page: Page) {
  const connections: { socket: any; topic: string; filters: Record<string, unknown>[]; sequence: number }[] = [];
  const activeJoins = new Set<string>();
  let joinCount = 0;
  let nextLeaveGate: { entered: () => void; gate: Promise<void> } | null = null;
  await page.routeWebSocket('ws://127.0.0.1:54329/realtime/v1/websocket*', socket => {
    const connection = { socket, topic: '', filters: [] as Record<string, unknown>[], sequence: 0 };
    connections.push(connection);
    socket.onMessage(async (raw: string | Buffer) => {
      let frame: unknown[];
      try { frame = JSON.parse(raw.toString()) as unknown[]; } catch { return; }
      const [joinRef, ref, topic, event, payload] = frame as [unknown, unknown, string, string, Record<string, any>];
      if (event === 'phx_join') {
        connection.topic = topic;
        connection.filters = payload?.config?.postgres_changes ?? [];
        joinCount += 1;
        connection.sequence = joinCount;
        activeJoins.add(String(joinRef));
        const postgres_changes = connection.filters.map((filter, index) => ({ ...filter, id: `${joinCount}-${index + 1}` }));
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes } }]));
      } else if (event === 'phx_leave') {
        const gate = nextLeaveGate;
        nextLeaveGate = null;
        if (gate) { gate.entered(); await gate.gate; }
        activeJoins.delete(String(joinRef));
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      } else if (event === 'heartbeat') {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  return {
    joined: () => joinCount,
    active: () => activeJoins.size,
    holdNextLeave() {
      const entered = deferred(), gate = deferred();
      nextLeaveGate = { entered: entered.resolve, gate: gate.promise };
      return { entered: entered.promise, release: gate.resolve };
    },
    async emitEmployeeChange() {
      const connection = [...connections].reverse().find(item => item.topic && item.filters.length);
      if (!connection) throw new Error('No subscribed Realtime channel is available');
      const index = connection.filters.findIndex(filter => filter.table === 'employees');
      if (index < 0) throw new Error('Latest Realtime channel has no employees binding');
      const id = `${connection.sequence}-${index + 1}`;
      connection.socket.send(JSON.stringify([null, `sec31-event-${joinCount}`, connection.topic, 'postgres_changes', {
        ids: [id], data: { schema: 'public', table: 'employees', commit_timestamp: new Date().toISOString(), type: 'UPDATE',
          columns: [], record: { id: adminId }, old_record: { id: adminId } }
      }]));
    },
    terminalClose() {
      const connection = [...connections].reverse().find(item => item.topic && item.filters.length);
      if (!connection) throw new Error('No subscribed Realtime channel is available for terminal disconnect');
      activeJoins.clear();
      connection.socket.send(JSON.stringify([null, null, connection.topic, 'phx_close', {}]));
    }
  };
}

async function openFollowupMock(page: Page) {
  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const authUser = {
    id: adminAuthId, aud: 'authenticated', role: 'authenticated', email: 'followup@example.test',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now
  };
  const session = {
    access_token: jwt({ sub: adminAuthId, aud: 'authenticated', role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 }),
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
  let followupPageReads = 0;
  let tokenRefreshCount = 0;
  let authLogoutCount = 0;
  let nextTokenGate: { entered: () => void; gate: Promise<void> } | null = null;
  let nextContextGate: { entered: () => void; gate: Promise<void> } | null = null;
  let failEmployeeReads = false;
  let contextAllowed = true;
  let protectedReadCount = 0;
  let protectedWriteCount = 0;
  let loseNextCommittedResponse = true;
  const tables: Record<string, Record<string, unknown>[]> = {
    employees: [
      { id: adminId, employee_number: 'RK000001', full_name: 'Admin Follow-up', whatsapp: '081200000001', department_id: 'department-followup', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: adminAuthId },
      { id: otherEmployeeId, employee_number: 'RK000003', full_name: 'Kasir Akun B', whatsapp: '081200000003', department_id: 'department-followup', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', auth_user_id: otherAuthId },
      { id: 'cashier-followup', employee_number: 'RK000002', full_name: 'Kasir Lama', whatsapp: '081200000002', department_id: 'department-followup', position_id: 'position-cashier', outlet_id: outletId, starts_on: '2020-01-01', status: 'active', account_status: 'active', weekly_off_days: [] }
    ],
    employee_roles: [{ employee_id: adminId, role: 'admin_hr' }, { employee_id: otherEmployeeId, role: 'employee' }],
    departments: [{ id: 'department-followup', name: 'Operasional', code: 'OPS', active: true }],
    positions: [{ id: 'position-admin', name: 'Admin HR', department_id: 'department-followup', active: true, is_cashier: false },
      { id: 'position-cashier', name: 'Kasir', department_id: 'department-followup', active: true, is_cashier: true }],
    outlets: [{ id: outletId, code: 'UJI', name: 'Outlet Uji', address: 'Jakarta', active: true, production_location: false,
      latitude: -6.2, longitude: 106.816666, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5, max_accuracy_m: 200 }],
    leave_requests: [], leave_adjustments: [], attendance: [], leave_ledger: [], notifications: [], cashier_assignments: [
      { id: 'assignment-followup-camera', employee_id: adminId, work_date: today, outlet_id: outletId, shift: 'morning', status: 'active', reason: 'Fixture attendance camera', created_by: adminId, created_at: now, updated_at: now }
    ],
    attendance_correction_requests: [], staffing_requirements: [], audit_events: []
  };

  await page.context().route(`${backend}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/functions/v1/hr-api') { await respond(route, { session }); return; }
    if (path === '/auth/v1/user') {
      const subject = requestAuthId(route);
      await respond(route, subject === otherAuthId ? { ...authUser, id: otherAuthId, email: 'other-followup@example.test' } : authUser);
      return;
    }
    if (path === '/auth/v1/logout') {
      authLogoutCount += 1;
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === '/auth/v1/token') {
      tokenRefreshCount += 1;
      const hold = nextTokenGate; nextTokenGate = null;
      if (hold) { hold.entered(); await hold.gate; }
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      await respond(route, { ...session, access_token: jwt({ sub: adminAuthId, aud: 'authenticated', role: 'authenticated', aal: 'aal1', exp: expiresAt, rotation: tokenRefreshCount }),
        refresh_token: `simulated-followup-refresh-${tokenRefreshCount}`, expires_in: 3600, expires_at: expiresAt });
      return;
    }
    if (path === '/rest/v1/rpc/auth_access_context') {
      const hold = nextContextGate; nextContextGate = null;
      if (hold) { hold.entered(); await hold.gate; }
      const subject = requestAuthId(route);
      await respond(route, { employee_id: subject === otherAuthId ? otherEmployeeId : adminId, requires_mfa: false,
        current_level: 'aal1', allowed: contextAllowed, reason: contextAllowed ? null : 'session_revoked' }); return;
    }
    if (path === '/rest/v1/rpc/spv_followup_page') {
      followupPageReads += 1;
      const visible = requestAuthId(route) === otherAuthId ? [] : [structuredClone(followup)];
      await respond(route, { items: visible, total: visible.length, has_more: false, next_cursor: null, as_of: new Date().toISOString() });
      return;
    }
    if (path === '/rest/v1/rpc/spv_followup_update_v2') {
      protectedWriteCount += 1;
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
    if (path === '/rest/v1/rpc/hr_save_employee_with_roles') {
      protectedWriteCount += 1;
      await respond(route, null);
      return;
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      await respond(route, path.endsWith('/leave_balance') ? { remaining: 12, expired: false } : []);
      return;
    }
    if (path.startsWith('/rest/v1/')) {
      protectedReadCount += 1;
      if (path === '/rest/v1/employees' && failEmployeeReads) {
        await respond(route, { code: 'MOCK_TRANSIENT_READ', message: 'Synthetic transient protected read failure.' }, 503);
        return;
      }
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
    followupPageReads: () => followupPageReads,
    tokenRefreshes: () => tokenRefreshCount,
    authLogoutRequests: () => authLogoutCount,
    protectedReads: () => protectedReadCount,
    protectedWrites: () => protectedWriteCount,
    failEmployeeReads() { failEmployeeReads = true; },
    restoreEmployeeReads() { failEmployeeReads = false; },
    revokeAdminRole() { tables.employee_roles = tables.employee_roles.filter(row => row.employee_id !== adminId || row.role !== 'admin_hr'); },
    setContextAllowed(value: boolean) { contextAllowed = value; },
    holdNextTokenRefresh() {
      const entered = deferred(), gate = deferred();
      nextTokenGate = { entered: entered.resolve, gate: gate.promise };
      return { entered: entered.promise, release: gate.resolve };
    },
    holdNextAuthContext() {
      const entered = deferred(), gate = deferred();
      nextContextGate = { entered: entered.resolve, gate: gate.promise };
      return { entered: entered.promise, release: gate.resolve };
    },
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

test('SEC31 browser SDK keeps the case draft and live camera through two rotations during delayed Realtime removal, then accepts the newest event and exact persisted retry', async ({ page, context }, testInfo) => {
  browserAcceptance(testInfo,
    'BR03a|live camera video and track identity remain connected during token rotation',
    'BR03b|captured selfie blob preview and captured context survive token rotation',
    'BR04|two token rotations during delayed channel removal leave one current owner and accept newest event',
    'BR05|terminal Realtime close joins replacement and its event triggers a data read',
    'BR10|follow-up retry after rotation and reload sends original payload/key and commits once');
  const realtime = await installRealtimeMock(page);
  const mock = await openFollowupMock(page);
  await expect.poll(() => realtime.joined()).toBeGreaterThan(0);

  const note = page.getByLabel('Catatan tindak lanjut');
  await note.fill('Draft harus tetap terbuka saat token berputar');

  const cameraPage = await context.newPage();
  const cameraRealtime = await installRealtimeMock(cameraPage);
  await cameraPage.goto('/attendance');
  await expect(cameraPage.getByRole('button', { name: 'Clock in · Masuk' })).toBeVisible();
  await cameraPage.getByRole('button', { name: 'Clock in · Masuk' }).click();
  await expect(cameraPage.getByRole('heading', { name: 'Catat masuk kerja' })).toBeVisible();
  await cameraPage.getByRole('button', { name: 'Buka kamera' }).click();
  const video = cameraPage.locator('video[aria-label="Pratinjau kamera selfie"]');
  await expect(video).toBeVisible();
  await expect.poll(async () => video.evaluate(element => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
    return stream?.getVideoTracks()[0]?.readyState ?? 'missing';
  })).toBe('live');
  const cameraTrack = await video.evaluate(element => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream;
    return stream.getVideoTracks()[0].id;
  });
  await expect.poll(() => cameraRealtime.joined()).toBeGreaterThan(0);

  const delayedContext = mock.holdNextAuthContext();
  const firstRotation = rotateAppSession(page);
  await delayedContext.entered;
  await expect(note).toHaveValue('Draft harus tetap terbuka saat token berputar');
  expect(await video.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.id)).toBe(cameraTrack);
  expect(await video.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.readyState)).toBe('live');

  await expect(cameraPage.getByRole('button', { name: 'Ambil selfie' })).toBeEnabled();
  const videoHandle = await video.elementHandle();
  expect(videoHandle).not.toBeNull();
  await cameraPage.getByRole('button', { name: 'Ambil selfie' }).click();
  const selfiePreview = cameraPage.locator('img[alt="Selfie dengan cap outlet, lokasi dan waktu yang akan dikirim"]');
  await expect(selfiePreview).toBeVisible();
  const selfieBlobUrl = await selfiePreview.getAttribute('src');
  expect(selfieBlobUrl).toMatch(/^blob:/);
  expect(await videoHandle!.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.readyState)).toBe('ended');
  const capturedRotationGate = mock.holdNextAuthContext();
  const capturedRotation = rotateAppSession(cameraPage);
  await capturedRotationGate.entered;
  await expect(selfiePreview).toBeVisible();
  expect(await selfiePreview.getAttribute('src')).toBe(selfieBlobUrl);
  capturedRotationGate.release();
  expect((await capturedRotation).userId).toBe(adminAuthId);
  await expect(selfiePreview).toBeVisible();
  expect(await selfiePreview.getAttribute('src')).toBe(selfieBlobUrl);
  expect(await videoHandle!.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.readyState)).toBe('ended');
  delayedContext.release();
  expect((await firstRotation).userId).toBe(adminAuthId);
  await expect(note).toHaveValue('Draft harus tetap terbuka saat token berputar');

  // Keep the first channel's asynchronous removal unresolved while a second
  // SDK refresh rotates the same persisted session again and the app validates
  // the newest revision while the earlier channel removal is still pending.
  const delayedLeave = realtime.holdNextLeave();
  const secondRotation = await rotateAppSession(page);
  expect(secondRotation.userId).toBe(adminAuthId);
  await delayedLeave.entered;
  const thirdRotation = await rotateAppSession(page);
  expect(thirdRotation.userId).toBe(adminAuthId);
  await expect.poll(() => realtime.joined()).toBeGreaterThan(1);
  delayedLeave.release();
  await expect.poll(() => realtime.active()).toBe(1);
  expect(await videoHandle!.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.readyState)).toBe('ended');
  expect(await videoHandle!.evaluate(element => ((element as HTMLVideoElement).srcObject as MediaStream)?.getVideoTracks()[0]?.id)).toBe(cameraTrack);

  const readsBeforeEvent = mock.followupPageReads();
  await realtime.emitEmployeeChange();
  await expect.poll(() => mock.followupPageReads()).toBeGreaterThan(readsBeforeEvent);
  await expect(note).toHaveValue('Draft harus tetap terbuka saat token berputar');

  const joinsBeforeReconnect = realtime.joined();
  realtime.terminalClose();
  await expect.poll(() => realtime.joined()).toBeGreaterThan(joinsBeforeReconnect);
  await expect.poll(() => realtime.active()).toBe(1);
  const readsAfterReconnect = mock.followupPageReads();
  await realtime.emitEmployeeChange();
  await expect.poll(() => mock.followupPageReads()).toBeGreaterThan(readsAfterReconnect);

  await page.getByRole('button', { name: 'Simpan dengan pemeriksaan revisi' }).click();
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();
  await expect.poll(() => mock.commits()).toBe(1);
  const originalRequest = structuredClone(mock.requests[0]);
  expect(originalRequest.p_idempotency_key).toBeTruthy();

  const pendingRotationGate = mock.holdNextAuthContext();
  const pendingRotation = rotateAppSession(page);
  await pendingRotationGate.entered;
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();
  await expect(note).toHaveValue('Draft harus tetap terbuka saat token berputar');
  pendingRotationGate.release();
  expect((await pendingRotation).userId).toBe(adminAuthId);
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Permintaan belum mempunyai hasil pasti')).toBeVisible();
  await page.getByRole('button', { name: 'Coba lagi permintaan yang sama' }).click();
  await expect(page.getByText('Tindak lanjut tersimpan. Revisi server dan riwayat telah diperbarui.')).toBeVisible();
  expect(mock.requests).toHaveLength(2);
  expect(mock.requests[1]).toEqual(originalRequest);
  expect(mock.commits()).toBe(1);
  await cameraPage.close();
});

test('SEC31 browser SDK refresh leaves populated leave and employee forms mounted with their original input nodes', async ({ page }, testInfo) => {
  browserAcceptance(testInfo,
    'BR01|leave form textarea and dialog remain mounted and action is rejected during session validation',
    'BR02|employee inputs and draft remain mounted after token rotation');
  const mock = await openFollowupMock(page);
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Buat pengajuan' }).click();
  await expect(page.getByRole('heading', { name: 'Buat pengajuan' })).toBeVisible();
  const leaveReason = page.getByLabel('Alasan', { exact: true });
  await leaveReason.fill('Izin untuk urusan keluarga yang sudah direncanakan');
  const leaveNode = await leaveReason.elementHandle();
  expect(leaveNode).not.toBeNull();
  const validation = mock.holdNextAuthContext();
  const refresh = rotateAppSession(page);
  await validation.entered;
  const guardedActionError = await page.evaluate(async () => {
    const appModulePath: string = '/src/lib/state/app.ts';
    const { actions } = await import(/* @vite-ignore */ appModulePath);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    try {
      await actions.submitLeave({ type: 'personal', startDate: date, endDate: date, reason: 'Uji guard selama validasi sesi', startTime: '', endTime: '', extent: 'full_day' });
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(guardedActionError).toContain('Sesi sedang diverifikasi');
  await expect(page.getByRole('heading', { name: 'Buat pengajuan' })).toBeVisible();
  await expect(leaveReason).toHaveValue('Izin untuk urusan keluarga yang sudah direncanakan');
  expect(await leaveNode!.evaluate(element => element.isConnected)).toBe(true);
  validation.release();
  expect((await refresh).userId).toBe(adminAuthId);
  await expect(page.getByRole('heading', { name: 'Buat pengajuan' })).toBeVisible();
  await expect(leaveReason).toHaveValue('Izin untuk urusan keluarga yang sudah direncanakan');
  expect(await leaveNode!.evaluate(element => element.isConnected && [...document.querySelectorAll('textarea')].includes(element as HTMLTextAreaElement))).toBe(true);

  await page.goto('/employees');
  await page.getByRole('button', { name: 'Tambah karyawan' }).click();
  await expect(page.getByRole('heading', { name: 'Daftarkan karyawan' })).toBeVisible();
  const employeeName = page.getByLabel('Nama lengkap');
  const employeePhone = page.getByLabel('Nomor WhatsApp');
  await employeeName.fill('Calon karyawan yang sedang didaftarkan');
  await employeePhone.fill('081299999991');
  const employeeNameNode = await employeeName.elementHandle();
  expect(employeeNameNode).not.toBeNull();
  expect((await rotateAppSession(page)).userId).toBe(adminAuthId);
  await expect(page.getByRole('heading', { name: 'Daftarkan karyawan' })).toBeVisible();
  await expect(employeeName).toHaveValue('Calon karyawan yang sedang didaftarkan');
  await expect(employeePhone).toHaveValue('081299999991');
  expect(await employeeNameNode!.evaluate(element => element.isConnected && [...document.querySelectorAll('input')].includes(element as HTMLInputElement))).toBe(true);
});

test('SEC31 keeps same-account UI read-only after a transient protected read failure and retries against current context', async ({ page }, testInfo) => {
  browserAcceptance(testInfo, 'BR08|allowed token rotation plus employees 503 retains form, blocks protected write, and retry succeeds');
  const mock = await openFollowupMock(page);
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Buat pengajuan' }).click();
  const reason = page.getByLabel('Alasan', { exact: true });
  await reason.fill('Draft tetap tersimpan saat baca sementara gagal');
  const reasonNode = await reason.elementHandle();
  expect(reasonNode).not.toBeNull();
  // Keep the outage active across Auth/Realtime automatic refreshes so this
  // reproducer can assert the retained error state before explicit recovery.
  mock.failEmployeeReads();
  const rotated = await rotateAppSession(page);
  expect(rotated.userId).toBe(adminAuthId);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Synthetic transient protected read failure');
  await expect(page.getByRole('heading', { name: 'Buat pengajuan' })).toBeVisible();
  await expect(reason).toHaveValue('Draft tetap tersimpan saat baca sementara gagal');
  expect(await reasonNode!.evaluate(element => element.isConnected)).toBe(true);
  const blocked = await page.evaluate(async () => {
    const modulePath: string = '/src/lib/state/app.ts';
    const { actions } = await import(/* @vite-ignore */ modulePath);
    try { await actions.saveEmployee({ fullName: 'Stale role must not save' }); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(blocked).toContain('Sesi sedang diverifikasi');
  expect(mock.protectedWrites()).toBe(0);
  mock.restoreEmployeeReads();
  await dialog.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Buat pengajuan' })).toBeVisible();
  await expect(page.getByLabel('Alasan', { exact: true })).toHaveValue('Draft tetap tersimpan saat baca sementara gagal');
});

test('SEC31 ordinary data refresh failure retains the form but cannot authorize from the cached admin role', async ({ page }, testInfo) => {
  browserAcceptance(testInfo, 'BR08|ordinary same-token employees 503 retains form, blocks cached admin action, and retry applies revoked role');
  const mock = await openFollowupMock(page);
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Buat pengajuan' }).click();
  const reason = page.getByLabel('Alasan', { exact: true });
  await reason.fill('Draft disimpan selama penyegaran biasa gagal');
  const reasonNode = await reason.elementHandle();
  expect(reasonNode).not.toBeNull();
  mock.failEmployeeReads();
  await page.evaluate(async () => {
    const modulePath: string = '/src/lib/state/app.ts';
    const { actions } = await import(/* @vite-ignore */ modulePath);
    await actions.refresh();
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Synthetic transient protected read failure');
  await expect(reason).toHaveValue('Draft disimpan selama penyegaran biasa gagal');
  expect(await reasonNode!.evaluate(element => element.isConnected)).toBe(true);
  const blocked = await page.evaluate(async () => {
    const modulePath: string = '/src/lib/state/app.ts';
    const { actions } = await import(/* @vite-ignore */ modulePath);
    try { await actions.saveEmployee({ fullName: 'Stale admin must not save', phone: '081299999999', joinDate: '2025-01-01', departmentId: 'department-followup', positionId: 'position-cashier', outletId: 'outlet-followup', roles: [] }); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(blocked).toContain('Sesi sedang diverifikasi');
  expect(mock.protectedWrites()).toBe(0);

  mock.revokeAdminRole();
  mock.restoreEmployeeReads();
  await dialog.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Karyawan', exact: true })).toHaveCount(0);
  await expect(reason).toHaveValue('Draft disimpan selama penyegaran biasa gagal');
  const denied = await page.evaluate(async () => {
    const modulePath: string = '/src/lib/state/app.ts';
    const { actions } = await import(/* @vite-ignore */ modulePath);
    try { await actions.saveEmployee({ fullName: 'Revoked admin must not save', phone: '081299999999', joinDate: '2025-01-01', departmentId: 'department-followup', positionId: 'position-cashier', outletId: 'outlet-followup', roles: [] }); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });
  expect(denied).toContain('Tindakan ini hanya untuk Admin HR');
  expect(mock.protectedWrites()).toBe(0);
});

test('SEC31 denies retry after role/session revocation during retained transient UI', async ({ page }, testInfo) => {
  browserAcceptance(testInfo, 'BR08|transient read retry with revoked latest permission clears access and performs no protected write');
  const mock = await openFollowupMock(page);
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Buat pengajuan' }).click();
  mock.failEmployeeReads();
  await rotateAppSession(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Synthetic transient protected read failure');
  const writesBeforeRetry = mock.protectedWrites();
  const readsBeforeRetry = mock.protectedReads();
  mock.setContextAllowed(false);
  mock.restoreEmployeeReads();
  await dialog.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.protectedWrites()).toBe(writesBeforeRetry);
  expect(mock.protectedReads()).toBe(readsBeforeRetry);
});

test('SEC31 ignores a late account-A context after account B replaces it', async ({ page }, testInfo) => {
  browserAcceptance(testInfo, 'BR06|late account-A Auth context cannot replace or expose data after SDK session switches to account B');
  const mock = await openFollowupMock(page);
  const held = mock.holdNextAuthContext();
  const rotating = rotateAppSession(page);
  await held.entered;
  const otherAccessToken = jwt({ sub: otherAuthId, aud: 'authenticated', role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600, switched: 1 });
  const switchResult = await page.evaluate(async ({ accessToken }) => {
    const modulePath: string = '/src/lib/state/client.ts';
    const { supabase } = await import(/* @vite-ignore */ modulePath);
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: 'account-b-refresh' });
    return { id: data.session?.user.id, error: error?.message ?? null };
  }, { accessToken: otherAccessToken });
  expect(switchResult).toEqual({ id: otherAuthId, error: null });
  held.release();
  expect((await rotating).userId).toBe(adminAuthId);
  await expect(page.locator('.account strong')).toHaveText('Kasir Akun B');
  await expect(page.getByText(`KASUS missing_clockin:assignment-old`, { exact: true })).toHaveCount(0);
  await expect(page.getByText('Kasir Lama', { exact: true })).toHaveCount(0);
  expect(mock.protectedWrites()).toBe(0);
});

test('SEC31 ignores delayed account-A validation after logout', async ({ page }, testInfo) => {
  browserAcceptance(testInfo, 'BR06|late Auth context after logout cannot republish the signed-out account');
  const mock = await openFollowupMock(page);
  const readsBeforeRotation = mock.protectedReads();
  const held = mock.holdNextAuthContext();
  const rotating = rotateAppSession(page);
  await held.entered;
  await page.getByRole('button', { name: 'Keluar akun', exact: true }).click();
  await expect.poll(() => mock.authLogoutRequests()).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
  held.release();
  await rotating;
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.protectedReads()).toBe(readsBeforeRotation);
  expect(mock.protectedWrites()).toBe(0);
});
