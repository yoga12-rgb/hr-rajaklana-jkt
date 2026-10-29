import { describe, expect, it } from 'vitest';
import { completeMfaRecoveryPending, mfaRecoveryPendingKey, mfaRecoveryScope, persistMfaRecoveryPending, readMfaRecoveryPending } from './mfa-recovery-pending';

const authA = '10000000-0000-4000-8000-000000000001', authB = '10000000-0000-4000-8000-000000000002';
const actorA = '20000000-0000-4000-8000-000000000001', actorB = '20000000-0000-4000-8000-000000000002';
const employeeId = '20000000-0000-4000-8000-000000000003', requestId = '30000000-0000-4000-8000-000000000001';
const scope = mfaRecoveryScope('preview', 'https://fixture.supabase.co', authA, actorA);
const payload = { employeeId, requestId, reason: 'Identitas dikonfirmasi oleh HR' };
function storageFixture() {
  const values = new Map<string,string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('account and environment isolated MFA recovery pending requests', () => {
  it('persists and reloads the original exact payload and refuses another employee or modified reason', () => {
    const storage = storageFixture();
    persistMfaRecoveryPending(storage, scope, payload);
    expect(readMfaRecoveryPending(storage, scope)).toEqual(payload);
    expect(() => persistMfaRecoveryPending(storage, scope, { ...payload, employeeId: actorB })).toThrow('Penyimpanan');
    expect(() => persistMfaRecoveryPending(storage, scope, { ...payload, reason: 'Permintaan lain dengan alasan berbeda' })).toThrow('Penyimpanan');
    expect(readMfaRecoveryPending(storage, scope)).toEqual(payload);
    persistMfaRecoveryPending(storage, scope, payload);
    expect(readMfaRecoveryPending(storage, scope)).toEqual(payload);
  });
  it('does not expose A to B, another employee identity, another project or another environment', () => {
    const storage = storageFixture(); persistMfaRecoveryPending(storage, scope, payload);
    for (const other of [mfaRecoveryScope('preview','https://fixture.supabase.co',authB,actorB),
      mfaRecoveryScope('preview','https://fixture.supabase.co',authA,actorB),
      mfaRecoveryScope('production','https://fixture.supabase.co',authA,actorA),
      mfaRecoveryScope('preview','https://other.supabase.co',authA,actorA)]) {
      expect(readMfaRecoveryPending(storage, other)).toBeNull();
      expect(mfaRecoveryPendingKey(other)).not.toBe(mfaRecoveryPendingKey(scope));
    }
    expect(readMfaRecoveryPending(storage, scope)).toEqual(payload);
  });
  it('fails closed on storage errors or a silently failed write before the caller can send', () => {
    for (const storage of [
      { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} },
      { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      { getItem: () => { throw new Error('disabled'); }, setItem: () => {}, removeItem: () => {} }
    ]) expect(() => persistMfaRecoveryPending(storage, scope, payload)).toThrow('Penyimpanan');
  });
  it.each(['not-json', 'null', '[]', JSON.stringify({version:2,scope,payload}),
    JSON.stringify({version:1,scope:{...scope,authUserId:authB},payload}),
    JSON.stringify({version:1,scope,payload:{...payload,requestId:'arbitrary'}}),
    JSON.stringify({version:1,scope,payload:{...payload,reason:'short'}}),
    JSON.stringify({version:1,scope,payload:{...payload,secret:'never-allowed'}})
  ])('does not silently erase or overwrite a malformed stored request: %s', raw => {
    const storage = storageFixture(), key = mfaRecoveryPendingKey(scope); storage.setItem(key,raw);
    expect(() => readMfaRecoveryPending(storage,scope)).toThrow('Penyimpanan');
    expect(() => persistMfaRecoveryPending(storage,scope,payload)).toThrow('Penyimpanan');
    expect(storage.getItem(key)).toBe(raw);
  });
  it('clears only its own exact draft after a matching confirmed completion', () => {
    const storage = storageFixture(); persistMfaRecoveryPending(storage,scope,payload);
    for (const receipt of [null, {ok:false,request_id:requestId}, {ok:true,request_id:'different'}])
      expect(() => completeMfaRecoveryPending(storage,scope,payload,receipt)).toThrow('Penyimpanan');
    expect(() => completeMfaRecoveryPending(storage,scope,{...payload,reason:'Changed payload must not clear'}, {ok:true,request_id:requestId})).toThrow('Penyimpanan');
    expect(readMfaRecoveryPending(storage,scope)).toEqual(payload);
    completeMfaRecoveryPending(storage,scope,payload,{ok:true,request_id:requestId});
    expect(readMfaRecoveryPending(storage,scope)).toBeNull();
  });
});
