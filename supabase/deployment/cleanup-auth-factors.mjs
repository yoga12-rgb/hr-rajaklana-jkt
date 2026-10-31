#!/usr/bin/env node
// Deliberate, manifest-driven operator tool for the retired application
// authenticator. It is separate from the product and defaults to dry-run.
// Never place service keys, JWTs, OTPs, seeds or QR values in a manifest.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedFactorTypes = new Set(['totp']);
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
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
  if (!manifest || manifest.schema !== 1 || typeof manifest.operationKey !== 'string') throw new Error('Manifest cleanup tidak valid.');
  const target = assertSafeTarget(manifest);
  if (expected.projectRef && expected.projectRef !== target.projectRef) throw new Error('Project ref manifest berbeda dari target.');
  if (expected.userId && expected.userId !== target.userId) throw new Error('Auth user manifest berbeda dari target.');
  if (!Array.isArray(manifest.factors) || !manifest.factors.length) throw new Error('Manifest faktor kosong.');
  for (const factor of manifest.factors) {
    const item = { id: factor.id, userId: factor.userId, factorType: factor.factorType, status: factor.status };
    if (factor.userId !== target.userId || !allowedFactorTypes.has(factor.factorType) || factor.fingerprint !== fingerprint(item)) throw new Error('Fingerprint atau linkage faktor manifest tidak valid.');
  }
  return manifest;
}

export async function buildManifest(provider, target) {
  const safe = assertSafeTarget(target);
  const factors = await provider.listFactors(safe.userId);
  return createManifest({ ...safe, factors });
}

export async function cleanupFromManifest(provider, manifest, { execute = false, projectRef } = {}) {
  validateManifest(manifest, { projectRef });
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
      observed.push({ id: item.id, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      return { ...manifest, status: 'failed', result: { observed, at: new Date().toISOString() } };
    }
  }
  return { ...manifest, status: execute ? 'completed' : 'pending', result: { observed, at: new Date().toISOString() } };
}

export async function saveManifest(path, manifest) {
  validateManifest(manifest);
  const target = resolve(path), temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temp, target);
  return target;
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
  const result = { ...manifest, status: 'pending', result: { observed: manifest.factors.map(factor => ({ id: factor.id, status: 'planned' })), at: new Date().toISOString() } };
  await saveManifest(manifestPath, result);
  console.log(JSON.stringify({ operationKey: result.operationKey, projectRef: result.projectRef, userId: result.userId, status: result.status, execute: false }));
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
