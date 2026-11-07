import type { AttendanceRecord, AuditEntry, Employee, LeaveRequest } from './types';
import { leaveAuditDetail } from './leave-audit';
import { rpcError } from './rpc-error';

export type ReportTab = 'attendance' | 'leave' | 'audit';
export type ReportSessionFilter = 'all' | 'open' | 'review';
export interface ReportCursor { at: string; id: string; asOf: string; reviewAt: string; key: string }
export interface ReportQueryInput {
  tab: ReportTab; startDate: string; endDate: string; outletId?: string; search?: string;
  sessionFilter?: ReportSessionFilter; entityId?: string; pageSize?: number; cursor?: ReportCursor | null; asOf?: string;
}
export interface ReportPage {
  tab: ReportTab; attendanceRecords: AttendanceRecord[]; leaveRequests: LeaveRequest[]; auditEntries: AuditEntry[];
  hasMore: boolean; nextCursor: ReportCursor | null; asOf: string;
}
interface ReportContext { employees: Employee[]; assertCurrent?: () => void; now?: () => number }
type Client = { from(table: string): any };
const cutTime = (value: string | null | undefined) => value?.slice(0, 5) ?? '';
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
// audit_events.id is a bigint identity column, so PostgREST serialises it as a
// JSON number while every other report id is a uuid string. Normalise both
// shapes to the canonical string used by cursors and dedupe keys; otherwise a
// numeric bigint is rejected as if the history had changed mid-load.
const reportId = (value: unknown): string | null => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return safeId(value) ? value : null;
};
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function filters(input: ReportQueryInput) {
  if (!['attendance', 'leave', 'audit'].includes(input.tab) || !date(input.startDate) || !date(input.endDate)
    || input.endDate < input.startDate) throw new Error('Pilih rentang tanggal rekap yang valid.');
  if (input.outletId && !safeId(input.outletId) || input.entityId && !safeId(input.entityId)) throw new Error('Filter rekap tidak valid.');
  const search = (input.search ?? '').trim().toLocaleLowerCase('id-ID');
  if (search.length > 100) throw new Error('Pencarian maksimal 100 karakter.');
  const session = input.sessionFilter ?? 'all';
  if (!['all', 'open', 'review'].includes(session)) throw new Error('Status sesi rekap tidak valid.');
  const pageSize = input.pageSize ?? 25;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Ukuran halaman rekap tidak valid.');
  const key = JSON.stringify([input.tab, input.startDate, input.endDate, input.outletId ?? '', search,
    input.tab === 'attendance' ? session : 'all', input.tab === 'audit' ? input.entityId ?? '' : '']);
  const cursor = input.cursor;
  if (cursor && (!timestamp(cursor.at) || !safeId(cursor.id) || !timestamp(cursor.asOf) || !timestamp(cursor.reviewAt)
    || cursor.key !== key || input.asOf && input.asOf !== cursor.asOf)) throw new Error('Halaman rekap tidak sesuai filter. Muat ulang rekap.');
  if (input.asOf && !timestamp(input.asOf)) throw new Error('Batas waktu rekap tidak valid.');
  return { key, search, session, pageSize, cursor };
}
async function rows(query: any, context: ReportContext): Promise<any[]> {
  context.assertCurrent?.();
  const result = await query;
  context.assertCurrent?.();
  if (result.error) throw rpcError(result.error, result.status);
  if (!Array.isArray(result.data)) throw new Error('Respons rekap belum dapat dibaca. Coba lagi.');
  return result.data;
}
function cursorClause(column: string, cursor: { at: string; id: string }) {
  return `or(${column}.lt.${cursor.at},and(${column}.eq.${cursor.at},id.lt.${cursor.id}))`;
}
function applyLogical(query: any, clauses: string[]) {
  if (!clauses.length) return query;
  // The single outer OR has an AND branch when independent OR predicates are
  // combined, so a review filter cannot replace the pagination predicate.
  return query.or(clauses.length === 1 ? clauses[0].slice(3, -1) : `and(${clauses.join(',')})`);
}
function rowCursor(row: any, column: string) {
  const id = reportId(row?.id);
  if (!timestamp(row?.[column]) || !id) throw new Error('Urutan data rekap tidak valid. Muat ulang rekap.');
  // Preserve PostgreSQL microseconds rather than round through Date.toISOString.
  return { at: row[column] as string, id };
}
async function relatedRows(client: Client, table: string, foreignKey: string, ids: string[], fields: string, context: ReportContext) {
  if (!ids.length) return [];
  const output: any[] = [], seen = new Set<string>();
  let cursor: { at: string; id: string } | null = null;
  for (;;) {
    let query = client.from(table).select(fields).in(foreignKey, ids)
      .order('created_at', { ascending: false }).order('id', { ascending: false });
    if (cursor) query = applyLogical(query, [cursorClause('created_at', cursor)]);
    const page = await rows(query.range(0, 999), context);
    for (const row of page) {
      const id = reportId(row.id);
      if (!id || seen.has(id)) throw new Error('Riwayat berubah saat dimuat. Muat ulang rekap.');
      seen.add(id); output.push({ ...row, id });
    }
    if (page.length < 1000) return output;
    cursor = rowCursor(page[page.length - 1], 'created_at');
  }
}
export function mapReportAttendance(r: any, reason = ''): AttendanceRecord {
  return { id: r.id, employeeId: r.employee_id, outletId: r.outlet_id, shift: r.shift, workDate: r.work_date,
    clockIn: r.clock_in, clockOut: r.clock_out, scheduledStart: r.expected_in, lateMinutes: r.late_minutes,
    durationMinutes: r.worked_minutes, inLatitude: r.in_latitude, inLongitude: r.in_longitude,
    inAccuracy: r.in_accuracy_m, inDistance: r.in_distance_m, outLatitude: r.out_latitude,
    outLongitude: r.out_longitude, outDistance: r.out_distance_m, outAccuracy: r.out_accuracy_m,
    selfiePath: r.selfie_path ?? '', selfieCapturedAt: r.selfie_captured_at ?? undefined,
    selfieOutletName: r.selfie_outlet_name ?? undefined, corrected: r.corrected, correctionReason: reason,
    source: r.source === 'manual' ? 'manual' : 'device', assignmentId: r.assignment_id ?? null,
    outletSnapshot: { morningStart: cutTime(r.morning_starts_at), afternoonStart: cutTime(r.afternoon_starts_at),
      lateToleranceMinutes: r.tolerance_minutes, latitude: r.outlet_latitude, longitude: r.outlet_longitude, radiusMeters: r.radius_m } };
}
export function mapReportLeave(r: any, adjustments: any[], employees: Employee[]): LeaveRequest {
  const history = adjustments.filter(a => a.leave_request_id === r.id);
  const adjustment = history.find(a => a.status === 'pending') ?? history[0];
  return { id: r.id, employeeId: r.employee_id, type: r.kind, extent: r.extent,
    attachmentPath: r.attachment_path ?? undefined, attachmentName: r.attachment_path ? 'Lampiran pengajuan' : undefined,
    startDate: r.starts_on, endDate: r.ends_on, startTime: cutTime(r.starts_at), endTime: cutTime(r.ends_at), reason: r.reason,
    status: r.status, deductionDays: Object.values(r.deductions ?? {}).reduce((total: number, value) => total + Number(value), 0),
    approverId: r.decision_by ?? employees.find(e => e.id === r.employee_id)?.managerId ?? null,
    note: r.decision_note ?? '', externalApproverName: r.external_decider ?? '', createdAt: r.created_at,
    adjustment: adjustment ? { id: adjustment.id, type: adjustment.type, startDate: adjustment.starts_on,
      endDate: adjustment.ends_on, reason: adjustment.reason, status: adjustment.status, requestedAt: adjustment.created_at,
      note: adjustment.decision_note ?? '', decidedAt: adjustment.decided_at ?? undefined,
      deciderName: adjustment.external_decider || employees.find(e => e.id === adjustment.decision_by)?.fullName } : null };
}

/** RLS remains authoritative. This is a bounded, insertion-fenced page, not a
 * multi-request PostgreSQL MVCC snapshot. Callers abort export on observed changes. */
export async function queryReportPage(client: Client, input: ReportQueryInput, context: ReportContext): Promise<ReportPage> {
  const { key, search, session, pageSize, cursor } = filters(input);
  context.assertCurrent?.();
  const table = { attendance: 'attendance', leave: 'leave_requests', audit: 'audit_events' }[input.tab];
  const column = input.tab === 'attendance' ? 'clock_in' : 'created_at';
  let asOf = cursor?.asOf ?? input.asOf;
  if (!asOf) {
    // Anchor to a server timestamp, so a device clock behind the server cannot
    // accidentally exclude valid records. Later inserts wait for a fresh load.
    const latest = await rows(client.from(table).select('created_at').order('created_at', { ascending: false }).limit(1), context);
    if (!latest.length) asOf = new Date((context.now ?? Date.now)()).toISOString();
    else if (timestamp(latest[0].created_at)) asOf = latest[0].created_at;
    else throw new Error('Batas waktu data rekap tidak valid. Coba lagi.');
  }
  if (!asOf || !timestamp(asOf)) throw new Error('Batas waktu data rekap tidak valid. Coba lagi.');
  const page: ReportPage = { tab: input.tab, attendanceRecords: [], leaveRequests: [], auditEntries: [], hasMore: false, nextCursor: null, asOf };
  const matchIds = context.employees.filter(employee => (!search || `${employee.fullName} ${employee.employeeNumber}`.toLocaleLowerCase('id-ID').includes(search))
    && (input.tab === 'attendance' || !input.outletId || employee.outletId === input.outletId)).map(e => e.id);
  const needsEmployeeFilter = Boolean(search || input.tab !== 'attendance' && input.outletId);
  if (needsEmployeeFilter && !matchIds.length) return page;
  if (matchIds.some(id => !safeId(id))) throw new Error('Data karyawan rekap tidak valid. Muat ulang data.');
  let query = client.from(table).select('*').lte('created_at', asOf)
    .order(column, { ascending: false }).order('id', { ascending: false });
  const start = new Date(`${input.startDate}T00:00:00+07:00`).toISOString();
  const endExclusive = new Date(Date.parse(`${input.endDate}T00:00:00+07:00`) + 86_400_000).toISOString();
  if (input.tab === 'leave') query = query.gte('ends_on', input.startDate).lte('starts_on', input.endDate);
  else query = query.gte(column, start).lt(column, endExclusive);
  if (input.tab === 'attendance' && input.outletId) query = query.eq('outlet_id', input.outletId);
  if (needsEmployeeFilter) query = query.in(input.tab === 'audit' ? 'actor_employee_id' : 'employee_id', matchIds);
  if (input.tab === 'audit' && input.entityId) query = query.eq('entity_id', input.entityId);
  const reviewAt = cursor?.reviewAt ?? new Date((context.now ?? Date.now)()).toISOString();
  const logical: string[] = [];
  if (cursor) logical.push(cursorClause(column, cursor));
  if (input.tab === 'attendance' && session === 'open') query = query.is('clock_out', null);
  if (input.tab === 'attendance' && session === 'review') {
    const cutoff = new Date(Date.parse(reviewAt) - 12 * 60 * 60_000).toISOString();
    logical.push(`or(worked_minutes.gte.720,and(clock_out.is.null,clock_in.lte.${cutoff}))`);
  }
  query = applyLogical(query, logical);
  const data = await rows(query.range(0, pageSize), context);
  const visible = data.slice(0, pageSize);
  for (const row of visible) rowCursor(row, column);
  page.hasMore = data.length > pageSize;
  if (page.hasMore) page.nextCursor = { ...rowCursor(visible[visible.length - 1], column), asOf, reviewAt, key };
  if (input.tab === 'attendance') {
    const ids = visible.filter(r => r.corrected || r.source === 'manual').map(r => r.id);
    const history = await relatedRows(client, 'audit_events', 'entity_id', ids, 'id,entity_id,reason,created_at', context);
    page.attendanceRecords = visible.map(r => mapReportAttendance(r, history.find(a => a.entity_id === r.id && a.reason)?.reason ?? ''));
  } else if (input.tab === 'leave') {
    const adjustments = await relatedRows(client, 'leave_adjustments', 'leave_request_id', visible.map(r => r.id), '*', context);
    page.leaveRequests = visible.map(r => mapReportLeave(r, adjustments, context.employees));
  } else page.auditEntries = visible.map(r => ({ id: rowCursor(r, column).id, actorId: r.actor_employee_id, entityId: r.entity_id,
    action: r.action, at: r.created_at, detail: r.entity === 'leave' ? leaveAuditDetail(r.reason, r.before_data, r.after_data) : r.reason ?? '' }));
  context.assertCurrent?.();
  return page;
}
