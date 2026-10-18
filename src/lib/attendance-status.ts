import type { AttendanceRecord, LeaveRequest } from './types';

export interface AttendanceLateness {
  kind: 'on_time' | 'permitted' | 'unexcused' | 'permit_exceeded' | 'flexible';
  permittedMinutes: number;
  unexcusedMinutes: number;
}

const minute = 60_000;
const jakartaDate = (value: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));

/** Return the latest applicable approved arrival boundary for this work date. */
export function approvedArrivalForAttendance(record: AttendanceRecord, leaves: LeaveRequest[]): { time: string; until: number } | null {
  if (record.shift === 'middle') return null;
  const scheduled = record.scheduledStart ? Date.parse(record.scheduledStart) : NaN;
  const actual = Date.parse(record.clockIn);
  if (!Number.isFinite(scheduled) || !Number.isFinite(actual)) return null;
  const workDate = jakartaDate(record.scheduledStart!);
  let approved: { time: string; until: number } | null = null;
  for (const request of leaves) {
    if (request.employeeId !== record.employeeId || request.status !== 'approved' || request.extent !== 'late_arrival'
      || request.startDate !== workDate || request.endDate !== workDate) continue;
    // A late-arrival request stores the authorized arrival in startTime.
    const arrival = request.startTime || request.endTime;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrival)) continue;
    let until = Date.parse(`${workDate}T${arrival}:00+07:00`);
    // Preserve the work date for an overnight session's arrival after midnight.
    if (until < scheduled && jakartaDate(record.clockIn) > workDate) until += 24 * 60 * minute;
    if (until > scheduled && (!approved || until > approved.until)) approved = { time: arrival, until };
  }
  return approved;
}

/** Classify the recorded lateness without changing actual attendance timestamps. */
export function classifyAttendanceLateness(record: AttendanceRecord, leaves: LeaveRequest[]): AttendanceLateness {
  if (record.shift === 'middle') return { kind: 'flexible', permittedMinutes: 0, unexcusedMinutes: 0 };
  const gross = Math.max(0, record.lateMinutes);
  if (!gross) return { kind: 'on_time', permittedMinutes: 0, unexcusedMinutes: 0 };
  const approved = approvedArrivalForAttendance(record, leaves);
  if (!approved) return { kind: 'unexcused', permittedMinutes: 0, unexcusedMinutes: gross };
  const unexcusedMinutes = Math.min(gross, Math.max(0, Math.ceil((Date.parse(record.clockIn) - approved.until) / minute)));
  return {
    kind: unexcusedMinutes ? 'permit_exceeded' : 'permitted',
    permittedMinutes: gross - unexcusedMinutes,
    unexcusedMinutes
  };
}

export function attendanceLatenessLabel(status: AttendanceLateness): string {
  if (status.kind === 'flexible') return 'Fleksibel';
  if (status.kind === 'on_time') return 'Tepat waktu';
  if (status.kind === 'permitted') return `Berizin ${status.permittedMinutes} mnt`;
  if (status.kind === 'permit_exceeded') return `Lewat izin ${status.unexcusedMinutes} mnt`;
  return `Tanpa izin ${status.unexcusedMinutes} mnt`;
}

/** Review thresholds only; a session is never closed or rewritten automatically. */
export function attendanceSessionStatus(record: AttendanceRecord, now = Date.now()): 'stale' | 'review' | 'due' | 'working' | 'complete' {
  if (record.clockOut) return Date.parse(record.clockOut) - Date.parse(record.clockIn) >= 12 * 60 * minute ? 'review' : 'complete';
  const elapsed = now - Date.parse(record.clockIn);
  if (elapsed >= 12 * 60 * minute) return 'stale';
  if (elapsed >= 8 * 60 * minute) return 'due';
  return 'working';
}

/** Explain the 480-minute comparison without changing recorded work or payroll. */
export function attendanceDurationReview(record: AttendanceRecord, leaves: LeaveRequest[]) {
  const actualMinutes = record.clockOut ? Math.max(0, record.durationMinutes ?? Math.floor((Date.parse(record.clockOut) - Date.parse(record.clockIn)) / minute)) : null;
  const shortfallMinutes = actualMinutes === null ? 0 : Math.max(0, 480 - actualMinutes);
  const start = Date.parse(record.scheduledStart ?? record.clockIn), end = start + 480 * minute;
  const workDate = jakartaDate(record.scheduledStart ?? record.clockIn);
  const permissions = leaves.filter(request => request.employeeId === record.employeeId && request.status === 'approved' && request.startDate === workDate && request.endDate === workDate);
  let permittedEarlyMinutes = 0;
  for (const request of permissions.filter(request => request.extent === 'early_departure')) {
    const time = request.startTime || request.endTime;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !record.clockOut) continue;
    let departure = Date.parse(`${workDate}T${time}:00+07:00`);
    if (departure < start && jakartaDate(new Date(end).toISOString()) > workDate) departure += 24 * 60 * minute;
    if (departure < start || departure >= end) continue;
    permittedEarlyMinutes = Math.max(permittedEarlyMinutes, Math.max(0, Math.floor((end - Math.max(departure, Date.parse(record.clockOut))) / minute)));
  }
  permittedEarlyMinutes = Math.min(shortfallMinutes, permittedEarlyMinutes);
  const permittedLateMinutes = Math.min(Math.max(0, shortfallMinutes - permittedEarlyMinutes), classifyAttendanceLateness(record, leaves).permittedMinutes);
  const permittedMinutes = permittedEarlyMinutes + permittedLateMinutes;
  return { actualMinutes, shortfallMinutes, permittedMinutes, permittedEarlyMinutes, permittedLateMinutes,
    unexplainedMinutes: shortfallMinutes - permittedMinutes,
    temporaryExit: permissions.filter(request => request.extent === 'temporary_exit').map(request => `${request.startTime}–${request.endTime} WIB`) };
}
