import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: {} as Record<string, any> }));
vi.mock('./client', () => ({ configured: true, supabase: mockSupabase }));

const session = { user: { id: 'auth-admin' }, access_token: 'test-session' };
const liveTables: Record<string, Record<string, unknown>[]> = {
  employees: [{ id: 'employee-admin', employee_number: 'RK000001', full_name: 'Admin Uji', whatsapp: '0812', department_id: 'department', position_id: 'position', outlet_id: 'outlet', starts_on: '2025-01-01', status: 'active', account_status: 'active', auth_user_id: 'auth-admin', can_middle_shift: false, weekly_off_days: [], approval_mode: 'internal', gender: 'unspecified' }],
  employee_roles: [{ employee_id: 'employee-admin', role: 'admin_hr' }],
  departments: [{ id: 'department', name: 'Kasir', code: 'KSR', active: true }],
  positions: [{ id: 'position', name: 'Admin Uji', department_id: 'department', active: true, is_cashier: false }],
  outlets: [{ id: 'outlet', code: 'UJI', name: 'Outlet Uji', address: '', active: true, production_location: false, latitude: null, longitude: null, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 10 }]
};

let channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; emit: (status: string) => void };
let windowListeners: Map<string, () => void>;
let documentListeners: Map<string, () => void>;

function flush() { return new Promise(resolve => setTimeout(resolve, 0)); }

function installLiveClient() {
  let channelState = 'closed';
  let statusCallback: ((status: string) => void) | undefined;
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn((callback: (status: string) => void) => {
      if (channelState === 'closed') { channelState = 'joining'; statusCallback = callback; }
      return channelObject;
    }),
    emit(status: string) {
      if (status === 'CLOSED') channelState = 'closed';
      if (status === 'SUBSCRIBED') channelState = 'joined';
      statusCallback?.(status);
    }
  };
  channel = channelObject;
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn((table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(async () => ({ data: liveTables[table] ?? [], error: null }))
      };
      return query;
    }),
    rpc: vi.fn(async (name: string) => ({ data: name === 'leave_balance' ? { expired: false, remaining: 12 } : [], error: null })),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: '' }, error: null })) })) },
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(async () => 'ok')
  };
  Object.assign(mockSupabase, client);
}

async function openLiveApp() {
  const { actions, app } = await import('./app');
  await actions.init();
  return { actions, app };
}

describe('live Realtime recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    windowListeners = new Map(); documentListeners = new Map();
    installLiveClient();
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      addEventListener: vi.fn((event: string, callback: () => void) => windowListeners.set(event, callback)),
      setInterval: vi.fn(() => 1)
    });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn((event: string, callback: () => void) => documentListeners.set(event, callback))
    });
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('rejoins a closed channel after the browser reports that it is online', async () => {
    const { app } = await openLiveApp();
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    channel.emit('SUBSCRIBED'); await flush();
    expect(get(app).connected).toBe(true);

    channel.emit('CLOSED');
    expect(get(app).connected).toBe(false);
    windowListeners.get('online')?.(); await flush();

    expect(channel.subscribe).toHaveBeenCalledTimes(2);
    channel.emit('SUBSCRIBED'); await flush();
    expect(get(app).connected).toBe(true);
  });

  it('rejoins a closed channel when a suspended page becomes visible again', async () => {
    const { app } = await openLiveApp();
    channel.emit('SUBSCRIBED'); await flush();
    channel.emit('CLOSED');
    documentListeners.get('visibilitychange')?.(); await flush();

    expect(channel.subscribe).toHaveBeenCalledTimes(2);
    channel.emit('SUBSCRIBED'); await flush();
    expect(get(app).connected).toBe(true);
  });

  it('backs off and rejoins an unexpectedly closed channel without waiting for a browser event', async () => {
    const { app } = await openLiveApp();
    channel.emit('SUBSCRIBED'); await flush();
    vi.useFakeTimers();
    channel.emit('CLOSED');

    expect(get(app).connected).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(channel.subscribe).toHaveBeenCalledTimes(2);
  });
});
