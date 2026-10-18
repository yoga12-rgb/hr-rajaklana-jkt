import { supabase } from './state/client';

export type DevicePushState = 'install_required' | 'unsupported' | 'insecure' | 'denied' | 'disabled' | 'enabled' | 'unavailable';
export interface DevicePushEnvironment {
  ios: boolean;
  standalone: boolean;
  state: 'install_required' | 'unsupported' | 'insecure' | 'disabled';
}

const STATUS_TIMEOUT = 8_000;
const API_TIMEOUT = 12_000;
const SUBSCRIBE_TIMEOUT = 30_000;
const workerMessage = 'Notifikasi perangkat belum siap. Buka ulang aplikasi dari Layar Utama, lalu tekan Periksa ulang.';
type PreparedPush = { registration: ServiceWorkerRegistration; key: Uint8Array<ArrayBuffer>; subscription: PushSubscription | null; userId: string };
let prepared: PreparedPush | null = null;
let statusGeneration = 0;

export function devicePushEnvironment(): DevicePushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ios: false, standalone: false, state: 'unsupported' };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || ((navigator.platform === 'MacIntel' || /Macintosh/.test(navigator.userAgent)) && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  if (!window.isSecureContext) return { ios, standalone, state: 'insecure' };
  if (ios && !standalone) return { ios, standalone, state: 'install_required' };
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { ios, standalone, state: supported ? 'disabled' : 'unsupported' };
}

export function pushSupported() { return devicePushEnvironment().state === 'disabled'; }

function bounded<T>(operation: PromiseLike<T>, deadline: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { reject(new Error(message)); return; }
    const timer = setTimeout(() => reject(new Error(message)), remaining);
    Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function pushAPI(body: Record<string, unknown>, deadline = Date.now() + API_TIMEOUT, expectedUserId?: string): Promise<{ data: Record<string, unknown>; userId: string }> {
  if (!supabase) throw new Error('Notifikasi perangkat tersedia setelah aplikasi terhubung ke server.');
  const timeoutMessage = 'Server notifikasi belum merespons. Periksa koneksi, lalu coba kembali.';
  const { data: { session }, error } = await bounded(supabase.auth.getSession(), deadline, timeoutMessage);
  if (error || !session?.user?.id) throw new Error('Silakan login kembali.');
  if (expectedUserId && session.user.id !== expectedUserId) throw new Error('Akun telah berubah. Tekan Periksa ulang sebelum mengaktifkan notifikasi.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    const response = await bounded(fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
      signal: controller.signal
    }), deadline, timeoutMessage);
    const data = await bounded(response.json(), deadline, timeoutMessage) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Notifikasi perangkat belum dapat diatur.');
    return { data, userId: session.user.id };
  } finally { clearTimeout(timer); controller.abort(); }
}

function keyBytes(key: unknown): Uint8Array<ArrayBuffer> {
  try {
    if (typeof key !== 'string') throw new Error('missing');
    const value = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
    const bytes = Uint8Array.from(value, c => c.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('invalid');
    return bytes;
  } catch { throw new Error('Konfigurasi notifikasi perangkat belum siap. Hubungi Admin HR.'); }
}

function activeRegistration(registration: ServiceWorkerRegistration | undefined): registration is ServiceWorkerRegistration {
  return !!registration?.active && registration.active.state === 'activated' && !!registration.pushManager;
}

/** Read-only probe. It never requests permission, subscribes, or rebinds an account. */
export async function devicePushStatus(): Promise<DevicePushState> {
  const generation = ++statusGeneration;
  prepared = null;
  const environment = devicePushEnvironment();
  if (environment.state !== 'disabled') return environment.state;
  if (Notification.permission === 'denied') return 'denied';
  if (!supabase) return 'unavailable';
  const deadline = Date.now() + STATUS_TIMEOUT;
  try {
    const result = await bounded((async () => {
      const [registration, configuration] = await Promise.all([
        navigator.serviceWorker.getRegistration(),
        pushAPI({ action: 'config' }, deadline)
      ]);
      if (!activeRegistration(registration)) throw new Error(workerMessage);
      const key = keyBytes(configuration.data.publicKey);
      const subscription = await registration.pushManager.getSubscription();
      let owned = false;
      if (subscription) {
        const { data, error } = await supabase!.rpc('push_subscription_status', { p_endpoint: subscription.endpoint });
        if (error) throw error;
        owned = data === true;
      }
      return { preparation: { registration, key, subscription, userId: configuration.userId }, state: owned && Notification.permission === 'granted' ? 'enabled' as const : 'disabled' as const };
    })(), deadline, workerMessage);
    if (generation === statusGeneration) prepared = result.preparation;
    return result.state;
  } catch { return 'unavailable'; }
}

export async function enableDevicePush(): Promise<void> {
  const environment = devicePushEnvironment();
  if (environment.state === 'install_required') throw new Error('Di iPhone/iPad, tambahkan aplikasi ke Layar Utama melalui Safari, lalu buka dari ikonnya.');
  if (environment.state === 'insecure') throw new Error('Notifikasi perangkat memerlukan alamat HTTPS.');
  if (environment.state === 'unsupported') throw new Error('Browser ini belum mendukung notifikasi perangkat. Perbarui browser atau sistem perangkat.');
  if (Notification.permission === 'denied') throw new Error('Izin notifikasi diblokir. Aktifkan melalui pengaturan notifikasi perangkat, lalu tekan Periksa ulang.');
  const preparation = prepared;
  if (!supabase || !preparation || !activeRegistration(preparation.registration)) throw new Error(workerMessage);
  const activationGeneration = statusGeneration;

  // Called from the opt-in click: subscribe must start before any awaited work.
  // It asks permission itself; a preceding requestPermission can consume iOS activation.
  const pending = preparation.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: preparation.key });
  let subscription: PushSubscription;
  try {
    subscription = await bounded(pending, Date.now() + SUBSCRIBE_TIMEOUT, 'Permintaan izin notifikasi belum selesai. Periksa izin perangkat, lalu coba kembali.');
  } catch (error) {
    // A browser operation cannot be aborted. Remove only a newly-created late result.
    void Promise.resolve(pending).then(late => {
      if (activationGeneration === statusGeneration && late.endpoint !== preparation.subscription?.endpoint) return late.unsubscribe();
    }).catch(() => undefined);
    throw error;
  }
  try {
    if (activationGeneration !== statusGeneration) throw new Error('Akun atau pemeriksaan perangkat berubah. Tekan Periksa ulang sebelum mengaktifkan notifikasi.');
    await pushAPI({ action: 'subscribe', subscription: subscription.toJSON(), device: navigator.userAgent.slice(0, 100) }, Date.now() + API_TIMEOUT, preparation.userId);
    if (activationGeneration === statusGeneration) prepared = { ...preparation, subscription };
  } catch (error) {
    if (activationGeneration === statusGeneration && subscription.endpoint !== preparation.subscription?.endpoint) {
      await bounded(subscription.unsubscribe(), Date.now() + 3_000, workerMessage).catch(() => undefined);
    }
    throw error;
  }
}

export async function disableDevicePush(): Promise<void> {
  ++statusGeneration;
  prepared = null;
  if (!pushSupported()) return;
  const deadline = Date.now() + STATUS_TIMEOUT;
  const registration = await bounded(navigator.serviceWorker.getRegistration(), deadline, workerMessage);
  const subscription = await bounded(registration?.pushManager.getSubscription() ?? Promise.resolve(null), deadline, workerMessage);
  if (!subscription) return;
  try { await pushAPI({ action: 'unsubscribe', endpoint: subscription.endpoint }, deadline); }
  finally { await bounded(subscription.unsubscribe(), Date.now() + 2_000, workerMessage); }
}
