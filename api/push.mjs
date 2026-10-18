import { ApiError, authenticate, bodyJSON, checkRPC, fail, json } from '../server/security.mjs';
import { validateSubscription } from '../server/push-security.mjs';
/** @param {Request} request */
export async function POST(request) {
  try {
    const { client } = await authenticate(request), input = await bodyJSON(request,10000);
    if (input.action==='config') {
      if (!/^[A-Za-z0-9_-]{87}$/.test(process.env.VAPID_PUBLIC_KEY??'')) throw new ApiError('unconfigured','Notifikasi perangkat belum dikonfigurasi.',503);
      return json({publicKey:process.env.VAPID_PUBLIC_KEY});
    }
    if (input.action==='subscribe') {
      const subscription = validateSubscription(input.subscription);
      checkRPC(await client.rpc('push_subscribe',{p_endpoint:subscription.endpoint,p_p256dh:subscription.keys.p256dh,p_auth:subscription.keys.auth,p_device:String(input.device??'Browser').slice(0,100)}));
      return json({ok:true});
    }
    if (input.action==='unsubscribe') {
      checkRPC(await client.rpc('push_unsubscribe',{p_endpoint:String(input.endpoint??'')}));
      return json({ok:true});
    }
    throw new ApiError('action','Tindakan tidak dikenal.');
  } catch(error) { return fail(error); }
}
