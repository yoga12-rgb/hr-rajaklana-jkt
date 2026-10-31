import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assertManifestFileInfo, createManifest, createManifestEnvelope, saveManifest, executeCleanupFromManifest } from './cleanup-auth-factors.mjs';

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

function startNode(args, env = process.env) {
  const child = spawn(process.execPath, args, { cwd: resolve('.'), windowsHide: true, env: { ...env } });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
  child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
  const done = new Promise(resolveResult => child.on('close', code => resolveResult({ code, stdout, stderr })));
  return { child, done };
}

async function waitForFiles(paths) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const present = await Promise.all(paths.map(path => readFile(path).then(() => true, () => false)));
    if (present.every(Boolean)) return paths;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error('Timed out waiting for child-process barrier marker.');
}

const projectRef = 'lypsqrwjzrmuyqtdcegr';
const userId = '10000000-0000-4000-8000-000000000001';
const factorId = '20000000-0000-4000-8000-000000000001';
const manifest = createManifest({
  projectRef: 'lypsqrwjzrmuyqtdcegr',
  userId,
  factors: [{ id: factorId, userId, factorType: 'totp', status: 'verified' }]
});

const root = await mkdtemp(join(tmpdir(), 'rk cleanup spaces-'));
const childProcesses = [];
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

  const dotAlias = join(root, 'ignored-dot-segment', '..', 'manifest spasi-üji.json');
  await saveManifest(dotAlias, manifest);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), manifest, 'relative dot-segment aliases resolve to the same original file');
  const hardlinkPath = join(root, 'hardlink.json');
  let hardlinkCreated = false;
  try {
    await link(manifestPath, hardlinkPath);
    hardlinkCreated = true;
    await assert.rejects(saveManifest(hardlinkPath, manifest), /hardlink/);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    assert.throws(() => assertManifestFileInfo({ isSymbolicLink: () => false, isFile: () => true, nlink: 2 }), /hardlink/);
    console.log('HARDLINK_FIXTURE_OPEN: host denied creating an actual hardlink; synthetic nlink contract was checked.');
  }
  if (hardlinkCreated) await rm(hardlinkPath);

  const realDirectory = join(root, 'real-directory'), aliasDirectory = join(root, 'directory-alias');
  await mkdir(realDirectory);
  let symlinkCreated = false;
  try {
    await symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkCreated = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    assert.throws(() => assertManifestFileInfo({ isSymbolicLink: () => true, isFile: () => false, nlink: 1 }), /symlink/);
    console.log('SYMLINK_ALIAS_FIXTURE_OPEN: host denied directory symlink/junction creation; synthetic symlink denial contract was checked.');
  }
  if (symlinkCreated) {
    const aliasManifestPath = join(aliasDirectory, 'manifest.json'), realManifestPath = join(realDirectory, 'manifest.json');
    await saveManifest(aliasManifestPath, manifest);
    assert.deepEqual(JSON.parse(await readFile(realManifestPath, 'utf8')), manifest);
    await saveManifest(realManifestPath, manifest);
  }

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
      const { createManifest, createManifestEnvelope, saveManifest, loadManifest, executeCleanupFromManifest } = await import(${JSON.stringify(moduleUrl)});
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
      const first = await executeCleanupFromManifest(provider, { manifestPath: replayPath, storeRoot: ${JSON.stringify(root)}, expected });
      const reloaded = await loadManifest(replayPath);
      const retry = await executeCleanupFromManifest(provider, { manifestPath: replayPath, storeRoot: ${JSON.stringify(root)}, expected });
      if (first.status !== 'failed' || retry.result.observed.map(item => item.status).join(',') !== 'unknown,already_absent'
        || retry.result.attempts.length !== 2 || calls.length !== 1 || calls[0].factorId !== factorId || retry.operationKey !== operationKey) process.exit(1);
      console.log(JSON.stringify({ operationKey: retry.operationKey, factorId, first: first.status, retry: retry.result.observed.at(-1).status, attempts: retry.result.attempts.length }));
    `
  ]);
  assert.equal(replay.code, 0, replay.stderr);
  const replaySummary = JSON.parse(replay.stdout);
  assert.equal(replaySummary.operationKey, '11111111-1111-4111-8111-111111111111');
  assert.equal(replaySummary.factorId, factorId);
  assert.equal(replaySummary.retry, 'already_absent');

  // Two distinct child processes race the same record revision. The stable
  // record lock permits one CAS writer; the stale writer cannot replace it.
  const concurrentPath = join(root, 'two child writers.json');
  await saveManifest(concurrentPath, manifest);
  const readyA = join(root, 'writer-a.ready'), readyB = join(root, 'writer-b.ready'), barrier = join(root, 'writers.go');
  const saveWorkerCode = [
    "import { existsSync } from 'node:fs';",
    "import { readFile, writeFile } from 'node:fs/promises';",
    "const { saveManifest } = await import(process.env.SAR_MODULE_URL);",
    "const base = JSON.parse(await readFile(process.env.SAR_MANIFEST, 'utf8'));",
    "await writeFile(process.env.SAR_READY, 'ready');",
    "while (!existsSync(process.env.SAR_BARRIER)) await new Promise(resolve => setTimeout(resolve, 10));",
    "const outcome = { ...base, receiptRevision: 1, status: process.env.SAR_STATUS, result: { observed: [{ id: process.env.SAR_FACTOR, status: process.env.SAR_STATUS }], attempts: [], events: [] } };",
    "try { await saveManifest(process.env.SAR_MANIFEST, outcome); console.log('saved'); } catch (error) { console.log('rejected:' + error.message); }"
  ].join('\n');
  const writerA = startNode(['--input-type=module', '-e', saveWorkerCode], {
    ...process.env, SAR_MODULE_URL: moduleUrl, SAR_MANIFEST: concurrentPath, SAR_READY: readyA, SAR_BARRIER: barrier, SAR_STATUS: 'completed', SAR_FACTOR: factorId
  });
  const writerB = startNode(['--input-type=module', '-e', saveWorkerCode], {
    ...process.env, SAR_MODULE_URL: moduleUrl, SAR_MANIFEST: concurrentPath, SAR_READY: readyB, SAR_BARRIER: barrier, SAR_STATUS: 'failed', SAR_FACTOR: factorId
  });
  childProcesses.push(writerA, writerB);
  await waitForFiles([readyA, readyB]);
  await writeFile(barrier, 'go');
  const writerResults = await Promise.all([writerA.done, writerB.done]);
  assert.deepEqual(writerResults.map(result => result.code), [0, 0]);
  assert.equal(writerResults.flatMap(result => result.stdout.split(/\r?\n/)).filter(line => line === 'saved').length, 1);
  assert.equal(writerResults.flatMap(result => result.stdout.split(/\r?\n/)).filter(line => line.startsWith('rejected:')).length, 1);
  assert.ok(['completed', 'failed'].includes((await JSON.parse(await readFile(concurrentPath, 'utf8'))).status));

  const lockPath = concurrentPath + '.lock';
  const ownerRecord = JSON.stringify({ schema: 1, token: 'synthetic-active-owner', pid: process.pid });
  await writeFile(lockPath, ownerRecord, { flag: 'wx' });
  await assert.rejects(saveManifest(concurrentPath, { ...manifest, receiptRevision: 2 }), /lease sedang dipakai/);
  assert.equal(await readFile(lockPath, 'utf8'), ownerRecord, 'failed acquisition cannot remove another owner lock');
  await rm(lockPath);

  const recoveryPath = join(root, 'crash-recovery.json');
  const recoveryManifest = createManifest({ projectRef, userId, factors: manifest.factors, operationKey: '66666666-6666-4666-8666-666666666666' });
  const recoveryEnvelope = createManifestEnvelope(recoveryManifest);
  await saveManifest(recoveryPath, recoveryManifest);
  const leaseDirectory = join(root, '.leases');
  await mkdir(leaseDirectory, { recursive: true });
  const targetHash = createHash('sha256').update(JSON.stringify({ projectRef, userId })).digest('hex');
  const residualLockPath = join(leaseDirectory, 'target-' + targetHash + '.lock');
  const residualLock = JSON.stringify({ schema: 1, token: 'synthetic-crash-owner', pid: 987654 });
  await writeFile(residualLockPath, residualLock, { flag: 'wx' });
  let recoveryProviderCalls = 0;
  const recoveryProvider = { projectRef,
    async listFactors(id) { recoveryProviderCalls += 1; return [{ id: factorId, userId: id, factorType: 'totp', status: 'verified' }]; },
    async deleteFactor() { recoveryProviderCalls += 1; }
  };
  await assert.rejects(executeCleanupFromManifest(recoveryProvider, { manifestPath: recoveryPath, storeRoot: root, expected: recoveryEnvelope }), /lease sedang dipakai/);
  assert.equal(recoveryProviderCalls, 0, 'a restart first fails closed on a residual lease before provider I/O');
  assert.equal(await readFile(residualLockPath, 'utf8'), residualLock, 'the runner does not auto-delete an unknown residual lease');
  await rm(residualLockPath); // explicit test-operator recovery of this exact synthetic fixture after its owner is known stopped
  const recoveredRun = await executeCleanupFromManifest(recoveryProvider, { manifestPath: recoveryPath, storeRoot: root, expected: recoveryEnvelope });
  assert.equal(recoveredRun.status, 'completed');
  assert.equal(recoveryProviderCalls, 2);

  // A same-target lease serializes different keys and paths. The first fake
  // provider pauses after entering listFactors while the second child must
  // fail before any provider I/O.
  const leasePathA = join(root, 'lease operation a.json'), leasePathB = join(root, 'lease operation b.json');
  const keyA = '44444444-4444-4444-8444-444444444444', keyB = '55555555-5555-4555-8555-555555555555';
  const leaseManifestA = createManifest({ projectRef: manifest.projectRef, userId, factors: manifest.factors, operationKey: keyA });
  const leaseManifestB = createManifest({ projectRef: manifest.projectRef, userId, factors: manifest.factors, operationKey: keyB });
  await saveManifest(leasePathA, leaseManifestA);
  await saveManifest(leasePathB, leaseManifestB);
  const enteredA = join(root, 'lease-a-entered'), enteredB = join(root, 'lease-b-entered'), releaseProvider = join(root, 'provider-release');
  const leaseWorkerCode = [
    "import { existsSync } from 'node:fs';",
    "import { readFile, writeFile } from 'node:fs/promises';",
    "const { executeCleanupFromManifest } = await import(process.env.SAR_MODULE_URL);",
    "const manifestPath = process.env.SAR_MANIFEST;",
    "const expected = JSON.parse(await readFile(manifestPath + '.trusted-envelope.json', 'utf8'));",
    "const provider = { projectRef: process.env.SAR_PROJECT, async listFactors(id) { await writeFile(process.env.SAR_ENTERED, 'yes'); while (!existsSync(process.env.SAR_RELEASE)) await new Promise(resolve => setTimeout(resolve, 10)); return [{ id: process.env.SAR_FACTOR, userId: id, factorType: 'totp', status: 'verified' }]; }, async deleteFactor() {} };",
    "try { const result = await executeCleanupFromManifest(provider, { manifestPath, storeRoot: process.env.SAR_ROOT, expected }); console.log('completed:' + result.operationKey); } catch (error) { console.log('denied:' + error.message); }"
  ].join('\n');
  const leaseA = startNode(['--input-type=module', '-e', leaseWorkerCode], {
    ...process.env, SAR_MODULE_URL: moduleUrl, SAR_MANIFEST: leasePathA, SAR_ROOT: root, SAR_PROJECT: projectRef,
    SAR_FACTOR: factorId, SAR_ENTERED: enteredA, SAR_RELEASE: releaseProvider
  });
  childProcesses.push(leaseA);
  await waitForFiles([enteredA]);
  const leaseB = startNode(['--input-type=module', '-e', leaseWorkerCode], {
    ...process.env, SAR_MODULE_URL: moduleUrl, SAR_MANIFEST: leasePathB, SAR_ROOT: root, SAR_PROJECT: projectRef,
    SAR_FACTOR: factorId, SAR_ENTERED: enteredB, SAR_RELEASE: releaseProvider
  });
  childProcesses.push(leaseB);
  const loser = await Promise.race([leaseA.done, leaseB.done]);
  assert.equal(loser.code, 0);
  assert.match(loser.stdout, /denied:Cleanup lease sedang dipakai/);
  await writeFile(releaseProvider, 'release');
  const leaseResults = await Promise.all([leaseA.done, leaseB.done]);
  assert.equal(leaseResults.filter(result => /completed:/.test(result.stdout)).length, 1);
  assert.equal(leaseResults.filter(result => /denied:/.test(result.stdout)).length, 1);
  assert.equal((await readFile(enteredA).catch(() => null) ? 1 : 0) + (await readFile(enteredB).catch(() => null) ? 1 : 0), 1,
    'the losing operation cannot list factors or perform provider I/O');
} finally {
  for (const process of childProcesses) if (process.child.exitCode === null) process.child.kill();
  await Promise.allSettled(childProcesses.map(process => process.done));
  await rm(root, { recursive: true, force: true });
}

console.log('Auth cleanup subprocess OK: portable entrypoint, side-effect-free import, Windows-safe paths, receipt-preserving dry-run, fail-closed execute, malformed input and persisted original-manifest retry');
