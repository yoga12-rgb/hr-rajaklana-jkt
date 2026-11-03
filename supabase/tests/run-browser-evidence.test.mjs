import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceFingerprint, fingerprintFiles, validateFixture } from './run-browser-evidence.mjs';

for (const suite of ['live-mock', 'demo-pwa']) {
  const flag = suite === 'live-mock' ? 'E2E_LIVE_SUPABASE_MOCK' : 'E2E_PWA';
  assert.throws(() => validateFixture(suite, {}), /requires explicit/);
  assert.doesNotThrow(() => validateFixture(suite, { [flag]: '1' }));
  assert.throws(() => validateFixture(suite, { [flag]: '1', E2E_BASE_URL: 'https://example.com' }), /loopback/);
  assert.throws(() => validateFixture(suite, { E2E_LIVE_SUPABASE_MOCK: '1', E2E_PWA: '1' }), /requires explicit/);
}
const directory = mkdtempSync(join(tmpdir(), 'browser-evidence-contract-'));
writeFileSync(join(directory, 'package.json'), '{"synthetic":1}');
writeFileSync(join(directory, '.env'), 'SYNTHETIC_SECRET=do-not-copy');
const before = fingerprintFiles(directory, ['package.json']);
assert.deepEqual(Object.keys(before.files), ['package.json']);
assert(!JSON.stringify(before).includes('do-not-copy'));
writeFileSync(join(directory, 'package.json'), '{"synthetic":2}');
assert.notEqual(before.sha256, fingerprintFiles(directory, ['package.json']).sha256, 'source changes invalidate source binding');
assert.equal(Object.keys(fingerprintFiles(directory, ['package.json', 'package.json']).files).length, 1, 'source is not counted twice');
writeFileSync(join(directory, 'removed.js'), 'retired implementation');
const present = fingerprintFiles(directory, ['removed.js']);
unlinkSync(join(directory, 'removed.js'));
const absent = fingerprintFiles(directory, ['removed.js']);
assert.equal(absent.files['removed.js'], null, 'reviewed deletion has an explicit fingerprint tombstone');
assert.notEqual(present.sha256, absent.sha256, 'deleting code changes the evidence binding');
assert(!Object.keys(sourceFingerprint().files).some(path => /(^|\/)\.env($|\.)/.test(path)), 'Git source allowlist excludes environment files');
assert.equal(readFileSync(join(directory, '.env'), 'utf8'), 'SYNTHETIC_SECRET=do-not-copy');
console.log('Browser evidence contract: explicit fixture, source binding, untracked changes and secret exclusion PASS.');
