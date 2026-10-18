import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import sharp from 'sharp';
import { authenticate, bodyJSON, requireFresh, sha256 } from '../../server/security.mjs';
import { validateSubscription, GENERIC_PUSH } from '../../server/push-security.mjs';
import { assertFaceMatch, extractFace, descriptorDistance } from '../../server/face-engine.mjs';
import { dispatchPushBatch } from '../../supabase/functions/_shared/push-delivery.mjs';
const require=createRequire(import.meta.url);
const sample=(name:string)=>readFile(join(dirname(require.resolve('@vladmandic/face-api/package.json')),'demo',name));

describe('server identity request boundary',()=>{
  it('rejects cross-origin, missing JWT and unconfigured service before network access',async()=>{
    await expect(authenticate(new Request('https://hr.example/api/biometric',{headers:{Origin:'https://evil.example',Authorization:'Bearer a.b.c'}}),{})).rejects.toMatchObject({code:'origin',status:403});
    await expect(authenticate(new Request('https://hr.example/api/biometric'),{})).rejects.toMatchObject({code:'unauthorized',status:401});
    await expect(authenticate(new Request('https://hr.example/api/biometric',{headers:{Authorization:'Bearer a.b.c'}}),{})).rejects.toMatchObject({code:'unconfigured',status:503});
  });
  it('bounds JSON bytes and refuses non-object or malformed payloads',async()=>{
    await expect(bodyJSON(new Request('https://hr.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'[1]'}))).rejects.toMatchObject({code:'invalid_json'});
    await expect(bodyJSON(new Request('https://hr.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"image":"123456789"}'}),8)).rejects.toMatchObject({code:'too_large'});
    await expect(bodyJSON(new Request('https://hr.example',{method:'POST',body:'{}'}))).rejects.toMatchObject({code:'content_type'});
  });
  it('enforces recent finite capture and changes byte-bound hash',()=>{
    const now=Date.parse('2026-10-18T01:00:00Z');
    expect(()=>requireFresh('2026-10-18T00:58:59Z',60,now)).toThrow('terlalu lama');
    expect(()=>requireFresh('2026-10-18T01:00:11Z',60,now)).toThrow('terlalu lama');
    expect(()=>requireFresh('bad',60,now)).toThrow('terlalu lama');
    expect(()=>requireFresh('2026-10-18T00:59:30Z',60,now)).not.toThrow();
    expect(sha256(Buffer.from('selfie-A'))).not.toBe(sha256(Buffer.from('selfie-B')));
  });
});
describe('device push boundary',()=>{
  const key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,7)]).toString('base64url');
  const valid={endpoint:'https://fcm.googleapis.com/fcm/send/opaque-device-key',keys:{p256dh:key,auth:Buffer.alloc(16,2).toString('base64url')}};
  it('accepts supported push services and rejects SSRF, userinfo, fragments and deceptive domains',()=>{
    expect(validateSubscription(valid).endpoint).toBe(valid.endpoint);
    for(const endpoint of ['http://fcm.googleapis.com/fcm/send/a','https://127.0.0.1/test','https://fcm.googleapis.com.evil.example/send/a','https://x@fcm.googleapis.com/send/a','https://fcm.googleapis.com:444/send/a','https://fcm.googleapis.com/send/a#secret','https://metadata.google.internal/a'])expect(()=>validateSubscription({...valid,endpoint})).toThrow();
    for(const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/Q/a','https://wns2-par02p.notify.windows.com/w/?token=a'])expect(()=>validateSubscription({...valid,endpoint})).not.toThrow();
    expect(()=>validateSubscription({...valid,keys:{...valid.keys,p256dh:'a'.repeat(87)}})).toThrow();
  });
  it('keeps the lock-screen payload generic with a fixed same-origin destination',()=>{
    expect(GENERIC_PUSH).toEqual({title:'HR Rajaklana',body:'Ada pembaruan di aplikasi HR Anda. Buka aplikasi untuk melihatnya.',url:'/dashboard',tag:'hr-update'});
    expect(JSON.stringify(GENERIC_PUSH)).not.toMatch(/reason|employee|approved|rejected|cuti/i);
  });
  it('records delivery, expired subscription and temporary errors with the exact claim lease',async()=>{
    const deliveries=[{id:'one',lease_token:'lease1',endpoint:valid.endpoint,p256dh:key,auth_key:valid.keys.auth},{id:'two',lease_token:'lease2',endpoint:'https://web.push.apple.com/Q/expired',p256dh:key,auth_key:valid.keys.auth},{id:'three',lease_token:'lease3',endpoint:'https://updates.push.services.mozilla.com/wpush/v2/temporary',p256dh:key,auth_key:valid.keys.auth},{id:'four',lease_token:'lease4',endpoint:'https://127.0.0.1/private',p256dh:key,auth_key:valid.keys.auth}];
    const results:{id:string,lease:string,status:number}[]=[],sent:string[]=[];
    const result=await dispatchPushBatch({claim:async()=>({data:deliveries,error:null}),complete:async(row,status)=>{results.push({id:row.id,lease:row.lease_token,status});return{error:null};},send:async(subscription,payload)=>{sent.push(subscription.endpoint);expect(JSON.parse(payload)).toEqual(GENERIC_PUSH);if(subscription.endpoint.includes('expired'))throw{statusCode:410};if(subscription.endpoint.includes('temporary'))throw new Error('network');return{statusCode:201};}});
    expect(result).toEqual({claimed:4,completed:4});expect(sent).toHaveLength(3);
    expect(results).toEqual(expect.arrayContaining([{id:'one',lease:'lease1',status:201},{id:'two',lease:'lease2',status:410},{id:'three',lease:'lease3',status:503},{id:'four',lease:'lease4',status:400}]));
  });
});
describe('actual pinned face model inference',()=>{
  it('matches a transformed same-face sample and rejects another face, no-face, multiple-face and blur',async()=>{
    // Images are the dependency's bundled demo samples, used only in memory.
    // They are never uploaded to a service, enrolled, or copied into the repo.
    const photo=await sample('sample1.jpg');
    const face=await sharp(photo).extract({left:260,top:160,width:550,height:650}).jpeg().toBuffer();
    const transformed=await sharp(face).modulate({brightness:1.05}).jpeg({quality:85}).toBuffer();
    const other=await sharp(await sample('sample3.jpg')).extract({left:430,top:180,width:550,height:650}).jpeg().toBuffer();
    const reference=await extractFace(face),candidate=await extractFace(transformed),different=await extractFace(other);
    expect(reference.descriptor).toHaveLength(128);
    expect(()=>assertFaceMatch(reference.descriptor,candidate.descriptor)).not.toThrow();
    expect(descriptorDistance(reference.descriptor,different.descriptor)).toBeGreaterThan(0.48);
    expect(()=>assertFaceMatch(reference.descriptor,different.descriptor)).toThrow('belum cocok');
    await expect(extractFace(await sharp({create:{width:640,height:640,channels:3,background:'#aaaaaa'}}).jpeg().toBuffer())).rejects.toHaveProperty('code');
    await expect(extractFace(photo)).rejects.toMatchObject({code:'face_count'});
    await expect(extractFace(await sharp(face).blur(25).jpeg().toBuffer())).rejects.toHaveProperty('code');
  },30000);
  it('refuses malformed image bytes and forged or nonfinite descriptors',async()=>{
    await expect(extractFace(Buffer.alloc(1200,7))).rejects.toMatchObject({code:'image_invalid'});
    expect(()=>assertFaceMatch(Array(128).fill(0),Array(128).fill(Number.NaN))).toThrow('didaftarkan ulang');
  });
});
