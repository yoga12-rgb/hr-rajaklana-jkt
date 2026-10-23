// Read-only release verification. This does not sign in or test HR workflows.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const origin = 'https://hr-rajaklana-jkt-preview.vercel.app';
// `vercel env run -- node scripts/verify-preview-shell.mjs` supplies the
// short-lived development token without printing or persisting credentials.
const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
const trustedHeader = 'x-vercel-trusted-oidc-idp-token';
const trustedHeaders = oidcToken ? { [trustedHeader]: oidcToken } : {};
function redactTokens(value) {
  let text = String(value ?? '');
  if (oidcToken) text = text.split(oidcToken).join('[redacted]');
  return text.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-token]');
}
function safeLocation(value) {
  try { const url = new URL(value, origin); return { origin: url.origin, path: redactTokens(url.pathname) }; }
  catch { return { origin: '', path: '' }; }
}
function safeText(value, limit = 300) {
  return redactTokens(value).replace(/https?:\/\/[^\s<>"']+/g, value => {
    const location = safeLocation(value); return `${location.origin}${location.path}`;
  }).replace(/\b(token|secret|password|authorization|code)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}
function isRedirect(response) { return response.status() >= 300 && response.status() < 400 && response.status() !== 304; }
const output = new URL('../.vercel/release-preview-oct23/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
let browser, page, response, phase = 'browser-launch', blockedRedirect = null;
async function checkedGet(context, value) {
  const url = new URL(value, origin);
  assert.equal(url.origin, origin, 'Smoke assets must remain on the verified Preview origin');
  const result = await context.request.get(url.href, { headers: trustedHeaders, maxRedirects: 0 });
  if (isRedirect(result)) {
    blockedRedirect = { status: result.status(), ...safeLocation(result.headers().location ?? url.href) };
    throw new Error('Preview resource redirected; automatic redirects are disabled to keep the trusted token origin scoped');
  }
  return result;
}
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  phase = 'login';
  const context = await browser.newContext({ serviceWorkers: 'block' });
  if (oidcToken) {
    // Extra HTTP headers and route.continue overrides follow redirects, so an
    // origin predicate alone cannot prevent a token reaching a different host.
    // Fetch one hop and fulfill only non-redirect responses. Never put the
    // credential in context-wide headers or browser-visible storage.
    await context.route(url => url.origin === origin, async route => {
      try {
        const fetched = await route.fetch({ headers: { ...route.request().headers(), ...trustedHeaders }, maxRedirects: 0 });
        if (isRedirect(fetched)) {
          blockedRedirect = { status: fetched.status(), ...safeLocation(fetched.headers().location ?? route.request().url()) };
          await route.abort('blockedbyclient');
          return;
        }
        await route.fulfill({ response: fetched });
      } catch (error) {
        errors.push(safeText(error.message));
        await route.abort('failed').catch(() => {});
      }
    });
  }
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  response = await page.goto(`${origin}/login`);
  assert.equal(response?.status(), 200);
  await page.getByLabel('Nomor karyawan', { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByLabel('Kata sandi', { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText('Preview · Lingkungan uji', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Data contoh, tanpa koneksi Supabase.').count(), 0);

  phase = 'service-worker-manifest';
  const serviceWorker = await checkedGet(context, `${origin}/service-worker.js`);
  assert.equal(serviceWorker.status(), 200);
  const paths = [...(await serviceWorker.text()).matchAll(/path:\s*[`"']([^`"']+\.js)[`"']/g)].map(match => match[1]);
  assert(paths.length > 10, 'Expected immutable application bundles in service worker manifest');
  phase = 'public-bundles';
  const bundles = await Promise.all(paths.map(async path => {
    const response = await checkedGet(context, new URL(path, origin).href);
    assert.equal(response.status(), 200);
    return response.text();
  }));
  const source = bundles.join('\n');
  const refs = [...new Set([...source.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g)].map(match => match[1]))];
  assert.deepEqual(refs, ['lypsqrwjzrmuyqtdcegr'], 'Only the verified Supabase Preview project may be bundled');
  assert(source.includes('hr_save_employee_with_roles'), 'Atomic employee RPC must be in the deployed frontend');
  assert.deepEqual(errors, []);
  phase = 'login-screenshot';
  await page.screenshot({ path: fileURLToPath(new URL('preview-login.png', output)), fullPage: true });
  console.log(JSON.stringify({ origin, loginStatus: 200, preview: true, demo: false,
    publicJsBundles: paths.length, supabaseProject: refs[0], atomicEmployeeRpc: true,
    pageErrors: errors.length, oidcUsed: Boolean(oidcToken), authenticatedWorkflowTested: false, physicalDeviceTested: false }));
} catch (error) {
  const title = page ? await page.title().catch(() => '') : '';
  const body = page ? await page.locator('body').innerText({ timeout: 2000 }).catch(() => '') : '';
  const diagnostic = { ok: false, phase, status: response?.status() ?? blockedRedirect?.status ?? null,
    ...safeLocation(page?.url() ?? origin), title: safeText(title, 100), body: safeText(body),
    error: safeText(error.message, 400), blockedRedirect, oidcUsed: Boolean(oidcToken),
    pageErrors: errors.map(message => safeText(message, 150)).slice(0, 3) };
  console.error(JSON.stringify(diagnostic));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
