import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
const { client } = vi.hoisted(() => ({ client: {} as Record<string, any> }));
vi.mock('./client', () => ({ configured: true, supabase: client }));
const stamp = '2026-11-04T03:00:00.000Z';
const actor = { id: 'employee-admin', auth_user_id: 'auth-admin', employee_number: 'RK000001', full_name: 'Admin',
  starts_on: '2020-01-01', status: 'active', account_status: 'active', department_id: 'department', position_id: 'position', outlet_id: 'outlet', weekly_off_days: [] };
const record = { id: 'record-a', employee_id: 'employee-cashier', outlet_id: 'outlet', created_at: stamp,
  clock_in: stamp, clock_out: null, shift: 'morning', corrected: false, source: 'device', selfie_path: '' };
let admin = true, holdPage = false;
let pageStarted: () => void, releasePage: () => void;
let started: Promise<void>, held: Promise<void>;
function tableRows(table: string) {
  if (table === 'employees') return [actor];
  if (table === 'employee_roles') return admin ? [{ employee_id: actor.id, role: 'admin_hr' }] : [];
  if (table === 'departments') return [{ id: 'department', name: 'SDM', active: true }];
  if (table === 'positions') return [{ id: 'position', name: 'SPV', active: true, is_cashier: false, department_id: 'department' }];
  if (table === 'outlets') return [{ id: 'outlet', name: 'Outlet', active: true, radius_m: 500 }];
  if (table === 'attendance') return [record];
  return [];
}
beforeEach(() => {
  vi.resetModules(); admin = true; holdPage = false;
  started = new Promise<void>(resolve => { pageStarted = resolve; }); held = new Promise<void>(resolve => { releasePage = resolve; });
  const session = { user: { id: actor.auth_user_id }, access_token: 'synthetic-report-token' };
  Object.assign(client, {
    auth: { getSession: vi.fn(async () => ({ data: { session }, error: null })), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })) },
    from: vi.fn((table: string) => {
      let fields = '*';
      const query: any = {
        select: (value = '*') => { fields = value; return query; }, order: () => query,
        eq: () => query, lte: () => query, gte: () => query, lt: () => query, or: () => query, is: () => query, in: () => query,
        limit: async () => ({ data: table === 'attendance' ? [{ created_at: stamp }] : tableRows(table).slice(0,1), error: null }),
        range: async (_from: number, to: number) => {
          const snapshot = structuredClone(tableRows(table));
          if (table === 'attendance' && fields === '*' && to !== 999 && holdPage) { holdPage = false; pageStarted(); await held; }
          return { data: snapshot, error: null };
        }
      }; return query;
    }),
    rpc: vi.fn(async (name: string) => ({ data: name === 'auth_access_context'
      ? { employee_id: actor.id, allowed: true, requires_mfa: false, current_level: 'aal1', reason: null }
      : name === 'leave_balance' ? { expired: false, remaining: 12 } : name === 'spv_followup_page' ? { items: [] } : [], error: null })),
    storage: { from: vi.fn() },
    channel: vi.fn(() => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }), removeChannel: vi.fn(async () => 'ok')
  });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
});
afterEach(async () => { releasePage?.(); await new Promise(resolve => setTimeout(resolve, 10)); vi.unstubAllGlobals(); vi.resetModules(); });

it('rejects an old privileged report response after its HR role was revoked without a Realtime event', async () => {
  const { actions, app } = await import('./app'); await actions.init();
  expect(get(app).user?.roles).toEqual(['admin_hr']);
  holdPage = true;
  const reading = actions.loadReportPage({ tab: 'attendance', startDate: '2026-11-04', endDate: '2026-11-04', pageSize: 25 });
  const denied = expect(reading).rejects.toThrow(/akses|Admin|Sesi/i);
  await started;
  // The in-flight PostgreSQL statement captured its authorized old snapshot.
  // The live role changes before the response arrives; no socket event repairs
  // the app's cached role before the publication boundary.
  admin = false; releasePage();
  await denied;
});
