import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';
import { dispatchPushBatch } from '../_shared/push-delivery.mjs';

async function sameSecret(value:string,expected:string) {
  // Compare fixed-size SHA-256 digests without exposing the credential in logs.
  const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected)));
  return a.reduce((difference,byte,i)=>difference|(byte^b[i]),0)===0;
}
Deno.serve(async request=>{
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const secret=Deno.env.get('PUSH_WORKER_SECRET');
  if(!secret||!await sameSecret(request.headers.get('x-hr-push-wake')??'',secret))return new Response('Unauthorized',{status:401});
  const publicKey=Deno.env.get('VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('VAPID_PRIVATE_KEY'),contact=Deno.env.get('PUSH_CONTACT');
  if(!publicKey||!privateKey||!contact)return new Response('Not configured',{status:503});
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    // Consent withdrawal removes descriptors synchronously. Physical reference
    // files are retried here if Storage was unavailable during that request.
    const cleanup=await client.rpc('biometric_cleanup_claim');
    for(const file of cleanup.data??[]){
      const result=await client.storage.from('biometric-references').remove([file.image_path]);
      if(!result.error)await client.rpc('biometric_cleanup_complete',{p_image_path:file.image_path});
    }
    const result=await dispatchPushBatch({
      claim:async()=>await client.rpc('push_claim',{p_limit:30}),
      complete:async(row,status)=>await client.rpc('push_complete',{p_id:row.id,p_lease_token:row.lease_token,p_status:status}),
      send:async(subscription,payload)=>await webpush.sendNotification(subscription,payload,{vapidDetails:{subject:contact,publicKey,privateKey},TTL:3600,urgency:'normal',timeout:10000})
    });
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch{
    console.error('Push worker failed',{category:'queue_unavailable'});
    return new Response('Queue unavailable',{status:503});
  }
});
