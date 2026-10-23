import { get, writable } from 'svelte/store';
import type { AppState, AttendanceRecord, ClockInInput, ClockOutInput, Department, Employee, LeaveDecision, LeaveInput, LeaveRequest, Outlet, Position, Role, Shift, CashierAssignmentInput, AttendanceCorrectionInput, RetrospectiveLeaveInput, CashierRosterChange, StaffingRequirementInput, StaffingRequirement, SpvFollowupInput, SpvFollowup, SpvFollowupUpdate } from '../types';
import { attendanceTiming, dateRange, deductionByYear, haversineMeters, jakartaDate, leaveEntitlement } from '../domain';
import { initialDemo } from './demo';
import { hasApproverAccess } from '../access';
import { configured, supabase } from './client';
import { classifyAttendanceLateness, approvedArrivalForAttendance } from '../attendance-status';
import { duplicateLeave, findLeaveConflicts } from '../leave-validation';
import { demoNotifications } from '../notifications';
import { leaveAuditDetail } from '../leave-audit';
import { assignmentFor, assertCashierAssignment, saveAssignmentInState, syncUnassignedRosterFollowups, assertCorrectionInput, submitCorrectionInState, decideCorrectionInState } from '../cashier-workflows';
import { disableDevicePush } from '../device-push';
import { followupCaseKey, operationalSignals, validateRosterBatch } from '../cashier-spv';
import { rpcError } from '../rpc-error';

const KEY = 'rajaklana-hr-demo-v1';
export const app = writable<AppState>(initialDemo());
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
let realtimeUserId: string | null = null;
let realtimeGeneration = 0;
let realtimeReplacementPending = false;
let realtimeTerminal = false;
let refreshing = false, timer: ReturnType<typeof setTimeout> | undefined;
let refreshPromise: Promise<void> | null = null;
let refreshRequested = false;
let initPromise: Promise<void> | null = null;
let realtimeSubscribed = false;
let realtimeRetryTimer: ReturnType<typeof setTimeout> | undefined;
let realtimeRetryAttempt = 0;
let authRevision = 0;
let liveAuthUserId: string | null = null;
const id = () => crypto.randomUUID();
async function demoPasswordHash(password: string, salt: string) { const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${salt}:${password}`)); return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
function readDemoToken(token: string) {
  const links = JSON.parse(localStorage.getItem('rk-demo-links') ?? '{}');
  const link = links[token], expiresAt = new Date(link?.expiresAt ?? '').getTime();
  if (!link || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) throw new Error('Tautan tidak berlaku atau sudah kedaluwarsa. Hubungi HR.');
  const employee = get(app).employees.find(e => e.id === link.employeeId);
  if (!employee || employee.status !== 'active') throw new Error('Akun karyawan tidak aktif. Hubungi HR.');
  return { links, link, employee };
}
const activeAccount = (employee: Employee | null | undefined) => employee?.status === 'active' && employee.accountStatus === 'active';
const user = () => { const u = get(app).user; if (!u || !activeAccount(u)) throw new Error('Silakan masuk dengan akun aktif.'); return u; };
export const isAdmin = (employee: Employee | undefined | null = get(app).user) => employee?.roles.includes('admin_hr') ?? false;
export const isApprover = (employee: Employee | undefined | null = get(app).user) => hasApproverAccess(employee, get(app).employees);
export const isCashier = (employee: Employee | undefined | null = get(app).user) => !!employee && get(app).positions.some(p => p.id === employee.positionId && p.isCashier);
export const displayName = (employeeId: string) => get(app).employees.find(e => e.id === employeeId)?.fullName ?? 'Karyawan';
export const shiftLabel = (shift: Shift) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle' })[shift];
function attendanceSnapshot(outlet: Outlet): NonNullable<AttendanceRecord['outletSnapshot']> {
  const { morningStart, afternoonStart, lateToleranceMinutes, latitude, longitude, radiusMeters } = outlet;
  return { morningStart, afternoonStart, lateToleranceMinutes, latitude, longitude, radiusMeters };
}
export const cashierAssignment = (employeeId = user().id, day = jakartaDate()) => assignmentFor(get(app),employeeId,day);
function assertFreshGps(capturedAt: string | undefined) {
  const age = Date.now() - Date.parse(capturedAt ?? '');
  if (!Number.isFinite(age) || age < -5000 || age > 60_000) throw new Error('Lokasi sudah kedaluwarsa. Periksa ulang lokasi sebelum konfirmasi.');
}
async function verifyBiometricSelfie(input: ClockInInput, selfiePath: string): Promise<string> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session) throw new Error('Silakan masuk kembali.');
  const response = await fetch('/api/biometric', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'verify', selfiePath, shift: input.shift, latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy,
      geoCapturedAt: input.geoCapturedAt, selfieCapturedAt: input.selfieCapturedAt, selfieOutletName: input.selfieOutletName }) });
  const result = await response.json();
  if (!response.ok || !result.verificationToken) throw Object.assign(new Error(result.error || 'Wajah belum berhasil diverifikasi. Periksa pendaftaran wajah atau hubungi HR.'), { uploadRejected: true });
  return result.verificationToken;
}
function selfieMetadata(input: ClockInInput): Pick<AttendanceRecord, 'selfieCapturedAt' | 'selfieOutletName'> {
  if (input.selfieCapturedAt === undefined && input.selfieOutletName === undefined) return {};
  const capturedAt = input.selfieCapturedAt, outletName = input.selfieOutletName;
  if (typeof capturedAt !== 'string' || typeof outletName !== 'string' || !outletName.trim()) throw new Error('Waktu dan outlet pengambilan selfie harus lengkap. Ambil selfie kembali.');
  // Require a real ISO instant, including its timezone, rather than a loose date.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt))) throw new Error('Waktu pengambilan selfie tidak valid. Ambil selfie kembali.');
  const localParts = new Date(`${capturedAt.slice(0,19)}Z`);
  if (!Number.isFinite(+localParts) || localParts.toISOString().slice(0,19) !== capturedAt.slice(0,19)) throw new Error('Waktu pengambilan selfie tidak valid. Ambil selfie kembali.');
  return { selfieCapturedAt: new Date(capturedAt).toISOString(), selfieOutletName: outletName.trim() };
}
export function attendanceOutlet(record: AttendanceRecord, outlet: Outlet): Outlet {
  // Older local records have no snapshot; retain their existing outlet fallback.
  return { ...outlet, ...record.outletSnapshot };
}
function attendanceOverlaps(records: AttendanceRecord[], employeeId: string, clockIn: string, clockOut: string | null, excludedId?: string): boolean {
  const start = +new Date(clockIn), end = clockOut === null ? Infinity : +new Date(clockOut);
  if (start === end) return false;
  return records.some(record => {
    const recordStart = +new Date(record.clockIn), recordEnd = record.clockOut === null ? Infinity : +new Date(record.clockOut);
    return record.id !== excludedId && record.employeeId === employeeId && recordStart !== recordEnd
      && recordStart < end && start < recordEnd;
  });
}
export function attendancePermission(record: AttendanceRecord): string {
  const permission = approvedArrivalForAttendance(record, get(app).leaveRequests);
  if (!permission) return '';
  return `Izin datang sampai ${permission.time} WIB${classifyAttendanceLateness(record, get(app).leaveRequests).kind === 'permit_exceeded' ? ' · masuk melewati waktu izin' : ' disetujui'}`;
}
export const attendanceLateStatus = (record: AttendanceRecord) => classifyAttendanceLateness(record, get(app).leaveRequests);
export const leaveConflicts = (employeeId: string, startDate: string, endDate: string, excludedId?: string) => findLeaveConflicts(get(app), employeeId, startDate, endDate, excludedId);
export const isDuplicateLeave = (input: LeaveInput, excludedId?: string, employeeId = user().id) => duplicateLeave(get(app), employeeId, input, excludedId);
export function canDecideLeave(request: LeaveRequest): boolean {
  const s = get(app), u = s.user, employee = s.employees.find(e => e.id === request.employeeId);
  if (!u || !activeAccount(u) || !employee || u.id === employee.id) return false;
  return employee.approvalMode === 'external' ? isAdmin(u) : employee.managerId === u.id;
}
export function leaveBalance(employeeId: string, year = Number(jakartaDate().slice(0, 4))): number {
  const s = get(app), employee = s.employees.find(e => e.id === employeeId);
  if (!employee || year < Number(jakartaDate().slice(0, 4))) return 0;
  if (s.mode === 'live') return s.balanceCache?.[`${employeeId}:${year}`] ?? 0;
  return Math.max(0, Math.round((leaveEntitlement(employee.joinDate, year) - s.leaveLedger.filter(e => e.employeeId === employeeId && e.year === year).reduce((a, b) => a + b.days, 0)) * 100) / 100);
}
function persist(state: AppState) {
  if (typeof localStorage !== 'undefined' && state.mode === 'demo') localStorage.setItem(KEY, JSON.stringify({ ...state, user: state.user ? { ...state.user, photoUrl: undefined } : null, employees: state.employees.map(({ photoUrl, ...employee }) => employee), attendanceRecords: state.attendanceRecords.map(({ selfieUrl, ...record }) => record), leaveRequests: state.leaveRequests.map(({ attachmentUrl, ...request }) => request) }));
}
function commit(change: (state: AppState) => void, action?: string, entityId = '', detail = '') {
  const before = get(app), state = structuredClone(before); change(state);
  state.notifications = [...demoNotifications(before, state), ...(state.notifications ?? [])];
  if (action) state.auditEntries.unshift({ id: id(), actorId: state.user?.id ?? '', action, entityId, at: new Date().toISOString(), detail });
  if (state.user) state.user = state.employees.find(e => e.id === state.user?.id) ?? null;
  persist(state); app.set(state);
}
function auditDemoFollowupContextChanges(state: AppState, before: SpvFollowup[], actorId: string) {
  const previous = new Map(before.map(row => [row.id, row]));
  for (const followup of state.spvFollowups ?? []) {
    const old = previous.get(followup.id);
    if (!old || (old.workDate === followup.workDate && old.outletId === followup.outletId
      && old.employeeId === followup.employeeId && old.shift === followup.shift)) continue;
    state.auditEntries.unshift({ id: id(), actorId, action: 'spv_followup_context_refreshed', entityId: followup.id,
      at: followup.updatedAt, detail: 'Konteks kasus mengikuti penempatan kasir.' });
  }
}
function requireAdmin() { if (!isAdmin(user())) throw new Error('Tindakan ini hanya untuk Admin HR.'); }
function fail(error: unknown): never { throw new Error(error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Permintaan belum berhasil. Coba kembali.'); }
async function rpc(name: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error, status } = await supabase.rpc(name, args);
  if (error) throw rpcError(error, status);
  return data;
}
async function cleanupRejectedLeaveUpload(path: string | null, error: unknown) {
  await cleanupRejectedUpload('leave-attachments',path,error);
}
async function cleanupRejectedUpload(bucket: 'leave-attachments' | 'attendance-selfies', path: string | null, error: unknown) {
  // A SQLSTATE response confirms that PostgreSQL rolled the RPC back. Network
  // failures can arrive while it is still committing; keep that evidence rather
  // than racing its attachment link. Storage RLS also protects linked objects.
  const code = typeof error === 'object' && error && 'code' in error ? error.code : null;
  const rejected = typeof error === 'object' && error && 'uploadRejected' in error && error.uploadRejected === true;
  if (!path || (!rejected && (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)))) return;
  try { await supabase!.storage.from(bucket).remove([path]); } catch { /* Retain the original RPC failure. */ }
}
async function edge(action: string, body: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.');
  const { data, error } = await supabase.functions.invoke('hr-api', { body: { action, ...body } });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) { try { const detail = await response.json(); throw new Error(detail.error || detail.message || error.message); } catch (e) { fail(e); } }
    fail(error);
  }
  if (data?.error) throw new Error(data.error); return data;
}
const cutTime = (v: string | null | undefined) => v?.slice(0, 5) ?? '';
function mapEmployee(r: any, roles: any[]): Employee {
  return { id: r.id, employeeNumber: r.employee_number, fullName: r.full_name, phone: r.whatsapp ?? '', departmentId: r.department_id ?? '', positionId: r.position_id ?? '', outletId: r.outlet_id ?? '', managerId: r.approver_employee_id, joinDate: r.starts_on ?? '', status: r.status ?? 'active', employmentType: 'permanent', accountStatus: ({ uninvited: 'not_invited', pending: 'invited', active: 'active', disabled: 'disabled' } as const)[r.account_status as 'uninvited'] ?? 'not_invited', authUserId: r.auth_user_id, roles: roles.filter(x => x.employee_id === r.id).map(x => x.role), canMiddleShift: r.can_middle_shift ?? false, weeklyOffDays: r.weekly_off_days ?? [], approvalMode: r.approval_mode ?? 'internal', address: r.address ?? '', birthDate: r.birthday ?? '', gender: r.gender === 'unspecified' ? '' : r.gender ?? '', emergencyName: r.emergency_name ?? '', emergencyPhone: r.emergency_phone ?? '', photoUrl: r.photo_path, exitDate: r.ends_on ?? '', exitReason: r.exit_reason ?? '' };
}
async function refresh() {
  if (!supabase) return;
  if (refreshPromise) { refreshRequested = true; return refreshPromise; }
  refreshPromise = (async () => { do { refreshRequested = false; await refreshNow(); } while (refreshRequested); })();
  try { await refreshPromise; } finally { refreshPromise = null; }
}
function clearLiveState(error: string | null = null) {
  app.set({ ...initialDemo(), mode: 'live', initialized: true, loading: false, user: null, employees: [], departments: [], positions: [], outlets: [], leaveRequests: [], attendanceRecords: [], auditEntries: [], leaveLedger: [], cashierAssignments: [], attendanceCorrectionRequests: [], notifications: [], balanceCache: {}, connected: navigator.onLine, error });
  if (timer) clearTimeout(timer);
  timer = undefined;
  clearRealtimeRetry(true);
  const previousChannel = channel;
  channel = null;
  realtimeUserId = null;
  realtimeGeneration += 1;
  realtimeReplacementPending = false;
  realtimeTerminal = false;
  realtimeSubscribed = false;
  if (previousChannel && supabase) void supabase.removeChannel(previousChannel);
}
function clearRealtimeRetry(resetAttempt = false) {
  if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
  realtimeRetryTimer = undefined;
  if (resetAttempt) realtimeRetryAttempt = 0;
}
function scheduleRealtimeReplacement(target: NonNullable<typeof channel>, generation: number, userId: string, revision: number) {
  if (realtimeRetryTimer || !navigator.onLine) return;
  const delays = [1000, 2000, 5000, 10000];
  const delay = delays[Math.min(realtimeRetryAttempt, delays.length - 1)];
  realtimeRetryAttempt += 1;
  realtimeRetryTimer = setTimeout(() => {
    realtimeRetryTimer = undefined;
    if (channel !== target || realtimeGeneration !== generation || !navigator.onLine || revision !== authRevision || !supabase) return;
    channel = null;
    realtimeSubscribed = false;
    realtimeGeneration += 1;
    realtimeReplacementPending = true;
    app.update(state => ({ ...state, connected: false }));
    void Promise.resolve(supabase.removeChannel(target)).catch(() => undefined).finally(() => {
      realtimeReplacementPending = false;
      if (revision !== authRevision || !navigator.onLine || channel || !supabase) return;
      createRealtimeChannel(userId, revision);
      void refresh();
    });
  }, delay);
}
function createRealtimeChannel(userId: string, revision: number) {
  if (!supabase || revision !== authRevision || realtimeReplacementPending) return;
  if (channel && realtimeUserId === userId) return;
  if (channel) {
    const previous = channel;
    channel = null;
    realtimeUserId = null;
    realtimeGeneration += 1;
    realtimeSubscribed = false;
    void supabase.removeChannel(previous).catch(() => undefined);
  }
  const target = supabase.channel(`hr-${userId}`), generation = ++realtimeGeneration;
  channel = target;
  realtimeUserId = userId;
  realtimeTerminal = false;
  try {
    for (const table of ['employees', 'attendance', 'leave_requests', 'leave_adjustments', 'leave_ledger', 'outlets', 'departments', 'positions', 'employee_roles', 'notifications', 'cashier_assignments', 'attendance_correction_requests', 'staffing_requirements', 'spv_followups']) {
      target.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (channel !== target || realtimeGeneration !== generation || authRevision !== revision) return;
        clearTimeout(timer);
        timer = setTimeout(() => { if (channel === target && realtimeGeneration === generation && authRevision === revision) void refresh(); }, 300);
      });
    }
    target.subscribe(status => {
      if (channel !== target || realtimeGeneration !== generation || authRevision !== revision) return;
      realtimeSubscribed = status === 'SUBSCRIBED';
      app.update(state => ({ ...state, connected: navigator.onLine && realtimeSubscribed }));
      if (realtimeSubscribed) { realtimeTerminal = false; clearRealtimeRetry(true); void refresh(); }
      else if (status === 'CLOSED' || status === 'TIMED_OUT') { realtimeTerminal = true; scheduleRealtimeReplacement(target, generation, userId, revision); }
      // The SDK owns CHANNEL_ERROR reconnects. Only terminal/timeout states
      // replace this channel instance; a closed instance is never joined again.
    });
  } catch {
    realtimeSubscribed = false;
    realtimeTerminal = true;
    app.update(state => ({ ...state, connected: false }));
    scheduleRealtimeReplacement(target, generation, userId, revision);
  }
}
function resumeLiveConnection() {
  if (!supabase || !navigator.onLine) return;
  // The SDK reconnects transport errors on a live channel. A terminal channel
  // is replaced by its generation-guarded timer; resume always refreshes data.
  if (channel && realtimeTerminal && realtimeUserId) scheduleRealtimeReplacement(channel, realtimeGeneration, realtimeUserId, authRevision);
  void refresh();
}
async function readAll(table: string, fields = '*'): Promise<any[]> {
  if (!supabase) return [];
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from(table).select(fields).order(table === 'employee_roles' ? 'employee_id' : 'id');
    if (table === 'employee_roles') query = query.order('role');
    const { data, error } = await query.range(offset, offset + 999);
    if (error) fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
async function refreshNow() {
  if (!supabase || refreshing) return; refreshing = true;
  let revision = authRevision;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (revision !== authRevision) return;
    const nextAuthUserId = session?.user.id ?? null;
    if (nextAuthUserId !== liveAuthUserId) {
      liveAuthUserId = nextAuthUserId;
      authRevision += 1;
      revision = authRevision;
      clearLiveState();
    }
    if (!session) { if (revision === authRevision) clearLiveState(); return; }
    const tables = ['employees', 'employee_roles', 'departments', 'positions', 'outlets', 'leave_requests', 'leave_adjustments', 'attendance', 'leave_ledger', 'notifications', 'cashier_assignments', 'attendance_correction_requests'];
    const [employeeRows, roleRows, departmentRows, positionRows, outletRows, leaveRows, adjustmentRows, attendanceRows, ledgerRows, notificationRows, assignmentRows, correctionRows] = await Promise.all(tables.map(name => readAll(name)));
    const employees = employeeRows.map(r => mapEmployee(r, roleRows));
    const current = employees.find(e => e.authUserId === session.user.id);
    if (!current || current.status !== 'active') {
      // Background validation denies access without mutating the shared Auth
      // session: an awaited signOut for A could otherwise clear a newer login B.
      if (revision === authRevision) clearLiveState('Akses akun tidak aktif. Hubungi Admin HR.');
      return;
    }
    const [staffingRows, followupRows] = isAdmin(current)
      ? await Promise.all([readAll('staffing_requirements'), readAll('spv_followups')])
      : [[], []];
    const directory = await rpc('employee_directory', {});
    for (const d of directory ?? []) if (!employees.some(e => e.id === d.id)) employees.push(mapEmployee(d, []));
    const attendanceRecords: AttendanceRecord[] = await Promise.all(attendanceRows.map(async r => {
      const signed = r.selfie_path ? await supabase!.storage.from('attendance-selfies').createSignedUrl(r.selfie_path, 300) : null;
      return { id: r.id, employeeId: r.employee_id, outletId: r.outlet_id, shift: r.shift, workDate: r.work_date, clockIn: r.clock_in, clockOut: r.clock_out, scheduledStart: r.expected_in, lateMinutes: r.late_minutes, durationMinutes: r.worked_minutes, inLatitude: r.in_latitude, inLongitude: r.in_longitude, inAccuracy: r.in_accuracy_m, inDistance: r.in_distance_m, outLatitude: r.out_latitude, outLongitude: r.out_longitude, outDistance: r.out_distance_m, outAccuracy: r.out_accuracy_m, selfiePath: r.selfie_path ?? '', selfieUrl: signed?.data?.signedUrl, selfieCapturedAt: r.selfie_captured_at ?? undefined, selfieOutletName: r.selfie_outlet_name ?? undefined, corrected: r.corrected, correctionReason: '', source: r.source === 'manual' ? 'manual' : 'device', assignmentId: r.assignment_id ?? null, outletSnapshot: { morningStart: cutTime(r.morning_starts_at), afternoonStart: cutTime(r.afternoon_starts_at), lateToleranceMinutes: r.tolerance_minutes, latitude: r.outlet_latitude, longitude: r.outlet_longitude, radiusMeters: r.radius_m } };
    }));
    let auditEntries: AppState['auditEntries'] = [];
    if (isAdmin(current)) {
      const data = await readAll('audit_events', 'id,entity,actor_employee_id,entity_id,action,reason,before_data,after_data,created_at');
      auditEntries = data.map(r => ({ id: r.id, actorId: r.actor_employee_id, entityId: r.entity_id, action: r.action, at: r.created_at, detail: r.entity === 'leave' ? leaveAuditDetail(r.reason,r.before_data,r.after_data) : r.reason ?? '' })).sort((a,b) => b.at.localeCompare(a.at));
      for (const record of attendanceRecords) record.correctionReason = auditEntries.find(entry => entry.entityId === record.id && entry.detail)?.detail ?? '';
    }
    const balanceCache: Record<string, number> = {};
    const year = Number(jakartaDate().slice(0,4));
    const balanceYears = new Set<number>([year, year + 1]);
    for (const row of [...leaveRows, ...adjustmentRows]) for (const date of [row.starts_on, row.ends_on]) if (date) balanceYears.add(Number(date.slice(0,4)));
    const balanceIds = isAdmin(current) ? employeeRows.map(e => e.id) : [...new Set([current.id,...leaveRows.map(r => r.employee_id)])];
    await Promise.all(balanceIds.flatMap(employeeId => [...balanceYears].map(async balanceYear => { const balance = await rpc('leave_balance', { p_employee_id: employeeId, p_year: balanceYear }); balanceCache[`${employeeId}:${balanceYear}`] = balance.expired ? 0 : Number(balance.remaining); })));
    for (const employee of employees.filter(e => e.photoUrl)) { const signed = await supabase.storage.from('profile-photos').createSignedUrl(employee.photoUrl!,300); employee.photoUrl = signed.data?.signedUrl; }
    const leaveRequests: LeaveRequest[] = await Promise.all(leaveRows.map(async r => {
      const history = adjustmentRows.filter(a => a.leave_request_id === r.id).sort((a,b) => b.created_at.localeCompare(a.created_at));
      const adjustment = history.find(a => a.status === 'pending') ?? history[0];
      const attachment = r.attachment_path ? await supabase!.storage.from('leave-attachments').createSignedUrl(r.attachment_path,300) : null;
      return { id: r.id, employeeId: r.employee_id, type: r.kind, extent: r.extent, attachmentUrl: attachment?.data?.signedUrl, attachmentName: r.attachment_path ? 'Lampiran pengajuan' : undefined, attachmentPath: r.attachment_path ?? undefined, startDate: r.starts_on, endDate: r.ends_on, startTime: cutTime(r.starts_at), endTime: cutTime(r.ends_at), reason: r.reason, status: r.status, deductionDays: Object.values(r.deductions ?? {}).reduce((a: number, b) => a + Number(b), 0), approverId: r.decision_by ?? employees.find(e => e.id === r.employee_id)?.managerId ?? null, note: r.decision_note ?? '', externalApproverName: r.external_decider ?? '', createdAt: r.created_at, adjustment: adjustment ? { id: adjustment.id, type: adjustment.type, startDate: adjustment.starts_on, endDate: adjustment.ends_on, reason: adjustment.reason, status: adjustment.status, requestedAt: adjustment.created_at, note: adjustment.decision_note ?? '', decidedAt: adjustment.decided_at ?? undefined, deciderName: adjustment.external_decider || employees.find(e => e.id === adjustment.decision_by)?.fullName } : null };
    }));
    const cashierAssignments = assignmentRows.map(r => ({ id: r.id, employeeId: r.employee_id, workDate: r.work_date, outletId: r.outlet_id, shift: r.shift,
      status: r.status, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }));
    const attendanceCorrectionRequests = correctionRows.map(r => ({ id: r.id, employeeId: r.employee_id, attendanceId: r.attendance_id, workDate: r.work_date,
      outletId: r.outlet_id, shift: r.shift, proposedClockIn: r.proposed_clock_in, proposedClockOut: r.proposed_clock_out, reason: r.reason,
      status: r.status, decisionNote: r.decision_note ?? '', decisionBy: r.decision_by, createdAt: r.created_at, decidedAt: r.decided_at,
      originalSnapshot: r.original_snapshot ? { clockIn: r.original_snapshot.clock_in, clockOut: r.original_snapshot.clock_out,
        shift: r.original_snapshot.shift, outletId: r.original_snapshot.outlet_id } : null }));
    const notifications = notificationRows.map(r => ({ id: r.id, employeeId: r.employee_id, title: r.title, body: r.body, href: r.href, entityId: r.entity_id, entityType: r.entity_type ?? 'leave', createdAt: r.created_at, readAt: r.read_at }));
    const staffingRequirements: StaffingRequirement[] = staffingRows.map(r => ({ id: r.id, outletId: r.outlet_id, weekday: r.weekday, shift: r.shift,
      minimum: r.minimum, effectiveFrom: r.effective_from, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }));
    const spvFollowups: SpvFollowup[] = followupRows.map(r => ({ id: r.id, caseKey: r.case_key, issueType: r.issue_type, sourceType: r.source_type,
      sourceId: r.source_id, workDate: r.work_date, outletId: r.outlet_id, employeeId: r.employee_id, shift: r.shift, ownerId: r.owner_id,
      status: r.status, note: r.note ?? '', resolutionNote: r.resolution_note ?? '', createdBy: r.created_by, updatedBy: r.updated_by,
      createdAt: r.created_at, updatedAt: r.updated_at, reopenedCount: r.reopened_count ?? 0 }));
    const { data: { session: latestSession } } = await supabase.auth.getSession();
    if (revision !== authRevision || latestSession?.user.id !== session.user.id) return;
    app.set({ mode: 'live', initialized: true, loading: false, user: current, connected: navigator.onLine && realtimeSubscribed, error: null, balanceCache, notifications, cashierAssignments, attendanceCorrectionRequests, staffingRequirements, spvFollowups, employees, departments: departmentRows.map(r => ({ id: r.id, name: r.name, code: r.code ?? '', active: r.active })), positions: positionRows.map(r => ({ id: r.id, name: r.name, departmentId: r.department_id, active: r.active, isCashier: r.is_cashier })), outlets: outletRows.map(r => ({ id: r.id, code: r.code, name: r.name, address: r.address, active: r.active, isProduction: r.production_location, latitude: r.latitude, longitude: r.longitude, radiusMeters: r.radius_m, opensAt: cutTime(r.opens_at), closesAt: cutTime(r.closes_at), morningStart: cutTime(r.morning_starts_at), afternoonStart: cutTime(r.afternoon_starts_at), lateToleranceMinutes: r.late_tolerance_minutes, maxAccuracyMeters: r.max_accuracy_m ?? 100 })), attendanceRecords, auditEntries, leaveLedger: ledgerRows.map(r => ({ id: r.id, employeeId: r.employee_id, year: r.year, days: -Number(r.amount), requestId: r.leave_request_id })), leaveRequests });
    createRealtimeChannel(session.user.id, revision);
  } catch (e) { if (revision === authRevision) app.update(s => ({ ...s, initialized: true, loading: false, error: e instanceof Error ? e.message : 'Data belum berhasil dimuat.' })); }
  finally { refreshing = false; }
}
function validateGeo(input: ClockOutInput, outlet: Outlet): number {
  if (!navigator.onLine) throw new Error('Absensi membutuhkan koneksi internet.');
  if (outlet.latitude === null || outlet.longitude === null) throw new Error('Lokasi outlet belum diatur. Hubungi Admin HR.');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180 || !Number.isFinite(input.accuracy) || input.accuracy <= 0 || input.accuracy > (outlet.maxAccuracyMeters ?? 100)) throw new Error('Akurasi lokasi belum cukup. Aktifkan lokasi presisi dan coba kembali.');
  const distance = haversineMeters(input.latitude, input.longitude, outlet.latitude, outlet.longitude);
  if (distance > outlet.radiusMeters) throw new Error(`Anda berjarak ${Math.round(distance)} m dari outlet. Radius yang diizinkan ${outlet.radiusMeters} m.`);
  return distance;
}
function validateLeavePeriod(input: Pick<LeaveInput, 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'extent'>) {
  dateRange(input.startDate, input.endDate);
  const extent = input.extent ?? (input.startTime ? 'temporary_exit' : 'full_day');
  if (extent !== 'full_day' && (input.startDate !== input.endDate || (!input.startTime && !input.endTime))) throw new Error('Izin sebagian hari memerlukan satu tanggal dan jam izin.');
  if (extent === 'temporary_exit' && (!input.startTime || !input.endTime)) throw new Error('Izin keluar sementara memerlukan jam keluar dan kembali.');
  for (const time of [input.startTime, input.endTime]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Jam izin tidak valid.');
  if (input.startTime && input.endTime && input.endTime <= input.startTime) throw new Error('Jam selesai harus setelah jam mulai.');
  return extent;
}
function applyLeaveAllocation(state: AppState, request: LeaveRequest, allocation: Record<number, number>) {
  const currentYear = Number(jakartaDate().slice(0,4)), old: Record<number, number> = {};
  for (const entry of state.leaveLedger.filter(e => e.requestId === request.id)) old[entry.year] = (old[entry.year] ?? 0) + entry.days;
  const employee = state.employees.find(e => e.id === request.employeeId)!;
  for (const year of new Set([...Object.keys(old), ...Object.keys(allocation)].map(Number))) {
    const amount = allocation[year] ?? 0, delta = Math.round((amount - (old[year] ?? 0)) * 100) / 100;
    const used = state.leaveLedger.filter(e => e.employeeId === employee.id && e.year === year).reduce((sum,e) => sum + e.days, 0);
    if (amount < 0 || amount > 12 || !Number.isFinite(amount)) throw new Error('Potongan cuti tidak valid.');
    if (delta > 0 && (year < currentYear || delta > Math.round((leaveEntitlement(employee.joinDate, year) - used) * 100) / 100)) throw new Error(`Saldo cuti tahun ${year} tidak cukup atau sudah kedaluwarsa.`);
    if (delta) state.leaveLedger.push({ id: id(), employeeId: employee.id, requestId: request.id, year, days: delta });
  }
}
function updateCharge(state: AppState, request: LeaveRequest, start: string, end: string, days: number) {
  applyLeaveAllocation(state, request, deductionByYear(start, end, days));
}
export const actions = {
  async init() {
    if (initPromise) return initPromise;
    if (get(app).initialized) return;
    initPromise = (async () => {
      if (configured) {
        app.set({ ...initialDemo(), mode: 'live', employees: [], departments: [], positions: [], outlets: [], leaveRequests: [], cashierAssignments: [], attendanceCorrectionRequests: [], notifications: [], loading: true });
        // Auth identity changes must invalidate an in-flight startup read too.
        // Register once, before getSession() or any user-scoped table fetch.
        supabase!.auth.onAuthStateChange((_event, session) => {
          const nextAuthUserId = session?.user.id ?? null;
          if (nextAuthUserId !== liveAuthUserId) { liveAuthUserId = nextAuthUserId; authRevision += 1; clearLiveState(); }
          setTimeout(() => void refresh(), 0);
        });
        await refresh();
        window.setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) resumeLiveConnection(); }, 60000);
      } else {
        try { const saved = localStorage.getItem(KEY); if (saved) { const parsed = JSON.parse(saved); if (parsed.mode === 'demo' && Array.isArray(parsed.employees) && Array.isArray(parsed.leaveLedger)) app.set(parsed); } } catch { /* damaged demo data resets safely */ }
        app.update(s => ({ ...s, initialized: true, connected: navigator.onLine }));
      }
      window.addEventListener('online', () => { app.update(s => ({ ...s, connected: !configured || !get(app).user })); resumeLiveConnection(); });
      window.addEventListener('offline', () => { clearRealtimeRetry(); app.update(s => ({ ...s, connected: false })); });
      window.addEventListener('focus', resumeLiveConnection);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeLiveConnection(); });
    })();
    try { await initPromise; } finally { initPromise = null; }
  },
  refresh,
  async readNotification(notificationId?: string) {
    const actor = user();
    if (configured) { await rpc('notifications_mark_read', { p_id: notificationId ?? null }); await refresh(); return; }
    commit(s => { for (const n of s.notifications ?? []) if (n.employeeId === actor.id && (!notificationId || n.id === notificationId) && !n.readAt) n.readAt = new Date().toISOString(); });
  },
  async login(employeeNumber: string, password: string) {
    if (configured) { const data = await edge('login', { employee_number: employeeNumber, password }); const { error } = await supabase!.auth.setSession(data.session); if (error) fail(error); await refresh(); if (!get(app).user) throw new Error(get(app).error ?? 'Akun belum dapat dimuat.'); }
    else { const employee = get(app).employees.find(e => e.employeeNumber === employeeNumber.trim().toUpperCase() && e.status === 'active' && e.accountStatus === 'active'); if (!employee) throw new Error('Nomor karyawan atau kata sandi tidak sesuai.'); const passwords = JSON.parse(localStorage.getItem('rk-demo-passwords') ?? '{}'), stored = passwords[employee.id]; const valid = stored ? await demoPasswordHash(password,stored.salt) === stored.hash : password === 'DemoRajaklana123!'; if(!valid) throw new Error('Nomor karyawan atau kata sandi tidak sesuai. Kata sandi akun contoh: DemoRajaklana123!'); commit(s => { s.user = employee; }); }
  },
  async logout() { if (supabase) { try { await disableDevicePush(); } catch { /* Session logout must remain available if the push service is unavailable. */ } const { error } = await supabase.auth.signOut(); if (error) fail(error); } authRevision += 1; liveAuthUserId = null; if (supabase) clearLiveState(); else { clearRealtimeRetry(true); channel = null; realtimeUserId = null; realtimeGeneration += 1; realtimeReplacementPending = false; realtimeTerminal = false; realtimeSubscribed = false; commit(s => { s.user = null; }); } },
  async bootstrap(input: { fullName: string; phone: string; outletName: string; secret: string; password: string }) { if(!configured)throw new Error('Hubungkan proyek Supabase terlebih dahulu.'); return edge('bootstrap',{full_name:input.fullName,whatsapp:input.phone,outlet_name:input.outletName,bootstrap_secret:input.secret,password:input.password}); },
  async switchDemoUser(employeeId: string) { if (configured) throw new Error('Pergantian akun contoh hanya tersedia dalam demo.'); const employee = get(app).employees.find(e => e.id === employeeId && activeAccount(e)); if (!employee) throw new Error('Akun contoh tidak ditemukan atau tidak aktif.'); commit(s => { s.user = employee; }); },
  async saveEmployee(input: Partial<Employee>) {
    requireAdmin(); const s = get(app), before = s.employees.find(e => e.id === input.id);
    if (!input.fullName?.trim() || !input.phone?.trim() || !input.joinDate || !input.departmentId || !input.positionId || !input.outletId) throw new Error('Lengkapi nama, WhatsApp, tanggal masuk, departemen, jabatan, dan outlet.');
    if (!s.positions.some(p => p.id === input.positionId && p.departmentId === input.departmentId)) throw new Error('Jabatan tidak sesuai departemen.');
    if (input.managerId === input.id && input.id) throw new Error('Karyawan tidak dapat menjadi atasannya sendiri.');
    let cursor = input.managerId; const seen = new Set<string>();
    while (cursor) { if (cursor === input.id || seen.has(cursor)) throw new Error('Hubungan atasan tidak boleh membentuk lingkaran.'); seen.add(cursor); cursor = s.employees.find(e => e.id === cursor)?.managerId; }
    if (input.status === 'inactive' && (s.employees.some(e => e.managerId === input.id && e.status === 'active') || input.id === user().id)) throw new Error('Alihkan anggota tim terlebih dahulu. Anda tidak dapat menonaktifkan akun sendiri.');
    if (input.status === 'inactive' && (!input.exitDate || !input.exitReason?.trim())) throw new Error('Tanggal dan alasan keluar wajib diisi.');
    if (input.id === user().id && JSON.stringify([...(input.roles ?? [])].sort()) !== JSON.stringify([...user().roles].sort())) throw new Error('Perubahan hak akses sendiri harus dilakukan admin lain.');
    if (configured) {
      const row = { full_name: input.fullName.trim(), whatsapp: input.phone, department_id: input.departmentId, position_id: input.positionId, outlet_id: input.outletId, approver_employee_id: input.managerId || null, starts_on: input.joinDate, approval_mode: input.approvalMode, status: input.status, can_middle_shift: input.canMiddleShift, can_clock: s.positions.find(p => p.id === input.positionId)?.isCashier ?? false, weekly_off_days: input.weeklyOffDays ?? [], birthday: input.birthDate || null, gender: input.gender || 'unspecified', address: input.address ?? '', emergency_name: input.emergencyName ?? '', emergency_phone: input.emergencyPhone ?? '', ends_on: input.exitDate || null, exit_reason: input.exitReason || null };
      const roles = [...new Set(['employee', ...(input.roles ?? [])])];
      await rpc('hr_save_employee_with_roles', { p_id: input.id ?? null, p_employee: row, p_roles: roles,
        p_reason: input.exitReason || 'Pembaruan data karyawan' });
      await refresh(); return;
    }
    const employeeId = input.id ?? id();
    const establishedDemoAccounts: Record<string, boolean> = JSON.parse(localStorage.getItem('rk-demo-established-accounts') ?? '{}');
    const reactivatingDemoAccount = before?.status === 'inactive' && input.status === 'active'
      && (establishedDemoAccounts[employeeId] === true || !!before.authUserId);
    // Persist established identity first so a reload after deactivation can still
    // recover seeded accounts without changing their Auth/draft namespace.
    if (input.status === 'inactive' && (before?.accountStatus === 'active' || before?.authUserId)) {
      establishedDemoAccounts[employeeId] = true;
      localStorage.setItem('rk-demo-established-accounts', JSON.stringify(establishedDemoAccounts));
    }
    commit(state => {
      const previousFollowups = structuredClone(state.spvFollowups ?? []);
      const employee: Employee = { ...initialDemo().employees[0], ...input, id: employeeId, roles: [...new Set<Role>(['employee', ...(input.roles ?? [])])], employeeNumber: before?.employeeNumber ?? `RK${String(Math.max(0, ...state.employees.map(e => Number(e.employeeNumber.slice(2)))) + 1).padStart(6, '0')}`, accountStatus: input.status === 'inactive' ? 'disabled' : reactivatingDemoAccount ? 'active' : before?.accountStatus ?? 'not_invited' };
      const index = state.employees.findIndex(e => e.id === employeeId); if (index < 0) state.employees.push(employee); else state.employees[index] = employee;
      syncUnassignedRosterFollowups(state, employeeId, null, state.user?.id ?? '');
      auditDemoFollowupContextChanges(state, previousFollowups, state.user?.id ?? '');
    }, 'employee_saved', employeeId, 'Perubahan data karyawan');
    if (input.status === 'inactive') {
      const links = JSON.parse(localStorage.getItem('rk-demo-links') ?? '{}');
      for (const token of Object.keys(links)) if (links[token]?.employeeId === employeeId) delete links[token];
      localStorage.setItem('rk-demo-links', JSON.stringify(links));
    }
  },
  async saveDepartment(input: Partial<Department>) {
    requireAdmin(); if (!input.name?.trim()) throw new Error('Nama departemen wajib diisi.');
    if (configured) { const body = { name: input.name.trim(), active: input.active ?? true }; const result = input.id ? await supabase!.from('departments').update(body).eq('id', input.id) : await supabase!.from('departments').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { id: input.id ?? id(), code: input.code ?? '', name: input.name!.trim(), active: input.active ?? true }; const i = s.departments.findIndex(x => x.id === row.id); if (i < 0) s.departments.push(row); else s.departments[i] = row; }, 'department_saved', input.id);
  },
  async savePosition(input: Partial<Position>) {
    requireAdmin(); if (!input.name?.trim() || !input.departmentId) throw new Error('Nama jabatan dan departemen wajib diisi.');
    if (configured) { const body = { name: input.name.trim(), department_id: input.departmentId, active: input.active ?? true, is_cashier: input.isCashier ?? false }; const result = input.id ? await supabase!.from('positions').update(body).eq('id', input.id) : await supabase!.from('positions').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { id: input.id ?? id(), name: input.name!.trim(), departmentId: input.departmentId!, active: input.active ?? true, isCashier: input.isCashier ?? false }; const i = s.positions.findIndex(x => x.id === row.id); if (i < 0) s.positions.push(row); else s.positions[i] = row; }, 'position_saved', input.id);
  },
  async saveOutlet(input: Partial<Outlet>) {
    requireAdmin(); if (!input.name?.trim() || !input.opensAt || !input.closesAt) throw new Error('Lengkapi nama dan jam operasional outlet.');
    if ((input.radiusMeters ?? 0) < 10 || (input.radiusMeters ?? 0) > 2000) throw new Error('Radius absensi harus antara 10 dan 2.000 meter.');
    if (input.latitude !== null && (!Number.isFinite(input.latitude) || Math.abs(input.latitude!) > 90)) throw new Error('Latitude tidak valid.');
    if (input.longitude !== null && (!Number.isFinite(input.longitude) || Math.abs(input.longitude!) > 180)) throw new Error('Longitude tidak valid.');
    if (configured) { const body = { code: input.code || `OT${Date.now().toString().slice(-7)}`, name: input.name, address: input.address ?? '', latitude: input.latitude, longitude: input.longitude, radius_m: input.radiusMeters, opens_at: input.opensAt, closes_at: input.closesAt, morning_starts_at: input.morningStart, afternoon_starts_at: input.afternoonStart, late_tolerance_minutes: input.lateToleranceMinutes, production_location: input.isProduction, active: input.active ?? true }; const result = input.id ? await supabase!.from('outlets').update(body).eq('id', input.id) : await supabase!.from('outlets').insert(body); if (result.error) fail(result.error); await refresh(); return; }
    commit(s => { const row = { ...input, id: input.id ?? id(), code: input.code || `OT${String(s.outlets.length + 1).padStart(3,'0')}` } as Outlet; const i = s.outlets.findIndex(x => x.id === row.id); if (i < 0) s.outlets.push(row); else s.outlets[i] = row; }, 'outlet_saved', input.id);
  },
  async updateProfile(input: Partial<Employee> & { photoFile?: File }) {
    const u = user(), allowed = { address: input.address ?? '', emergencyName: input.emergencyName ?? '', emergencyPhone: input.emergencyPhone ?? '' };
    if(input.photoFile && (input.photoFile.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(input.photoFile.type))) throw new Error('Foto profil harus JPG, PNG, atau WebP maksimal 5 MB.');
    if (configured) {
      let path: string | undefined;
      if(input.photoFile) { const { data: { session } } = await supabase!.auth.getSession(); path=`${session!.user.id}/${id()}.${input.photoFile.type==='image/png'?'png':input.photoFile.type==='image/webp'?'webp':'jpg'}`; const uploaded=await supabase!.storage.from('profile-photos').upload(path,input.photoFile); if(uploaded.error)fail(uploaded.error); }
      try { await rpc('update_my_profile', { p_profile: { address: allowed.address, emergency_name: allowed.emergencyName, emergency_phone: allowed.emergencyPhone, ...(path?{photo_path:path}:{}) } }); } catch(e){if(path)await supabase!.storage.from('profile-photos').remove([path]);throw e;}
      await refresh(); return;
    }
    commit(s => { Object.assign(s.employees.find(e => e.id === u.id)!, allowed, input.photoFile ? {photoUrl:URL.createObjectURL(input.photoFile)} : {}); }, 'profile_updated', u.id);
  },
  async issueLink(employeeId: string, purpose: 'activate' | 'reset') {
    requireAdmin(); if (configured) { const result = await edge(purpose === 'activate' ? 'issue_activation' : 'issue_reset', { employee_id: employeeId }); await refresh(); return { url: result.url, message: result.message, expiresAt: result.expires_at }; }
    const employee = get(app).employees.find(e => e.id === employeeId); if (!employee) throw new Error('Karyawan tidak ditemukan.');
    if (employee.status !== 'active') throw new Error('Akun karyawan tidak aktif. Hubungi HR.');
    const token = id() + id(), expiresAt = new Date(Date.now() + 86400000).toISOString();
    const links = JSON.parse(localStorage.getItem('rk-demo-links') ?? '{}');
    for (const key of Object.keys(links)) if (links[key].employeeId === employeeId && links[key].purpose === purpose) delete links[key];
    links[token] = { employeeId, purpose, expiresAt }; localStorage.setItem('rk-demo-links', JSON.stringify(links));
    const url = `${location.origin}/activate#token=${token}`;
    commit(s => { const e = s.employees.find(e => e.id === employeeId)!; if (purpose === 'activate') e.accountStatus = 'invited'; }, 'link_issued', employeeId, purpose);
    return { url, expiresAt, message: `Halo ${employee.fullName}, ${purpose === 'activate' ? 'aktifkan akun' : 'buat kata sandi baru untuk akun'} HR Rajaklana Anda (${employee.employeeNumber}) melalui ${url}. Berlaku 24 jam. Tautan ini khusus untuk Anda. [DEMO: hanya bekerja pada browser yang sama]` };
  },
  async inspectToken(token: string) {
    if (configured) return edge('inspect_token', { token });
    const { link, employee } = readDemoToken(token);
    return { purpose: link.purpose, employee_number: employee.employeeNumber, full_name: employee.fullName, expires_at: link.expiresAt };
  },
  async activate(token: string, password: string, purpose = 'activate') {
    if (password.length < 10 || password.length > 128) throw new Error('Kata sandi harus 10–128 karakter.');
    if (configured) return edge(purpose === 'reset' ? 'reset_password' : 'activate', { token, password });
    const inspected = readDemoToken(token);
    if (inspected.link.purpose !== purpose) throw new Error('Jenis tautan tidak sesuai.');
    const salt = id(), hash = await demoPasswordHash(password, salt);
    // Hashing yields control: recheck that the employee and token still permit activation.
    const { links, link } = readDemoToken(token);
    if (link.purpose !== purpose || link.employeeId !== inspected.employee.id) throw new Error('Jenis tautan tidak sesuai.');
    const passwords=JSON.parse(localStorage.getItem('rk-demo-passwords')??'{}');passwords[link.employeeId]={salt,hash};localStorage.setItem('rk-demo-passwords',JSON.stringify(passwords));
    commit(s => { s.employees.find(e => e.id === link.employeeId)!.accountStatus = 'active'; }, 'account_activated', link.employeeId); delete links[token]; localStorage.setItem('rk-demo-links', JSON.stringify(links));
    return { ok: true, employee_number: get(app).employees.find(e => e.id === link.employeeId)!.employeeNumber };
  },
  async submitLeave(input: LeaveInput) {
    const u = user(), extent = validateLeavePeriod(input); if (input.reason.trim().length < 3) throw new Error('Alasan pengajuan minimal 3 karakter.');
    if (isDuplicateLeave({ ...input, extent })) throw new Error('Pengajuan yang sama sudah ada. Buka pengajuan tersebut untuk memperbaruinya.');
    if (input.startDate < jakartaDate()) throw new Error('Tanggal pengajuan tidak boleh sebelum hari ini. Untuk koreksi, hubungi HR.');
    if (input.type === 'annual' && !leaveEntitlement(u.joinDate, Number(input.startDate.slice(0,4)))) throw new Error('Hak cuti tahunan belum tersedia setelah masa kerja 3 bulan.');
    if (!u.managerId && u.approvalMode !== 'external') throw new Error('Atasan belum ditetapkan. Hubungi HR.');
    if (configured) {
      let path: string | null = null;
      if (input.attachment) { if (input.attachment.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(input.attachment.type)) throw new Error('Lampiran harus foto/PDF maksimal 5 MB.'); const { data: { session } } = await supabase!.auth.getSession(); path = `${session!.user.id}/${id()}.${input.attachment.type === 'application/pdf' ? 'pdf' : 'jpg'}`; const result = await supabase!.storage.from('leave-attachments').upload(path, input.attachment); if (result.error) fail(result.error); }
      try { await rpc('leave_submit', { p_kind: input.type, p_starts_on: input.startDate, p_ends_on: input.endDate, p_reason: input.reason, p_extent: extent, p_starts_at: input.startTime || null, p_ends_at: input.endTime || null, p_attachment_path: path }); }
      catch(e) { await cleanupRejectedLeaveUpload(path,e); throw e; } await refresh(); return;
    }
    const requestId = id(); commit(s => { s.leaveRequests.unshift({ id: requestId, employeeId: u.id, type: input.type, extent, attachmentUrl: input.attachment ? URL.createObjectURL(input.attachment) : undefined, attachmentName: input.attachment?.name, startDate: input.startDate, endDate: input.endDate, startTime: input.startTime ?? '', endTime: input.endTime ?? '', reason: input.reason, status: 'pending', deductionDays: 0, approverId: u.managerId, note: '', externalApproverName: '', createdAt: new Date().toISOString(), adjustment: null }); }, 'leave_submitted', requestId);
  },
  async decideLeave(requestId: string, decision: LeaveDecision) {
    const request = get(app).leaveRequests.find(r => r.id === requestId); if (!request || !canDecideLeave(request)) throw new Error('Anda bukan pemberi keputusan untuk pengajuan ini.');
    if (!['pending', 'needs_info'].includes(request.status)) throw new Error('Pengajuan sudah diproses.');
    const employee = get(app).employees.find(e => e.id === request.employeeId)!;
    if (employee.approvalMode === 'external' && (decision.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal minimal 3 karakter.');
    if (decision.decision !== 'approve' && (decision.note?.trim().length ?? 0) < 3) throw new Error('Catatan keputusan minimal 3 karakter.');
    if (configured) { await rpc('leave_decide', { p_id: requestId, p_decision: ({ approve: 'approved', reject: 'rejected', needs_info: 'needs_info' })[decision.decision], p_deductions: decision.decision === 'approve' ? deductionByYear(request.startDate, request.endDate, decision.deductionDays) : {}, p_note: decision.note || null, p_external_decider: decision.externalApproverName || null }); await refresh(); return; }
    commit(s => { const r = s.leaveRequests.find(x => x.id === requestId)!; if (decision.decision === 'approve') updateCharge(s, r, r.startDate, r.endDate, decision.deductionDays); r.status = ({ approve: 'approved', reject: 'rejected', needs_info: 'needs_info' } as const)[decision.decision]; r.deductionDays = decision.decision === 'approve' ? decision.deductionDays : 0; r.note = decision.note ?? ''; r.externalApproverName = decision.externalApproverName ?? ''; }, 'leave_decided', requestId, decision.note);
  },
  async changeLeave(requestId: string, input: { startDate: string; endDate: string; reason: string; startTime?: string; endTime?: string; attachment?: File; removeAttachment?: boolean }) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if (!r || r.employeeId !== user().id) throw new Error('Pengajuan hanya dapat diubah pemiliknya.');
    if (!['pending','needs_info','approved'].includes(r.status)) throw new Error('Pengajuan ini tidak dapat diubah.');
    if (r.adjustment?.status === 'pending') throw new Error('Masih ada perubahan yang menunggu keputusan.');
    const startTime = input.startTime ?? r.startTime, endTime = input.endTime ?? r.endTime;
    const extent = validateLeavePeriod({ ...input, startTime, endTime, extent: r.extent });
    if(input.reason.trim().length < 3 || input.startDate < jakartaDate() || r.startDate < jakartaDate()) throw new Error('Perubahan tanggal yang sudah dijalani harus melalui HR. Alasan minimal 3 karakter.');
    if (isDuplicateLeave({ ...input, type: r.type, extent, startTime, endTime }, requestId)) throw new Error('Pengajuan yang sama sudah ada.');
    if (input.attachment && input.removeAttachment) throw new Error('Pilih mengganti atau menghapus lampiran.');
    if (r.status === 'approved' && (startTime !== r.startTime || endTime !== r.endTime || input.attachment || input.removeAttachment)) throw new Error('Pengajuan disetujui hanya dapat meminta perubahan tanggal atau pembatalan.');
    if (input.attachment && (!input.attachment.size || input.attachment.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(input.attachment.type))) throw new Error('Lampiran harus foto/PDF maksimal 5 MB.');
    if (configured) {
      let path: string | null = null;
      if (input.attachment) {
        const { data: { session } } = await supabase!.auth.getSession();
        if (!session) throw new Error('Sesi berakhir. Silakan login kembali.');
        path = `${session.user.id}/${id()}.${input.attachment.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
        const upload = await supabase!.storage.from('leave-attachments').upload(path, input.attachment);
        if (upload.error) fail(upload.error);
      }
      try {
        const args = { p_id: requestId, p_starts_on: input.startDate, p_ends_on: input.endDate, p_reason: input.reason, p_starts_at: startTime || null, p_ends_at: endTime || null };
        if (r.status === 'approved') await rpc('leave_request_change', args);
        else await rpc('leave_edit', { ...args, p_attachment_path: path, p_replace_attachment: !!input.attachment || !!input.removeAttachment });
      } catch (error) { await cleanupRejectedLeaveUpload(path,error); throw error; }
      await refresh(); return;
    }
    commit(s => {
      const request = s.leaveRequests.find(x => x.id === requestId)!;
      if (r.status === 'approved') request.adjustment = { id: id(), type: 'change', status: 'pending', requestedAt: new Date().toISOString(), startDate: input.startDate, endDate: input.endDate, reason: input.reason };
      else {
        Object.assign(request, { startDate: input.startDate, endDate: input.endDate, startTime, endTime, reason: input.reason, status: 'pending', approverId: user().managerId, note: '', externalApproverName: '' });
        if (input.attachment) { request.attachmentUrl = URL.createObjectURL(input.attachment); request.attachmentName = input.attachment.name; }
        else if (input.removeAttachment) { request.attachmentUrl = undefined; request.attachmentName = undefined; request.attachmentPath = undefined; }
      }
    }, 'leave_change_requested', requestId, input.reason);
  },
  async correctLeave(requestId: string, input: { startDate: string; endDate: string; deductionDays: number; reason: string; cancel: boolean; externalApproverName?: string; startTime?: string; endTime?: string }) {
    requireAdmin();
    const state = get(app), actor = user(), request = state.leaveRequests.find(r => r.id === requestId);
    if (!request || request.employeeId === actor.id) throw new Error('Koreksi cuti sendiri harus dilakukan Admin HR lain.');
    if (request.status !== 'approved' || request.adjustment?.status === 'pending') throw new Error('Koreksi hanya untuk cuti disetujui tanpa perubahan yang menunggu.');
    if (input.reason.trim().length < 3) throw new Error('Alasan koreksi minimal 3 karakter.');
    const employee = state.employees.find(e => e.id === request.employeeId)!;
    if (employee.approvalMode === 'external' && (input.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal wajib diisi.');
    const startDate = input.cancel ? request.startDate : input.startDate, endDate = input.cancel ? request.endDate : input.endDate;
    const startTime = input.cancel ? request.startTime : input.startTime ?? request.startTime, endTime = input.cancel ? request.endTime : input.endTime ?? request.endTime;
    validateLeavePeriod({ ...request, startDate, endDate, startTime, endTime });
    const allocation: Record<number, number> = input.cancel ? {} : deductionByYear(startDate, endDate, input.deductionDays);
    if (!input.cancel && duplicateLeave(state, request.employeeId, { ...request, startDate, endDate, startTime, endTime }, requestId)) throw new Error('Pengajuan yang sama sudah ada.');
    if (configured) { await rpc('leave_correct_hours', { p_id: requestId, p_starts_on: startDate, p_ends_on: endDate, p_deductions: allocation, p_reason: input.reason, p_cancel: input.cancel, p_external_decider: input.externalApproverName || null, p_starts_at: startTime || null, p_ends_at: endTime || null }); await refresh(); return; }
    commit(s => {
      const r = s.leaveRequests.find(x => x.id === requestId)!;
      applyLeaveAllocation(s,r,allocation);
      Object.assign(r, { startDate, endDate, startTime, endTime, status: input.cancel ? 'cancelled' : 'approved', deductionDays: input.cancel ? 0 : input.deductionDays, note: input.reason, approverId: actor.id, externalApproverName: input.externalApproverName ?? '' });
    }, input.cancel ? 'leave_corrected_cancelled' : 'leave_corrected', requestId, `${input.reason.trim()} · Sebelum: ${request.startDate}–${request.endDate} ${request.startTime}–${request.endTime}, ${request.deductionDays} hari. Sesudah: ${startDate}–${endDate} ${startTime}–${endTime}, ${input.cancel ? 0 : input.deductionDays} hari${input.externalApproverName ? ` · Keputusan ${input.externalApproverName}` : ''}`);
  },
  async recordRetrospectiveLeave(input: RetrospectiveLeaveInput) {
    requireAdmin(); const actor = user(), state = get(app), employee = state.employees.find(e => e.id === input.employeeId);
    if (!employee || employee.status !== 'active' || employee.id === actor.id) throw new Error('Pilih karyawan aktif selain diri sendiri.');
    if (!['personal','sick'].includes(input.type)) throw new Error('Pencatatan susulan hanya untuk izin pribadi atau sakit.');
    if (input.startDate >= jakartaDate() || input.endDate > jakartaDate() || input.startDate < employee.joinDate) throw new Error('Pencatatan susulan harus dimulai pada tanggal lampau setelah mulai bekerja.');
    if (input.reason.trim().length < 3 || input.note.trim().length < 5) throw new Error('Alasan dan sumber konfirmasi HR wajib diisi.');
    const extent = validateLeavePeriod(input), startTime = input.startTime || '', endTime = input.endTime || '';
    const allocation = deductionByYear(input.startDate,input.endDate,input.deductionDays);
    if (employee.approvalMode === 'external' && (input.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal wajib diisi.');
    if (duplicateLeave(state,employee.id,{ ...input,extent,startTime,endTime })) throw new Error('Pengajuan yang sama sudah ada dan masih aktif.');
    if (configured) { const row = await rpc('leave_record_retrospective', { p_employee_id: employee.id, p_kind: input.type, p_starts_on: input.startDate,
      p_ends_on: input.endDate, p_reason: input.reason, p_extent: extent, p_starts_at: startTime || null, p_ends_at: endTime || null,
      p_deductions: allocation, p_note: input.note, p_external_decider: input.externalApproverName || null }); await refresh(); return row.id; }
    const requestId = id();
    commit(s => { const request: LeaveRequest = { id: requestId, employeeId: employee.id, type: input.type, extent, startDate: input.startDate,
      endDate: input.endDate, startTime, endTime, reason: input.reason.trim(), status: 'approved', deductionDays: input.deductionDays,
      approverId: actor.id, note: input.note.trim(), externalApproverName: input.externalApproverName?.trim() ?? '', createdAt: new Date().toISOString(), adjustment: null };
      applyLeaveAllocation(s,request,allocation); s.leaveRequests.push(request);
    }, 'leave_recorded_retrospective', requestId, `${input.reason.trim()} · Sumber konfirmasi: ${input.note.trim()} · ${input.startDate}–${input.endDate}`);
    return requestId;
  },
  async saveCashierAssignment(input: CashierAssignmentInput) {
    requireAdmin(); assertCashierAssignment(get(app),input);
    if (configured) { const row = await rpc('cashier_assignment_save',{ p_employee_id: input.employeeId, p_work_date: input.workDate,
      p_outlet_id: input.outletId, p_shift: input.shift, p_reason: input.reason, p_id: input.id ?? null, p_cancel: input.cancel ?? false }); await refresh(); return row.id; }
    let result = ''; commit(s => {
      const previousFollowups = structuredClone(s.spvFollowups ?? []);
      result = saveAssignmentInState(s,input).id;
      auditDemoFollowupContextChanges(s, previousFollowups, s.user?.id ?? '');
    },input.cancel ? 'assignment_cancelled' : 'assignment_saved', input.id ?? '', input.reason); return result;
  },
  async saveStaffingRequirement(input: StaffingRequirementInput) {
    requireAdmin();
    const state = get(app), actor = user();
    if (!state.outlets.some(outlet => outlet.id === input.outletId && outlet.active)) throw new Error('Pilih outlet aktif.');
    if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6 || !['morning','afternoon','middle'].includes(input.shift)) throw new Error('Hari dan shift kebutuhan tidak valid.');
    if (!Number.isInteger(input.minimum) || input.minimum < 0 || input.minimum > 100) throw new Error('Kebutuhan minimum harus angka 0 sampai 100.');
    const date = new Date(`${input.effectiveFrom}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || !Number.isFinite(+date) || date.toISOString().slice(0,10) !== input.effectiveFrom || input.effectiveFrom < jakartaDate()) throw new Error('Tanggal berlaku harus hari ini atau mendatang.');
    if (configured) {
      const row = await rpc('staffing_requirement_save', { p_outlet_id: input.outletId, p_weekday: input.weekday, p_shift: input.shift, p_minimum: input.minimum, p_effective_from: input.effectiveFrom });
      await refresh(); return row.id;
    }
    const now = new Date().toISOString(), before = (state.staffingRequirements ?? []).find(row => row.outletId === input.outletId && row.weekday === input.weekday && row.shift === input.shift && row.effectiveFrom === input.effectiveFrom);
    const row: StaffingRequirement = { id: before?.id ?? id(), ...input, createdBy: before?.createdBy ?? actor.id, createdAt: before?.createdAt ?? now, updatedAt: now };
    commit(s => { s.staffingRequirements ??= []; const index = s.staffingRequirements.findIndex(item => item.id === row.id); if (index < 0) s.staffingRequirements.push(row); else s.staffingRequirements[index] = row; }, 'staffing_requirement_saved', row.id, `Minimum ${input.minimum} · ${input.shift} · mulai ${input.effectiveFrom}`);
    return row.id;
  },
  async saveCashierRosterBatch(weekStart: string, changes: CashierRosterChange[], idempotencyKey: string, replayPersistedAttempt = false) {
    requireAdmin();
    const state = get(app), actor = user();
    // New writes are checked against the current client snapshot. An exact
    // persisted replay must reach the server's idempotency lookup first: its
    // original commit may itself have advanced updated_at in this browser.
    if (!configured || !replayPersistedAttempt) validateRosterBatch(state, actor.id, weekStart, changes);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new Error('Kunci penyimpanan jadwal tidak valid.');
    if (configured) {
      const result = await rpc('cashier_roster_batch_save', { p_week_start: weekStart, p_idempotency_key: idempotencyKey,
        p_changes: changes.map(change => ({ id: change.id ?? null, employee_id: change.employeeId, work_date: change.workDate,
          outlet_id: change.outletId, shift: change.shift, reason: change.reason, expected_updated_at: change.expectedUpdatedAt ?? null, cancel: change.cancel ?? false })) });
      await refresh(); return result as { batch_id: string; week_start: string; saved_count: number; assignments: unknown[] };
    }
    const next = structuredClone(state), saved = changes.map(change => saveAssignmentInState(next, { ...change, reason: change.reason.trim() }));
    commit(s => {
      s.cashierAssignments = next.cashierAssignments;
      const previousFollowups = structuredClone(s.spvFollowups ?? []);
      s.spvFollowups = next.spvFollowups ?? [];
      auditDemoFollowupContextChanges(s, previousFollowups, actor.id);
      for (const row of saved) s.auditEntries.unshift({ id: id(), actorId: actor.id, action: 'assignment_week_saved', entityId: row.id,
        at: new Date().toISOString(), detail: `${row.reason} · ${row.workDate} · ${row.shift}` });
    });
    return { batch_id: idempotencyKey, week_start: weekStart, saved_count: saved.length, assignments: saved };
  },
  async startSpvFollowup(input: SpvFollowupInput) {
    requireAdmin();
    const state = get(app), actor = user(), caseKey = followupCaseKey(input);
    if (!operationalSignals(state, input.workDate).some(item => item.key === caseKey)) throw new Error('Kondisi sumber sudah berubah atau tidak lagi memerlukan tindak lanjut. Muat ulang panel.');
    if (configured) {
      const row = await rpc('spv_followup_start', { p_issue_type: input.issueType, p_work_date: input.workDate, p_outlet_id: input.outletId,
        p_employee_id: input.employeeId, p_shift: input.shift, p_source_type: input.sourceType, p_source_id: input.sourceId });
      await refresh(); return row.id;
    }
    const now = new Date().toISOString(), before = (state.spvFollowups ?? []).find(row => row.caseKey === caseKey);
    if (before && before.status !== 'completed') return before.id;
    const row: SpvFollowup = before ? { ...before, ...input, id: before.id, caseKey, status: 'new', ownerId: null, resolutionNote: '', updatedBy: actor.id, updatedAt: now, reopenedCount: before.reopenedCount + 1 }
      : { id: id(), caseKey, ...input, ownerId: null, status: 'new', note: '', resolutionNote: '', createdBy: actor.id, updatedBy: actor.id, createdAt: now, updatedAt: now, reopenedCount: 0 };
    commit(s => {
      s.spvFollowups ??= []; const index = s.spvFollowups.findIndex(item => item.caseKey === caseKey);
      if (index < 0) s.spvFollowups.push(row); else s.spvFollowups[index] = row;
      s.auditEntries.unshift({ id: id(), actorId: actor.id, action: before ? 'spv_followup_reopened' : 'spv_followup_started', entityId: row.id, at: now,
        detail: before ? 'Kondisi sumber muncul kembali' : 'Tindak lanjut dimulai' });
    });
    return row.id;
  },
  async updateSpvFollowup(input: SpvFollowupUpdate) {
    requireAdmin();
    const state = get(app), actor = user(), before = (state.spvFollowups ?? []).find(row => row.id === input.id);
    if (!before) throw new Error('Tindak lanjut tidak ditemukan. Muat ulang panel.');
    if (before.status === 'completed' && input.status !== 'completed') throw new Error('Buka kembali kasus hanya jika kondisi sumber muncul kembali.');
    if (input.status === 'in_progress' && !input.ownerId) throw new Error('Pilih penanggung jawab sebelum memproses kasus.');
    if (input.status === 'completed' && input.resolutionNote.trim().length < 5) throw new Error('Catatan penyelesaian minimal 5 karakter.');
    if (input.note.length > 2000 || input.resolutionNote.length > 2000) throw new Error('Catatan maksimal 2.000 karakter.');
    if (input.ownerId && !state.employees.some(employee => employee.id === input.ownerId && employee.status === 'active' && employee.accountStatus === 'active' && employee.roles.includes('admin_hr'))) throw new Error('Penanggung jawab harus Admin HR aktif.');
    if (configured) { await rpc('spv_followup_update', { p_id: input.id, p_status: input.status, p_owner_id: input.ownerId,
      p_note: input.note, p_resolution_note: input.resolutionNote }); await refresh(); return; }
    const now = new Date().toISOString();
    commit(s => {
      const row = s.spvFollowups!.find(item => item.id === input.id)!;
      const currentSource = operationalSignals(s, row.workDate).find(signal => signal.key === row.caseKey);
      if (currentSource) Object.assign(row, currentSource.input);
      Object.assign(row, { status: input.status, ownerId: input.ownerId, note: input.note.trim(), resolutionNote: input.status === 'completed' ? input.resolutionNote.trim() : '', updatedBy: actor.id, updatedAt: now });
      s.auditEntries.unshift({ id: id(), actorId: actor.id, action: input.status === 'completed' ? 'spv_followup_completed' : 'spv_followup_updated', entityId: row.id,
        at: now, detail: input.resolutionNote.trim() || input.note.trim() || 'Tindak lanjut diperbarui' });
    });
  },
  async submitAttendanceCorrection(input: AttendanceCorrectionInput) {
    const actor = user(); assertCorrectionInput(get(app),actor.id,input);
    if (configured) { const row = await rpc('attendance_correction_submit',{ p_attendance_id: input.attendanceId, p_work_date: input.workDate,
      p_clock_in: input.clockIn, p_clock_out: input.clockOut, p_shift: input.shift, p_reason: input.reason }); await refresh(); return row.id; }
    let result = ''; commit(s => { result = submitCorrectionInState(s,input).id; },'attendance_correction_requested',input.attendanceId ?? '',input.reason); return result;
  },
  async decideAttendanceCorrection(requestId: string, approved: boolean, note: string) {
    requireAdmin(); const request = (get(app).attendanceCorrectionRequests ?? []).find(r => r.id === requestId);
    if (!request || request.status !== 'pending' || request.employeeId === user().id) throw new Error('Permintaan tidak tersedia atau tidak boleh diproses sendiri.');
    if (note.trim().length < 5) throw new Error('Catatan keputusan minimal 5 karakter.');
    if (configured) { await rpc('attendance_correction_decide',{ p_id: requestId, p_approved: approved, p_note: note }); await refresh(); return; }
    commit(s => { decideCorrectionInState(s,requestId,approved,note); },'attendance_correction_decided',requestId,note);
  },
  async cancelAttendanceCorrection(requestId: string) {
    const actor = user(), request = (get(app).attendanceCorrectionRequests ?? []).find(r => r.id === requestId);
    if (!request || request.employeeId !== actor.id || request.status !== 'pending') throw new Error('Hanya permintaan sendiri yang masih menunggu dapat dibatalkan.');
    if (configured) { await rpc('attendance_correction_cancel',{ p_id: requestId }); await refresh(); return; }
    commit(s => { (s.attendanceCorrectionRequests ?? []).find(r => r.id === requestId)!.status = 'cancelled'; },'attendance_correction_cancelled',requestId,'Dibatalkan pemohon sebelum keputusan HR');
  },
  async cancelLeave(requestId: string, reason: string) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if (!r || r.employeeId !== user().id) throw new Error('Pengajuan hanya dapat dibatalkan pemiliknya.'); if (reason.trim().length < 3) throw new Error('Alasan pembatalan minimal 3 karakter.');
    if (r.status === 'approved' && r.startDate < jakartaDate()) throw new Error('Pembatalan tanggal lampau harus dikoreksi HR.');
    if (configured) { await rpc('leave_request_cancel', { p_id: requestId, p_reason: reason }); await refresh(); return; }
    commit(s => { const request = s.leaveRequests.find(x => x.id === requestId)!; if(request.adjustment?.status === 'pending') throw new Error('Masih ada perubahan yang menunggu keputusan.'); if(['pending','needs_info'].includes(request.status)) request.status = 'cancelled'; else if(request.status === 'approved') request.adjustment = { id:id(),type:'cancel',reason,status:'pending',requestedAt:new Date().toISOString() }; else throw new Error('Pengajuan ini tidak dapat dibatalkan.'); }, 'leave_cancel_requested', requestId, reason);
  },
  async decideAdjustment(requestId: string, decision: { decision: 'approve' | 'reject'; deductionDays: number; note?: string; externalApproverName?: string }) {
    const r = get(app).leaveRequests.find(x => x.id === requestId); if(!r?.adjustment || !canDecideLeave(r)) throw new Error('Anda tidak dapat memutuskan perubahan ini.');
    if (r.status !== 'approved' || r.adjustment.status !== 'pending') throw new Error('Perubahan sudah diproses.');
    const employee = get(app).employees.find(e => e.id === r.employeeId)!; if(employee.approvalMode === 'external' && (decision.externalApproverName?.trim().length ?? 0) < 3) throw new Error('Nama pemberi keputusan eksternal minimal 3 karakter.');
    if (decision.decision === 'reject' && (decision.note?.trim().length ?? 0) < 3) throw new Error('Alasan penolakan minimal 3 karakter.');
    if (!configured && decision.decision === 'approve' && r.adjustment.type === 'change'
      && duplicateLeave(get(app),r.employeeId,{ ...r,startDate:r.adjustment.startDate!,endDate:r.adjustment.endDate! },r.id)) throw new Error('Pengajuan yang sama sudah ada.');
    if(configured) { await rpc('leave_decide_adjustment', { p_id: r.adjustment.id, p_approved: decision.decision === 'approve', p_deductions: r.adjustment.type === 'cancel' ? {} : deductionByYear(r.adjustment.startDate!,r.adjustment.endDate!,decision.deductionDays), p_note: decision.note || null, p_external_decider: decision.externalApproverName || null }); await refresh(); return; }
    commit(s => { const request = s.leaveRequests.find(x => x.id === requestId)!, a = request.adjustment!; if(decision.decision === 'approve') { if(a.type === 'cancel') { applyLeaveAllocation(s,request,{}); request.status = 'cancelled'; request.deductionDays = 0; } else { updateCharge(s,request,a.startDate!,a.endDate!,decision.deductionDays); request.startDate = a.startDate!; request.endDate = a.endDate!; request.deductionDays = decision.deductionDays; } } a.status = decision.decision === 'approve' ? 'approved' : 'rejected'; a.note = decision.note?.trim() ?? ''; a.decidedAt = new Date().toISOString(); a.deciderName = decision.externalApproverName?.trim() || user().fullName; }, 'leave_adjustment_decided', requestId, `${r.adjustment.type === 'cancel' ? 'Pembatalan' : 'Perubahan tanggal'} ${decision.decision === 'approve' ? 'disetujui' : 'ditolak'}${decision.externalApproverName ? ` oleh ${decision.externalApproverName.trim()}` : ''}${decision.note ? `: ${decision.note.trim()}` : ''}`);
  },
  async clockIn(input: ClockInInput) {
    const u = user(), s = get(app), assignment = assignmentFor(s,u.id), outlet = s.outlets.find(o => o.id === assignment?.outletId);
    if (!isCashier(u)) throw new Error('Absensi hanya untuk kasir.');
    if (!assignment || assignment.shift === 'off') throw new Error('Belum ada penugasan kerja hari ini atau Anda dijadwalkan libur. Hubungi HR.');
    if (!outlet || input.outletId !== outlet.id || input.shift !== assignment.shift) throw new Error('Outlet dan shift harus sesuai penugasan harian HR.');
    if (!outlet.active) throw new Error('Outlet tidak aktif. Hubungi Admin HR.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift)) throw new Error('Shift tidak valid.');
    const distance = validateGeo(input,outlet); if(input.shift === 'middle' && !u.canMiddleShift) throw new Error('Shift Middle memerlukan izin SPV.');
    if(!input.selfie.size || input.selfie.size > 5 * 1024 * 1024 || !input.selfie.type.startsWith('image/')) throw new Error('Ambil selfie langsung dari kamera, maksimal 5 MB.');
    const metadata = selfieMetadata(input);
    if(s.attendanceRecords.some(r => r.employeeId === u.id && !r.clockOut)) throw new Error('Masih ada sesi kerja yang belum clock out.');
    if(s.attendanceRecords.some(r => r.employeeId === u.id && jakartaDate(r.clockIn) === jakartaDate())) throw new Error('Clock in hari ini sudah tercatat. Untuk koreksi, hubungi SPV.');
    assertFreshGps(input.geoCapturedAt);
    if(configured) {
      if (!metadata.selfieCapturedAt || !metadata.selfieOutletName) throw new Error('Ambil selfie baru dengan informasi pengambilan yang lengkap.');
      const { data: { session } } = await supabase!.auth.getSession(); if (!session) throw new Error('Silakan masuk kembali.');
      const path = `${session.user.id}/${id()}.jpg`, upload = await supabase!.storage.from('attendance-selfies').upload(path,input.selfie,{contentType:'image/jpeg'});
      if(upload.error) fail(upload.error);
      try { const verificationToken = await verifyBiometricSelfie(input,path);
        await rpc('attendance_clock_in_verified',{ p_shift:input.shift,p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy_m:input.accuracy,p_selfie_path:path,
          p_selfie_captured_at:metadata.selfieCapturedAt,p_selfie_outlet_name:metadata.selfieOutletName,p_geo_captured_at:input.geoCapturedAt,p_verification_token:verificationToken });
      } catch(e) { await cleanupRejectedUpload('attendance-selfies',path,e); throw e; }
      await refresh(); return;
    }
    const now = new Date().toISOString(), recordId = id(); commit(state => { state.attendanceRecords.unshift({ id:recordId,employeeId:u.id,outletId:outlet.id,shift:input.shift,clockIn:now,clockOut:null,...attendanceTiming(now,input.shift,outlet),durationMinutes:null,inLatitude:input.latitude,inLongitude:input.longitude,inAccuracy:input.accuracy,inDistance:distance,selfiePath:'demo-session-only',assignmentId:assignment.id,selfieUrl:URL.createObjectURL(input.selfie),...metadata,corrected:false,correctionReason:'',outletSnapshot:attendanceSnapshot(outlet) }); },'clock_in',recordId);
  },
  async clockOut(input: ClockOutInput) {
    const u = user(), record = get(app).attendanceRecords.find(r => r.employeeId === u.id && !r.clockOut); if(!record) throw new Error('Tidak ada sesi kerja aktif.'); const outlet = attendanceOutlet(record,get(app).outlets.find(o => o.id === record.outletId)!); const distance = validateGeo(input,outlet);
    assertFreshGps(input.geoCapturedAt);
    if(configured) { await rpc('attendance_clock_out_fresh',{p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy_m:input.accuracy,p_geo_captured_at:input.geoCapturedAt}); await refresh(); return; }
    const now = new Date().toISOString(); commit(s => { const r = s.attendanceRecords.find(x => x.id === record.id)!; r.clockOut = now; r.durationMinutes = Math.floor((+new Date(now)-+new Date(r.clockIn))/60000); r.outLatitude = input.latitude; r.outLongitude = input.longitude; r.outDistance = distance; r.outAccuracy = input.accuracy; },'clock_out',record.id);
  },
  async correctAttendance(recordId: string, input: { clockIn: string; clockOut: string | null; shift?: Shift; reason: string }) {
    requireAdmin(); const r = get(app).attendanceRecords.find(x => x.id === recordId); if(!r || r.employeeId === user().id) throw new Error('Anda tidak dapat mengoreksi absensi sendiri.'); if(input.reason.trim().length < 5) throw new Error('Alasan koreksi minimal 5 karakter.');
    const clockIn = +new Date(input.clockIn), clockOut = input.clockOut === null ? null : +new Date(input.clockOut);
    if (!Number.isFinite(clockIn) || clockIn > Date.now() || (clockOut !== null && (!Number.isFinite(clockOut) || clockOut < clockIn || clockOut > Date.now()))) throw new Error('Waktu koreksi tidak valid atau belum terjadi.');
    if (jakartaDate(input.clockIn) !== jakartaDate(r.clockIn)) throw new Error('Tanggal kerja tidak dapat diubah.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift ?? r.shift)) throw new Error('Shift tidak valid.');
    if (!input.clockOut && get(app).attendanceRecords.some(row => row.id !== r.id && row.employeeId === r.employeeId && !row.clockOut)) throw new Error('Masih ada sesi kerja lain yang belum clock out.');
    if (attendanceOverlaps(get(app).attendanceRecords,r.employeeId,input.clockIn,input.clockOut,r.id)) throw new Error('Waktu absensi bertabrakan dengan catatan yang sudah ada.');
    if(configured) { await rpc('attendance_correct',{p_id:recordId,p_clock_in:input.clockIn,p_clock_out:input.clockOut || null,p_shift:input.shift ?? null,p_reason:input.reason}); await refresh(); return; }
    commit(s => { const row = s.attendanceRecords.find(x => x.id === recordId)!; const before = JSON.stringify(row); const outlet = attendanceOutlet(row,s.outlets.find(o => o.id === row.outletId)!); Object.assign(row,{ clockIn:input.clockIn,clockOut:input.clockOut,shift:input.shift ?? row.shift,corrected:true,correctionReason:input.reason,durationMinutes:input.clockOut?Math.floor((+new Date(input.clockOut)-+new Date(input.clockIn))/60000):null,outletSnapshot:attendanceSnapshot(outlet) }); Object.assign(row,attendanceTiming(input.clockIn,row.shift,outlet)); s.auditEntries.unshift({id:id(),actorId:user().id,action:'attendance_original',entityId:recordId,at:new Date().toISOString(),detail:before}); },'attendance_corrected',recordId,input.reason);
  },
  async recordManualAttendance(input: { employeeId: string; shift: Shift; clockIn: string; clockOut: string | null; reason: string }) {
    requireAdmin(); const employee=get(app).employees.find(e=>e.id===input.employeeId);
    if(!employee || employee.id===user().id || !isCashier(employee) || employee.status!=='active')throw new Error('Pilih kasir aktif selain diri sendiri.');
    if(input.reason.trim().length < 5)throw new Error('Alasan dan sumber konfirmasi minimal 5 karakter.');
    if (!['morning', 'afternoon', 'middle'].includes(input.shift)) throw new Error('Shift tidak valid.');
    if(input.shift==='middle'&&!employee.canMiddleShift)throw new Error('Kasir ini belum diizinkan menggunakan Middle.');
    if(!Number.isFinite(+new Date(input.clockIn)) || +new Date(input.clockIn)>Date.now() || (input.clockOut && (!Number.isFinite(+new Date(input.clockOut)) || input.clockOut<input.clockIn || +new Date(input.clockOut)>Date.now())))throw new Error('Waktu absensi tidak valid atau belum terjadi.');
    if(configured){await rpc('attendance_record_manual',{p_employee_id:input.employeeId,p_shift:input.shift,p_clock_in:input.clockIn,p_clock_out:input.clockOut,p_reason:input.reason});await refresh();return;}
    const assignment=assignmentFor(get(app),employee.id,jakartaDate(input.clockIn)), outlet=get(app).outlets.find(o=>o.id===(assignment?.outletId ?? employee.outletId))!;
    const recordId=id();commit(s=>{if(s.attendanceRecords.some(r=>r.employeeId===employee.id&&(!r.clockOut||jakartaDate(r.clockIn)===jakartaDate(input.clockIn))))throw new Error('Catatan pada tanggal ini sudah ada atau sesi sebelumnya belum selesai. Gunakan koreksi.');if(attendanceOverlaps(s.attendanceRecords,employee.id,input.clockIn,input.clockOut))throw new Error('Waktu absensi bertabrakan dengan catatan yang sudah ada.');s.attendanceRecords.unshift({id:recordId,employeeId:employee.id,outletId:outlet.id,assignmentId:assignment?.id ?? null,shift:input.shift,clockIn:input.clockIn,clockOut:input.clockOut,...attendanceTiming(input.clockIn,input.shift,outlet),durationMinutes:input.clockOut?Math.floor((+new Date(input.clockOut)-+new Date(input.clockIn))/60000):null,inLatitude:null,inLongitude:null,inAccuracy:null,inDistance:null,selfiePath:'',corrected:true,correctionReason:input.reason,source:'manual',outletSnapshot:attendanceSnapshot(outlet)});},'attendance_manual',recordId,input.reason);
  }
};
