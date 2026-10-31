import assert from 'node:assert/strict';
import { createManifest, createManifestEnvelope, validateManifest, cleanupFromManifest, executeCleanupFromManifest, saveManifest, loadManifest } from './cleanup-auth-factors.mjs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRef = 'lypsqrwjzrmuyqtdcegr';
const userId = '10000000-0000-4000-8000-000000000001';
const factorId = '20000000-0000-4000-8000-000000000001';
const otherFactor = '30000000-0000-4000-8000-000000000001';
let factors = [
  { id: factorId, userId, factorType: 'totp', status: 'verified' },
  { id: otherFactor, userId, factorType: 'totp', status: 'verified' }
];
const calls = [];
let listCalls = 0;
let failSecondList = false;
const provider = {
  projectRef,
  async listFactors(id) {
    listCalls += 1;
    if (failSecondList && listCalls === 2) throw new Error('timeout with unsafe detail that must not be persisted');
    return factors.filter(factor => factor.userId === id);
  },
  async deleteFactor(input) {
    calls.push(input);
    factors = factors.filter(factor => factor.id !== input.factorId);
  }
};

const manifest = createManifest({ projectRef, userId, factors: [factors[0]] });
const expected = createManifestEnvelope(manifest);
validateManifest(manifest, { projectRef, userId });
const dry = await cleanupFromManifest(provider, manifest);
assert.equal(dry.reportType, 'dry_run');
assert.equal(dry.observation, 'not_performed');
assert.deepEqual(dry.factors, [{ id: factorId, status: 'planned' }]);
assert.equal(calls.length, 0);
assert.equal(listCalls, 0, 'dry-run must not query provider');
await assert.rejects(cleanupFromManifest(provider, manifest, { execute: true }), /persisted operation runner/);

let mismatchCalls = 0;
const wrongProjectProvider = { projectRef: 'differentproj1', async listFactors() { mismatchCalls += 1; return factors; }, async deleteFactor() { mismatchCalls += 1; } };
await assert.rejects(executeCleanupFromManifest(wrongProjectProvider, {}), /Envelope eksekusi tepercaya wajib/);

const dir = await mkdtemp(join(tmpdir(), 'rk-auth-cleanup-'));
try {
  const path = join(dir, 'manifest.json');
  await saveManifest(path, manifest);
  assert.deepEqual(await loadManifest(path), manifest);
  assert.match(await readFile(path, 'utf8'), /operationKey/);

  const unsafeStore = join(dir, 'unsafe-envelope');
  await mkdir(unsafeStore);
  const unsafeManifestPath = join(unsafeStore, 'manifest.json');
  await saveManifest(unsafeManifestPath, manifest);
  const listCountBeforeUnsafeEnvelope = listCalls, deleteCountBeforeUnsafeEnvelope = calls.length;
  await assert.rejects(executeCleanupFromManifest(provider, { manifestPath: unsafeManifestPath, storeRoot: unsafeStore,
    expected: { ...expected, operationKey: '../../../../../../escaped' } }), /Envelope eksekusi tepercaya/);
  assert.equal(listCalls, listCountBeforeUnsafeEnvelope, 'malformed operation key is rejected before provider reads');
  assert.equal(calls.length, deleteCountBeforeUnsafeEnvelope, 'malformed operation key is rejected before provider deletes');
  assert.deepEqual((await readdir(unsafeStore)).sort(), ['manifest.json', 'manifest.json.trusted-envelope.json'].sort(),
    'malformed operation key creates no lock or operation registry');

  await assert.rejects(executeCleanupFromManifest(wrongProjectProvider, { manifestPath: path, storeRoot: dir, expected }), /Identitas proyek provider/);
  assert.equal(mismatchCalls, 0, 'provider identity mismatch is rejected before factor listing/deletion');

  const completed = await executeCleanupFromManifest(provider, { manifestPath: path, storeRoot: dir, expected });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result.observed.map(({ id, status }) => ({ id, status })), [{ id: factorId, status: 'deleted' }]);
  assert.deepEqual(completed.result.attempts.map(item => item.operationKey), [manifest.operationKey]);
  assert.deepEqual(calls, [{ userId, factorId }], 'execute uses the original operation identity and factor ID');
  const completedBytes = await readFile(path, 'utf8');
  const reviewCompleted = await cleanupFromManifest(provider, completed);
  assert.equal(reviewCompleted.reportType, 'dry_run');
  assert.equal(await readFile(path, 'utf8'), completedBytes, 'dry-run must not mutate the receipt');

  const retry = await executeCleanupFromManifest(provider, { manifestPath: path, storeRoot: dir, expected });
  assert.deepEqual(retry.result.observed.map(item => item.status), ['deleted', 'already_absent']);
  assert.equal(retry.result.attempts.length, 2);
  assert.equal(retry.operationKey, manifest.operationKey);

  const persistedBeforeDrift = await readFile(path, 'utf8');
  const changedProject = createManifest({ projectRef: 'differentproj1', userId, operationKey: '11111111-1111-4111-8111-111111111111',
    factors: [{ id: factorId, userId, factorType: 'totp', status: 'verified' }], now: manifest.createdAt });
  await assert.rejects(saveManifest(path, { ...changedProject, receiptRevision: (retry.receiptRevision ?? 0) + 1 }), /Immutable envelope/);
  assert.equal(await readFile(path, 'utf8'), persistedBeforeDrift, 'project/key/plan drift cannot replace the original record');

  const stale = { ...completed, receiptRevision: completed.receiptRevision + 1, status: 'failed' };
  await assert.rejects(saveManifest(path, stale), /berubah sejak dibaca/);
  const current = await loadManifest(path);
  const truncated = { ...current, receiptRevision: current.receiptRevision + 1,
    result: { ...current.result, observed: current.result.observed.slice(1) } };
  await assert.rejects(saveManifest(path, truncated), /Receipt\/observations lama berubah atau terpotong/);
  assert.deepEqual(await loadManifest(path), current, 'stale and truncating writers leave the receipt intact');

  const multiPath = join(dir, 'partial.json');
  listCalls = 0;
  failSecondList = true;
  factors = [
    { id: factorId, userId, factorType: 'totp', status: 'verified' },
    { id: otherFactor, userId, factorType: 'totp', status: 'verified' }
  ];
  const multi = createManifest({ projectRef, userId, factors: [...factors], operationKey: '22222222-2222-4222-8222-222222222222' });
  const multiExpected = createManifestEnvelope(multi);
  await saveManifest(multiPath, multi);
  const partial = await executeCleanupFromManifest(provider, { manifestPath: multiPath, storeRoot: dir, expected: multiExpected });
  assert.equal(partial.status, 'failed');
  assert.deepEqual(partial.result.observed.map(item => item.status), ['deleted']);
  assert.equal(calls.at(-1).factorId, factorId);
  assert.match(await readFile(multiPath, 'utf8'), /provider_list_failed/);
  assert.doesNotMatch(await readFile(multiPath, 'utf8'), /unsafe detail/);
  failSecondList = false;
  const retryPartial = await executeCleanupFromManifest(provider, { manifestPath: multiPath, storeRoot: dir, expected: multiExpected });
  assert.equal(retryPartial.status, 'completed');
  assert.deepEqual(retryPartial.result.observed.map(item => item.status), ['deleted', 'already_absent', 'deleted']);
  assert.equal(retryPartial.result.attempts.length, 2);
  assert.deepEqual(multi.factors.map(item => item.id), [factorId, otherFactor], 'original ordered plan remains unchanged');

  const ambiguousPath = join(dir, 'ambiguous.json');
  const ambiguousManifest = createManifest({ projectRef, userId, factors: [{ id: otherFactor, userId, factorType: 'totp', status: 'verified' }],
    operationKey: '33333333-3333-4333-8333-333333333333' });
  const ambiguousExpected = createManifestEnvelope(ambiguousManifest);
  factors = [{ id: otherFactor, userId, factorType: 'totp', status: 'verified' }];
  await saveManifest(ambiguousPath, ambiguousManifest);
  let failConfirmationPersist = true;
  await assert.rejects(executeCleanupFromManifest(provider, { manifestPath: ambiguousPath, storeRoot: dir, expected: ambiguousExpected,
    persist: async (target, next, options) => {
      if (failConfirmationPersist && next.result?.events?.some(event => event.phase === 'delete' && event.outcome === 'confirmed')) {
        failConfirmationPersist = false;
        throw new Error('simulated receipt storage failure');
      }
      return saveManifest(target, next, options);
    } }), /outcome is ambiguous/);
  const afterCrashLikeFailure = await loadManifest(ambiguousPath);
  assert.equal(afterCrashLikeFailure.status, 'in_progress');
  assert.equal(afterCrashLikeFailure.result.events.at(-1).outcome, 'intent');
  const reconciled = await executeCleanupFromManifest(provider, { manifestPath: ambiguousPath, storeRoot: dir, expected: ambiguousExpected });
  assert.deepEqual(reconciled.result.observed.map(item => item.status), ['already_absent']);
  assert.equal(reconciled.result.attempts.length, 2);
  assert.equal(reconciled.operationKey, ambiguousManifest.operationKey);
} finally { await rm(dir, { recursive: true, force: true }); }

assert.throws(() => validateManifest({ ...manifest, factors: [{ ...manifest.factors[0], userId: '40000000-0000-4000-8000-000000000001' }] }), /Fingerprint|linkage/);
assert.throws(() => createManifest({ projectRef, userId, factors: [{ id: otherFactor, userId, factorType: 'webauthn' }] }), /TOTP/);
console.log('Auth cleanup operator OK: persisted dry-run, target lease, immutable envelope, append-only CAS, partial/retry receipts and ambiguous persistence handling');
