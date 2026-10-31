#!/usr/bin/env node
// Deliberate, manifest-driven operator tool for the retired application
// authenticator. It is separate from the product and defaults to dry-run.
// Never place service keys, JWTs, OTPs, seeds or QR values in a manifest.
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, rename, rm, realpath, lstat, mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedFactorTypes = new Set(['totp']);
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const targetKey = target => fingerprint({ projectRef: target.projectRef.toLowerCase(), userId: target.userId.toLowerCase() });

export function assertManifestFileInfo(info) {
  if (info.isSymbolicLink()) throw new Error('Manifest symlink ditolak.');
  if (!info.isFile() || info.nlink > 1) throw new Error('Manifest harus file lokal biasa tanpa hardlink.');
}

async function canonicalManifestPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Path manifest cleanup tidak valid.');
  const absolute = resolve(path);
  if (process.platform === 'win32' && absolute.startsWith('\\\\')) throw new Error('Path jaringan/UNC tidak didukung untuk cleanup.');
  const parent = await realpath(dirname(absolute));
  const target = join(parent, basename(absolute));
  try {
    const info = await lstat(target);
    assertManifestFileInfo(info);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const key = process.platform === 'win32' ? target.toLocaleLowerCase('en-US') : target;
  return { target, key, parent };
}

async function canonicalStoreRoot(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Canonical cleanup store wajib ditentukan.');
  const absolute = resolve(path);
  if (process.platform === 'win32' && absolute.startsWith('\\\\')) throw new Error('Store jaringan/UNC tidak didukung untuk cleanup.');
  const root = await realpath(absolute);
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error('Cleanup store harus direktori lokal.');
  return root;
}

async function acquireExclusiveLock(path) {
  const token = randomUUID();
  let handle;
  let created = false;
  try {
    handle = await open(path, 'wx', 0o600);
    created = true;
    await handle.writeFile(JSON.stringify({ schema: 1, token, pid: process.pid, createdAt: new Date().toISOString() }) + '\n', 'utf8');
    await handle.sync();
    return { path, token };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.code === 'EEXIST') throw new Error('Cleanup lease sedang dipakai; tidak ada operasi provider yang dijalankan.');
    if (created) await releaseOwnedLock({ path, token }).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function releaseOwnedLock(lock) {
  try {
    const record = JSON.parse(await readFile(lock.path, 'utf8'));
    if (record?.token === lock.token) await rm(lock.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function assertPathInsideStore(path, storeRoot) {
  const rel = relative(storeRoot, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('Manifest harus berada di dalam canonical cleanup store.');
  }
}

export function assertSafeTarget(target) {
  if (!target || typeof target !== 'object') throw new Error('Target cleanup tidak valid.');
  if (typeof target.projectRef !== 'string' || !/^[a-z0-9]{10,30}$/i.test(target.projectRef)) throw new Error('Project ref cleanup tidak valid.');
  if (typeof target.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.userId)) throw new Error('Auth user cleanup tidak valid.');
  return { projectRef: target.projectRef, userId: target.userId };
}

export function createManifest({ projectRef, userId, factors, operationKey = randomUUID(), now = new Date().toISOString() }) {
  const target = assertSafeTarget({ projectRef, userId });
  if (!Array.isArray(factors) || !factors.length) throw new Error('Manifest harus memiliki minimal satu faktor target.');
  const items = factors.map(factor => {
    if (factor?.userId !== userId || typeof factor.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(factor.id)) throw new Error('Faktor tidak tertaut ke akun target.');
    if (!allowedFactorTypes.has(factor.factorType ?? factor.factor_type)) throw new Error('Manifest hanya menerima faktor TOTP yang sudah dipetakan.');
    const item = { id: factor.id, userId, factorType: factor.factorType ?? factor.factor_type, status: factor.status ?? 'unknown' };
    return { ...item, fingerprint: fingerprint(item) };
  });
  return { schema: 1, operationKey, projectRef: target.projectRef, userId: target.userId, createdAt: now,
    factors: items, status: 'pending', result: null };
}

export function validateManifest(manifest, expected = {}) {
  if (!manifest || manifest.schema !== 1 || typeof manifest.operationKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(manifest.operationKey)) throw new Error('Manifest cleanup tidak valid.');
  const target = assertSafeTarget(manifest);
  if (expected.projectRef !== undefined && expected.projectRef !== target.projectRef) throw new Error('Project ref manifest berbeda dari target.');
  if (expected.userId !== undefined && expected.userId !== target.userId) throw new Error('Auth user manifest berbeda dari target.');
  if (!Array.isArray(manifest.factors) || !manifest.factors.length) throw new Error('Manifest faktor kosong.');
  const ids = new Set();
  for (const factor of manifest.factors) {
    const item = { id: factor.id, userId: factor.userId, factorType: factor.factorType, status: factor.status };
    if (typeof factor.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(factor.id) || ids.has(factor.id)
      || factor.userId !== target.userId || !allowedFactorTypes.has(factor.factorType) || factor.fingerprint !== fingerprint(item)) throw new Error('Fingerprint, ID duplikat, atau linkage faktor manifest tidak valid.');
    ids.add(factor.id);
  }
  return manifest;
}

// Persist this envelope in a trusted operator record separate from the
// editable manifest. Execution requires the original envelope again; deriving
// it from a possibly edited manifest at retry time is not an identity check.
export function createManifestEnvelope(manifest) {
  validateManifest(manifest);
  const plan = { schema: manifest.schema, operationKey: manifest.operationKey, projectRef: manifest.projectRef,
    userId: manifest.userId, createdAt: manifest.createdAt,
    factors: manifest.factors.map(({ id, userId, factorType, status, fingerprint: factorFingerprint }) => ({ id, userId, factorType, status, fingerprint: factorFingerprint })) };
  return { schema: plan.schema, operationKey: plan.operationKey, projectRef: plan.projectRef, userId: plan.userId,
    createdAt: plan.createdAt, planFingerprint: fingerprint(plan) };
}

export function createDryRunReport(manifest) {
  validateManifest(manifest);
  const envelope = createManifestEnvelope(manifest);
  return { reportType: 'dry_run', execute: false, operationKey: envelope.operationKey, projectRef: envelope.projectRef,
    userId: envelope.userId, planFingerprint: envelope.planFingerprint, observation: 'not_performed',
    factors: manifest.factors.map(({ id }) => ({ id, status: 'planned' })) };
}

export async function buildManifest(provider, target) {
  const safe = assertSafeTarget(target);
  const factors = await provider.listFactors(safe.userId);
  return createManifest({ ...safe, factors });
}

async function assertExecutionEnvelope(provider, manifest, expected) {
  assertTrustedExpectedEnvelope(expected);
  validateManifest(manifest, { projectRef: expected.projectRef, userId: expected.userId });
  const actualEnvelope = createManifestEnvelope(manifest);
  for (const key of ['schema', 'operationKey', 'projectRef', 'userId', 'createdAt', 'planFingerprint']) {
    if (expected[key] !== actualEnvelope[key]) throw new Error(`Envelope manifest berbeda pada ${key}.`);
  }
  const providerProjectRef = typeof provider?.getProjectRef === 'function'
    ? await provider.getProjectRef()
    : provider?.projectRef;
  if (typeof providerProjectRef !== 'string' || providerProjectRef !== expected.projectRef) {
    throw new Error('Identitas proyek provider tidak sesuai target tepercaya.');
  }
  return actualEnvelope;
}

function assertTrustedExpectedEnvelope(expected) {
  if (!expected || expected.schema !== 1 || typeof expected.projectRef !== 'string' || typeof expected.userId !== 'string'
    || typeof expected.operationKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(expected.operationKey)
    || typeof expected.createdAt !== 'string' || !expected.createdAt
    || typeof expected.planFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(expected.planFingerprint)) {
    throw new Error('Envelope eksekusi tepercaya wajib disediakan terpisah dari manifest.');
  }
  assertSafeTarget(expected);
  return expected;
}

function same(left, right) { return canonical(left) === canonical(right); }

function assertReceiptAppendOnly(current, next) {
  if (!current?.result) return;
  const previous = current.result, incoming = next.result;
  if (!incoming || !Array.isArray(previous.observed) || !Array.isArray(incoming.observed)
    || !Array.isArray(previous.attempts) || !Array.isArray(incoming.attempts)
    || !Array.isArray(previous.events) || !Array.isArray(incoming.events)) {
    throw new Error('Receipt lama ambigu atau tidak memiliki journal append-only; update ditolak.');
  }
  const isPrefix = (prefix, value) => prefix.length <= value.length && prefix.every((item, index) => same(item, value[index]));
  if (!isPrefix(previous.observed, incoming.observed) || !isPrefix(previous.attempts, incoming.attempts)
    || !isPrefix(previous.events, incoming.events)) throw new Error('Receipt/observations lama berubah atau terpotong; update ditolak.');
}

function startAttempt(manifest) {
  const now = new Date().toISOString(), attemptId = randomUUID();
  const prior = manifest.result ?? { observed: [], attempts: [], events: [] };
  if (!Array.isArray(prior.observed) || !Array.isArray(prior.attempts) || !Array.isArray(prior.events)) {
    throw new Error('Receipt legacy tidak memiliki journal retry yang dapat dipertahankan.');
  }
  return { attemptId, manifest: { ...manifest, receiptRevision: (manifest.receiptRevision ?? 0) + 1, status: 'in_progress',
    result: { ...prior, observed: [...prior.observed], attempts: [...prior.attempts, { attemptId, operationKey: manifest.operationKey, startedAt: now }],
      events: [...prior.events, { attemptId, at: now, phase: 'attempt', outcome: 'started' }], at: now } } };
}

function appendAttemptEvent(manifest, attemptId, event, { status, observed } = {}) {
  const now = new Date().toISOString(), prior = manifest.result;
  return { ...manifest, receiptRevision: (manifest.receiptRevision ?? 0) + 1, status: status ?? 'in_progress',
    result: { ...prior, observed: [...prior.observed, ...(observed ? [{ ...observed, at: now, attemptId }] : [])],
      events: [...prior.events, { attemptId, at: now, ...event }], at: now } };
}

export async function cleanupFromManifest(_provider, manifest, { execute = false } = {}) {
  validateManifest(manifest);
  if (execute) throw new Error('Execute wajib memakai persisted operation runner dan shared target lease.');
  return createDryRunReport(manifest);
}

async function persistTrustedEnvelope(path, envelope, { create = false } = {}) {
  const envelopePath = path + '.trusted-envelope.json';
  if (create) {
    try {
      const handle = await open(envelopePath, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(envelope, null, 2) + '\n', 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
    } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const info = await lstat(envelopePath);
  try { assertManifestFileInfo(info); }
  catch { throw new Error('Trusted envelope file harus lokal biasa tanpa symlink/hardlink.'); }
  let existing;
  try { existing = JSON.parse(await readFile(envelopePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') throw new Error('Trusted original envelope tidak ditemukan; execute/retry ditolak.'); throw error; }
  if (!same(existing, envelope)) throw new Error('Trusted original envelope berbeda; manifest tidak dapat mengganti target/plan.');
}

async function writeAtomicManifest(target, value) {
  const temp = target + '.tmp-' + process.pid + '-' + randomUUID();
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close(); handle = undefined;
    // No delete-original fallback: replacement failure leaves the prior receipt intact.
    await rename(temp, target);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

export async function saveManifest(path, manifest, { expectedRevision, expectedEnvelope } = {}) {
  validateManifest(manifest);
  const canonicalPath = await canonicalManifestPath(path), target = canonicalPath.target;
  const lock = await acquireExclusiveLock(target + '.lock');
  try {
    let current = null;
    try { current = validateManifest(JSON.parse(await readFile(target, 'utf8'))); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const incomingEnvelope = createManifestEnvelope(manifest);
    const incomingRevision = Number.isInteger(manifest.receiptRevision) ? manifest.receiptRevision : 0;
    if (expectedEnvelope && !same(expectedEnvelope, incomingEnvelope)) throw new Error('Trusted original envelope berbeda dari manifest.');
    if (!current) {
      if (incomingRevision !== 0) throw new Error('Receipt manifest berubah sejak dibaca; revision awal harus nol.');
      await persistTrustedEnvelope(target, incomingEnvelope, { create: true });
    } else {
      const currentEnvelope = createManifestEnvelope(current);
      await persistTrustedEnvelope(target, currentEnvelope);
      if (!same(currentEnvelope, incomingEnvelope)) throw new Error('Immutable envelope manifest berubah sejak disimpan.');
      const currentRevision = Number.isInteger(current.receiptRevision) ? current.receiptRevision : 0;
      if (same(current, manifest)) return target;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) throw new Error('Receipt manifest berubah sejak dibaca; expected revision tidak lagi berlaku.');
      if (!Number.isInteger(manifest.receiptRevision) || manifest.receiptRevision !== currentRevision + 1) {
        throw new Error('Receipt manifest berubah sejak dibaca; simpan ditolak agar riwayat tidak tertimpa.');
      }
      if (!current.receiptRevision && current.result) throw new Error('Receipt legacy tanpa revision tidak dapat ditimpa.');
      assertReceiptAppendOnly(current, manifest);
    }
    await writeAtomicManifest(target, manifest);
    return target;
  } finally { await releaseOwnedLock(lock); }
}

export async function loadManifest(path) {
  const canonicalPath = await canonicalManifestPath(path);
  return validateManifest(JSON.parse(await readFile(canonicalPath.target, 'utf8')));
}

async function reserveOperation(storeRoot, manifestPath, expected) {
  const directory = join(storeRoot, '.operations');
  await mkdir(directory, { recursive: true });
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('Operation registry harus direktori lokal biasa.');
  // Use a fixed-format name even though the trusted envelope is validated
  // before this helper. Never let a malformed operation key become path text.
  const path = join(directory, 'operation-' + fingerprint({ operationKey: expected.operationKey }) + '.json');
  const identity = { schema: 1, operationKey: expected.operationKey, manifestPath, envelope: expected };
  try {
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(identity, null, 2) + '\n', 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    return;
  } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
    throw new Error('Operation registry harus berupa file lokal biasa tanpa hardlink.');
  }
  const existing = JSON.parse(await readFile(path, 'utf8'));
  if (!same(existing, identity)) throw new Error('operationKey sudah terikat ke original path/envelope lain.');
}

export async function executeCleanupFromManifest(provider, { manifestPath, storeRoot, expected, persist = saveManifest } = {}) {
  assertTrustedExpectedEnvelope(expected);
  const root = await canonicalStoreRoot(storeRoot);
  const canonicalPath = await canonicalManifestPath(manifestPath);
  await assertPathInsideStore(canonicalPath.target, root);
  const leaseDirectory = join(root, '.leases');
  await mkdir(leaseDirectory, { recursive: true });
  const leaseInfo = await lstat(leaseDirectory);
  if (leaseInfo.isSymbolicLink() || !leaseInfo.isDirectory()) throw new Error('Lease store harus direktori lokal biasa.');
  const targetLease = await acquireExclusiveLock(join(leaseDirectory, 'target-' + targetKey(expected) + '.lock'));
  try {
    await reserveOperation(root, canonicalPath.key, expected);
    let manifest = await loadManifest(canonicalPath.target);
    await assertExecutionEnvelope(provider, manifest, expected);
    const priorRevision = Number.isInteger(manifest.receiptRevision) ? manifest.receiptRevision : 0;
    const started = startAttempt(manifest);
    await persist(canonicalPath.target, started.manifest, { expectedRevision: priorRevision, expectedEnvelope: expected });
    manifest = started.manifest;

    for (const item of manifest.factors) {
      let listed;
      try {
        listed = await provider.listFactors(manifest.userId);
        if (!Array.isArray(listed)) throw new Error('invalid_factor_list');
      } catch {
        const failed = appendAttemptEvent(manifest, started.attemptId, { phase: 'list', outcome: 'unknown', reason: 'provider_list_failed' }, { status: 'failed' });
        await persist(canonicalPath.target, failed, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
        return failed;
      }
      const matches = listed.filter(factor => factor?.id === item.id);
      if (matches.length > 1) {
        const failed = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'linkage', outcome: 'blocked', reason: 'duplicate_factor_identity' }, { status: 'failed' });
        await persist(canonicalPath.target, failed, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
        return failed;
      }
      const current = matches[0];
      if (!current) {
        const next = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'reconcile', outcome: 'already_absent' },
          { observed: { id: item.id, status: 'already_absent' } });
        await persist(canonicalPath.target, next, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
        manifest = next;
        continue;
      }
      if ((current.userId ?? current.user_id) !== manifest.userId || (current.factorType ?? current.factor_type) !== item.factorType) {
        const failed = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'linkage', outcome: 'blocked', reason: 'factor_linkage_changed' }, { status: 'failed' });
        await persist(canonicalPath.target, failed, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
        return failed;
      }
      const intent = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'delete', outcome: 'intent' });
      await persist(canonicalPath.target, intent, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
      manifest = intent;
      try {
        const result = await provider.deleteFactor({ userId: manifest.userId, factorId: item.id });
        if (result?.error) throw result.error;
      } catch {
        const unknown = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'delete', outcome: 'unknown', reason: 'provider_delete_ambiguous' },
          { status: 'failed', observed: { id: item.id, status: 'unknown' } });
        await persist(canonicalPath.target, unknown, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
        return unknown;
      }
      const deleted = appendAttemptEvent(manifest, started.attemptId, { factorId: item.id, phase: 'delete', outcome: 'confirmed' },
        { observed: { id: item.id, status: 'deleted' } });
      try { await persist(canonicalPath.target, deleted, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected }); }
      catch { throw new Error('Provider side effect occurred but receipt persistence failed; outcome is ambiguous. Do not create a new key or plan.'); }
      manifest = deleted;
    }
    const completed = appendAttemptEvent(manifest, started.attemptId, { phase: 'attempt', outcome: 'completed' }, { status: 'completed' });
    await persist(canonicalPath.target, completed, { expectedRevision: manifest.receiptRevision, expectedEnvelope: expected });
    return completed;
  } finally { await releaseOwnedLock(targetLease); }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const manifestPath = process.argv.find(value => value.startsWith('--manifest='))?.slice('--manifest='.length);
  if (!manifestPath || args.has('--help')) {
    console.log('Usage: node cleanup-auth-factors.mjs --manifest=PATH [--execute]');
    console.log('Default is dry-run. Execute requires an injected Auth Admin provider in an embedding script.');
    return;
  }
  const manifest = await loadManifest(manifestPath);
  if (args.has('--execute')) throw new Error('CLI execute requires an explicit provider adapter; use the embedding API to avoid accidental broad cleanup.');
  console.log(JSON.stringify(createDryRunReport(manifest)));
}

// `import.meta.url` is always a URL.  Comparing it to a hand-built `file://`
// string works on POSIX by accident, but misses the extra slash/drive-letter
// form emitted by Windows (`file:///C:/...`).  Resolve the actual argv path
// through the platform URL helper so direct invocation behaves identically on
// Windows and Linux while importing this module remains side-effect free.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
