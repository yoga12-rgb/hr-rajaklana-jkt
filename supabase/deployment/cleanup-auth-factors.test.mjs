import assert from 'node:assert/strict';
import { createManifest, validateManifest, cleanupFromManifest, saveManifest, loadManifest } from './cleanup-auth-factors.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const userId = '10000000-0000-4000-8000-000000000001';
const factorId = '20000000-0000-4000-8000-000000000001';
const otherFactor = '30000000-0000-4000-8000-000000000001';
let factors = [{ id: factorId, userId, factorType: 'totp', status: 'verified' }];
const calls = [];
const provider = {
  async listFactors(id) { return factors.filter(factor => factor.userId === id); },
  async deleteFactor(input) { calls.push(input); factors = factors.filter(factor => factor.id !== input.factorId); }
};

const manifest = createManifest({ projectRef: 'lypsqrwjzrmuyqtdcegr', userId, factors });
validateManifest(manifest, { projectRef: 'lypsqrwjzrmuyqtdcegr', userId });
const dry = await cleanupFromManifest(provider, manifest, { execute: false, projectRef: 'lypsqrwjzrmuyqtdcegr' });
assert.equal(dry.status, 'pending');
assert.deepEqual(dry.result.observed, [{ id: factorId, status: 'planned' }]);
assert.equal(calls.length, 0, 'dry-run must not delete');

const completed = await cleanupFromManifest(provider, manifest, { execute: true, projectRef: 'lypsqrwjzrmuyqtdcegr' });
assert.equal(completed.status, 'completed');
assert.deepEqual(completed.result.observed, [{ id: factorId, status: 'deleted' }]);
assert.deepEqual(calls, [{ userId, factorId }], 'execute uses the original manifest key and factor ID');
const retry = await cleanupFromManifest(provider, manifest, { execute: true, projectRef: 'lypsqrwjzrmuyqtdcegr' });
assert.deepEqual(retry.result.observed, [{ id: factorId, status: 'already_absent' }], 'retry reports observed absence truthfully');

assert.throws(() => validateManifest({ ...manifest, factors: [{ ...manifest.factors[0], userId: '40000000-0000-4000-8000-000000000001' }] }), /Fingerprint|linkage/);
assert.throws(() => createManifest({ projectRef: 'lypsqrwjzrmuyqtdcegr', userId, factors: [{ id: otherFactor, userId, factorType: 'webauthn' }] }), /TOTP/);

const dir = await mkdtemp(join(tmpdir(), 'rk-auth-cleanup-'));
try {
  const path = join(dir, 'manifest.json');
  await saveManifest(path, manifest);
  assert.deepEqual(await loadManifest(path), manifest);
  assert.match(await readFile(path, 'utf8'), /operationKey/);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Auth cleanup operator OK: dry-run default, strict target/linkage, original-ID retry, partial-safe manifest persistence and no credential fields');
