import type { AppState, AttendanceCorrectionInput, AttendanceCorrectionRequest, AttendanceRecord, CashierAssignment, CashierAssignmentInput, Employee, Outlet, SpvFollowup } from './types';
import { attendanceTiming, jakartaDate } from './domain';

const uid = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
export const cashierInState = (state: AppState, employee: Employee) => state.positions.some(p => p.id === employee.positionId && p.isCashier);
function validDay(day: string) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== day) throw new Error('Tanggal kerja tidak valid.');
}
function adminActor(state: AppState) {
  const actor = state.user;
  if (!actor || actor.status !== 'active' || actor.accountStatus !== 'active' || !actor.roles.includes('admin_hr')) throw new Error('Tindakan ini hanya untuk Admin HR aktif.');
  return actor;
}
export function assignmentFor(state: AppState, employeeId: string, day = jakartaDate()) {
  return (state.cashierAssignments ?? []).find(a => a.employeeId === employeeId && a.workDate === day && a.status === 'active');
}
export function syncUnassignedRosterFollowups(state: AppState, employeeId: string, workDate: string | null, actorId: string): SpvFollowup[] {
  const employee = state.employees.find(item => item.id === employeeId);
  if (!employee) return [];
  const changed: SpvFollowup[] = [];
  const updatedAt = timestamp();
  for (const followup of state.spvFollowups ?? []) {
    if (followup.sourceType !== 'roster' || followup.issueType !== 'unassigned' || followup.sourceId !== null
      || followup.employeeId !== employeeId || (workDate !== null && followup.workDate !== workDate) || followup.status === 'completed') continue;
    const outletId = assignmentFor(state, employeeId, followup.workDate)?.outletId ?? employee.outletId;
    if (!outletId || outletId === followup.outletId) continue;
    followup.outletId = outletId;
    followup.updatedBy = actorId;
    followup.updatedAt = updatedAt;
    changed.push(followup);
  }
  return changed;
}
export function syncAssignmentFollowups(state: AppState, assignment: CashierAssignment, actorId: string): SpvFollowup[] {
  const changed: SpvFollowup[] = [];
  const updatedAt = timestamp();
  for (const followup of state.spvFollowups ?? []) {
    if (followup.sourceType !== 'assignment' || followup.sourceId !== assignment.id || followup.status === 'completed'
      || (followup.workDate === assignment.workDate && followup.outletId === assignment.outletId
        && followup.employeeId === assignment.employeeId && followup.shift === assignment.shift)) continue;
    followup.workDate = assignment.workDate;
    followup.outletId = assignment.outletId;
    followup.employeeId = assignment.employeeId;
    followup.shift = assignment.shift;
    followup.updatedBy = actorId;
    followup.updatedAt = updatedAt;
    changed.push(followup);
  }
  return changed;
}
export function assertCashierAssignment(state: AppState, input: CashierAssignmentInput) {
  const actor = adminActor(state), employee = state.employees.find(e => e.id === input.employeeId);
  validDay(input.workDate);
  if (!employee || employee.status !== 'active' || !cashierInState(state,employee)) throw new Error('Pilih kasir aktif.');
  if (actor.id === employee.id) throw new Error('Penugasan sendiri harus diatur Admin HR lain.');
  if (input.reason.trim().length < 5 || input.reason.length > 2000) throw new Error('Alasan penugasan minimal 5 karakter, maksimal 2.000 karakter.');
  if (input.workDate < employee.joinDate) throw new Error('Penugasan tidak boleh sebelum tanggal mulai bekerja.');
  if (!['morning','afternoon','middle','off'].includes(input.shift)) throw new Error('Shift tidak valid.');
  if (!input.cancel && input.shift === 'middle' && !employee.canMiddleShift) throw new Error('Kasir ini belum diizinkan menggunakan Middle.');
  if (!input.cancel && !state.outlets.some(o => o.id === input.outletId && o.active)) throw new Error('Pilih outlet aktif.');
  const before = input.id ? (state.cashierAssignments ?? []).find(a => a.id === input.id) : (state.cashierAssignments ?? []).find(a => a.employeeId === input.employeeId && a.workDate === input.workDate);
  if (input.id && !before) throw new Error('Penugasan tidak ditemukan.');
  if (before && (before.employeeId !== input.employeeId || before.workDate !== input.workDate)) throw new Error('Kasir dan tanggal penugasan tidak dapat diubah.');
  if (state.attendanceRecords.some(r => r.employeeId === input.employeeId && jakartaDate(r.clockIn) === input.workDate)) throw new Error('Penugasan yang sudah dipakai absensi tidak dapat diubah.');
  if (input.cancel && (!before || before.status !== 'active')) throw new Error('Penugasan aktif tidak ditemukan.');
  return { actor, employee, before };
}
export function saveAssignmentInState(state: AppState, input: CashierAssignmentInput) {
  const { actor, before } = assertCashierAssignment(state,input), at = timestamp();
  const row = { id: before?.id ?? uid(), employeeId: input.employeeId, workDate: input.workDate, outletId: input.cancel ? before!.outletId : input.outletId,
    shift: input.cancel ? before!.shift : input.shift, reason: input.reason.trim(), status: input.cancel ? 'cancelled' as const : 'active' as const,
    createdBy: before?.createdBy ?? actor.id, createdAt: before?.createdAt ?? at, updatedAt: at };
  state.cashierAssignments ??= [];
  if (before) state.cashierAssignments[state.cashierAssignments.findIndex(a => a.id === before.id)] = row;
  else state.cashierAssignments.push(row);
  syncAssignmentFollowups(state, row, actor.id);
  syncUnassignedRosterFollowups(state, input.employeeId, input.workDate, actor.id);
  return row;
}
export function assertCorrectionInput(state: AppState, employeeId: string, input: AttendanceCorrectionInput) {
  validDay(input.workDate);
  const employee = state.employees.find(e => e.id === employeeId), start = Date.parse(input.clockIn), end = input.clockOut ? Date.parse(input.clockOut) : null;
  if (!employee || employee.status !== 'active' || !cashierInState(state,employee)) throw new Error('Permintaan hanya untuk kasir aktif.');
  if (input.reason.trim().length < 5 || input.reason.length > 2000) throw new Error('Jelaskan kendala dan waktu sebenarnya dalam 5–2.000 karakter.');
  if (!Number.isFinite(start) || start > Date.now() || input.workDate !== jakartaDate(input.clockIn)
    || input.workDate > jakartaDate() || input.workDate < employee.joinDate
    || (end !== null && (!Number.isFinite(end) || end < start || end > Date.now()))) throw new Error('Waktu koreksi harus sudah terjadi dan sesuai tanggal kerja.');
  if (!['morning','afternoon','middle'].includes(input.shift) || (input.shift === 'middle' && !employee.canMiddleShift)) throw new Error('Shift tidak valid atau belum diizinkan.');
  const record = input.attendanceId ? state.attendanceRecords.find(r => r.id === input.attendanceId && r.employeeId === employeeId) : undefined;
  if (input.attendanceId && (!record || jakartaDate(record.clockIn) !== input.workDate)) throw new Error('Catatan absensi tidak tersedia pada tanggal tersebut.');
  if (!record && state.attendanceRecords.some(r => r.employeeId === employeeId && jakartaDate(r.clockIn) === input.workDate)) throw new Error('Absensi tanggal ini sudah ada. Ajukan koreksi pada catatan tersebut.');
  if ((state.attendanceCorrectionRequests ?? []).some(r => r.employeeId === employeeId && r.workDate === input.workDate && r.status === 'pending')) throw new Error('Masih ada permintaan koreksi yang menunggu untuk tanggal ini.');
  return { employee, record };
}
export function submitCorrectionInState(state: AppState, input: AttendanceCorrectionInput) {
  const actor = state.user;
  if (!actor || actor.status !== 'active' || actor.accountStatus !== 'active') throw new Error('Silakan masuk dengan akun aktif.');
  const { employee, record } = assertCorrectionInput(state,actor.id,input);
  const row: AttendanceCorrectionRequest = { id: uid(), employeeId: actor.id, attendanceId: input.attendanceId, workDate: input.workDate,
    outletId: record?.outletId ?? assignmentFor(state,employee.id,input.workDate)?.outletId ?? employee.outletId,
    shift: input.shift, proposedClockIn: new Date(input.clockIn).toISOString(), proposedClockOut: input.clockOut ? new Date(input.clockOut).toISOString() : null,
    reason: input.reason.trim(), status: 'pending', decisionNote: '', decisionBy: null, createdAt: timestamp(), decidedAt: null,
    originalSnapshot: record ? { clockIn: record.clockIn, clockOut: record.clockOut, shift: record.shift, outletId: record.outletId } : null };
  (state.attendanceCorrectionRequests ??= []).push(row);
  return row;
}
const snapshot = (outlet: Outlet): NonNullable<AttendanceRecord['outletSnapshot']> => ({ morningStart: outlet.morningStart, afternoonStart: outlet.afternoonStart,
  lateToleranceMinutes: outlet.lateToleranceMinutes, latitude: outlet.latitude, longitude: outlet.longitude, radiusMeters: outlet.radiusMeters });
export function decideCorrectionInState(state: AppState, requestId: string, approved: boolean, note: string) {
  const actor = adminActor(state), request = (state.attendanceCorrectionRequests ?? []).find(r => r.id === requestId);
  if (!request || request.status !== 'pending') throw new Error('Permintaan tidak tersedia atau sudah diproses.');
  if (request.employeeId === actor.id) throw new Error('Permintaan sendiri harus diproses Admin HR lain.');
  if (note.trim().length < 5 || note.length > 2000) throw new Error('Catatan keputusan minimal 5 karakter, maksimal 2.000 karakter.');
  if (approved) {
    const employee = state.employees.find(e => e.id === request.employeeId);
    if (!employee || employee.status !== 'active' || !cashierInState(state,employee)) throw new Error('Kasir tidak aktif.');
    const record = request.attendanceId ? state.attendanceRecords.find(r => r.id === request.attendanceId && r.employeeId === request.employeeId) : null;
    if (request.attendanceId && !record) throw new Error('Catatan asli tidak tersedia.');
    if (record && request.originalSnapshot && ['clockIn','clockOut','shift','outletId'].some(key => record[key as keyof typeof request.originalSnapshot] !== request.originalSnapshot![key as keyof typeof request.originalSnapshot])) throw new Error('Catatan absensi sudah berubah sejak permintaan diajukan. Tolak permintaan ini dan minta pengajuan baru.');
    const expectedOutlet = record?.outletId ?? assignmentFor(state,employee.id,request.workDate)?.outletId ?? employee.outletId;
    if (expectedOutlet !== request.outletId) throw new Error('Penempatan sudah berubah sejak permintaan diajukan. Periksa ulang melalui pengajuan baru.');
    if (state.attendanceRecords.some(r => r.employeeId === request.employeeId && r.id !== record?.id
      && (jakartaDate(r.clockIn) === request.workDate || (Date.parse(r.clockIn) < (request.proposedClockOut ? Date.parse(request.proposedClockOut) : Infinity)
        && Date.parse(request.proposedClockIn) < (r.clockOut ? Date.parse(r.clockOut) : Infinity))))) throw new Error('Waktu koreksi bertabrakan dengan absensi yang sudah ada.');
    const currentOutlet = state.outlets.find(o => o.id === request.outletId);
    if (!currentOutlet) throw new Error('Outlet tidak tersedia.');
    const outlet = { ...currentOutlet, ...record?.outletSnapshot }, before = record ? structuredClone(record) : null;
    const clockIn = request.proposedClockIn, clockOut = request.proposedClockOut;
    const values = { clockIn, clockOut, shift: request.shift, ...attendanceTiming(clockIn,request.shift,outlet), durationMinutes: clockOut ? Math.floor((Date.parse(clockOut)-Date.parse(clockIn))/60000) : null,
      corrected: true, correctionReason: `${request.reason} · Keputusan HR: ${note.trim()}`, outletSnapshot: snapshot(outlet) };
    if (record) Object.assign(record,values);
    else state.attendanceRecords.push({ id: uid(), employeeId: employee.id, outletId: outlet.id, assignmentId: assignmentFor(state,employee.id,request.workDate)?.id ?? null, ...values, source: 'manual',
      inLatitude: null, inLongitude: null, inAccuracy: null, inDistance: null, selfiePath: '' });
    const target = record ?? state.attendanceRecords[state.attendanceRecords.length - 1];
    request.attendanceId = target.id;
    state.auditEntries.unshift({ id: uid(), actorId: actor.id, action: before ? 'attendance_corrected' : 'attendance_manual', entityId: target.id,
      at: timestamp(), detail: `${request.reason} · Keputusan HR: ${note.trim()}${before ? ` · Sebelum: ${before.clockIn}–${before.clockOut ?? 'belum pulang'}` : ' · Catatan manual tanpa verifikasi GPS/selfie'} · Sesudah: ${clockIn}–${clockOut ?? 'belum pulang'}` });
  }
  request.status = approved ? 'approved' : 'rejected'; request.decisionNote = note.trim(); request.decisionBy = actor.id; request.decidedAt = timestamp();
  return request;
}
