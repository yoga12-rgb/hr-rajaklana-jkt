import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { jakartaDate } from '../domain';

const { client } = vi.hoisted(() => ({ client: {} as Record<string, any> }));
vi.mock('./client', () => ({ configured: true, supabase: client }));

function gate() {
  let release!: () => void, start!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { start = resolve; });
  return { promise, started, release, start };
}
type Gate = ReturnType<typeof gate>;
let session: { user: { id: string }; access_token: string } | null;
let authListener: ((event: string, nextSession: typeof session) => void) | undefined;
let tables: Record<string, any[]>;
let readHold: { table: string; gate: Gate } | undefined;
let rpcHold: Gate | undefined;
let rpcResult: ((row: any) => any) | undefined;
let rpcFailure: Record<string, unknown> | undefined;
let contextAllowed: boolean;
let holds: Gate[];
let singleReads: string[];

function holdRead(table: string) { const value = gate(); holds.push(value); readHold = { table, gate: value }; return value; }
function holdRpc() { const value = gate(); holds.push(value); rpcHold = value; return value; }
function geo() { return { latitude: -6.2, longitude: 106.816666, accuracy: 10, geoCapturedAt: new Date().toISOString() }; }
function attendanceRow() {
  return { id: 'attendance', employee_id: 'cashier', outlet_id: 'outlet', assignment_id: 'assignment',
    work_date: jakartaDate(), shift: 'middle', clock_in: new Date(Date.now() - 600_000).toISOString(), clock_out: null,
    expected_in: null, late_minutes: 0, worked_minutes: null, in_latitude: -6.2, in_longitude: 106.816666,
    in_accuracy_m: 10, in_distance_m: 0, selfie_path: 'auth-cashier/selfie.jpg', corrected: false,
    morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', tolerance_minutes: 5,
    outlet_latitude: -6.2, outlet_longitude: 106.816666, radius_m: 500, source: 'device' };
}
function installClient() {
  session = { user: { id: 'auth-cashier' }, access_token: 'synthetic-cashier-token' };
  contextAllowed = true; authListener = undefined; readHold = undefined; rpcHold = undefined;
  rpcResult = undefined; rpcFailure = undefined; holds = []; singleReads = [];
  tables = {
    employees: [{ id: 'cashier', auth_user_id: 'auth-cashier', employee_number: 'RK000032', full_name: 'Kasir Uji',
      status: 'active', account_status: 'active', position_id: 'position', department_id: 'department', outlet_id: 'outlet',
      starts_on: '2020-01-01', can_clock: true, can_middle_shift: true, weekly_off_days: [], approval_mode: 'internal' }],
    employee_roles: [{ employee_id: 'cashier', role: 'employee' }],
    departments: [{ id: 'department', name: 'Kasir', active: true }],
    positions: [{ id: 'position', department_id: 'department', name: 'Kasir', active: true, is_cashier: true }],
    outlets: [{ id: 'outlet', code: 'UJI', name: 'Outlet Uji', active: true, latitude: -6.2, longitude: 106.816666,
      radius_m: 500, max_accuracy_m: 100, opens_at: '00:00:00', closes_at: '23:59:00', morning_starts_at: '07:00:00',
      afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 }],
    cashier_assignments: [{ id: 'assignment', employee_id: 'cashier', outlet_id: 'outlet', work_date: jakartaDate(), shift: 'middle',
      status: 'active', reason: 'Fixture', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    attendance: [attendanceRow()]
  };
  Object.assign(client, {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn((callback: typeof authListener) => { authListener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn((table: string) => {
      let filter: { column: string; value: unknown } | undefined;
      const query: any = { select: () => query, order: () => query,
        eq: (column: string, value: unknown) => { filter = { column, value }; return query; },
        single: async () => {
          singleReads.push(table);
          // A held targeted query may execute after another request's snapshot.
          if (readHold?.table === `${table}-single`) { const pending = readHold.gate; readHold = undefined; pending.start(); await pending.promise; }
          const row = structuredClone((tables[table] ?? []).find(item => !filter || item[filter.column] === filter.value) ?? null);
          return { data: row, error: null };
        }, range: async () => {
        // Capture the rows at request time, reproducing a real older response.
        const rows = structuredClone(tables[table] ?? []);
        if (readHold?.table === table) { const pending = readHold.gate; readHold = undefined; pending.start(); await pending.promise; }
        return { data: rows, error: null };
      } };
      return query;
    }),
    rpc: vi.fn(async (name: string, input: Record<string, any>) => {
      if (name === 'auth_access_context') return { data: { employee_id: 'cashier', requires_mfa: false, current_level: 'aal1', allowed: contextAllowed, reason: contextAllowed ? null : 'session_revoked' }, error: null };
      if (name === 'leave_balance') return { data: { expired: false, remaining: 12 }, error: null };
      if (name === 'attendance_clock_out_fresh' || name === 'attendance_clock_in_selfie') {
        if (rpcHold) { const pending = rpcHold; rpcHold = undefined; pending.start(); await pending.promise; }
        if (rpcFailure) return { data: null, error: rpcFailure, status: 400 };
        const row = name === 'attendance_clock_out_fresh'
          ? { ...tables.attendance[0], clock_out: new Date().toISOString(), worked_minutes: 10, out_latitude: input.p_latitude, out_longitude: input.p_longitude, out_accuracy_m: input.p_accuracy_m, out_distance_m: 0 }
          : { ...attendanceRow(), clock_in: new Date().toISOString(), selfie_path: input.p_selfie_path,
              selfie_captured_at: input.p_selfie_captured_at, selfie_outlet_name: input.p_selfie_outlet_name };
        if (rpcResult) return { data: rpcResult(row), error: null };
        tables.attendance = [structuredClone(row)];
        return { data: structuredClone(row), error: null };
      }
      return { data: [], error: null };
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://example.test/selfie' }, error: null })), upload: vi.fn(async () => ({ error: null })), remove: vi.fn(async () => ({ error: null })) })) },
    channel: vi.fn(() => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }),
    removeChannel: vi.fn(async () => 'ok')
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ verificationToken: 'synthetic-receipt' }) })));
}

async function openApp(withAttendance = true) {
  if (!withAttendance) tables.attendance = [];
  const module = await import('./app'); await module.actions.init(); return module;
}

describe('responsive authoritative attendance receipts', () => {
  beforeEach(() => {
    vi.resetModules(); installClient();
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(() => 1) });
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  });
  afterEach(async () => {
    for (const pending of holds) pending.release();
    // Let any already requested background reconciliation settle in its module.
    for (let index = 0; index < 50; index++) await Promise.resolve();
    vi.unstubAllGlobals(); vi.resetModules();
  });

  it('resolves clock out from the saved server row while unrelated refresh reads remain blocked', async () => {
    const { actions, app } = await openApp();
    const pending = holdRead('employees');
    try {
      await actions.clockOut(geo());
      await pending.started;
      expect(get(app).attendanceRecords[0]).toMatchObject({ id: 'attendance', durationMinutes: 10, outAccuracy: 10 });
      expect(get(app).attendanceRecords[0].clockOut).toBe(tables.attendance[0].clock_out);
      expect(get(app).attendanceRecords[0].selfieUrl).toBeUndefined();
      expect(client.storage.from).not.toHaveBeenCalled();
      expect(singleReads).toEqual([]);
    } finally { pending.release(); await actions.refresh(); }
  });

  it('resolves clock in only after its real receipt and before background hydration', async () => {
    const { actions, app } = await openApp(false);
    const pending = holdRead('employees'), final = holdRpc();
    const input = { ...geo(), outletId: 'outlet', shift: 'middle' as const, selfie: new Blob(['selfie'], { type: 'image/jpeg' }), selfieCapturedAt: new Date().toISOString(), selfieOutletName: 'Outlet Uji' };
    let complete = false;
    const operation = actions.clockIn(input).then(() => { complete = true; });
    try {
      await final.started;
      expect(complete).toBe(false); expect(get(app).attendanceRecords).toEqual([]);
      final.release(); await operation; await pending.started;
      expect(get(app).attendanceRecords[0]).toMatchObject({ employeeId: 'cashier', clockOut: null, selfieOutletName: 'Outlet Uji', assignmentId: 'assignment' });
      expect(get(app).attendanceRecords[0].clockIn).toBe(tables.attendance[0].clock_in);
      expect(singleReads).toEqual([]);
    } finally { final.release(); pending.release(); await actions.refresh(); }
  });

  it('never publishes an older in-flight refresh over a confirmed clock out', async () => {
    const { actions, app } = await openApp();
    const oldRead = holdRead('attendance');
    const refresh = actions.refresh(); await oldRead.started;
    const observations: (string | null)[] = [];
    const unsubscribe = app.subscribe(state => observations.push(state.attendanceRecords.find(row => row.id === 'attendance')?.clockOut ?? null));
    try {
      await actions.clockOut(geo());
      const saved = get(app).attendanceRecords[0].clockOut;
      expect(saved).not.toBeNull(); observations.length = 0;
      oldRead.release(); await refresh;
      expect(observations).not.toContain(null);
      expect(get(app).attendanceRecords[0].clockOut).toBe(saved);
    } finally { oldRead.release(); unsubscribe(); }
  });

  it('does not replace a newer published correction with a delayed older RPC receipt', async () => {
    const { actions, app } = await openApp();
    const receipt = { ...tables.attendance[0], clock_out: new Date().toISOString(), worked_minutes: 10 };
    rpcResult = () => structuredClone(receipt);
    const pending = holdRpc();
    const operation = actions.clockOut(geo()); await pending.started;
    try {
      // PostgreSQL has committed clockout, then an SPV correction commits before
      // the first HTTP response reaches this tab. Realtime already saw that row.
      tables.attendance = [{ ...receipt, corrected: true,
        clock_in: new Date(Date.now() - 900_000).toISOString(), worked_minutes: 15 }];
      await actions.refresh();
      expect(get(app).attendanceRecords[0].corrected).toBe(true);
      pending.release(); await operation;
      expect(get(app).attendanceRecords[0]).toMatchObject({ corrected: true, durationMinutes: 15,
        clockIn: tables.attendance[0].clock_in });
      expect(singleReads).toEqual(['attendance']);
    } finally { pending.release(); await actions.refresh(); }
  });

  it('rechecks the account after the rare receipt reconciliation read', async () => {
    const { actions, app } = await openApp();
    const receipt = { ...tables.attendance[0], clock_out: new Date().toISOString(), worked_minutes: 10 };
    rpcResult = () => structuredClone(receipt);
    const pending = holdRpc();
    const operation = actions.clockOut(geo());
    const rejected = expect(operation).rejects.toThrow(/Sesi|akses|masuk/i);
    await pending.started;
    tables.attendance = [{ ...receipt, corrected: true, worked_minutes: 15 }];
    await actions.refresh();
    const targetedRead = holdRead('attendance-single');
    try {
      pending.release(); await targetedRead.started;
      session = null; authListener?.('SIGNED_OUT', session);
      targetedRead.release(); await rejected;
      expect(get(app).attendanceRecords).toEqual([]);
      await new Promise(resolve => setTimeout(resolve, 0));
      await actions.refresh();
    } finally { pending.release(); targetedRead.release(); }
  });

  it('fences a global refresh started during the targeted reconciliation await', async () => {
    const { actions, app } = await openApp();
    const receipt = { ...tables.attendance[0], clock_out: new Date().toISOString(), worked_minutes: 10 };
    rpcResult = () => structuredClone(receipt);
    const pending = holdRpc();
    const operation = actions.clockOut(geo()); await pending.started;
    tables.attendance = [{ ...receipt, corrected: true, worked_minutes: 15 }];
    await actions.refresh();
    const targeted = holdRead('attendance-single');
    pending.release(); await targeted.started;
    // This second refresh starts after the first publication fence, but reads
    // before the targeted query sees a still newer correction.
    const olderGlobal = holdRead('attendance');
    const refresh = actions.refresh(); await olderGlobal.started;
    const observations: (number | null)[] = [];
    let unsubscribe = () => {};
    try {
      tables.attendance = [{ ...receipt, corrected: true, worked_minutes: 20 }];
      targeted.release(); await operation;
      expect(get(app).attendanceRecords[0].durationMinutes).toBe(20);
      unsubscribe = app.subscribe(state => observations.push(state.attendanceRecords[0]?.durationMinutes ?? null));
      olderGlobal.release(); await refresh;
      expect(observations).not.toContain(15);
      expect(get(app).attendanceRecords[0].durationMinutes).toBe(20);
    } finally { pending.release(); targeted.release(); olderGlobal.release(); unsubscribe(); }
  });

  it.each(['logout', 'different-account', 'permission-revoked'] as const)('does not apply a late receipt after %s', async transition => {
    const { actions, app } = await openApp(); const pending = holdRpc();
    const operation = actions.clockOut(geo());
    const rejected = expect(operation).rejects.toThrow(/Sesi|akses|masuk/i);
    await pending.started;
    if (transition === 'permission-revoked') {
      tables.employees[0].can_clock = false; await actions.refresh();
    } else {
      session = transition === 'logout' ? null : { user: { id: 'auth-other' }, access_token: 'synthetic-other-token' };
      authListener?.('SIGNED_IN', session);
    }
    pending.release(); await rejected;
    if (transition === 'permission-revoked') expect(get(app).attendanceRecords[0].clockOut).toBeNull();
    else expect(get(app).attendanceRecords).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    await actions.refresh();
  });

  it.each(['malformed', 'employee', 'outlet', 'record', 'not-closed'] as const)('rejects a %s clockout receipt without fabricating success', async failure => {
    const { actions, app } = await openApp();
    rpcResult = row => failure === 'malformed' ? 'attendance' : failure === 'employee' ? { ...row, employee_id: 'other' }
      : failure === 'outlet' ? { ...row, outlet_id: 'other' } : failure === 'record' ? { ...row, id: 'other' } : { ...row, clock_out: null };
    await expect(actions.clockOut(geo())).rejects.toThrow('Respons absensi belum dapat dikonfirmasi');
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
    await actions.refresh();
  });

  it('keeps the active record when PostgreSQL rejects clockout', async () => {
    const { actions, app } = await openApp(); rpcFailure = { code: '42501', message: 'Akses ditolak' };
    await expect(actions.clockOut(geo())).rejects.toThrow('Akses ditolak');
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
  });
});
