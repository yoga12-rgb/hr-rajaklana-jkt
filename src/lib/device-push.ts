import { supabase } from './state/client';
async function pushAPI(body:Record<string,unknown>) {
  if(!supabase)throw new Error('Notifikasi perangkat tersedia setelah aplikasi terhubung ke server.');
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('Silakan login kembali.');
  const response=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error??'Notifikasi perangkat belum dapat diatur.');
  return data;
}
export function pushSupported() { return typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&window.isSecureContext; }
function keyBytes(key:string) { const value=atob(key.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(key.length/4)*4,'=')); return Uint8Array.from(value,c=>c.charCodeAt(0)); }
export async function devicePushStatus() {
  if(!pushSupported())return 'unsupported';
  if(Notification.permission==='denied')return 'denied';
  const registration=await navigator.serviceWorker.getRegistration();
  return registration&&await registration.pushManager.getSubscription()?'enabled':'disabled';
}
export async function enableDevicePush() {
  if(!pushSupported())throw new Error('Browser ini belum mendukung notifikasi perangkat. Di iPhone/iPad, pasang aplikasi ke Layar Utama terlebih dahulu.');
  // This function is called only by the explicit opt-in button, never on mount.
  if(await Notification.requestPermission()!=='granted')throw new Error('Izin notifikasi belum diberikan. Anda tetap dapat membaca kotak notifikasi di aplikasi.');
  const {publicKey}=await pushAPI({action:'config'});
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
  try{await pushAPI({action:'subscribe',subscription:subscription.toJSON(),device:navigator.userAgent.slice(0,100)});}
  catch(error){await subscription.unsubscribe();throw error;}
}
export async function disableDevicePush() {
  if(!pushSupported())return;
  const registration=await navigator.serviceWorker.getRegistration();
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)return;
  try{await pushAPI({action:'unsubscribe',endpoint:subscription.endpoint});}
  finally{await subscription.unsubscribe();}
}
