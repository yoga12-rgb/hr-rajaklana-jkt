import { afterEach, describe, expect, it, vi } from 'vitest';

const publicKey = btoa(String.fromCharCode(4, ...Array<number>(64).fill(1))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const never = <T>() => new Promise<T>(() => undefined);

async function harness(options: {
  ios?: boolean; ipadDesktop?: boolean; standalone?: boolean; legacyStandalone?: boolean;
  permission?: NotificationPermission; insecure?: boolean; unsupported?: boolean; configured?: boolean;
} = {}) {
  vi.resetModules();
  const subscription = {
    endpoint: 'https://web.push.apple.com/synthetic-test-endpoint',
    toJSON: vi.fn(() => ({ endpoint: 'https://web.push.apple.com/synthetic-test-endpoint', keys: { auth: 'synthetic', p256dh: 'synthetic' } })),
    unsubscribe: vi.fn(async () => true)
  };
  const pushManager = {
    getSubscription: vi.fn(async (): Promise<PushSubscription | null> => null),
    subscribe: vi.fn(async () => subscription as unknown as PushSubscription)
  };
  const registration = { active: { state: 'activated' }, pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration as unknown as ServiceWorkerRegistration),
    // This promise never settles, as permitted by the browser API. No code should await it.
    ready: never<ServiceWorkerRegistration>()
  };
  const notification = { permission: options.permission ?? 'default', requestPermission: vi.fn(async () => 'granted') };
  const navigatorMock = {
    userAgent: options.ipadDesktop ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari' : options.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Synthetic desktop browser',
    platform: options.ipadDesktop ? 'MacIntel' : options.ios ? 'iPhone' : 'Win32',
    maxTouchPoints: options.ipadDesktop || options.ios ? 5 : 0,
    standalone: options.legacyStandalone ?? false,
    serviceWorker
  };
  const windowMock = {
    isSecureContext: !options.insecure,
    matchMedia: vi.fn(() => ({ matches: options.standalone ?? false })),
    ...(options.unsupported ? {} : { PushManager: function PushManager() {}, Notification: notification })
  };
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('navigator', navigatorMock);
  vi.stubGlobal('Notification', notification);
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'synthetic-user-token', user: { id: 'synthetic-cashier' } } }, error: null })) },
    rpc: vi.fn(async (): Promise<{ data: boolean | null; error: Error | null }> => ({ data: true, error: null }))
  };
  vi.doMock('./state/client', () => ({ supabase: options.configured === false ? null : client }));
  const fetchMock = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({ publicKey }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const push = await import('./device-push');
  return { push, subscription, pushManager, registration, serviceWorker, notification, navigatorMock, windowMock, client, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./state/client');
});

describe('Dukungan push iPhone/iPad', () => {
  it('meminta instalasi untuk iPhone di tab browser meskipun API tersedia', async () => {
    const { push, fetchMock } = await harness({ ios: true });
    expect(push.devicePushEnvironment()).toMatchObject({ ios: true, standalone: false, state: 'install_required' });
    expect(await push.devicePushStatus()).toBe('install_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mengenali iPad yang memakai user agent desktop', async () => {
    const { push } = await harness({ ipadDesktop: true });
    expect(push.devicePushEnvironment()).toMatchObject({ ios: true, state: 'install_required' });
  });

  it('menerima Home Screen melalui display-mode maupun navigator.standalone', async () => {
    for (const options of [{ ios: true, standalone: true }, { ipadDesktop: true, legacyStandalone: true }]) {
      const { push } = await harness(options);
      expect(push.devicePushEnvironment()).toMatchObject({ ios: true, standalone: true, state: 'disabled' });
      expect(push.pushSupported()).toBe(true);
    }
  });

  it('membedakan HTTPS, browser tanpa API, dan rendering server', async () => {
    expect((await harness({ insecure: true })).push.devicePushEnvironment().state).toBe('insecure');
    const { push } = await harness({ unsupported: true });
    expect(push.devicePushEnvironment().state).toBe('unsupported');
    vi.stubGlobal('window', undefined);
    expect(push.devicePushEnvironment().state).toBe('unsupported');
  });

  it('tidak menganggap Mac desktop tanpa layar sentuh sebagai iPad', async () => {
    const { push, navigatorMock } = await harness({ ipadDesktop: true });
    navigatorMock.maxTouchPoints = 0;
    expect(push.devicePushEnvironment()).toMatchObject({ ios: false, state: 'disabled' });
  });
});

describe('Pemeriksaan notifikasi tanpa mengubah izin atau langganan', () => {
  it('menyiapkan aktivasi tanpa meminta izin, subscribe, atau menunggu ready', async () => {
    const { push, notification, pushManager, client } = await harness();
    expect(await push.devicePushStatus()).toBe('disabled');
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('menampilkan izin ditolak tanpa mencoba server atau browser lagi', async () => {
    const { push, fetchMock, serviceWorker } = await harness({ permission: 'denied' });
    expect(await push.devicePushStatus()).toBe('denied');
    await expect(push.enableDevicePush()).rejects.toThrow('Izin notifikasi diblokir');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serviceWorker.getRegistration).not.toHaveBeenCalled();
  });

  it('tidak mengaku aktif hanya karena langganan lokal masih ada', async () => {
    const { push, subscription, pushManager, client } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    client.rpc.mockResolvedValue({ data: false, error: null });
    expect(await push.devicePushStatus()).toBe('disabled');
    expect(client.rpc).toHaveBeenCalledWith('push_subscription_status', { p_endpoint: subscription.endpoint });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('hanya aktif bila server membenarkan kepemilikan dan izin diberikan', async () => {
    const { push, subscription, pushManager } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    expect(await push.devicePushStatus()).toBe('enabled');
  });

  it('gagal dengan status yang dapat dicoba ulang jika RPC atau konfigurasi belum siap', async () => {
    const { push, subscription, pushManager, client, fetchMock } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    client.rpc.mockResolvedValueOnce({ data: null, error: new Error('server unavailable') });
    expect(await push.devicePushStatus()).toBe('unavailable');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not configured' }), { status: 503 }));
    expect(await push.devicePushStatus()).toBe('unavailable');
    expect(await push.devicePushStatus()).toBe('enabled');
  });

  it('menolak mode tanpa koneksi Supabase dan service worker yang belum aktif', async () => {
    const disconnected = await harness({ configured: false });
    expect(await disconnected.push.devicePushStatus()).toBe('unavailable');
    expect(disconnected.fetchMock).not.toHaveBeenCalled();
    const { push, registration } = await harness();
    registration.active.state = 'activating';
    expect(await push.devicePushStatus()).toBe('unavailable');
    await expect(push.enableDevicePush()).rejects.toThrow('Periksa ulang');
  });

  it('membatasi getRegistration yang macet dan memungkinkan pemeriksaan ulang', async () => {
    const { push, serviceWorker } = await harness();
    vi.useFakeTimers();
    serviceWorker.getRegistration.mockReturnValueOnce(never<ServiceWorkerRegistration>());
    const status = push.devicePushStatus();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await status).toBe('unavailable');
    expect(await push.devicePushStatus()).toBe('disabled');
  });

  it('membatasi pembacaan sesi yang macet pada pemeriksaan awal', async () => {
    const { push, client, fetchMock } = await harness();
    vi.useFakeTimers();
    client.auth.getSession.mockReturnValueOnce(never());
    const status = push.devicePushStatus();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await status).toBe('unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('membatasi getSubscription yang macet tanpa membiarkan hasil lama menyiapkan aktivasi', async () => {
    const { push, pushManager } = await harness();
    vi.useFakeTimers();
    pushManager.getSubscription.mockReturnValueOnce(never<PushSubscription | null>());
    const status = push.devicePushStatus();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await status).toBe('unavailable');
    await expect(push.enableDevicePush()).rejects.toThrow('Periksa ulang');
  });
});

describe('Aktivasi eksplisit dan logout', () => {
  it('memanggil subscribe langsung dalam klik sebelum pekerjaan jaringan berikutnya', async () => {
    const { push, pushManager, notification, fetchMock } = await harness({ ios: true, standalone: true });
    await push.devicePushStatus();
    fetchMock.mockClear();
    const activation = push.enableDevicePush();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notification.requestPermission).not.toHaveBeenCalled();
    await activation;
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).action).toBe('subscribe');
  });

  it('mempertahankan error asli browser saat subscribe gagal', async () => {
    const { push, pushManager } = await harness();
    await push.devicePushStatus();
    const browserError = new DOMException('User denied native push prompt', 'NotAllowedError');
    pushManager.subscribe.mockRejectedValueOnce(browserError);
    await expect(push.enableDevicePush()).rejects.toBe(browserError);
  });

  it('tidak mengikat hasil klik lama setelah akun atau pemeriksaan berganti', async () => {
    const { push, pushManager, subscription, fetchMock } = await harness();
    await push.devicePushStatus();
    let finish!: (value: PushSubscription) => void;
    pushManager.subscribe.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const activation = expect(push.enableDevicePush()).rejects.toThrow('Akun atau pemeriksaan perangkat berubah');
    await push.devicePushStatus();
    finish(subscription as unknown as PushSubscription);
    await activation;
    expect(fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).action)).toEqual(['config', 'config']);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('menolak sesi akun lain setelah persetujuan native dan membersihkan langganan baru', async () => {
    const { push, pushManager, subscription, fetchMock, client } = await harness();
    await push.devicePushStatus();
    let finish!: (value: PushSubscription) => void;
    pushManager.subscribe.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const activation = expect(push.enableDevicePush()).rejects.toThrow('Akun telah berubah');
    client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'new-account-token', user: { id: 'synthetic-hr' } } }, error: null });
    finish(subscription as unknown as PushSubscription);
    await activation;
    expect(fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).action)).toEqual(['config']);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('membatalkan langganan baru jika penyimpanan server gagal', async () => {
    const { push, subscription, fetchMock } = await harness();
    await push.devicePushStatus();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Langganan tidak tersimpan' }), { status: 500 }));
    await expect(push.enableDevicePush()).rejects.toThrow('Langganan tidak tersimpan');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('tidak menghapus langganan lama ketika pengikatan akun gagal', async () => {
    const { push, subscription, pushManager, fetchMock } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    await push.devicePushStatus();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Pengikatan ditolak' }), { status: 403 }));
    await expect(push.enableDevicePush()).rejects.toThrow('Pengikatan ditolak');
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it('menghentikan penantian aktivasi dan membersihkan hasil browser yang terlambat', async () => {
    const { push, pushManager, subscription } = await harness();
    await push.devicePushStatus();
    vi.useFakeTimers();
    let finish!: (value: PushSubscription) => void;
    pushManager.subscribe.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const activation = expect(push.enableDevicePush()).rejects.toThrow('Permintaan izin notifikasi belum selesai');
    await vi.advanceTimersByTimeAsync(30_000);
    await activation;
    finish(subscription as unknown as PushSubscription);
    await vi.runAllTimersAsync();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('tetap unsubscribe lokal saat server logout gagal', async () => {
    const { push, subscription, pushManager, fetchMock } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Koneksi terputus' }), { status: 503 }));
    await expect(push.disableDevicePush()).rejects.toThrow('Koneksi terputus');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    await expect(push.enableDevicePush()).rejects.toThrow('Periksa ulang');
  });

  it('logout tidak menunggu server yang macet tanpa batas', async () => {
    const { push, subscription, pushManager, fetchMock } = await harness({ permission: 'granted' });
    pushManager.getSubscription.mockResolvedValue(subscription as unknown as PushSubscription);
    fetchMock.mockReturnValueOnce(never<Response>());
    vi.useFakeTimers();
    const disabling = expect(push.disableDevicePush()).rejects.toThrow('Server notifikasi belum merespons');
    await vi.advanceTimersByTimeAsync(8_000);
    await disabling;
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});

