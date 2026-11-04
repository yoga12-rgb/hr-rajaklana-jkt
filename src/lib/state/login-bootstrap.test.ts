import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { client } = vi.hoisted(() => ({ client: {} as Record<string, any> }));
vi.mock('./client', () => ({ configured: true, supabase: client }));

const session = (id = 'auth-a', token = `token-${id}`) => ({ user: { id }, access_token: token, refresh_token: `refresh-${id}` });
type Session = ReturnType<typeof session>;
let currentSession: Session | null;
let listener: (event: string, value: Session | null) => void;
let heldTable: string | null, releaseRead: (() => void) | undefined;
let failingTable: string | null, accessAllowed: boolean, contextEmployeeId: string | null;
let heldReadStarted: boolean;
const employee = (authId = 'auth-a') => ({ id: `employee-${authId}`, employee_number: 'RK000001', full_name: authId === 'auth-a' ? 'Admin A' : 'Admin B',
  whatsapp: '0812', department_id: 'dept', position_id: 'position', outlet_id: 'outlet', starts_on: '2025-01-01', status: 'active',
  account_status: 'active', auth_user_id: authId, can_clock: false, weekly_off_days: [], approval_mode: 'external', photo_path: `${authId}/private.jpg` });

function rows(table: string, capturedSession: Session | null) {
  const authId = capturedSession?.user.id ?? 'none';
  if (table === 'employees') return [employee(authId)];
  if (table === 'employee_roles') return [{ employee_id: `employee-${authId}`, role: 'admin_hr' }];
  if (table === 'departments') return [{ id: 'dept', name: 'SDM', active: true }];
  if (table === 'positions') return [{ id: 'position', name: 'SPV', department_id: 'dept', is_cashier: false, active: true }];
  if (table === 'outlets') return [{ id: 'outlet', code: 'UJI', name: 'Outlet Uji', active: true, latitude: null, longitude: null, radius_m: 500 }];
  return [];
}

beforeEach(() => {
  vi.resetModules();
  currentSession = null; listener = () => {}; heldTable = null; releaseRead = undefined;
  heldReadStarted = false; failingTable = null; accessAllowed = true; contextEmployeeId = null;
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(() => 1) });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  Object.assign(client, {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: currentSession }, error: null })),
      setSession: vi.fn(async (value: Session) => { currentSession = value; listener('SIGNED_IN', value); return { data: { session: value }, error: null }; }),
      onAuthStateChange: vi.fn((callback: typeof listener) => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
      signOut: vi.fn(async () => { currentSession = null; listener('SIGNED_OUT', null); return { error: null }; })
    },
    functions: { invoke: vi.fn(async () => ({ data: { session: session() }, error: null })) },
    from: vi.fn((table: string) => {
      const capturedSession = currentSession;
      const query: any = { select: () => query, order: () => query, range: async () => {
        if (heldTable === table) {
          heldReadStarted = true;
          await new Promise<void>(resolve => { releaseRead = () => { heldTable = null; resolve(); }; });
        }
        return failingTable === table
          ? { data: null, error: new Error('Data temporarily unavailable'), status: 503 }
          : { data: rows(table, capturedSession), error: null };
      } };
      return query;
    }),
    rpc: vi.fn(async (name: string) => ({ data: name === 'auth_access_context'
      ? { employee_id: contextEmployeeId ?? `employee-${currentSession?.user.id}`, requires_mfa: false, current_level: 'aal1', allowed: accessAllowed, reason: accessAllowed ? null : 'session_revoked' }
      : name === 'leave_balance' ? { remaining: 12, expired: false }
      : name === 'spv_followup_page' ? { items: [] } : [], error: null })),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://example.test/private-signed' }, error: null })) })) },
    channel: vi.fn(() => { const channel: any = { on: () => channel, subscribe: () => channel }; return channel; }),
    removeChannel: vi.fn(async () => 'ok')
  });
});
afterEach(async () => {
  heldTable = null; releaseRead?.();
  // Auth callbacks schedule refresh outside the SDK callback. Drain those
  // scheduled reads before replacing this module's synthetic client/account.
  await new Promise(resolve => setTimeout(resolve, 10));
  vi.unstubAllGlobals(); vi.resetModules();
});

describe('validated login bootstrap', () => {
  it('confirms login before slow operational data, keeps the partial workspace read-only, then hydrates', async () => {
    const { actions, app } = await import('./app'); await actions.init();
    heldTable = 'leave_requests';
    const login = actions.login('RK000001', 'synthetic');
    await vi.waitFor(() => expect(heldReadStarted).toBe(true));
    await login;
    expect(get(app)).toMatchObject({ initialized: true, workspaceLoading: true, user: { id: 'employee-auth-a', fullName: 'Admin A', roles: ['admin_hr'] } });
    expect(get(app).user?.photoUrl).toBeUndefined();
    expect(get(app).employees.every(row => row.photoUrl === undefined)).toBe(true);
    await expect(actions.readNotification()).rejects.toThrow('Data ruang kerja masih dimuat');
    expect(client.rpc).not.toHaveBeenCalledWith('notifications_mark_read', expect.anything());
    releaseRead?.(); await actions.refresh();
    expect(get(app)).toMatchObject({ workspaceLoading: false, user: { id: 'employee-auth-a', photoPath: 'auth-a/private.jpg' } });
    expect(get(app).user?.photoUrl).toBeUndefined();
    expect(client.storage.from).not.toHaveBeenCalled();
  });

  it('does not publish identity or confirm login before employee validation finishes', async () => {
    const { actions, app } = await import('./app'); await actions.init(); heldTable = 'employees';
    let resolved = false;
    const login = actions.login('RK000001', 'synthetic').then(() => { resolved = true; });
    await vi.waitFor(() => expect(heldReadStarted).toBe(true));
    expect(resolved).toBe(false); expect(get(app)).toMatchObject({ initialized: false, user: null });
    releaseRead?.(); await login; await actions.refresh();
    expect(get(app).user?.id).toBe('employee-auth-a');
  });

  it('denies a revoked context before any protected table reads', async () => {
    const { actions, app } = await import('./app'); await actions.init(); accessAllowed = false;
    await expect(actions.login('RK000001', 'synthetic')).rejects.toThrow('Sesi akun tidak berlaku');
    expect(client.from).not.toHaveBeenCalled(); expect(get(app).user).toBeNull();
  });

  it('does not let an already loaded matching token bypass fresh login validation', async () => {
    const { actions, app } = await import('./app'); await actions.init();
    await actions.login('RK000001', 'synthetic'); await actions.refresh();
    accessAllowed = false;
    await expect(actions.login('RK000001', 'synthetic')).rejects.toThrow('Sesi akun tidak berlaku');
    expect(get(app).user).toBeNull();
  });

  it('rejects identity/context mismatch without exposing a partial workspace', async () => {
    const { actions, app } = await import('./app'); await actions.init(); contextEmployeeId = 'another-employee';
    await expect(actions.login('RK000001', 'synthetic')).rejects.toThrow('Akses akun tidak aktif');
    expect(get(app).user).toBeNull(); expect(get(app).workspaceLoading).not.toBe(true);
  });

  it('rejects account A login when account B takes over during a delayed identity read', async () => {
    const { actions, app } = await import('./app'); await actions.init(); heldTable = 'employees';
    const login = actions.login('RK000001', 'synthetic');
    const rejected = expect(login).rejects.toThrow('Sesi akun berubah');
    await vi.waitFor(() => expect(heldReadStarted).toBe(true));
    currentSession = session('auth-b'); listener('SIGNED_IN', currentSession);
    await rejected;
    releaseRead?.(); await actions.refresh();
    expect(get(app).user?.id).toBe('employee-auth-b');
    expect(get(app).employees.map(row => row.id)).not.toContain('employee-auth-a');
  });

  it('retains an honest read-only loading error if background data fails, then recovers on retry', async () => {
    const { actions, app } = await import('./app'); await actions.init(); heldTable = 'leave_requests';
    const login = actions.login('RK000001', 'synthetic');
    await vi.waitFor(() => expect(heldReadStarted).toBe(true)); await login;
    failingTable = 'leave_requests'; releaseRead?.(); await actions.refresh();
    expect(get(app)).toMatchObject({ workspaceLoading: true, user: { id: 'employee-auth-a' }, error: 'Data temporarily unavailable' });
    await expect(actions.readNotification()).rejects.toThrow();
    failingTable = null; await actions.refresh();
    expect(get(app)).toMatchObject({ workspaceLoading: false, error: null, user: { id: 'employee-auth-a' } });
  });
});
