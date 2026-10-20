import type { AppState, CashierAssignment, CashierRosterChange, Employee, Shift, SpvFollowupInput, StaffingRequirement } from './types';
import { attendanceDurationReview, attendanceSessionStatus, classifyAttendanceLateness } from './attendance-status';
import { jakartaDate } from './domain';

const dayMs = 86_400_000;
const shifts: Shift[] = ['morning', 'afternoon', 'middle'];
const cashier = (state: AppState, employee: Employee) => state.positions.some(position => position.id === employee.positionId && position.isCashier);
const dateAt = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
export function isValidWorkDate(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = dateAt(day);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === day;
}
export const addWorkDays = (day: string, amount: number) => new Date(+dateAt(day) + amount * dayMs).toISOString().slice(0, 10);
export function startOfWorkWeek(day: string): string {
  const weekday = dateAt(day).getUTCDay();
  return addWorkDays(day, -((weekday + 6) % 7));
}
export const workWeekDates = (monday: string) => Array.from({ length: 7 }, (_, index) => addWorkDays(monday, index));
export const workWeekLabel = (monday: string) => `${monday} – ${addWorkDays(monday, 6)}`;

const workDateFor = (record: AppState['attendanceRecords'][number]) => record.workDate ?? jakartaDate(record.clockIn);
const covers = (start: string, end: string, day: string) => start <= day && day <= end;
const isFullDay = (request: AppState['leaveRequests'][number]) => request.extent === 'full_day' || !request.extent;
function fullDayApproved(state: AppState, employeeId: string, day: string) {
  return state.leaveRequests.some(request => request.employeeId === employeeId && request.status === 'approved' && isFullDay(request) && covers(request.startDate, request.endDate, day));
}
function leaveSignalsFor(state: AppState, employeeId: string, day: string) {
  const rows = state.leaveRequests.filter(request => request.employeeId === employeeId && covers(request.startDate, request.endDate, day));
  return {
    pending: rows.some(request => request.status === 'pending' || request.adjustment?.status === 'pending'),
    partial: rows.some(request => !isFullDay(request) && (request.status === 'approved' || request.status === 'pending'))
  };
}

export interface StaffingCoverage {
  outletId: string; outletName: string; shift: Shift; minimum: number | null; scheduled: number; available: number;
  absentOnApprovedFullDay: number; actual: number; working: number; pendingLeave: number; needsHourReview: number;
  status: 'not_configured' | 'not_needed' | 'shortage' | 'needs_time_review' | 'covered';
}

function requirementFor(requirements: StaffingRequirement[], outletId: string, weekday: number, shift: Shift, day: string) {
  return requirements.filter(row => row.outletId === outletId && row.weekday === weekday && row.shift === shift && row.effectiveFrom <= day)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function staffingCoverage(state: AppState, day: string): StaffingCoverage[] {
  const requirements = state.staffingRequirements ?? [];
  const assignments = (state.cashierAssignments ?? []).filter(row => row.workDate === day && row.status === 'active' && row.shift !== 'off');
  const weekday = dateAt(day).getUTCDay();
  return state.outlets.filter(outlet => outlet.active).flatMap(outlet => shifts.map(shift => {
    const rows = assignments.filter(row => row.outletId === outlet.id && row.shift === shift && state.employees.some(employee => {
      return employee.id === row.employeeId && employee.status === 'active' && cashier(state, employee);
    }));
    const distinct = [...new Map(rows.map(row => [row.employeeId, row])).values()];
    const absentOnApprovedFullDay = distinct.filter(row => fullDayApproved(state, row.employeeId, day)).length;
    const availableRows = distinct.filter(row => !fullDayApproved(state, row.employeeId, day));
    const leaveSignals = availableRows.map(row => leaveSignalsFor(state, row.employeeId, day));
    const minimum = requirementFor(requirements, outlet.id, weekday, shift, day)?.minimum ?? null;
    const actualRows = state.attendanceRecords.filter(record => workDateFor(record) === day && record.outletId === outlet.id && record.shift === shift);
    const actual = new Set(actualRows.map(record => record.employeeId)).size;
    const working = new Set(actualRows.filter(record => !record.clockOut).map(record => record.employeeId)).size;
    const needsHourReview = leaveSignals.filter(signal => signal.partial).length;
    const pendingLeave = leaveSignals.filter(signal => signal.pending).length;
    const status: StaffingCoverage['status'] = minimum === null ? 'not_configured'
      : minimum === 0 ? 'not_needed'
      : availableRows.length < minimum ? 'shortage'
      : needsHourReview ? 'needs_time_review'
      : 'covered';
    return { outletId: outlet.id, outletName: outlet.name, shift, minimum, scheduled: distinct.length, available: availableRows.length,
      absentOnApprovedFullDay, actual, working, pendingLeave, needsHourReview, status };
  }));
}

export interface OperationalSignal {
  key: string; title: string; detail: string; href: string; tone: 'amber' | 'red' | 'blue';
  input: SpvFollowupInput;
}
export interface CashierDayStatus {
  employee: Employee; outletId: string; shift: Shift | 'off' | null;
  status: 'unassigned' | 'off' | 'leave' | 'not_due' | 'flexible' | 'needs_confirmation' | 'working' | 'completed' | 'needs_review';
  detail: string;
}
export function followupCaseKey(input: SpvFollowupInput) {
  return input.sourceType === 'roster'
    ? `${input.issueType}:${input.employeeId}:${input.workDate}`
    : `${input.issueType}:${input.sourceId}`;
}
const shiftStart = (row: CashierAssignment, state: AppState) => {
  if (row.shift === 'middle' || row.shift === 'off') return null;
  const outlet = state.outlets.find(item => item.id === row.outletId);
  const time = row.shift === 'morning' ? outlet?.morningStart : outlet?.afternoonStart;
  return time ? Date.parse(`${row.workDate}T${time}:00+07:00`) : null;
};
function dueAtFor(state: AppState, employeeId: string, row: CashierAssignment) {
  const scheduled = shiftStart(row, state);
  if (scheduled === null) return null;
  const outlet = state.outlets.find(item => item.id === row.outletId);
  let dueAt = scheduled + (outlet?.lateToleranceMinutes ?? 0) * 60_000;
  for (const request of state.leaveRequests) {
    if (request.employeeId !== employeeId || request.status !== 'approved' || request.extent !== 'late_arrival'
      || request.startDate !== row.workDate || request.endDate !== row.workDate) continue;
    const time = request.startTime || request.endTime;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) dueAt = Math.max(dueAt, Date.parse(`${row.workDate}T${time}:00+07:00`));
  }
  return dueAt;
}
export function cashierDayStatuses(state: AppState, day: string, now = Date.now()): CashierDayStatus[] {
  const today = jakartaDate(new Date(now).toISOString());
  const weekday = dateAt(day).getUTCDay();
  const records = state.attendanceRecords.filter(record => workDateFor(record) === day);
  return state.employees.filter(employee => employee.status === 'active' && cashier(state, employee)).map(employee => {
    const assignment = (state.cashierAssignments ?? []).find(row => row.employeeId === employee.id && row.workDate === day && row.status === 'active');
    const attendance = records.find(record => record.employeeId === employee.id);
    const leave = fullDayApproved(state, employee.id, day);
    if (!assignment) {
      if (attendance) {
        const session = attendanceSessionStatus(attendance, now);
        return { employee, outletId: attendance.outletId, shift: attendance.shift,
          status: session === 'review' || session === 'stale' ? 'needs_review' : attendance.clockOut ? 'completed' : session === 'due' ? 'needs_confirmation' : 'working',
          detail: 'Absensi tercatat tanpa penugasan aktif.' };
      }
      if (leave) return { employee, outletId: employee.outletId, shift: null, status: 'leave', detail: 'Cuti sehari penuh disetujui.' };
      if (employee.weeklyOffDays.includes(weekday)) return { employee, outletId: employee.outletId, shift: 'off', status: 'off', detail: 'Hari libur tetap.' };
      return { employee, outletId: employee.outletId, shift: null, status: 'unassigned', detail: day > today ? 'Belum ada penugasan untuk tanggal ini.' : 'Belum ada jadwal; perlu konfirmasi ke HR.' };
    }
    if (assignment.shift === 'off') return { employee, outletId: assignment.outletId, shift: 'off', status: 'off', detail: 'Dijadwalkan libur.' };
    if (leave && !attendance) return { employee, outletId: assignment.outletId, shift: assignment.shift, status: 'leave', detail: 'Cuti sehari penuh disetujui; jadwal perlu ditinjau.' };
    if (attendance) {
      const session = attendanceSessionStatus(attendance, now);
      return { employee, outletId: attendance.outletId, shift: attendance.shift,
        status: leave || session === 'review' || session === 'stale' ? 'needs_review' : attendance.clockOut ? 'completed' : session === 'due' ? 'needs_confirmation' : 'working',
        detail: leave ? 'Absensi tercatat saat cuti sehari penuh; periksa penyesuaian cuti.' : attendance.clockOut ? 'Clock out tercatat.' : session === 'stale' ? 'Sesi terbuka 12 jam atau lebih.' : session === 'due' ? 'Durasi mencapai 8 jam; konfirmasi clock out.' : 'Clock in tercatat; sesi berjalan.' };
    }
    if (assignment.shift === 'middle') return { employee, outletId: assignment.outletId, shift: assignment.shift, status: 'flexible', detail: 'Middle fleksibel; sistem tidak menetapkan batas masuk.' };
    const dueAt = dueAtFor(state, employee.id, assignment);
    if (day > today || (dueAt !== null && now < dueAt)) return { employee, outletId: assignment.outletId, shift: assignment.shift, status: 'not_due', detail: 'Belum waktunya masuk.' };
    return { employee, outletId: assignment.outletId, shift: assignment.shift, status: 'needs_confirmation', detail: 'Belum ada clock in setelah waktu masuk yang berlaku.' };
  });
}
function signal(state: AppState, input: SpvFollowupInput, title: string, detail: string, tone: OperationalSignal['tone']): OperationalSignal {
  const key = followupCaseKey(input);
  const href = input.issueType === 'correction_pending' && input.sourceId
    ? `/reports?tab=corrections&request=${encodeURIComponent(input.sourceId)}`
    : `/assignments?date=${encodeURIComponent(input.workDate)}`;
  return { key, input, title, detail, href, tone };
}

export function operationalSignals(state: AppState, day: string, now = Date.now()): OperationalSignal[] {
  const today = jakartaDate(new Date(now).toISOString());
  const activeCashiers = state.employees.filter(employee => employee.status === 'active' && cashier(state, employee));
  const assignments = (state.cashierAssignments ?? []).filter(row => row.workDate === day && row.status === 'active');
  const records = state.attendanceRecords.filter(record => workDateFor(record) === day);
  const result: OperationalSignal[] = [];
  for (const employee of activeCashiers) {
    const assignment = assignments.find(row => row.employeeId === employee.id);
    if (!assignment) {
      if (records.some(record => record.employeeId === employee.id)) continue;
      if (fullDayApproved(state, employee.id, day)) continue;
      const weekday = dateAt(day).getUTCDay();
      if (day <= today && !employee.weeklyOffDays.includes(weekday)) {
        result.push(signal(state, { issueType: 'unassigned', sourceType: 'roster', sourceId: null, workDate: day,
          outletId: employee.outletId, employeeId: employee.id, shift: null }, 'Belum ditugaskan', 'Hari kerja belum memiliki jadwal kasir.', 'amber'));
      }
      continue;
    }
    if (assignment.shift === 'off') continue;
    const attendance = records.find(record => record.employeeId === employee.id);
    const fullLeave = fullDayApproved(state, employee.id, day);
    if (fullLeave) {
      result.push(signal(state, { issueType: 'leave_conflict', sourceType: 'assignment', sourceId: assignment.id, workDate: day,
        outletId: assignment.outletId, employeeId: employee.id, shift: assignment.shift }, 'Jadwal berbenturan dengan cuti', 'Cuti sehari penuh disetujui setelah jadwal tersimpan; periksa penyesuaian jadwal.', 'red'));
    }
    const correction = (state.attendanceCorrectionRequests ?? []).find(row => row.employeeId === employee.id && row.workDate === day && row.status === 'pending');
    if (correction) result.push(signal(state, { issueType: 'correction_pending', sourceType: 'correction', sourceId: correction.id, workDate: day,
      outletId: correction.outletId, employeeId: employee.id, shift: correction.shift }, 'Koreksi kehadiran menunggu', 'Kasir menunggu pemeriksaan catatan kehadiran.', 'amber'));

    if (!attendance) {
      if (fullLeave || assignment.shift === 'middle') continue;
      const dueAt = dueAtFor(state, employee.id, assignment);
      if (day < today || (dueAt !== null && now >= dueAt)) {
        result.push(signal(state, { issueType: 'missing_clockin', sourceType: 'assignment', sourceId: assignment.id, workDate: day,
          outletId: assignment.outletId, employeeId: employee.id, shift: assignment.shift }, 'Perlu konfirmasi kehadiran', 'Belum ada clock in setelah waktu masuk yang berlaku. Periksa izin dan konfirmasi langsung; sistem tidak memberi status alpa otomatis.', 'red'));
      }
      continue;
    }

    const lateness = classifyAttendanceLateness(attendance, state.leaveRequests);
    if (lateness.unexcusedMinutes > 0) result.push(signal(state, { issueType: 'unexcused_lateness', sourceType: 'attendance', sourceId: attendance.id,
      workDate: day, outletId: attendance.outletId, employeeId: employee.id, shift: attendance.shift }, 'Keterlambatan perlu ditinjau', `Tercatat ${lateness.unexcusedMinutes} menit di luar izin yang disetujui.`, 'amber'));
    if (!attendance.clockOut && ['due', 'stale'].includes(attendanceSessionStatus(attendance, now))) {
      const stale = attendanceSessionStatus(attendance, now) === 'stale';
      result.push(signal(state, { issueType: 'open_session', sourceType: 'attendance', sourceId: attendance.id, workDate: day,
        outletId: attendance.outletId, employeeId: employee.id, shift: attendance.shift }, stale ? 'Sesi terbuka perlu diperiksa' : 'Perlu konfirmasi clock out',
        stale ? 'Sesi terbuka sudah mencapai 12 jam; konfirmasikan waktu pulang sebenarnya.' : 'Durasi kerja mencapai 8 jam. Konfirmasikan apakah kasir sudah pulang.', stale ? 'red' : 'amber'));
    }
    if (attendance.clockOut) {
      const review = attendanceDurationReview(attendance, state.leaveRequests);
      if (review.unexplainedMinutes > 0) result.push(signal(state, { issueType: 'short_duration', sourceType: 'attendance', sourceId: attendance.id,
        workDate: day, outletId: attendance.outletId, employeeId: employee.id, shift: attendance.shift }, 'Durasi perlu dikonfirmasi',
        `Terdapat selisih ${review.unexplainedMinutes} menit dari 8 jam yang belum dijelaskan izin.`, 'amber'));
    }
  }
  return result;
}

export interface WeeklyCopyPreview { changes: CashierRosterChange[]; skipped: number; conflicts: string[]; sourceWeek: string; targetWeek: string }
export function previewPreviousWeekCopy(state: AppState, targetMonday: string): WeeklyCopyPreview {
  const sourceWeek = addWorkDays(targetMonday, -7), sourceEnd = addWorkDays(sourceWeek, 6);
  const source = (state.cashierAssignments ?? []).filter(row => row.status === 'active' && row.workDate >= sourceWeek && row.workDate <= sourceEnd);
  const targets = state.cashierAssignments ?? [];
  const changes: CashierRosterChange[] = [], conflicts: string[] = [];
  let skipped = 0;
  for (const row of source) {
    const workDate = addWorkDays(targetMonday, dateAt(row.workDate).getUTCDay() === 0 ? 6 : dateAt(row.workDate).getUTCDay() - 1);
    const existing = targets.find(target => target.employeeId === row.employeeId && target.workDate === workDate);
    if (existing) { skipped++; continue; }
    const employee = state.employees.find(item => item.id === row.employeeId);
    const outlet = state.outlets.find(item => item.id === row.outletId && item.active);
    if (!employee || employee.status !== 'active' || employee.id === state.user?.id || !cashier(state, employee) || !outlet || workDate < employee.joinDate
      || state.attendanceRecords.some(record => record.employeeId === row.employeeId && workDateFor(record) === workDate)
      || (row.shift !== 'off' && fullDayApproved(state,row.employeeId,workDate))
      || (row.shift === 'middle' && !employee.canMiddleShift) || workDate < jakartaDate()) {
      conflicts.push(`${employee?.fullName ?? 'Kasir'} · ${workDate}: data tidak lagi memenuhi syarat penugasan.`); continue;
    }
    changes.push({ employeeId: row.employeeId, workDate, outletId: row.outletId, shift: row.shift,
      reason: `Salin jadwal minggu ${sourceWeek}`, expectedUpdatedAt: null });
  }
  return { changes, skipped, conflicts, sourceWeek, targetWeek: targetMonday };
}

export function validateRosterBatch(state: AppState, actorId: string, weekStart: string, changes: CashierRosterChange[]) {
  if (dateAt(weekStart).getUTCDay() !== 1 || changes.length < 1 || changes.length > 500) throw new Error('Pilih minggu Senin–Minggu dan perubahan jadwal yang valid.');
  const keys = new Set<string>();
  const today = jakartaDate();
  for (const change of changes) {
    const employee = state.employees.find(item => item.id === change.employeeId);
    const outlet = state.outlets.find(item => item.id === change.outletId && item.active);
    if (change.workDate < weekStart || change.workDate > addWorkDays(weekStart, 6) || change.workDate < today) throw new Error('Jadwal mingguan hanya dapat mengubah tanggal hari ini atau mendatang pada minggu yang dipilih.');
    if (!employee || employee.status !== 'active' || !cashier(state, employee)) throw new Error('Setiap perubahan harus memilih kasir aktif.');
    if (employee.id === actorId) throw new Error('Penugasan sendiri harus diatur Admin HR lain.');
    if (!outlet) throw new Error('Pilih outlet aktif untuk setiap perubahan jadwal.');
    if (change.workDate < employee.joinDate) throw new Error(`${employee.fullName} belum mulai bekerja pada tanggal tersebut.`);
    if (!['morning', 'afternoon', 'middle', 'off'].includes(change.shift) || (!change.cancel && change.shift === 'middle' && !employee.canMiddleShift)) throw new Error(`Shift ${employee.fullName} tidak diizinkan.`);
    if (change.reason.trim().length < 5 || change.reason.length > 2000) throw new Error('Alasan setiap perubahan minimal 5 karakter.');
    const key = `${change.employeeId}:${change.workDate}`;
    if (keys.has(key)) throw new Error('Kasir yang sama tidak boleh memiliki dua perubahan pada tanggal yang sama.');
    keys.add(key);
    const existing = (state.cashierAssignments ?? []).find(row => row.employeeId === change.employeeId && row.workDate === change.workDate);
    if (existing?.id !== change.id || (existing?.updatedAt ?? null) !== (change.expectedUpdatedAt ?? null)) throw new Error('Jadwal berubah sejak pratinjau. Muat ulang sebelum menyimpan.');
    if (change.cancel && (!existing || existing.status !== 'active')) throw new Error('Penugasan aktif yang akan dibatalkan tidak ditemukan.');
    if (state.attendanceRecords.some(record => record.employeeId === change.employeeId && workDateFor(record) === change.workDate)) throw new Error('Jadwal yang sudah memiliki absensi tidak dapat diubah.');
    if (!change.cancel && change.shift !== 'off' && fullDayApproved(state, change.employeeId, change.workDate)) throw new Error('Penugasan kerja berbenturan dengan cuti penuh yang sudah disetujui.');
  }
}
