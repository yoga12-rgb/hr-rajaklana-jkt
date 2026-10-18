export const GENERIC_PUSH=Object.freeze({title:'HR Rajaklana',body:'Ada pembaruan di aplikasi HR Anda. Buka aplikasi untuk melihatnya.',url:'/dashboard',tag:'hr-update'});
/** @param {string} endpoint */
export function trustedEndpoint(endpoint){
  try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(u.hostname)||/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));}catch{return false;}
}
/** @typedef {{id:string,lease_token:string,endpoint:string,p256dh:string,auth_key:string}} Delivery */
/**
 * @param {{claim:()=>Promise<{data:Delivery[]|null,error:unknown}>,complete:(row:Delivery,status:number)=>Promise<{error:unknown}>,send:(subscription:{endpoint:string,keys:{p256dh:string,auth:string}},payload:string)=>Promise<{statusCode:number}>}} io
 */
export async function dispatchPushBatch(io){
  const claim=await io.claim();
  if(claim.error)throw new Error('Push queue claim failed');
  let completed=0;
  await Promise.all((claim.data??[]).map(async row=>{
    let status=400;
    if(trustedEndpoint(row.endpoint)){
      try{status=(await io.send({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth_key}},JSON.stringify(GENERIC_PUSH))).statusCode;}
      catch(error){status=typeof error==='object'&&error!==null&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:503;}
    }
    const result=await io.complete(row,status);
    if(!result.error)completed++;
  }));
  return{claimed:claim.data?.length??0,completed};
}
