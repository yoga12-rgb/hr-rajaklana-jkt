// Browser reports live outside Playwright's auto-cleared outputDir. Each run is
// bound to the reviewed source, and an incomplete/changed-source run fails closed.
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
export function sourceFingerprint(cwd = root) {
  // Explicit source allowlist: never copy environment files or local secrets.
  const paths = execFileSync('git', ['ls-files', '-cz', '--cached', '--others', '--exclude-standard', '--',
    'src', 'tests', 'supabase', 'api', 'server', '.github', 'vercel.json', 'package.json', 'package-lock.json',
    'playwright.config.ts', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json'], { cwd, encoding: 'utf8' })
    .split('\0').filter(path => path && !/(^|\/)\.env($|\.)/.test(path)).sort();
  return fingerprintFiles(cwd, paths);
}
export function fingerprintFiles(cwd, paths) {
  // Git still lists tracked files deleted in the reviewed worktree. Bind their
  // absence explicitly rather than failing to fingerprint a feature removal.
  const files = Object.fromEntries([...new Set(paths)].sort().map(path => [path,
    existsSync(resolve(cwd, path)) ? hash(readFileSync(resolve(cwd, path))) : null]));
  return { sha256: hash(JSON.stringify(files)), files };
}
export function validateFixture(suite, env) {
  if (!['live-mock', 'demo-pwa'].includes(suite)) throw new Error('Expected live-mock or demo-pwa');
  const url = new URL(env.E2E_BASE_URL || 'http://127.0.0.1:5173');
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Evidence runner accepts isolated loopback fixture servers only');
  }
  if (suite === 'live-mock' && (env.E2E_LIVE_SUPABASE_MOCK !== '1' || env.E2E_PWA === '1')) {
    throw new Error('live-mock requires explicit E2E_LIVE_SUPABASE_MOCK=1 and no PWA flag');
  }
  if (suite === 'demo-pwa' && (env.E2E_PWA !== '1' || env.E2E_LIVE_SUPABASE_MOCK === '1')) {
    throw new Error('demo-pwa requires explicit E2E_PWA=1 and no live-mock flag');
  }
}
export function runEvidence(suite) {
  validateFixture(suite, process.env);
  const before = sourceFingerprint();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${suite}-${randomUUID()}`;
  const runDir = resolve(root, '.codex-test-tmp/evidence', runId);
  mkdirSync(runDir, { recursive: true });
  const reportPath = resolve(runDir, 'report.json');
  // Vite ignores node_modules. Trace HTML under the workspace during a test can
  // otherwise trigger an HMR reload and invalidate the very workflow being tested.
  const transientOutput = resolve(root, 'node_modules/.cache/rajaklana-browser-evidence', runId);
  const args = [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test',
    ...(suite === 'demo-pwa' ? ['tests/demo.spec.ts'] : ['live-.*\\.spec\\.ts']),
    '--reporter=line,json', '--forbid-only', '--retries=0', '--output', transientOutput];
  const manifest = { runId, suite, startedAt: new Date().toISOString(),
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceBefore: before, command: [process.execPath, ...args], report: 'report.json',
    status: 'RUNNING', device: 'synthetic desktop browser; not a real device' };
  const manifestPath = resolve(runDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Retained evidence: ${relative(root, runDir)}`);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath } });
  if (existsSync(transientOutput)) cpSync(transientOutput, resolve(runDir, 'artifacts'), { recursive: true });
  manifest.sourceAfter = sourceFingerprint();
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = result.status;
  manifest.sourceUnchanged = before.sha256 === manifest.sourceAfter.sha256;
  if (result.error) manifest.error = result.error.message;
  let checkerStatus = null;
  try {
    manifest.reportSha256 = hash(readFileSync(reportPath));
    const checked = spawnSync(process.execPath, [resolve(root, 'supabase/tests/check-browser-report.mjs'), reportPath, suite],
      { cwd: root, stdio: 'inherit' });
    checkerStatus = checked.status;
  } catch (error) { manifest.error = error.message; }
  manifest.checkerExitCode = checkerStatus;
  manifest.status = result.status === 0 && checkerStatus === 0 && manifest.sourceUnchanged ? 'PASS' : 'FAIL';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  if (manifest.status !== 'PASS') throw new Error(`Browser evidence failed/incomplete/source changed: ${manifestPath}`);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEvidence(process.argv[2]);
}
