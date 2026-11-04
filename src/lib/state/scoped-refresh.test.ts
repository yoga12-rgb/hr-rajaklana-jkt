import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
const { client } = vi.hoisted(() => ({ client: {} as Record<string, any> }));
vi.mock('./client', () => ({ configured: true, supabase: client }));
const sessionFor = (id = 'auth-a', token = 'token-a') => ({ user: { id }, access_token: token });
let session: ReturnType<typeof sessionFor> | null;
let listener: (event: string, next: typeof session) => void;
let admin: boolean, allowed: boolean;
let includeOldHistory = false, oldHistoryReview = false;
let notifications: Record<string, any>[];
let followupRows: Record<string, any>[];
let tableHold: { table: string; gate: ReturnType<typeof gate> } | undefined;
let readReplyHold: ReturnType<typeof gate> | undefined;
let callbacks: Map<string, () => void>;
const markedAt = '2026-11-04T03:00:00.000Z';
function gate() { let release!: () => void, start!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { start = resolve; }); return { promise, started, release, start }; }
function employee(authId: string) { return { id: authId === 'auth-a' ? 'employee-a' : 'employee-b', auth_user_id: authId,
  employee_number: authId === 'auth-a' ? 'RK000001' : 'RK000002', full_name: authId === 'auth-a' ? 'Admin A' : 'Kasir B',
  department_id: 'department', position_id: 'position', outlet_id: 'outlet', starts_on: '2020-01-01', status: 'active', account_status: 'active',
  can_clock: true, photo_path: `${authId}/profile.jpg`, weekly_off_days: [] }; }
function rows(table: string, authId: string | undefined) {
  if (table === 'employees') return authId ? [employee(authId)] : [];
  if (table === 'employee_roles') return admin && authId === 'auth-a' ? [{ employee_id: 'employee-a', role: 'admin_hr' }] : [];
  if (table === 'departments') return [{ id: 'department', name: 'Operasional', active: true }];
  if (table === 'positions') return [{ id: 'position', name: 'Kasir', department_id: 'department', active: true, is_cashier: true }];
  if (table === 'outlets') return [{ id: 'outlet', name: 'Outlet', active: true, latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }];
  if (table === 'attendance') return authId === 'auth-a' ? [{ id: 'private-a-record', employee_id: 'employee-a', outlet_id: 'outlet', shift: 'morning', clock_in: '2026-11-04T00:00:00.000Z', clock_out: null, selfie_path: 'auth-a/photo.jpg', corrected: false, source: 'device' },
    ...(includeOldHistory ? [{ id: 'historical-closed', employee_id: 'employee-a', outlet_id: 'outlet', shift: 'morning', work_date: '2025-01-01', clock_in: '2025-01-01T00:00:00.000Z', clock_out: '2025-01-01T13:00:00.000Z', worked_minutes: oldHistoryReview ? 780 : 30, selfie_path: '', corrected: false, source: 'device' }] : [])] : [];
  if (table === 'notifications') return notifications.filter(row => row.employee_id === employee(authId ?? '').id);
  if (table === 'audit_events') return admin && authId === 'auth-a' ? [{ id: 'audit-a', actor_employee_id: 'employee-a', entity_id: 'private-a-record', action: 'private-admin-audit', created_at: '2026-11-04T00:00:00.000Z' }] : [];
  return [];
}
beforeEach(() => {
  vi.resetModules(); session = sessionFor(); admin = true; allowed = true; includeOldHistory = false; oldHistoryReview = false; tableHold = undefined; readReplyHold = undefined; callbacks = new Map();
  notifications = [{ id: 'notice-1', employee_id: 'employee-a', title: 'Awal', body: 'Kasus', href: '/supervisor?case=case', entity_id: 'case', entity_type: 'spv_followup', created_at: markedAt, read_at: null }];
  followupRows = [];
  Object.assign(client, {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn((callback: typeof listener) => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn((table: string) => {
      let filter = '';
      const query: any = { select: () => query, order: () => query, or: (value: string) => { filter = value; return query; }, range: async () => {
        let snapshot: Record<string, any>[] = structuredClone(rows(table, session?.user.id));
        if (table === 'attendance' && filter) {
          const cutoff = filter.match(/clock_in\.gte\.([^,]+)/)?.[1] ?? '';
          const caseDates = filter.match(/work_date\.in\.\(([^)]+)\)/)?.[1].split(',') ?? [];
          snapshot = snapshot.filter(row => row.clock_out === null || row.clock_in >= cutoff || row.clock_out >= cutoff
            || (filter.includes('worked_minutes.gte.720') && row.worked_minutes >= 720) || caseDates.includes(row.work_date));
        }
        if (tableHold?.table === table) { const pending = tableHold.gate; tableHold = undefined; pending.start(); await pending.promise; }
        return { data: snapshot, error: null };
      } }; return query;
    }),
    rpc: vi.fn(async (name: string, args: Record<string, any>) => {
      if (name === 'auth_access_context') return { data: { employee_id: employee(session?.user.id ?? '').id, requires_mfa: false, current_level: 'aal1', allowed, reason: allowed ? null : 'session_revoked' }, error: null };
      if (name === 'leave_balance') return { data: { expired: false, remaining: 12 }, error: null };
      if (name === 'spv_followup_page') return { data: { items: structuredClone(followupRows), total: followupRows.length }, error: null };
      if (name === 'notifications_mark_read') {
        const ids = new Set(notifications.filter(row => !args.p_id || row.id === args.p_id).map(row => row.id));
        notifications = notifications.map(row => ids.has(row.id) ? { ...row, read_at: row.read_at ?? markedAt } : row);
        if (readReplyHold) { const pending = readReplyHold; readReplyHold = undefined; pending.start(); await pending.promise; }
        return { data: markedAt, error: null };
      }
      return { data: [], error: null };
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://example.test/private.jpg' }, error: null })), createSignedUrls: vi.fn(async () => ({ data: [], error: null })) })) },
    channel: vi.fn(() => { const channel = { on: (_kind: string, filter: { table: string }, callback: () => void) => { callbacks.set(filter.table, callback); return channel; }, subscribe: () => channel }; return channel; }),
    removeChannel: vi.fn(async () => 'ok')
  });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
});
afterEach(async () => { tableHold?.gate.release(); readReplyHold?.release(); await new Promise(resolve => setTimeout(resolve, 10)); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
const tablesRead = () => new Set<string>(client.from.mock.calls.map(([table]: [string]) => table));
async function open() { const { actions, app } = await import('./app'); await actions.init(); return { actions, app }; }

describe('validated scoped refresh', () => {
  it('initializes a complete live snapshot without eagerly signing private media', async () => {
    const { app } = await open();
    expect(get(app)).toMatchObject({ user: { id: 'employee-a', roles: ['admin_hr'], photoPath: 'auth-a/profile.jpg' }, workspaceLoading: false });
    for (const table of ['employees', 'employee_roles', 'attendance', 'leave_requests', 'notifications', 'audit_events', 'staffing_requirements']) expect(tablesRead().has(table)).toBe(true);
    expect(get(app).attendanceRecords[0]).toMatchObject({ id: 'private-a-record', selfiePath: 'auth-a/photo.jpg' });
    expect(get(app).attendanceRecords[0].selfieUrl).toBeUndefined(); expect(get(app).user?.photoUrl).toBeUndefined();
    expect(client.storage.from).not.toHaveBeenCalled();
  });

  it('revalidates identity but refreshes only notifications when the scope is unchanged', async () => {
    const { actions, app } = await open(); client.from.mockClear(); client.rpc.mockClear();
    notifications.push({ ...notifications[0], id: 'notice-2', title: 'Baru' });
    await actions.refresh('notifications');
    expect(tablesRead()).toEqual(new Set(['employees', 'employee_roles', 'departments', 'positions', 'outlets', 'notifications']));
    expect(client.rpc.mock.calls.some(([name]: [string]) => ['leave_balance', 'employee_directory', 'spv_followup_page'].includes(name))).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith('auth_access_context', {});
    expect(client.storage.from).not.toHaveBeenCalled(); expect(get(app).notifications).toHaveLength(2);
    expect(get(app).attendanceRecords[0].id).toBe('private-a-record');
  });

  it('does not reuse an admin snapshot after the freshly read role changes', async () => {
    const { actions, app } = await open(); admin = false; client.from.mockClear(); client.rpc.mockClear();
    await actions.refresh('notifications');
    expect(tablesRead().has('attendance')).toBe(true); expect(tablesRead().has('leave_requests')).toBe(true);
    expect(client.rpc.mock.calls.some(([name]: [string]) => name === 'leave_balance')).toBe(true);
    expect(get(app).user?.roles).toEqual([]); expect(get(app).auditEntries).toEqual([]);
  });

  it('does not reuse the old raw snapshot after a same-account token rotation', async () => {
    const { actions, app } = await open(); client.from.mockClear();
    session = sessionFor('auth-a', 'token-a-rotated'); listener('TOKEN_REFRESHED', session);
    await actions.refresh('notifications');
    expect(tablesRead().has('attendance')).toBe(true); expect(tablesRead().has('audit_events')).toBe(true);
    expect(get(app).user?.id).toBe('employee-a'); expect(get(app).sessionValidating).toBe(false);
  });

  it('discards a late account-A scoped read and fully loads account B without A records', async () => {
    const { actions, app } = await open(); const held = gate(); tableHold = { table: 'notifications', gate: held };
    const late = actions.refresh('notifications'); await held.started;
    session = sessionFor('auth-b', 'token-b'); admin = false; listener('SIGNED_IN', session);
    held.release(); await late; await actions.refresh('notifications');
    expect(get(app)).toMatchObject({ user: { id: 'employee-b', roles: [] }, attendanceRecords: [], auditEntries: [], notifications: [] });
    expect(get(app).employees.some(row => row.authUserId === 'auth-a')).toBe(false);
  });

  it('cannot let a pre-write full snapshot undo the confirmed notification marker', async () => {
    const { actions, app } = await open(); const held = gate(); tableHold = { table: 'notifications', gate: held };
    const older = actions.refresh(); await held.started;
    await actions.readNotification('notice-1');
    expect(get(app).notifications?.[0].readAt).toBe(markedAt);
    notifications.push({ ...notifications[0], id: 'notice-new-after-commit', read_at: null });
    const observed: (string | null | undefined)[] = [];
    const unsubscribe = app.subscribe(state => observed.push(state.notifications?.find(row => row.id === 'notice-1')?.readAt));
    try { held.release(); await older; await actions.refresh('notifications'); }
    finally { unsubscribe(); }
    expect(observed.every(value => value === markedAt)).toBe(true);
    expect(get(app).notifications?.find(row => row.id === 'notice-new-after-commit')?.readAt).toBeNull();
  });

  it('mark-all does not locally mark arrivals outside the original receipt scope', async () => {
    const { actions, app } = await open(); const held = gate(); readReplyHold = held;
    const marking = actions.readNotification(); await held.started;
    notifications.push({ ...notifications[0], id: 'notice-new', read_at: null });
    await actions.refresh('notifications');
    expect(get(app).notifications?.find(row => row.id === 'notice-new')?.readAt).toBeNull();
    held.release(); await marking; await actions.refresh('notifications');
    expect(get(app).notifications?.find(row => row.id === 'notice-1')?.readAt).toBe(markedAt);
    expect(get(app).notifications?.find(row => row.id === 'notice-new')?.readAt).toBeNull();
  });

  it('unions multiple Realtime table targets instead of losing the earlier event', async () => {
    const { actions } = await open(); client.from.mockClear(); client.rpc.mockClear();
    callbacks.get('attendance')?.(); callbacks.get('leave_requests')?.();
    await new Promise(resolve => setTimeout(resolve, 350)); await actions.refresh('notifications');
    const read = tablesRead();
    for (const table of ['attendance', 'attendance_correction_requests', 'leave_requests', 'leave_adjustments', 'leave_ledger', 'notifications', 'audit_events']) expect(read.has(table)).toBe(true);
    expect(read.has('cashier_assignments')).toBe(false);
    expect(client.rpc.mock.calls.some(([name]: [string]) => name === 'leave_balance')).toBe(true);
  });

  it('fails closed before cached scoped data if live access is revoked', async () => {
    const { actions, app } = await open(); client.from.mockClear(); allowed = false;
    await actions.refresh('notifications');
    expect(client.from).not.toHaveBeenCalled();
    expect(get(app)).toMatchObject({ user: null, attendanceRecords: [], notifications: [], auditEntries: [] });
  });

  it('keeps an operational route gated until complete historical attendance is loaded', async () => {
    includeOldHistory = true;
    vi.stubGlobal('window', { location: { pathname: '/dashboard' }, addEventListener: vi.fn(), setInterval: vi.fn() });
    const { actions, app } = await open();
    expect(get(app).attendanceHistoryComplete).toBe(false);
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(false);
    const held = gate(); tableHold = { table: 'attendance', gate: held };
    const preparing = actions.prepareWorkspaceRoute('/attendance');
    expect(get(app).workspaceLoading).toBe(true);
    await held.started;
    expect(get(app).attendanceHistoryComplete).toBe(false);
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(false);
    held.release(); await preparing;
    expect(get(app)).toMatchObject({ workspaceLoading: false, attendanceHistoryComplete: true });
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(true);
  });

  it('discards a late full-history view when navigation has returned to a recent view', async () => {
    includeOldHistory = true;
    vi.stubGlobal('window', { location: { pathname: '/dashboard' }, addEventListener: vi.fn(), setInterval: vi.fn() });
    const { actions, app } = await open();
    const held = gate(); tableHold = { table: 'attendance', gate: held };
    const full = actions.prepareWorkspaceRoute('/attendance'); await held.started;
    const recent = actions.prepareWorkspaceRoute('/dashboard');
    const observed: boolean[] = [];
    const unsubscribe = app.subscribe(state => observed.push(Boolean(state.attendanceHistoryComplete)));
    try { held.release(); await Promise.all([full, recent]); }
    finally { unsubscribe(); }
    expect(observed.every(complete => complete === false)).toBe(true);
    expect(get(app)).toMatchObject({ workspaceLoading: false, attendanceHistoryComplete: false, user: { id: 'employee-a' } });
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(false);
  });

  it('retains an old closed review session in the recent Dashboard context', async () => {
    includeOldHistory = true; oldHistoryReview = true;
    vi.stubGlobal('window', { location: { pathname: '/dashboard' }, addEventListener: vi.fn(), setInterval: vi.fn() });
    const { app } = await open();
    expect(get(app).attendanceHistoryComplete).toBe(false);
    expect(get(app).attendanceRecords.find(row => row.id === 'historical-closed')?.durationMinutes).toBe(780);
  });

  it('loads the historical attendance footprint when a new supervisor case introduces an old day', async () => {
    includeOldHistory = true;
    vi.stubGlobal('window', { location: { pathname: '/dashboard' }, addEventListener: vi.fn(), setInterval: vi.fn() });
    const { actions, app } = await open();
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(false);
    followupRows = [{ id: 'new-historical-case', case_key: 'attendance:historical-closed', issue_type: 'short_session',
      source_type: 'attendance', source_id: 'historical-closed', work_date: '2025-01-01', outlet_id: 'outlet', employee_id: 'employee-a',
      shift: 'morning', status: 'open', created_by: 'employee-a', created_at: markedAt, updated_at: markedAt, revision: 1 }];
    client.from.mockClear();
    await actions.refresh('supervisor');
    expect(tablesRead().has('attendance')).toBe(true);
    expect(tablesRead().has('leave_requests')).toBe(false);
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(true);
    expect(get(app).spvFollowups?.[0]).toMatchObject({ id: 'new-historical-case', workDate: '2025-01-01' });
    client.from.mockClear(); await actions.refresh('supervisor');
    expect(tablesRead().has('attendance')).toBe(false);
    expect(get(app).attendanceRecords.some(row => row.id === 'historical-closed')).toBe(true);
  });
});
