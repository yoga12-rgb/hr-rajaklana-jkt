// Read-only release verification. This does not sign in or test HR workflows.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const origin = 'https://hr-rajaklana-jkt-preview.vercel.app';
const output = new URL('../.vercel/release-preview-oct23/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(`${origin}/login`);
  assert.equal(response.status(), 200);
  await page.getByLabel('Nomor karyawan', { exact: true }).waitFor();
  await page.getByLabel('Kata sandi', { exact: true }).waitFor();
  assert.equal(await page.getByText('Preview · Lingkungan uji', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Data contoh, tanpa koneksi Supabase.').count(), 0);

  const serviceWorker = await page.request.get(`${origin}/service-worker.js`);
  assert.equal(serviceWorker.status(), 200);
  const paths = [...(await serviceWorker.text()).matchAll(/path:\s*[`"']([^`"']+\.js)[`"']/g)].map(match => match[1]);
  assert(paths.length > 10, 'Expected immutable application bundles in service worker manifest');
  const bundles = await Promise.all(paths.map(async path => {
    const response = await page.request.get(new URL(path, origin).href);
    assert.equal(response.status(), 200);
    return response.text();
  }));
  const source = bundles.join('\n');
  const refs = [...new Set([...source.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)].map(match => match[1]))];
  assert.deepEqual(refs, ['lypsqrwjzrmuyqtdcegr'], 'Only the verified Supabase Preview project may be bundled');
  assert(source.includes('hr_save_employee_with_roles'), 'Atomic employee RPC must be in the deployed frontend');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL('preview-login.png', output)), fullPage: true });
  console.log(JSON.stringify({ origin, loginStatus: 200, preview: true, demo: false,
    publicJsBundles: paths.length, supabaseProject: refs[0], atomicEmployeeRpc: true,
    pageErrors: errors.length, authenticatedWorkflowTested: false, physicalDeviceTested: false }));
} finally {
  await browser.close();
}
