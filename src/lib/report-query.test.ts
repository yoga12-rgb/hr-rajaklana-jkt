import { describe, expect, it } from 'vitest';
import { queryReportPage, type ReportQueryInput } from './report-query';
import type { Employee } from './types';

type Row = Record<string, any>;
const employee = (id: string, name: string, outletId = 'outlet-a') => ({ id, fullName: name, employeeNumber: `RK-${id}`, outletId, managerId: 'manager' } as Employee);
const employees = [employee('cashier-a', 'Nadia Putri'), employee('cashier-b', 'Budi Santoso', 'outlet-b')];
const input = (overrides: Partial<ReportQueryInput> = {}): ReportQueryInput => ({ tab: 'attendance', startDate: '2026-11-01', endDate: '2026-11-04', ...overrides });
const context = () => ({ employees, now: () => Date.parse('2026-11-04T12:00:00Z') });
const attendance = (id: string, clockIn = '2026-11-03T01:00:00Z', extra: Row = {}): Row => ({ id, employee_id: 'cashier-a', outlet_id: 'outlet-a', shift: 'morning', work_date: clockIn.slice(0, 10), clock_in: clockIn, clock_out: null, created_at: '2026-11-04T13:00:00.123456+00:00', corrected: false, source: 'device', late_minutes: 0, worked_minutes: null, selfie_path: 'private/photo.jpg', ...extra });

// Independent semantic evaluator for the PostgREST predicates. Tests assert the
// returned rows, rather than matching production source or a prescribed string.
function precision(value: any): any {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const match = value.match(/^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return value;
  return BigInt(Date.parse(match[1] + match[3])) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0').slice(0, 6));
}
function compare(left: any, right: any) {
  const a = precision(left), b = typeof left === 'number' ? Number(right) : precision(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
function parts(expression: string) {
  let depth = 0, start = 0; const result: string[] = [];
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === '(') depth++;
    else if (expression[index] === ')') depth--;
    else if (expression[index] === ',' && depth === 0) { result.push(expression.slice(start, index)); start = index + 1; }
  }
  result.push(expression.slice(start)); return result;
}
function predicate(row: Row, expression: string): boolean {
  if (expression.startsWith('or(')) return parts(expression.slice(3, -1)).some(value => predicate(row, value));
  if (expression.startsWith('and(')) return parts(expression.slice(4, -1)).every(value => predicate(row, value));
  const match = expression.match(/^([a-z_]+)\.(eq|lt|lte|gte|is)\.(.*)$/);
  if (!match) throw Error(`Unsupported test predicate ${expression}`);
  const [, field, operator, value] = match;
  if (operator === 'is') return value === 'null' && row[field] == null;
  if (row[field] == null) return false;
  const delta = compare(row[field], value);
  return operator === 'eq' ? delta === 0 : operator === 'lt' ? delta < 0 : operator === 'lte' ? delta <= 0 : delta >= 0;
}
function database(tables: Record<string, Row[]>, hook?: (table: string, select: string, result: Row[]) => void | Promise<void>) {
  const calls: { table: string; select: string; filters: string[]; ids?: string[] }[] = [];
  const client = { from(table: string) {
    let selected = '*', take = Infinity, offset = 0;
    const filters: ((row: Row) => boolean)[] = [], order: { field: string; ascending: boolean }[] = [], descriptions: string[] = [];
    let ids: string[] | undefined;
    const query: any = {
      select(value: string) { selected = value; return query; },
      order(field: string, options: { ascending?: boolean } = {}) { order.push({ field, ascending: options.ascending !== false }); return query; },
      limit(value: number) { take = value; return query; },
      range(from: number, to: number) { offset = from; take = to - from + 1; return query; },
      eq(field: string, value: any) { filters.push(row => row[field] === value); descriptions.push(`${field}.eq.${value}`); return query; },
      is(field: string, value: any) { filters.push(row => row[field] === value); descriptions.push(`${field}.is.${value}`); return query; },
      in(field: string, values: string[]) { filters.push(row => values.includes(row[field])); ids = values; return query; },
      gte(field: string, value: string) { filters.push(row => row[field] != null && compare(row[field], value) >= 0); descriptions.push(`${field}.gte.${value}`); return query; },
      lte(field: string, value: string) { filters.push(row => row[field] != null && compare(row[field], value) <= 0); descriptions.push(`${field}.lte.${value}`); return query; },
      lt(field: string, value: string) { filters.push(row => row[field] != null && compare(row[field], value) < 0); descriptions.push(`${field}.lt.${value}`); return query; },
      or(expression: string) { filters.push(row => predicate(row, `or(${expression})`)); descriptions.push(expression); return query; },
      async then(resolve: (result: unknown) => void, reject: (error: unknown) => void) {
        try {
          let data = structuredClone(tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
          data.sort((a, b) => { for (const item of order) { const delta = compare(a[item.field], b[item.field]); if (delta) return item.ascending ? delta : -delta; } return 0; });
          data = data.slice(offset, offset + take);
          if (selected !== '*') data = data.map(row => Object.fromEntries(selected.split(',').map(field => [field, row[field]])));
          calls.push({ table, select: selected, filters: descriptions, ids });
          await hook?.(table, selected, data);
          resolve({ data, error: null });
        } catch (error) { reject(error); }
      }
    };
    return query;
  } };
  return { client, calls };
}

describe('bounded server report queries', () => {
  it('filters attendance by WIB date, actual outlet and searched employee on the server', async () => {
    const db = database({ attendance: [attendance('included', '2026-10-31T17:00:00Z'), attendance('before', '2026-10-31T16:59:59.999999Z'), attendance('after', '2026-11-04T17:00:00Z'), attendance('wrong-outlet', undefined, { outlet_id: 'outlet-b' }), attendance('wrong-employee', undefined, { employee_id: 'cashier-b' })] });
    const result = await queryReportPage(db.client, input({ search: ' nadia ', outletId: 'outlet-a' }), context());
    expect(result.attendanceRecords.map(row => row.id)).toEqual(['included']);
    expect(db.calls.find(call => call.select === '*')?.ids).toEqual(['cashier-a']);
    expect(result.asOf).toBe('2026-11-04T13:00:00.123456+00:00'); // Server fence beats a behind-device clock.
  });

  it('preserves microseconds and ID ties over pages and excludes later backdated inserts', async () => {
    const tables = { attendance: [attendance('z', '2026-11-03T01:00:00.123456+00:00'), attendance('y', '2026-11-03T01:00:00.123456+00:00'), attendance('x', '2026-11-03T01:00:00.123456+00:00'), attendance('w', '2026-11-03T01:00:00.123455+00:00'), attendance('v', '2026-11-02T01:00:00Z')] };
    const db = database(tables);
    const first = await queryReportPage(db.client, input({ pageSize: 2 }), context());
    expect(first.attendanceRecords.map(row => row.id)).toEqual(['z', 'y']);
    expect(first.nextCursor?.at).toBe('2026-11-03T01:00:00.123456+00:00');
    tables.attendance.push(attendance('new-backdated', '2026-11-03T01:00:00.123455Z', { created_at: '2026-11-04T13:00:01Z' }));
    const second = await queryReportPage(db.client, input({ pageSize: 2, cursor: first.nextCursor }), context());
    const third = await queryReportPage(db.client, input({ pageSize: 2, cursor: second.nextCursor }), context());
    expect([...first.attendanceRecords, ...second.attendanceRecords, ...third.attendanceRecords].map(row => row.id)).toEqual(['z', 'y', 'x', 'w', 'v']);
    expect(third.hasMore).toBe(false); expect(third.nextCursor).toBeNull();
    expect(db.calls.filter(call => call.select === 'created_at')).toHaveLength(1);
  });

  it('combines review status with cursor as an intersection, including closed long sessions', async () => {
    const db = database({ attendance: [attendance('old-open', '2026-11-03T23:00:00Z'), attendance('closed-long', '2026-11-03T07:00:00Z', { clock_out: '2026-11-03T20:00:00Z', worked_minutes: 780 }), attendance('older-open', '2026-11-02T02:00:00Z'), attendance('fresh-open', '2026-11-04T08:00:00Z'), attendance('closed-normal', '2026-11-03T10:00:00Z', { clock_out: '2026-11-03T18:00:00Z', worked_minutes: 480 })] });
    const first = await queryReportPage(db.client, input({ sessionFilter: 'review', pageSize: 1 }), context());
    const second = await queryReportPage(db.client, input({ sessionFilter: 'review', pageSize: 1, cursor: first.nextCursor }), context());
    const third = await queryReportPage(db.client, input({ sessionFilter: 'review', pageSize: 1, cursor: second.nextCursor }), context());
    expect([first, second, third].flatMap(page => page.attendanceRecords.map(row => row.id))).toEqual(['old-open', 'closed-long', 'older-open']);
    const open = await queryReportPage(db.client, input({ sessionFilter: 'open' }), context());
    expect(open.attendanceRecords.map(row => row.id)).toEqual(['fresh-open', 'old-open', 'older-open']);
  });

  it('filters overlapping leave dates and maps only matching-page adjustments without signing attachments', async () => {
    const request = (id: string, extra: Row = {}) => ({ id, employee_id: 'cashier-a', starts_on: '2026-10-30', ends_on: '2026-11-02', created_at: '2026-11-01T02:00:00Z', kind: 'annual', extent: 'full_day', status: 'approved', reason: 'Rencana', deductions: { 2026: 2 }, attachment_path: 'private/document.pdf', ...extra });
    const db = database({ leave_requests: [request('included'), request('outside', { ends_on: '2026-10-31' }), request('other', { employee_id: 'cashier-b' })], leave_adjustments: [
      { id: 'latest-rejected', leave_request_id: 'included', status: 'rejected', type: 'change', created_at: '2026-11-04T03:00:00Z' },
      { id: 'pending', leave_request_id: 'included', status: 'pending', type: 'change', starts_on: '2026-11-05', ends_on: '2026-11-06', reason: 'Usulan', created_at: '2026-11-03T03:00:00Z' },
      { id: 'foreign-adjustment', leave_request_id: 'other', status: 'pending', created_at: '2026-11-04T03:00:00Z' }
    ] });
    const result = await queryReportPage(db.client, input({ tab: 'leave', outletId: 'outlet-a', search: 'RK-cashier-a' }), context());
    expect(result.leaveRequests).toHaveLength(1);
    expect(result.leaveRequests[0]).toMatchObject({ id: 'included', deductionDays: 2, adjustment: { id: 'pending', status: 'pending' }, attachmentPath: 'private/document.pdf' });
    expect(result.leaveRequests[0].attachmentUrl).toBeUndefined();
    expect(db.calls.find(call => call.table === 'leave_adjustments')?.ids).toEqual(['included']);
  });

  it('filters audit actor/outlet/entity and renders the approved leave field whitelist', async () => {
    const row = (id: string, extra: Row = {}) => ({ id, actor_employee_id: 'cashier-a', entity_id: 'request-a', entity: 'leave', action: 'leave_corrected', created_at: '2026-11-03T20:00:00Z', reason: 'Konfirmasi SPV', before_data: { starts_on: '2026-11-01', status: 'pending', attachment_path: 'NEVER-RENDER-PRIVATE' }, after_data: { starts_on: '2026-11-02', status: 'approved', auth_secret: 'NEVER-RENDER-SECRET' }, ...extra });
    const db = database({ audit_events: [row('included'), row('wrong-actor', { actor_employee_id: 'cashier-b' }), row('wrong-entity', { entity_id: 'request-b' }), row('too-late', { created_at: '2026-11-04T17:00:00Z' }), row('system', { actor_employee_id: null })] });
    const result = await queryReportPage(db.client, input({ tab: 'audit', outletId: 'outlet-a', search: 'Nadia', entityId: 'request-a' }), context());
    expect(result.auditEntries.map(entry => entry.id)).toEqual(['included']);
    expect(result.auditEntries[0].detail).toContain('Konfirmasi SPV'); expect(result.auditEntries[0].detail).toContain('Disetujui');
    expect(result.auditEntries[0].detail).not.toMatch(/NEVER-RENDER/);
    const unfiltered = await queryReportPage(db.client, input({ tab: 'audit' }), context());
    expect(unfiltered.auditEntries.some(entry => entry.id === 'system')).toBe(true);
  });

  it('reads complete related history in bounded keyset pages and keeps later correction reasons', async () => {
    const records = Array.from({ length: 1001 }, (_, index) => ({ id: `audit-${String(index).padStart(4, '0')}`, entity_id: 'corrected', created_at: new Date(Date.parse('2026-11-06T12:00:00Z') - index * 1000).toISOString(), reason: `SPV reason ${index}` }));
    const db = database({ attendance: [attendance('corrected', undefined, { corrected: true, source: 'manual' })], audit_events: records });
    const result = await queryReportPage(db.client, input(), context());
    expect(result.attendanceRecords[0]).toMatchObject({ source: 'manual', corrected: true, correctionReason: 'SPV reason 0' });
    expect(db.calls.filter(call => call.table === 'audit_events')).toHaveLength(2);
    expect(db.calls.filter(call => call.table === 'audit_events').every(call => call.ids?.join() === 'corrected')).toBe(true);
  });

  // PostgREST serialises audit_events.id (bigint identity) as a JSON number.
  // These two cases mirror the production shape behind the cashier attendance
  // recap, which must not be mistaken for a concurrent history change.
  it('keeps corrected attendance reasons when audit ids arrive as bigint numbers', async () => {
    const db = database({ attendance: [attendance('corrected', undefined, { corrected: true, source: 'manual' })],
      audit_events: [{ id: 7, entity_id: 'corrected', created_at: '2026-11-06T12:00:00.123456+00:00', reason: 'SPV reason numeric' }] });
    const result = await queryReportPage(db.client, input(), context());
    expect(result.attendanceRecords[0]).toMatchObject({ id: 'corrected', correctionReason: 'SPV reason numeric' });
  });

  it('paginates the audit tab with bigint numbers and keeps canonical string ids', async () => {
    const row = (id: number, createdAt: string) => ({ id, actor_employee_id: 'cashier-a', entity_id: 'record-a', entity: 'attendance', action: 'attendance_manual', created_at: createdAt, reason: `Riwayat ${id}` });
    const db = database({ audit_events: [row(9, '2026-11-03T20:00:00Z'), row(8, '2026-11-03T19:00:00Z'), row(7, '2026-11-03T18:00:00Z')] });
    const first = await queryReportPage(db.client, input({ tab: 'audit', pageSize: 2 }), context());
    expect(first.auditEntries.map(entry => entry.id)).toEqual(['9', '8']);
    expect(first.nextCursor?.id).toBe('8');
    const second = await queryReportPage(db.client, input({ tab: 'audit', pageSize: 2, cursor: first.nextCursor }), context());
    expect(second.auditEntries.map(entry => entry.id)).toEqual(['7']);
  });

  it('returns no matching employee rows instead of dropping a server filter', async () => {
    const db = database({ attendance: [attendance('unrelated')] });
    const result = await queryReportPage(db.client, input({ search: 'not found' }), context());
    expect(result.attendanceRecords).toEqual([]); expect(result.hasMore).toBe(false);
    expect(db.calls.filter(call => call.select === '*')).toHaveLength(0);
  });

  it('checks account scope after an awaited primary read before starting related history', async () => {
    let allowed = true;
    const db = database({ attendance: [attendance('corrected', undefined, { corrected: true })] }, (table, select) => { if (table === 'attendance' && select === '*') allowed = false; });
    await expect(queryReportPage(db.client, input(), { ...context(), assertCurrent() { if (!allowed) throw Error('account changed'); } })).rejects.toThrow('account changed');
    expect(db.calls.some(call => call.table === 'audit_events')).toBe(false);
  });

  it('checks scope after a related history read too', async () => {
    let allowed = true;
    const db = database({ attendance: [attendance('corrected', undefined, { corrected: true })], audit_events: [] }, table => { if (table === 'audit_events') allowed = false; });
    await expect(queryReportPage(db.client, input(), { ...context(), assertCurrent() { if (!allowed) throw Error('role changed'); } })).rejects.toThrow('role changed');
  });

  it('rejects a cursor reused with different filters and raw PostgREST injection before queries', async () => {
    const db = database({ attendance: [attendance('b'), attendance('a')] });
    const first = await queryReportPage(db.client, input({ pageSize: 1 }), context());
    const count = db.calls.length;
    await expect(queryReportPage(db.client, input({ pageSize: 1, search: 'Nadia', cursor: first.nextCursor }), context())).rejects.toThrow('tidak sesuai filter');
    for (const mutation of [{ at: '2026-11-01T00:00:00Z),id.gt.0' }, { id: 'abc),id.gt.0' }, { reviewAt: '2026-11-01T00:00:00Z),id.gt.0' }, { asOf: '2026-11-01T00:00:00Z),id.gt.0' }]) {
      await expect(queryReportPage(db.client, input({ cursor: { ...first.nextCursor!, ...mutation } }), context())).rejects.toThrow('tidak sesuai filter');
    }
    expect(db.calls).toHaveLength(count);
  });

  it.each([{ startDate: '' }, { startDate: '2026-11-05' }, { endDate: '2026-02-30' }, { pageSize: 0 }, { pageSize: 101 }, { outletId: 'outlet-a,or(id.gt.0)' }, { entityId: 'bad/value' }])('refuses invalid bounded report input %j', async mutation => {
    const db = database({}); await expect(queryReportPage(db.client, input(mutation), context())).rejects.toThrow(); expect(db.calls).toEqual([]);
  });

  it('does not turn a server failure into an empty successful report', async () => {
    const client = { from: () => { const q: any = { select: () => q, order: () => q, limit: () => q, then: (resolve: (value: unknown) => void) => resolve({ data: null, error: { code: '42501', message: 'denied' }, status: 403 }) }; return q; } };
    await expect(queryReportPage(client, input(), context())).rejects.toMatchObject({ message: 'denied', code: '42501', status: 403 });
  });
});
