#!/usr/bin/env node
// Deliberate, manifest-driven operator tool for the retired application
// authenticator. It is separate from the product and defaults to dry-run.
// Never place service keys, JWTs, OTPs, seeds or QR values in a manifest.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedFactorTypes = new Set(['totp']);
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');

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
  if (!expected || typeof expected.projectRef !== 'string' || typeof expected.userId !== 'string'
    || typeof expected.operationKey !== 'string' || typeof expected.planFingerprint !== 'string') {
    throw new Error('Envelope eksekusi tepercaya wajib disediakan terpisah dari manifest.');
  }
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

function appendExecutionReceipt(manifest, observed, status, at = new Date().toISOString()) {
  const prior = manifest.result;
  const history = Array.isArray(prior?.attempts) ? [...prior.attempts]
    : prior ? [{ status: manifest.status ?? 'unknown', at: prior.at ?? manifest.createdAt, observed: Array.isArray(prior.observed) ? [...prior.observed] : [] }] : [];
  const attempt = { status, at, observed };
  history.push(attempt);
  const previousObserved = Array.isArray(prior?.observed) ? prior.observed : [];
  return { ...manifest, receiptRevision: (manifest.receiptRevision ?? 0) + 1, status,
    result: { observed: [...previousObserved, ...observed], at, attempts: history } };
}

export async function cleanupFromManifest(provider, manifest, { execute = false, expected } = {}) {
  await assertExecutionEnvelope(provider, manifest, expected);
  if (!execute) return createDryRunReport(manifest);
  const observed = [];
  for (const item of manifest.factors) {
    const listed = await provider.listFactors(manifest.userId);
    const current = listed.find(factor => factor.id === item.id);
    if (!current) { observed.push({ id: item.id, status: 'already_absent' }); continue; }
    if (current.userId !== manifest.userId || current.factorType !== item.factorType) throw new Error(`Faktor ${item.id} berubah atau tertaut ke akun lain.`);
    if (!execute) { observed.push({ id: item.id, status: 'planned' }); continue; }
    try {
      await provider.deleteFactor({ userId: manifest.userId, factorId: item.id });
      observed.push({ id: item.id, status: 'deleted' });
    } catch (error) {
      observed.push({ id: item.id, status: 'failed', error: 'provider_delete_failed' });
      return appendExecutionReceipt(manifest, observed, 'failed');
    }
  }
  return appendExecutionReceipt(manifest, observed, 'completed');
}

export async function saveManifest(path, manifest) {
  validateManifest(manifest);
  const target = resolve(path), lock = `${target}.lock-${process.pid}-${randomUUID()}`;
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const normalized = { ...manifest };
  let lockCreated = false;
  try {
    await writeFile(lock, 'locked\n', { encoding: 'utf8', flag: 'wx' });
    lockCreated = true;
    let current = null;
    try { current = validateManifest(JSON.parse(await readFile(target, 'utf8'))); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const nextRevision = Number.isInteger(normalized.receiptRevision) ? normalized.receiptRevision : 0;
    if ((!current && nextRevision !== 0) || (current && (!Number.isInteger(normalized.receiptRevision)
      || normalized.receiptRevision !== (current.receiptRevision ?? 0) + 1))) {
      throw new Error('Receipt manifest berubah sejak dibaca; simpan ditolak agar riwayat tidak tertimpa.');
    }
    await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, target);
    return target;
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
    if (lockCreated) await rm(lock, { force: true }).catch(() => undefined);
  }
}

export async function loadManifest(path) { return validateManifest(JSON.parse(await readFile(path, 'utf8'))); }

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
