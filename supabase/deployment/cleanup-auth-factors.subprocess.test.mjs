import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createManifest, saveManifest } from './cleanup-auth-factors.mjs';

const execFile = promisify(execFileCallback);
const script = resolve('supabase/deployment/cleanup-auth-factors.mjs');
const moduleUrl = pathToFileURL(script).href;

async function runNode(args) {
  try {
    const result = await execFile(process.execPath, args, {
      cwd: resolve('.'),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env }
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? ''
    };
  }
}

const userId = '10000000-0000-4000-8000-000000000001';
const factorId = '20000000-0000-4000-8000-000000000001';
const manifest = createManifest({
  projectRef: 'lypsqrwjzrmuyqtdcegr',
  userId,
  factors: [{ id: factorId, userId, factorType: 'totp', status: 'verified' }]
});

const root = await mkdtemp(join(tmpdir(), 'rk cleanup spaces-'));
try {
  const manifestPath = join(root, 'manifest spasi-üji.json');
  await saveManifest(manifestPath, manifest);

  const help = await runNode([script, '--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage: node cleanup-auth-factors\.mjs/);
  assert.equal(help.stderr, '');

  const imported = await runNode([
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(moduleUrl)});`
  ]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');

  const dryRun = await runNode([script, `--manifest=${manifestPath}`]);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  const drySummary = JSON.parse(dryRun.stdout);
  assert.equal(drySummary.reportType, 'dry_run');
  assert.equal(drySummary.observation, 'not_performed');
  assert.equal(drySummary.operationKey, manifest.operationKey);
  const persisted = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(persisted, manifest, 'CLI dry-run must not replace or downgrade the manifest receipt');

  for (const state of ['completed', 'failed']) {
    const terminalPath = join(root, `${state} receipt.json`);
    const terminal = { ...manifest, status: state, result: { observed: [{ id: factorId, status: state === 'completed' ? 'deleted' : 'failed', at: 'preserve-this-receipt' }], at: '2026-10-31T00:00:00.000Z' } };
    await saveManifest(terminalPath, terminal);
    const before = JSON.parse(await readFile(terminalPath, 'utf8'));
    const terminalDryRun = await runNode([script, `--manifest=${terminalPath}`]);
    assert.equal(terminalDryRun.code, 0, terminalDryRun.stderr);
    assert.equal(JSON.parse(terminalDryRun.stdout).reportType, 'dry_run');
    assert.deepEqual(JSON.parse(await readFile(terminalPath, 'utf8')), before, `${state} execution receipt remains byte-equivalent in meaning after dry-run`);
  }

  const execute = await runNode([script, `--manifest=${manifestPath}`, '--execute']);
  assert.notEqual(execute.code, 0, 'execute without an adapter must fail closed');
  assert.match(execute.stderr, /explicit provider adapter/);

  const missing = await runNode([script, `--manifest=${join(root, 'missing.json')}`]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /ENOENT|no such file/i);

  const malformedPath = join(root, 'malformed.json');
  await writeFile(malformedPath, '{not-json', 'utf8');
  const malformed = await runNode([script, `--manifest=${malformedPath}`]);
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /Unexpected token|JSON/i);

  // Exercise the real module in a child process with a narrowly scoped fake
  // provider.  A timeout after the delete is followed by a retry using the
  // exact original manifest key and factor id; no broad listing is allowed.
  const replay = await runNode([
    '--input-type=module',
    '-e',
    `
      const { createManifest, createManifestEnvelope, cleanupFromManifest, saveManifest, loadManifest } = await import(${JSON.stringify(moduleUrl)});
      const userId = ${JSON.stringify(userId)};
      const factorId = ${JSON.stringify(factorId)};
      const operationKey = '11111111-1111-4111-8111-111111111111';
      const replayPath = ${JSON.stringify(join(root, 'persisted retry manifest.json'))};
      const factor = { id: factorId, userId, factorType: 'totp', status: 'verified' };
      let present = true;
      const calls = [];
      const provider = {
        projectRef: 'lypsqrwjzrmuyqtdcegr',
        async listFactors(id) { return present && id === userId ? [factor] : []; },
        async deleteFactor({ userId: id, factorId: key }) {
          calls.push({ userId: id, factorId: key });
          present = false;
          throw new Error('provider timeout after delete');
        }
      };
      const manifest = createManifest({ projectRef: 'lypsqrwjzrmuyqtdcegr', userId, factors: [factor], operationKey });
      const expected = createManifestEnvelope(manifest);
      await saveManifest(replayPath, manifest);
      const first = await cleanupFromManifest(provider, manifest, { execute: true, expected });
      await saveManifest(replayPath, first);
      const reloaded = await loadManifest(replayPath);
      const retry = await cleanupFromManifest(provider, reloaded, { execute: true, expected });
      if (first.status !== 'failed' || retry.result.observed.map(item => item.status).join(',') !== 'failed,already_absent'
        || retry.result.attempts.length !== 2 || calls.length !== 1 || calls[0].factorId !== factorId || retry.operationKey !== operationKey) process.exit(1);
      console.log(JSON.stringify({ operationKey: retry.operationKey, factorId, first: first.status, retry: retry.result.observed.at(-1).status, attempts: retry.result.attempts.length }));
    `
  ]);
  assert.equal(replay.code, 0, replay.stderr);
  const replaySummary = JSON.parse(replay.stdout);
  assert.equal(replaySummary.operationKey, '11111111-1111-4111-8111-111111111111');
  assert.equal(replaySummary.factorId, factorId);
  assert.equal(replaySummary.retry, 'already_absent');
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('Auth cleanup subprocess OK: portable entrypoint, side-effect-free import, Windows-safe paths, receipt-preserving dry-run, fail-closed execute, malformed input and persisted original-manifest retry');
