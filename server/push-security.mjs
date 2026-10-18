import { ApiError } from './security.mjs';
/** @param {{endpoint:string,keys:{p256dh:string,auth:string}}} value */
export function validateSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { throw new ApiError('subscription', 'Alamat layanan notifikasi tidak valid.'); }
  const host = url.hostname;
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !url.pathname || url.pathname === '/' || value.endpoint.length > 2048) throw new ApiError('subscription', 'Layanan notifikasi browser ini belum didukung.');
  const p256dh = value?.keys?.p256dh, auth = value?.keys?.auth;
  if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh ?? '') || !/^[A-Za-z0-9_-]{22}$/.test(auth ?? '')) throw new ApiError('subscription', 'Kunci notifikasi tidak valid.');
  if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) throw new ApiError('subscription', 'Kunci notifikasi tidak valid.');
  return { endpoint: url.href, keys: { p256dh, auth } };
}
export { GENERIC_PUSH } from '../supabase/functions/_shared/push-delivery.mjs';
