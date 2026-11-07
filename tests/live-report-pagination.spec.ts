import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const backend = 'http://127.0.0.1:54329';
type Row = Record<string, any>;
type Gate = { received: Promise<void>; release(): Promise<void>; started: boolean; opened: () => void; wait: Promise<void>; finished: () => void };
function gate(): Gate {
  const received = Promise.withResolvers<void>(), wait = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>();
  const result = { received: received.promise, started: false, opened() { result.started = true; received.resolve(); }, wait: wait.promise,
    finished: finished.resolve, async release() { wait.resolve(); if (result.started) await finished.promise; } };
  return result;
}
function scopeSession(scope: 'a' | 'b', revision = 0) {
  const user = { id: `auth-report-${scope}`, aud: 'authenticated', role: 'authenticated', email: `${scope}@example.test`, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: new Date().toISOString() };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { user, access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: 'authenticated', aal: 'aal1', revision, exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-report`, refresh_token: `synthetic-report-${scope}-${revision}`, token_type: 'bearer', expires_in: 3600 };
}
function timestamp(value: any): any {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const match = value.match(/^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  return match ? BigInt(Date.parse(match[1] + match[3])) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0').slice(0, 6)) : value;
}
function compare(a: any, b: any) { const left = timestamp(a), right = typeof a === 'number' ? Number(b) : timestamp(b); return left === right ? 0 : left < right ? -1 : 1; }
function branches(expression: string) {
  const result: string[] = []; let depth = 0, start = 0;
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === '(') depth++; else if (expression[index] === ')') depth--;
    else if (expression[index] === ',' && depth === 0) { result.push(expression.slice(start, index)); start = index + 1; }
  }
  result.push(expression.slice(start)); return result;
}
function logical(row: Row, expression: string): boolean {
  if (expression.startsWith('or(')) return branches(expression.slice(3, -1)).some(part => logical(row, part));
  if (expression.startsWith('and(')) return branches(expression.slice(4, -1)).every(part => logical(row, part));
  const match = expression.match(/^([a-z_]+)\.(.*)$/); if (!match) throw Error(`Unsupported fixture logical expression ${expression}`);
  return filter(row[match[1]], match[2]);
}
function filter(value: any, expression: string): boolean {
  if (expression.startsWith('not.')) return !filter(value, expression.slice(4));
  if (expression === 'is.null') return value == null;
  if (expression.startsWith('in.(')) return branches(expression.slice(4, -1)).map(item => item.replace(/^"|"$/g, '')).includes(String(value));
  const match = expression.match(/^(eq|neq|gte|lte|gt|lt)\.(.*)$/); if (!match) throw Error(`Unsupported fixture filter ${expression}`);
  if (value == null) return false;
  const delta = compare(value, match[2]);
  return ({ eq: delta === 0, neq: delta !== 0, gte: delta >= 0, lte: delta <= 0, gt: delta > 0, lt: delta < 0 } as Record<string, boolean>)[match[1]];
}
function postgrest(source: Row[], url: URL) {
  let rows = structuredClone(source);
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
    rows = rows.filter(row => key === 'or' ? logical(row, `or${value}`) : key === 'and' ? logical(row, `and${value}`) : filter(row[key], value));
  }
  const order = (url.searchParams.get('order') ?? '').split(',').filter(Boolean).map(value => value.split('.'));
  rows.sort((a, b) => { for (const [field, direction] of order) { const delta = compare(a[field], b[field]); if (delta) return direction === 'desc' ? -delta : delta; } return 0; });
  const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? rows.length);
  rows = rows.slice(offset, offset + limit);
  const selected = url.searchParams.get('select') ?? '*';
  return selected === '*' ? rows : rows.map(row => Object.fromEntries(selected.split(',').map(field => [field, row[field]])));
}
async function respond(route: Route, body: unknown, status = 200) {
  const list = Array.isArray(body) ? body : null;
  await route.fulfill({ status, contentType: 'application/json', headers: list ? { 'content-range': list.length ? `0-${list.length - 1}/${list.length}` : '*/0' } : {}, body: JSON.stringify(body) });
}
async function setup(page: Page) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = Date.parse(`${today}T00:00:00+07:00`), step = Math.max(1, Math.floor((Date.now() - start - 1000) / 124));
  const data = (scope: 'a' | 'b'): Record<string, Row[]> => {
    const records = Array.from({ length: 122 }, (_, index) => {
      const at = start + 1 + index * step;
      return { id: `record-${scope}-${String(index).padStart(3, '0')}`, employee_id: `cashier-report-${scope}`, outlet_id: index >= 100 ? 'outlet-b' : 'outlet-a', work_date: today, shift: 'morning',
        clock_in: new Date(at).toISOString(), clock_out: new Date(at + 1).toISOString(), created_at: new Date(at + 1).toISOString(), expected_in: new Date(at).toISOString(),
        source: 'manual', corrected: true, selfie_path: '', late_minutes: 0, worked_minutes: 0, morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', tolerance_minutes: 5, outlet_latitude: -6.2, outlet_longitude: 106.8, radius_m: 500 };
    });
    return {
      employees: [{ id: `admin-report-${scope}`, employee_number: 'RK000081', full_name: `Admin Laporan ${scope.toUpperCase()}`, auth_user_id: scopeSession(scope).user.id, status: 'active', account_status: 'active', starts_on: '2020-01-01', department_id: 'report-dept', position_id: 'report-admin', outlet_id: 'outlet-a', weekly_off_days: [], can_clock: false },
        { id: `cashier-report-${scope}`, employee_number: 'RK000082', full_name: `Kasir Laporan ${scope.toUpperCase()}`, status: 'active', account_status: 'active', starts_on: '2020-01-01', department_id: 'report-dept', position_id: 'report-cashier', outlet_id: 'outlet-a', weekly_off_days: [], can_clock: true }],
      employee_roles: [{ employee_id: `admin-report-${scope}`, role: 'admin_hr' }], departments: [{ id: 'report-dept', name: 'Operasional', active: true }],
      positions: [{ id: 'report-admin', name: 'SPV', department_id: 'report-dept', active: true, is_cashier: false }, { id: 'report-cashier', name: 'Kasir', department_id: 'report-dept', active: true, is_cashier: true }],
      outlets: ['a', 'b'].map(letter => ({ id: `outlet-${letter}`, code: `OUT-${letter}`, name: `Outlet ${letter.toUpperCase()}`, active: true, latitude: -6.2, longitude: 106.8, radius_m: 500, opens_at: '07:00:00', closes_at: '23:00:00', morning_starts_at: '07:00:00', afternoon_starts_at: '15:00:00', late_tolerance_minutes: 5 })),
      attendance: records,
      // audit_events.id is a bigint identity column in PostgreSQL; PostgREST
      // returns it as a JSON number, which the report must accept as-is.
      audit_events: records.map((record, index) => ({ id: index + 1, actor_employee_id: `admin-report-${scope}`, entity_id: record.id, entity: 'attendance', action: 'attendance_manual', reason: `CSV sentinel ${scope}-${String(index).padStart(3, '0')}`, created_at: record.created_at })),
      leave_requests: [], leave_adjustments: [], notifications: [], cashier_assignments: [], attendance_correction_requests: [], leave_ledger: [], staffing_requirements: []
    };
  };
  const datasets = { a: data('a'), b: data('b') };
  const queries: { table: string; select: string; limit: number; order: string; scope: string; query: string }[] = [];
  let active: 'a' | 'b' = 'a', tokenRevision = 0, allowed = true, failSecondExport = false;
  let uiHold: Gate | null = null, exportHold: Gate | null = null;
  await page.route(`${backend}/**`, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const scope: 'a' | 'b' = request.headers().authorization === `Bearer ${scopeSession('b').access_token}` ? 'b' : active;
    if (path === '/functions/v1/hr-api') { await respond(route, { session: scopeSession(active, tokenRevision) }); return; }
    if (path === '/auth/v1/token') { tokenRevision++; await respond(route, scopeSession(active, tokenRevision)); return; }
    if (path === '/auth/v1/user') { await respond(route, scopeSession(scope).user); return; }
    if (path === '/rest/v1/rpc/auth_access_context') { await respond(route, { employee_id: `admin-report-${scope}`, allowed, requires_mfa: false, current_level: 'aal1', reason: allowed ? null : 'session_revoked' }); return; }
    if (path === '/rest/v1/rpc/leave_balance') { await respond(route, { remaining: 12, expired: false }); return; }
    if (path.startsWith('/rest/v1/rpc/')) { await respond(route, path.endsWith('_page') ? { items: [], has_more: false, next_cursor: null, total: 0 } : []); return; }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length), selected = url.searchParams.get('select') ?? '*', order = url.searchParams.get('order') ?? '', limit = Number(url.searchParams.get('limit') ?? 0);
      queries.push({ table, select: selected, limit, order, scope, query: url.search });
      const values = postgrest(datasets[scope][table] ?? [], url);
      const isReport = table === 'attendance' && selected === '*' && order === 'clock_in.desc,id.desc';
      let hold: Gate | null = null;
      if (isReport && limit === 26 && uiHold) { hold = uiHold; uiHold = null; }
      if (isReport && limit === 101 && exportHold) { hold = exportHold; exportHold = null; }
      if (hold) { hold.opened(); await hold.wait; }
      try {
        if (isReport && limit === 101 && url.searchParams.has('or') && failSecondExport) { await respond(route, { code: 'PGRST000', message: 'Export page temporarily unavailable' }, 503); return; }
        await respond(route, request.headers().accept?.includes('vnd.pgrst.object') ? values[0] ?? null : values);
      } finally { hold?.finished(); }
      return;
    }
    await respond(route, {});
  });
  await page.goto('/login');
  await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000081');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Synthetic-Report-Password');
  await page.getByRole('button', { name: 'Masuk', exact: false }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { queries, today, failNextSecondExport() { failSecondExport = true; }, recoverExport() { failSecondExport = false; }, holdUi() { uiHold = gate(); return uiHold; }, holdExport() { exportHold = gate(); return exportHold; },
    async openReports() { await page.goto('/reports'); await expect(page.locator('.report-panel tbody tr')).toHaveCount(25); },
    async refreshData() { await page.evaluate(async () => { const path: string = '/src/lib/state/app.ts'; const { actions } = await import(/* @vite-ignore */ path); await actions.refresh('attendance'); }); },
    async revokeAndRotate() { allowed = false; await page.evaluate(async () => { const path: string = '/src/lib/state/client.ts'; const { supabase } = await import(/* @vite-ignore */ path); const { error } = await supabase.auth.refreshSession(); if (error) throw error; }); },
    async switchAccount() {
      active = 'b';
      await page.evaluate(async session => { const clientPath: string = '/src/lib/state/client.ts', statePath: string = '/src/lib/state/app.ts'; const { supabase } = await import(/* @vite-ignore */ clientPath); const { actions } = await import(/* @vite-ignore */ statePath); const { error } = await supabase.auth.setSession(session); if (error) throw error; await actions.refresh(); }, scopeSession('b'));
    }
  };
}
test.skip(!process.env.E2E_LIVE_SUPABASE_MOCK, 'Requires isolated Supabase SDK mock server.');

test('report server pages stay bounded and CSV walks the entire filtered range beyond the visible page', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-REPORT-01|server reports render 25 rows per page and export all 122 matching rows through original cursor and asOf, then apply outlet filter on server' });
  const mock = await setup(page); await mock.openReports();
  await expect(page.getByText('Halaman 1 · maksimal 25 catatan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page.getByText('Halaman 2 · maksimal 25 catatan', { exact: true })).toBeVisible();
  await expect(page.locator('.report-panel tbody tr')).toHaveCount(25);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click();
  const file = testInfo.outputPath('complete-filtered-report.csv'); await (await pending).saveAs(file);
  const csv = await readFile(file, 'utf8');
  expect(csv.split(/\r?\n/)).toHaveLength(123);
  for (let index = 0; index < 122; index++) expect(csv).toContain(`CSV sentinel a-${String(index).padStart(3, '0')}`);
  expect(csv).toContain('Tidak diverifikasi GPS maupun selfie');
  expect(mock.queries.filter(row => row.table === 'attendance' && row.limit === 101)).toHaveLength(2);
  await page.getByRole('combobox', { name: 'Outlet', exact: true }).selectOption('outlet-b');
  await expect(page.locator('.report-panel tbody tr')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'Berikutnya', exact: true })).toBeDisabled();
  expect(mock.queries.some(row => row.table === 'attendance' && row.limit === 26 && new URLSearchParams(row.query).get('outlet_id') === 'eq.outlet-b')).toBe(true);
  await page.getByRole('button', { name: 'Reset semua filter', exact: true }).click();
  await expect(page.getByLabel('Dari tanggal', { exact: true })).toHaveValue(mock.today.slice(0,7) + '-01');
  await expect(page.getByLabel('Sampai tanggal', { exact: true })).toHaveValue(mock.today);
  await expect(page.locator('.report-panel tbody tr')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Berikutnya', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Ekspor CSV', exact: true })).toBeEnabled();
  await expect(page.getByText('Pilih rentang tanggal rekap yang valid.', { exact: true })).toHaveCount(0);
});

test('failed, filter-changed and data-changed exports never download a partial CSV', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-REPORT-02|failed later export page and filter or authoritative data revision changes abort the complete CSV without a partial download' });
  const mock = await setup(page); await mock.openReports();
  let downloads = 0; page.on('download', () => downloads++);
  mock.failNextSecondExport();
  await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click();
  await expect(page.getByText('Export page temporarily unavailable', { exact: true }).first()).toBeVisible();
  expect(downloads).toBe(0);
  // GET retries may recover a transient outage. Keep it unavailable through
  // every SDK retry, then explicitly restore it for the next independent case.
  mock.recoverExport();
  for (const change of ['filter', 'data'] as const) {
    const held = mock.holdExport();
    try {
      await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click(); await expect.poll(() => held.started).toBe(true);
      if (change === 'filter') await page.getByRole('textbox', { name: 'Cari karyawan', exact: true }).fill('Laporan');
      else await mock.refreshData();
      await held.release();
      await expect(page.getByText('Data, filter, atau sesi berubah. Ekspor dihentikan; muat ulang lalu ekspor kembali.', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ekspor CSV', exact: true })).toBeEnabled();
      expect(downloads).toBe(0);
    } finally { await held.release(); }
  }
});

test('revoked session during a held export cannot download or continue protected report reads', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-REPORT-03|session revocation and SDK token rotation during a held report export deny further protected reads and prevent any CSV download' });
  const mock = await setup(page); await mock.openReports();
  const held = mock.holdExport(); let downloads = 0; page.on('download', () => downloads++);
  try {
    await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click(); await expect.poll(() => held.started).toBe(true);
    const queriesBefore = mock.queries.length;
    await mock.revokeAndRotate();
    await expect(page).toHaveURL(/\/login$/);
    await held.release(); await page.waitForLoadState('networkidle');
    expect(downloads).toBe(0); expect(mock.queries).toHaveLength(queriesBefore);
  } finally { await held.release(); }
});

test('late report page from account A cannot replace account B report rows', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-REPORT-04|late report response from account A never publishes rows after account B replaces the live SDK session' });
  const mock = await setup(page), held = mock.holdUi();
  try {
    await page.goto('/reports'); await expect.poll(() => held.started).toBe(true);
    await mock.switchAccount();
    await expect(page.locator('.report-panel tbody tr')).toHaveCount(25);
    await expect(page.locator('.report-panel tbody tr').first()).toContainText('Kasir Laporan B');
    await held.release(); await page.waitForLoadState('networkidle');
    await expect(page.locator('.report-panel tbody tr')).toHaveCount(25);
    await expect(page.locator('.report-panel')).not.toContainText('Kasir Laporan A');
    await expect(page.locator('.report-panel tbody tr').filter({ hasText: 'Kasir Laporan B' })).toHaveCount(25);
  } finally { await held.release(); }
});

test('an unchanged background refresh does not falsely cancel a complete report export', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-acceptance', description: 'live-mock|UX-REPORT-05|unchanged full workspace refresh preserves the report revision and a held export completes all rows without a false data-change error' });
  const mock = await setup(page); await mock.openReports();
  const held = mock.holdExport(), pending = page.waitForEvent('download');
  void pending.catch(() => {});
  try {
    await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click(); await held.received;
    const revisions = await page.evaluate(async () => {
      const path: string = '/src/lib/state/app.ts'; const { app, actions } = await import(/* @vite-ignore */ path);
      const read = () => {
        let value: number | undefined, actor: string | undefined;
        const stop = app.subscribe((state: { reportRevision?: number; user?: { id: string } }) => { value = state.reportRevision; actor = state.user?.id; }); stop();
        if (actor !== 'admin-report-a') throw new Error('The browser must inspect the mounted account store; restart a source-changed dev fixture.');
        return value;
      };
      const before = read(); await actions.refresh(); return [before, read()];
    });
    expect(revisions[1]).toBe(revisions[0]);
    await held.release();
    const file = testInfo.outputPath('complete-after-background-refresh.csv'); await (await pending).saveAs(file);
    expect((await readFile(file, 'utf8')).split(/\r?\n/)).toHaveLength(123);
    await expect(page.getByText('122 catatan sesuai filter disiapkan untuk diunduh.', { exact: true }).first()).toBeVisible();
  } finally { await held.release(); }
});
