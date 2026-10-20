import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { RealtimeClient } from '@supabase/realtime-js';

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

type MockChannel = { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; emit: (status: string) => void; joined: boolean };
let channels: MockChannel[];
let windowListeners: Map<string, () => void>;
let documentListeners: Map<string, () => void>;
let subscribeThrows = false;

async function flush() { await Promise.resolve(); await Promise.resolve(); }

function installLiveClient() {
  channels = [];
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
    channel: vi.fn(() => {
      let statusCallback: ((status: string) => void) | undefined;
      const channelObject: MockChannel = {
        joined: false,
        on: vi.fn(() => channelObject),
        subscribe: vi.fn((callback: (status: string) => void) => {
          if (channelObject.joined) throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance");
          channelObject.joined = true;
          if (subscribeThrows) throw new Error('mock subscribe failure');
          statusCallback = callback;
          return channelObject;
        }),
        emit(status: string) { statusCallback?.(status); }
      };
      channels.push(channelObject);
      return channelObject;
    }),
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
    subscribeThrows = false;
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

  it('replaces a terminal CLOSED channel with a new instance when the browser reports online', async () => {
    const { app } = await openLiveApp();
    const first = channels[0];
    expect(first.subscribe).toHaveBeenCalledTimes(1);
    first.emit('SUBSCRIBED'); await flush();
    expect(get(app).connected).toBe(true);

    vi.useFakeTimers();
    first.emit('CLOSED');
    expect(get(app).connected).toBe(false);
    windowListeners.get('online')?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(first.subscribe).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(channels).toHaveLength(2);
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(first);
    expect(first.subscribe).toHaveBeenCalledTimes(1);
    channels[1].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(app).connected).toBe(true);
  });

  it('replaces a terminal channel when a suspended page becomes visible again', async () => {
    const { app } = await openLiveApp();
    const first = channels[0];
    first.emit('SUBSCRIBED'); await flush();
    vi.useFakeTimers();
    first.emit('CLOSED');
    documentListeners.get('visibilitychange')?.();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(channels).toHaveLength(2);
    expect(first.subscribe).toHaveBeenCalledTimes(1);
    channels[1].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(app).connected).toBe(true);
  });

  it('uses a new channel for TIMED_OUT and ignores callbacks from the replaced generation', async () => {
    const { app } = await openLiveApp();
    const first = channels[0];
    first.emit('SUBSCRIBED'); await flush();
    vi.useFakeTimers();
    first.emit('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(channels).toHaveLength(2);
    first.emit('SUBSCRIBED');
    expect(get(app).connected).toBe(false);
    channels[1].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(app).connected).toBe(true);
  });

  it('confirms the installed Realtime SDK rejects joining the same terminal channel again', () => {
    vi.useFakeTimers();
    const realtime = new RealtimeClient('ws://127.0.0.1:9/realtime/v1', { params: { apikey: 'test-only' }, timeout: 5 });
    const channel = realtime.channel('hr-sdk-recovery-test');
    const adapter = (channel as unknown as { channelAdapter: { subscribe: () => unknown; state: string; teardown: () => void } }).channelAdapter;
    adapter.subscribe();
    adapter.state = 'closed';
    expect(() => adapter.subscribe()).toThrow("tried to join multiple times. 'join' can only be called a single time per channel instance");
    adapter.teardown();
    realtime.disconnect();
    vi.clearAllTimers();
  });

  it('keeps refetch independent from a thrown subscribe failure', async () => {
    subscribeThrows = true;
    const { actions, app } = await openLiveApp();
    expect(get(app).initialized).toBe(true);
    expect(get(app).employees).toHaveLength(1);
    const readCalls = mockSupabase.from.mock.calls.length;
    await actions.refresh();
    expect(mockSupabase.from.mock.calls.length).toBeGreaterThan(readCalls);
    expect(get(app).employees).toHaveLength(1);
  });

  it('backs off while offline, then replaces the terminal channel after reconnection', async () => {
    const { app } = await openLiveApp();
    const first = channels[0];
    first.emit('SUBSCRIBED'); await flush();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: false });
    first.emit('CLOSED');
    await vi.advanceTimersByTimeAsync(5000);
    expect(channels).toHaveLength(1);
    vi.stubGlobal('navigator', { onLine: true });
    windowListeners.get('online')?.();
    await vi.advanceTimersByTimeAsync(0);
    // The resume refresh is independent. The CLOSED callback also schedules a
    // fresh instance as soon as the browser is online again.
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(channels).toHaveLength(2);
    channels[1].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(app).connected).toBe(true);
  });
});
