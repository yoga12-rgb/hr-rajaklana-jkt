import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
const boundary = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('../../server/security.mjs', async () => ({
  ...await vi.importActual<typeof import('../../server/security.mjs')>('../../server/security.mjs'),
  authenticate: boundary.authenticate
}));
import { POST as biometric } from '../../api/biometric.mjs';
import { POST as selfie, validateSelfieImage } from '../../api/attendance-selfie.mjs';
import { POST as push } from '../../api/push.mjs';
import { ApiError, sha256 } from '../../server/security.mjs';
const now = new Date('2026-10-18T01:00:00Z');
const authId = '10000000-0000-4000-9000-000000000011';
const employeeId = '20000000-0000-4000-9000-000000000011';
const foreignId = '20000000-0000-4000-9000-000000000099';
const nonce = '40000000-0000-4000-9000-000000000011';
const storageObjectId = '50000000-0000-4000-9000-000000000011';
const expiresAt = '2026-10-18T01:02:00Z';
const pixels = Buffer.from(Array.from({length:480*480*3},(_,i)=>(i*37+Math.floor(i/480))%256));
const storedSelfie = await sharp(pixels,{raw:{width:480,height:480,channels:3}}).jpeg().toBuffer();
const clientRPC = vi.fn(), adminRPC = vi.fn(), download = vi.fn(), upload = vi.fn(), remove = vi.fn(), fetchSpy = vi.fn();
const storageFrom = vi.fn(() => ({ download, upload, remove }));
const request = (body: unknown, route = 'attendance-selfie') => new Request('https://hr.example/api/'+route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic.jwt.only' }, body: JSON.stringify(body)
});
const verifyInput = (overrides: Record<string, unknown> = {}) => ({
  action: 'verify', selfiePath: authId+'/fresh-selfie.jpg', shift: 'morning',
  latitude: -6.2, longitude: 106.8, accuracy: 10,
  geoCapturedAt: now.toISOString(), selfieCapturedAt: now.toISOString(), selfieOutletName: 'Synthetic outlet', ...overrides
});
const validSubscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device') => ({
  endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') }
});
const receiptCalls = () => adminRPC.mock.calls.filter(([name]) => name === 'attendance_issue_selfie_receipt');
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockRejectedValue(new Error('Network is forbidden in handler tests'));
  adminRPC.mockImplementation(async (name: string) => {
    if (name === 'attendance_selfie_object') return { data: storageObjectId, error: null };
    if (name === 'auth_rate_limit') return { data: true, error: null };
    if (name === 'attendance_issue_selfie_receipt') return { data: [{ id: nonce, expires_at: expiresAt }], error: null };
    throw new Error('Unexpected synthetic RPC: '+name);
  });
  clientRPC.mockImplementation(async(name: string)=>({data:name==='auth_access_context'?{employee_id:employeeId,allowed:true,requires_mfa:false,current_level:'aal1',reason:null}:true,error:null}));
  download.mockResolvedValue({ data: new Blob([storedSelfie]), error: null });
  upload.mockResolvedValue({ data: {}, error: null }); remove.mockResolvedValue({ data: {}, error: null });
  boundary.authenticate.mockResolvedValue({
    user: { id: authId }, employee: { id: employeeId, can_clock: true },
    admin: { rpc: adminRPC, storage: { from: storageFrom } }, client: { rpc: clientRPC }
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Retired face endpoint', () => {
  it.each(['status','enroll','review','withdraw','verify'])('returns410 without authenticating or touching data: %s', async action => {
    const response=await biometric();
    expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'feature_removed'});
    expect(boundary.authenticate).not.toHaveBeenCalled();expect(adminRPC).not.toHaveBeenCalled();expect(storageFrom).not.toHaveBeenCalled();
  });
});
describe('Actual API authentication/error boundary', () => {
  it.each([['attendance-selfie', selfie], ['push', push]] as const)('%s denies unauthenticated side effects', async (route, handler) => {
    boundary.authenticate.mockRejectedValue(new ApiError('unauthorized', 'Silakan login kembali.', 401));
    const response = await handler(request({ action: 'verify' }, route));
    expect(response.status).toBe(401);expect(await response.json()).toEqual({ code: 'unauthorized', error: 'Silakan login kembali.' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(adminRPC).not.toHaveBeenCalled();expect(clientRPC).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
  });
  it('hides unexpected credentials/image details in responses and logs', async () => {
    const logs=vi.spyOn(console,'error').mockImplementation(()=>{});
    boundary.authenticate.mockRejectedValue(new Error('SERVICE_SECRET private-photo-path'));
    const response=await selfie(request(verifyInput()));expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({code:'unavailable'});expect(JSON.stringify(logs.mock.calls)).not.toMatch(/SERVICE_SECRET|private-photo-path/);
  });
  it('rejects non-object JSON before storage/RPC', async () => {
    const response=await selfie(new Request('https://hr.example/api/attendance-selfie',{method:'POST',headers:{'Content-Type':'application/json'},body:'[1,2]'}));
    expect(await response.json()).toMatchObject({code:'invalid_json'});expect(adminRPC).not.toHaveBeenCalled();expect(storageFrom).not.toHaveBeenCalled();
  });
});
describe('Non-biometric attendance selfie handler', () => {
  it.each([foreignId+'/foreign.jpg', authId+'/../foreign.jpg', 'https://evil.example/image.jpg'])('denies an unowned path: %s', async selfiePath=>{
    const response=await selfie(request(verifyInput({selfiePath})));expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({code:'selfie_owner'});expect(download).not.toHaveBeenCalled();expect(receiptCalls()).toHaveLength(0);
  });
  it('issues a server-hashed selfie receipt without any face reference or enrollment', async()=>{
    const response=await selfie(request(verifyInput({employeeId:foreignId,p_employee_id:foreignId,referenceId:'forged',storageObjectId:'forged',descriptor:[9],imageHash:'forged'})));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({verificationToken:nonce,expiresAt});
    expect(adminRPC).toHaveBeenCalledWith('attendance_selfie_object',{p_employee_id:employeeId,p_selfie_path:authId+'/fresh-selfie.jpg'});
    expect(download).toHaveBeenCalledWith(authId+'/fresh-selfie.jpg');
    expect(adminRPC).toHaveBeenCalledWith('attendance_issue_selfie_receipt',{
      p_employee_id:employeeId,p_storage_object_id:storageObjectId,p_selfie_path:authId+'/fresh-selfie.jpg',p_selfie_sha256:sha256(storedSelfie),p_shift:'morning',
      p_latitude:-6.2,p_longitude:106.8,p_accuracy_m:10,p_geo_captured_at:now.toISOString(),p_selfie_captured_at:now.toISOString(),p_selfie_outlet_name:'Synthetic outlet'
    });
    expect(adminRPC.mock.calls.every(([name])=>!name.startsWith('biometric'))).toBe(true);
    expect(clientRPC).toHaveBeenCalledWith('auth_access_context');expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(['geoCapturedAt','selfieCapturedAt'])('denies stale %s before download',async field=>{
    const response=await selfie(request(verifyInput({[field]:new Date(now.getTime()-60001).toISOString()})));
    expect(await response.json()).toMatchObject({code:'stale_capture'});expect(download).not.toHaveBeenCalled();expect(receiptCalls()).toHaveLength(0);
  });
  it('rechecks time after download and does not mint a stale receipt',async()=>{
    download.mockImplementation(async()=>{vi.setSystemTime(new Date(now.getTime()+60001));return{data:new Blob([storedSelfie]),error:null};});
    expect(await(await selfie(request(verifyInput()))).json()).toMatchObject({code:'stale_capture'});expect(receiptCalls()).toHaveLength(0);
  });
  it('rechecks live session after image decode',async()=>{
    clientRPC.mockResolvedValue({data:{employee_id:employeeId,allowed:false,requires_mfa:false,reason:'session_revoked'},error:null});
    expect((await selfie(request(verifyInput()))).status).toBe(401);expect(receiptCalls()).toHaveLength(0);
  });
  it('keeps malformed-image and can_clock failures closed',async()=>{
    download.mockResolvedValue({data:new Blob([Buffer.alloc(2000,1)]),error:null});
    expect(await(await selfie(request(verifyInput()))).json()).toMatchObject({code:'image_invalid'});expect(receiptCalls()).toHaveLength(0);
    boundary.authenticate.mockResolvedValue({user:{id:authId},employee:{id:employeeId,can_clock:false}});
    expect((await selfie(request(verifyInput()))).status).toBe(403);
  });
  it('rejects the actual rate-limit denial before download',async()=>{
    adminRPC.mockResolvedValue({data:false,error:null});
    const response=await selfie(request(verifyInput()));
    expect(response.status).toBe(429);expect(await response.json()).toMatchObject({code:'rate_limited'});
    expect(download).not.toHaveBeenCalled();expect(receiptCalls()).toHaveLength(0);
  });
  it('rejects an oversized stored download before reading its bytes',async()=>{
    const arrayBuffer=vi.fn();download.mockResolvedValue({data:{size:2*1024*1024+1,arrayBuffer},error:null});
    expect(await(await selfie(request(verifyInput()))).json()).toMatchObject({code:'image_size'});
    expect(arrayBuffer).not.toHaveBeenCalled();expect(receiptCalls()).toHaveLength(0);
  });
  it('returns a rejected receipt RPC honestly',async()=>{
    adminRPC.mockImplementation(async(name:string)=>({data:name==='attendance_selfie_object'?storageObjectId:name==='auth_rate_limit'?true:null,error:name==='attendance_issue_selfie_receipt'?{message:'Penugasan belum sesuai.'}:null}));
    expect(await(await selfie(request(verifyInput()))).json()).toEqual({code:'operation_rejected',error:'Penugasan belum sesuai.'});
  });
  it('checks image format/dimensions/complete decoding without requiring a detectable face',async()=>{
    await expect(validateSelfieImage(storedSelfie)).resolves.toBeUndefined();
    await expect(validateSelfieImage(Buffer.alloc(900))).rejects.toMatchObject({code:'image_size'});
    const png=await sharp(pixels,{raw:{width:480,height:480,channels:3}}).png().toBuffer();
    await expect(validateSelfieImage(png)).rejects.toMatchObject({code:'image_invalid'});
    await expect(validateSelfieImage(storedSelfie.subarray(0,2000))).rejects.toMatchObject({code:'image_invalid'});
  });
});

describe('Actual push subscribe/unsubscribe handlers', () => {
  it.each(['https://fcm.googleapis.com/fcm/send/device', 'https://updates.push.services.mozilla.com/wpush/v2/device', 'https://web.push.apple.com/Q/device', 'https://wns2-par02p.notify.windows.com/w/?token=device'])('accepts known host via the own client RPC: %s', async endpoint => {
    const subscription = validSubscription(endpoint);
    const response = await push(request({ action: 'subscribe', subscription, device: 'Synthetic browser', employeeId: foreignId, p_employee_id: foreignId, p_endpoint: 'https://127.0.0.1/override' }, 'push'));
    expect(await response.json()).toEqual({ ok: true });
    expect(clientRPC).toHaveBeenCalledWith('push_subscribe', { p_endpoint: endpoint, p_p256dh: subscription.keys.p256dh, p_auth: subscription.keys.auth, p_device: 'Synthetic browser' });
    expect(adminRPC).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each(['https://127.0.0.1/private', 'https://metadata.google.internal/a', 'http://fcm.googleapis.com/send/a', 'https://fcm.googleapis.com.evil.example/a', 'https://x@fcm.googleapis.com/send/a', 'https://fcm.googleapis.com:444/send/a', 'https://fcm.googleapis.com/send/a#secret'])('rejects SSRF/deceptive endpoint without an RPC or fetch: %s', async endpoint => {
    const response = await push(request({ action: 'subscribe', subscription: validSubscription(endpoint) }, 'push'));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'subscription' });
    expect(clientRPC).not.toHaveBeenCalled(); expect(adminRPC).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects malformed keys before registration and bounds the device label', async () => {
    const subscription = validSubscription();
    const invalid = await push(request({ action: 'subscribe', subscription: { ...subscription, keys: { ...subscription.keys, p256dh: 'a'.repeat(87) } } }, 'push'));
    expect(await invalid.json()).toMatchObject({ code: 'subscription' }); expect(clientRPC).not.toHaveBeenCalled();
    const valid = await push(request({ action: 'subscribe', subscription, device: 'D'.repeat(200) }, 'push'));
    expect(valid.status).toBe(200); expect(clientRPC.mock.calls[0][1].p_device).toHaveLength(100);
  });
  it('unsubscribes through the authenticated owner RPC and ignores employee overrides', async () => {
    const endpoint = validSubscription().endpoint;
    const response = await push(request({ action: 'unsubscribe', endpoint, employeeId: foreignId, p_employee_id: foreignId }, 'push'));
    expect(await response.json()).toEqual({ ok: true }); expect(clientRPC).toHaveBeenCalledWith('push_unsubscribe', { p_endpoint: endpoint });
    expect(adminRPC).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not turn an unsubscribe authorization failure into a fake success', async () => {
    clientRPC.mockResolvedValue({ data: null, error: { message: 'Langganan bukan milik akun ini.' } });
    const response = await push(request({ action: 'unsubscribe', endpoint: validSubscription().endpoint }, 'push'));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: 'operation_rejected' }); expect(adminRPC).not.toHaveBeenCalled();
  });
});
