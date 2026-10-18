import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ authenticate: vi.fn(), extractFace: vi.fn() }));
vi.mock('../../server/security.mjs', async () => ({
  ...await vi.importActual<typeof import('../../server/security.mjs')>('../../server/security.mjs'),
  authenticate: boundary.authenticate
}));
vi.mock('../../server/face-engine.mjs', async () => ({
  ...await vi.importActual<typeof import('../../server/face-engine.mjs')>('../../server/face-engine.mjs'),
  extractFace: boundary.extractFace
}));

import { POST as biometric } from '../../api/biometric.mjs';
import { POST as push } from '../../api/push.mjs';
import { ApiError, sha256 } from '../../server/security.mjs';
import { MODEL_ID } from '../../server/face-engine.mjs';

const now = new Date('2026-10-18T01:00:00Z');
const authId = '10000000-0000-4000-9000-000000000011';
const employeeId = '20000000-0000-4000-9000-000000000011';
const foreignId = '20000000-0000-4000-9000-000000000099';
const referenceId = '30000000-0000-4000-9000-000000000011';
const nonce = '40000000-0000-4000-9000-000000000011';
const storageObjectId = '50000000-0000-4000-9000-000000000011';
const expiresAt = '2026-10-18T01:02:00Z';
const storedSelfie = Buffer.from('synthetic stored image bytes, never uploaded or inferred');
const clientRPC = vi.fn(), adminRPC = vi.fn(), download = vi.fn(), upload = vi.fn(), remove = vi.fn(), fetchSpy = vi.fn();
const storageFrom = vi.fn(() => ({ download, upload, remove }));
let materials: Array<{ id: string; status: string; model_id: string; descriptor: number[] }>;

const request = (body: unknown, route = 'biometric') => new Request(`https://hr.example/api/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic.jwt.only' }, body: JSON.stringify(body)
});
const verifyInput = (overrides: Record<string, unknown> = {}) => ({
  action: 'verify', selfiePath: `${authId}/fresh-selfie.jpg`, shift: 'morning',
  latitude: -6.2, longitude: 106.8, accuracy: 10,
  geoCapturedAt: now.toISOString(), selfieCapturedAt: now.toISOString(), selfieOutletName: 'Synthetic outlet', ...overrides
});
const enrollment = (overrides: Record<string, unknown> = {}) => ({
  action: 'enroll', consent: true, capturedAt: now.toISOString(), image: storedSelfie.toString('base64'), ...overrides
});
const validSubscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-device') => ({
  endpoint, keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') }
});
const receiptCalls = () => adminRPC.mock.calls.filter(([name]) => name === 'biometric_issue_receipt');

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockRejectedValue(new Error('Network is forbidden in handler tests'));
  materials = [{ id: referenceId, status: 'approved', model_id: MODEL_ID, descriptor: Array(128).fill(0) }];
  adminRPC.mockImplementation(async (name: string) => {
    if (name === 'biometric_server_material') return { data: materials, error: null };
    if (name === 'biometric_selfie_object') return { data: storageObjectId, error: null };
    if (name === 'auth_rate_limit') return { data: true, error: null };
    if (name === 'biometric_issue_receipt') return { data: [{ id: nonce, expires_at: expiresAt }], error: null };
    if (name === 'biometric_enroll_server') return { data: referenceId, error: null };
    if (name === 'biometric_stage_reference') return { data: null, error: null };
    throw new Error(`Unexpected synthetic RPC: ${name}`);
  });
  clientRPC.mockResolvedValue({ data: true, error: null });
  download.mockResolvedValue({ data: new Blob([storedSelfie]), error: null });
  upload.mockResolvedValue({ data: {}, error: null }); remove.mockResolvedValue({ data: {}, error: null });
  boundary.authenticate.mockResolvedValue({
    user: { id: authId }, employee: { id: employeeId, can_clock: true },
    admin: { rpc: adminRPC, storage: { from: storageFrom } }, client: { rpc: clientRPC }
  });
  boundary.extractFace.mockImplementation(async (bytes: Buffer) => ({ descriptor: Array(128).fill(0), modelId: MODEL_ID, imageHash: sha256(bytes) }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Actual API authentication/error boundary', () => {
  it.each([['biometric', biometric], ['push', push]] as const)('%s returns normalized unauthenticated errors before side effects', async (route, handler) => {
    boundary.authenticate.mockRejectedValue(new ApiError('unauthorized', 'Silakan login kembali.', 401));
    const response = await handler(request({ action: 'verify' }, route));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'unauthorized', error: 'Silakan login kembali.' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(adminRPC).not.toHaveBeenCalled(); expect(clientRPC).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });
  it('hides unexpected credential, image and descriptor details in both response and logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    boundary.authenticate.mockRejectedValue(new Error('SERVICE_SECRET synthetic-descriptor private-photo-path'));
    const response = await biometric(request(verifyInput()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'unavailable', error: expect.any(String) });
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/SERVICE_SECRET|synthetic-descriptor|private-photo-path/);
    expect(receiptCalls()).toHaveLength(0);
  });
  it('uses the actual JSON parser before touching storage or RPCs', async () => {
    const response = await biometric(new Request('https://hr.example/api/biometric', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' }));
    expect(await response.json()).toMatchObject({ code: 'invalid_json' });
    expect(adminRPC).not.toHaveBeenCalled(); expect(storageFrom).not.toHaveBeenCalled();
  });
});

describe('Actual biometric verify handler', () => {
  it.each([`${foreignId}/foreign.jpg`, `${authId}/../foreign.jpg`, 'https://evil.example/image.jpg'])('cannot download another account or untrusted path: %s', async selfiePath => {
    const response = await biometric(request(verifyInput({ selfiePath })));
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: 'selfie_owner' });
    expect(download).not.toHaveBeenCalled(); expect(receiptCalls()).toHaveLength(0);
  });
  it.each(['missing', 'pending', 'obsolete-model'])('requires a compatible approved reference: %s', async state => {
    if (state === 'missing') materials = [];
    else materials[0] = { ...materials[0], ...(state === 'pending' ? { status: 'pending' } : { model_id: 'obsolete-model' }) };
    const response = await biometric(request(verifyInput()));
    expect(await response.json()).toMatchObject({ code: 'reference_pending' });
    expect(download).not.toHaveBeenCalled(); expect(receiptCalls()).toHaveLength(0);
  });
  it('uses authenticated employee, approved reference, own stored bytes and server hash; returns only receipt fields', async () => {
    const response = await biometric(request(verifyInput({ employeeId: foreignId, p_employee_id: foreignId, referenceId: 'forged', storageObjectId: 'forged-object-id', descriptor: Array(128).fill(9), imageHash: 'forged-client-hash' })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verificationToken: nonce, expiresAt });
    expect(adminRPC).toHaveBeenCalledWith('biometric_server_material', { p_employee_id: employeeId, p_pending: false });
    expect(adminRPC).toHaveBeenCalledWith('biometric_selfie_object', { p_employee_id: employeeId, p_selfie_path: `${authId}/fresh-selfie.jpg` });
    expect(storageFrom).toHaveBeenCalledWith('attendance-selfies'); expect(download).toHaveBeenCalledWith(`${authId}/fresh-selfie.jpg`);
    expect(boundary.extractFace).toHaveBeenCalledWith(storedSelfie);
    expect(adminRPC).toHaveBeenCalledWith('biometric_issue_receipt', {
      p_employee_id: employeeId, p_reference_id: referenceId, p_storage_object_id: storageObjectId, p_selfie_path: `${authId}/fresh-selfie.jpg`, p_selfie_sha256: sha256(storedSelfie),
      p_shift: 'morning', p_latitude: -6.2, p_longitude: 106.8, p_accuracy_m: 10,
      p_geo_captured_at: now.toISOString(), p_selfie_captured_at: now.toISOString(), p_selfie_outlet_name: 'Synthetic outlet'
    });
    expect(clientRPC).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('does not issue a receipt when the actual matcher rejects a different descriptor', async () => {
    boundary.extractFace.mockResolvedValue({ descriptor: Array(128).fill(0.5), modelId: MODEL_ID, imageHash: sha256(storedSelfie) });
    const response = await biometric(request(verifyInput()));
    expect(await response.json()).toMatchObject({ code: 'face_mismatch' }); expect(receiptCalls()).toHaveLength(0);
  });
  it.each(['geoCapturedAt', 'selfieCapturedAt'])('rejects stale %s before download or receipt', async field => {
    const response = await biometric(request(verifyInput({ [field]: new Date(now.getTime() - 60_001).toISOString() })));
    expect(await response.json()).toMatchObject({ code: 'stale_capture' }); expect(download).not.toHaveBeenCalled(); expect(receiptCalls()).toHaveLength(0);
  });
  it('rechecks freshness after extraction, so a slow verification cannot issue an expired receipt', async () => {
    boundary.extractFace.mockImplementation(async (bytes: Buffer) => { vi.setSystemTime(new Date(now.getTime() + 60_001)); return { descriptor: Array(128).fill(0), modelId: MODEL_ID, imageHash: sha256(bytes) }; });
    const response = await biometric(request(verifyInput()));
    expect(await response.json()).toMatchObject({ code: 'stale_capture' }); expect(receiptCalls()).toHaveLength(0);
  });
  it('does not claim success when the receipt RPC rejects the assignment/context', async () => {
    adminRPC.mockImplementation(async (name: string) => ({ data: name === 'biometric_server_material' ? materials : name === 'biometric_selfie_object' ? storageObjectId : name === 'auth_rate_limit' ? true : null, error: name === 'biometric_issue_receipt' ? { message: 'Penugasan belum sesuai.' } : null }));
    const response = await biometric(request(verifyInput()));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: 'operation_rejected', error: 'Penugasan belum sesuai.' });
  });
});

describe('Actual biometric enrollment and HR review handlers', () => {
  it.each([{ consent: false }, { consent: 'true' }, { capturedAt: undefined }, { capturedAt: new Date(now.getTime() - 60_001).toISOString() }])('requires explicit consent and fresh capture: %j', async invalid => {
    const response = await biometric(request(enrollment(invalid)));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: expect.stringMatching(/consent|stale_capture/) });
    expect(upload).not.toHaveBeenCalled(); expect(adminRPC).not.toHaveBeenCalled();
  });
  it('enrolls only the authenticated employee and returns pending status without descriptors', async () => {
    const response = await biometric(request(enrollment({ employeeId: foreignId, p_employee_id: foreignId, status: 'approved', descriptor: [9] })));
    expect(await response.json()).toEqual({ referenceId, status: 'pending' });
    const call = adminRPC.mock.calls.find(([name]) => name === 'biometric_enroll_server');
    expect(call?.[1]).toEqual({ p_employee_id: employeeId, p_image_path: expect.stringMatching(new RegExp(`^${authId}/[0-9a-f-]+\\.jpg$`)), p_image_sha256: sha256(storedSelfie), p_descriptor: Array(128).fill(0) });
    expect(adminRPC).toHaveBeenCalledWith('biometric_stage_reference', { p_employee_id: employeeId, p_image_path: call?.[1].p_image_path });
    const stageIndex=adminRPC.mock.calls.findIndex(([name])=>name==='biometric_stage_reference');
    expect(adminRPC.mock.invocationCallOrder[stageIndex]).toBeLessThan(upload.mock.invocationCallOrder[0]);
    expect(upload).toHaveBeenCalledWith(expect.stringContaining(`${authId}/`), storedSelfie, { contentType: 'image/jpeg', upsert: false });
  });
  it('rechecks enrollment capture time after inference before writing a reference', async () => {
    boundary.extractFace.mockImplementation(async (bytes: Buffer) => { vi.setSystemTime(new Date(now.getTime() + 60_001)); return { descriptor: Array(128).fill(0), modelId: MODEL_ID, imageHash: sha256(bytes) }; });
    const response = await biometric(request(enrollment()));
    expect(await response.json()).toMatchObject({ code: 'stale_capture' }); expect(upload).not.toHaveBeenCalled();
    expect(adminRPC.mock.calls.some(([name]) => name === 'biometric_enroll_server')).toBe(false);
  });
  it('routes HR approval through the authenticated client RPC, never a service-role mutation', async () => {
    const response = await biometric(request({ action: 'review', referenceId, decision: 'approved', reason: 'Diperiksa HR lain', employeeId: foreignId }));
    expect(await response.json()).toEqual({ ok: true });
    expect(clientRPC).toHaveBeenCalledWith('biometric_review', { p_id: referenceId, p_decision: 'approved', p_reason: 'Diperiksa HR lain' });
    expect(adminRPC).not.toHaveBeenCalled(); expect(storageFrom).not.toHaveBeenCalled();
  });
  it('preserves an authorization denial returned by the client RPC instead of falling back to admin', async () => {
    clientRPC.mockResolvedValue({ data: null, error: { message: 'Admin HR lain diperlukan.' } });
    const response = await biometric(request({ action: 'review', referenceId, decision: 'approved', reason: 'Tidak berwenang' }));
    expect(await response.json()).toMatchObject({ code: 'operation_rejected' }); expect(adminRPC).not.toHaveBeenCalled();
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
