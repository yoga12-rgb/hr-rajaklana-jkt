import assert from 'node:assert/strict';
import { createManifest, createManifestEnvelope, validateManifest, cleanupFromManifest, saveManifest, loadManifest } from './cleanup-auth-factors.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userId = '10000000-0000-4000-8000-000000000001';
const factorId = '20000000-0000-4000-8000-000000000001';
const otherFactor = '30000000-0000-4000-8000-000000000001';
let factors = [{ id: factorId, userId, factorType: 'totp', status: 'verified' }];
const calls = [];
const provider = {
  projectRef: 'lypsqrwjzrmuyqtdcegr',
  async listFactors(id) { return factors.filter(factor => factor.userId === id); },
  async deleteFactor(input) { calls.push(input); factors = factors.filter(factor => factor.id !== input.factorId); }
};

const manifest = createManifest({ projectRef: 'lypsqrwjzrmuyqtdcegr', userId, factors });
const expected = createManifestEnvelope(manifest);
validateManifest(manifest, { projectRef: 'lypsqrwjzrmuyqtdcegr', userId });
const dry = await cleanupFromManifest(provider, manifest, { execute: false, expected });
assert.equal(dry.reportType, 'dry_run');
assert.equal(dry.observation, 'not_performed');
assert.deepEqual(dry.factors, [{ id: factorId, status: 'planned' }]);
assert.equal(calls.length, 0, 'dry-run must not delete');

const completed = await cleanupFromManifest(provider, manifest, { execute: true, expected });
assert.equal(completed.status, 'completed');
assert.deepEqual(completed.result.observed, [{ id: factorId, status: 'deleted' }]);
assert.equal(completed.receiptRevision, 1);
assert.deepEqual(calls, [{ userId, factorId }], 'execute uses the original manifest key and factor ID');
const reviewCompleted = await cleanupFromManifest(provider, completed, { execute: false, expected });
assert.equal(reviewCompleted.reportType, 'dry_run');
assert.deepEqual(completed.result.observed, [{ id: factorId, status: 'deleted' }], 'dry-run does not mutate the completed receipt');
const retry = await cleanupFromManifest(provider, completed, { execute: true, expected });
assert.deepEqual(retry.result.observed, [{ id: factorId, status: 'deleted' }, { id: factorId, status: 'already_absent' }], 'retry appends an honest absence observation without losing the prior delete receipt');
assert.equal(retry.result.attempts.length, 2);
assert.equal(retry.receiptRevision, 2);
assert.equal(retry.operationKey, manifest.operationKey);

let mismatchCalls = 0;
const wrongProjectProvider = { projectRef: 'differentproj1', async listFactors() { mismatchCalls += 1; return factors; }, async deleteFactor() { mismatchCalls += 1; } };
await assert.rejects(cleanupFromManifest(wrongProjectProvider, manifest, { execute: true, expected }), /Identitas proyek provider/);
assert.equal(mismatchCalls, 0, 'provider identity mismatch is rejected before factor listing/deletion');
await assert.rejects(cleanupFromManifest(provider, manifest, { execute: true }), /Envelope eksekusi tepercaya wajib/);
const changedKey = { ...manifest, operationKey: '11111111-1111-4111-8111-111111111111' };
await assert.rejects(cleanupFromManifest(provider, changedKey, { execute: true, expected }), /Envelope manifest berbeda pada operationKey/);
const changedPlan = createManifest({ projectRef: manifest.projectRef, userId, operationKey: manifest.operationKey,
  factors: [{ id: otherFactor, userId, factorType: 'totp', status: 'verified' }], now: manifest.createdAt });
await assert.rejects(cleanupFromManifest(provider, changedPlan, { execute: true, expected }), /Envelope manifest berbeda pada planFingerprint/);
assert.equal(mismatchCalls, 0);

assert.throws(() => validateManifest({ ...manifest, factors: [{ ...manifest.factors[0], userId: '40000000-0000-4000-8000-000000000001' }] }), /Fingerprint|linkage/);
assert.throws(() => createManifest({ projectRef: 'lypsqrwjzrmuyqtdcegr', userId, factors: [{ id: otherFactor, userId, factorType: 'webauthn' }] }), /TOTP/);

const dir = await mkdtemp(join(tmpdir(), 'rk-auth-cleanup-'));
try {
  const path = join(dir, 'manifest.json');
  await saveManifest(path, manifest);
  assert.deepEqual(await loadManifest(path), manifest);
  assert.match(await readFile(path, 'utf8'), /operationKey/);

  const completedReceipt = { ...completed, receiptRevision: 1 };
  await saveManifest(path, completedReceipt);
  const staleWrite = { ...completed, receiptRevision: 1, status: 'failed', result: { observed: [], at: 'stale' } };
  await assert.rejects(saveManifest(path, staleWrite), /berubah sejak dibaca/);
  assert.deepEqual(await loadManifest(path), completedReceipt, 'stale concurrent writer cannot overwrite the newer receipt');
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Auth cleanup operator OK: dry-run default, strict target/linkage, original-ID retry, partial-safe manifest persistence and no credential fields');
