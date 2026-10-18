import { describe, expect, it } from 'vitest';
import { approvedArrivalForAttendance, attendanceDurationReview, attendanceSessionStatus, classifyAttendanceLateness } from './attendance-status';
import type { AttendanceRecord, LeaveRequest } from './types';

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 'attendance', employeeId: 'cashier', outletId: 'outlet', shift: 'morning',
  scheduledStart: '2026-10-15T00:00:00Z', clockIn: '2026-10-15T01:30:00Z', clockOut: null,
  lateMinutes: 90, durationMinutes: null, inLatitude: null, inLongitude: null, inAccuracy: null,
  inDistance: null, selfiePath: '', corrected: false, correctionReason: '', ...overrides
});
const permission = (overrides: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'permission', employeeId: 'cashier', type: 'personal', extent: 'late_arrival',
  startDate: '2026-10-15', endDate: '2026-10-15', startTime: '08:00', endTime: '',
  reason: 'Izin datang', status: 'approved', deductionDays: 0, approverId: 'supervisor', note: '',
  externalApproverName: '', createdAt: '2026-10-14T00:00:00Z', adjustment: null, ...overrides
});

describe('Keterlambatan aktual dan batas izin', () => {
  it('memisahkan menit berizin dan menit setelah batas izin', () => {
    expect(classifyAttendanceLateness(record(), [permission()])).toEqual({ kind: 'permit_exceeded', permittedMinutes: 60, unexcusedMinutes: 30 });
  });
  it('mengizinkan kedatangan tepat batas dan menandai satu detik setelahnya', () => {
    expect(approvedArrivalForAttendance(record(), [permission()])).toEqual({ time: '08:00', until: Date.parse('2026-10-15T01:00:00Z') });
    expect(classifyAttendanceLateness(record({ clockIn: '2026-10-15T01:00:00Z', lateMinutes: 60 }), [permission()])).toEqual({ kind: 'permitted', permittedMinutes: 60, unexcusedMinutes: 0 });
    expect(classifyAttendanceLateness(record({ clockIn: '2026-10-15T01:00:01Z', lateMinutes: 61 }), [permission()])).toEqual({ kind: 'permit_exceeded', permittedMinutes: 60, unexcusedMinutes: 1 });
  });
  it('memilih batas izin disetujui paling akhir tanpa bergantung urutan', () => {
    const later = permission({ id: 'later', startTime: '08:45' });
    const afterBoth = record({ clockIn: '2026-10-15T02:00:00Z', lateMinutes: 120 });
    for (const leaves of [[permission(), later], [later, permission()]]) {
      expect(approvedArrivalForAttendance(afterBoth, leaves)).toEqual({ time: '08:45', until: Date.parse('2026-10-15T01:45:00Z') });
      expect(classifyAttendanceLateness(afterBoth, leaves)).toEqual({ kind: 'permit_exceeded', permittedMinutes: 105, unexcusedMinutes: 15 });
    }
  });
  it('mengabaikan izin tanggal lain, karyawan lain dan keputusan yang tidak berlaku', () => {
    for (const overrides of [
      { status: 'pending' as const }, { status: 'rejected' as const }, { status: 'cancelled' as const },
      { startDate: '2026-10-14', endDate: '2026-10-14' }, { employeeId: 'another' },
      { extent: 'temporary_exit' as const }, { startTime: '06:30' }
    ]) expect(classifyAttendanceLateness(record(), [permission(overrides)])).toEqual({ kind: 'unexcused', permittedMinutes: 0, unexcusedMinutes: 90 });
  });
  it('memakai izin asli selama perubahan atau pembatalan masih menunggu', () => {
    const adjustment = { id: 'adjustment', type: 'cancel' as const, reason: 'Batal', status: 'pending' as const, requestedAt: '2026-10-15T00:00:00Z' };
    expect(classifyAttendanceLateness(record(), [permission({ adjustment })]).permittedMinutes).toBe(60);
  });
  it('Middle fleksibel dan tepat waktu tidak mendapat keterlambatan buatan', () => {
    expect(classifyAttendanceLateness(record({ shift: 'middle' }), [permission()])).toEqual({ kind: 'flexible', permittedMinutes: 0, unexcusedMinutes: 0 });
    expect(classifyAttendanceLateness(record({ lateMinutes: 0 }), [permission()])).toEqual({ kind: 'on_time', permittedMinutes: 0, unexcusedMinutes: 0 });
  });
  it('mengikuti tanggal jadwal untuk izin datang sesudah tengah malam', () => {
    const overnight = record({ scheduledStart: '2026-10-15T16:00:00Z', clockIn: '2026-10-15T17:45:00Z', lateMinutes: 105 });
    expect(approvedArrivalForAttendance(overnight, [permission({ startTime: '00:30' })])).toEqual({ time: '00:30', until: Date.parse('2026-10-15T17:30:00Z') });
    expect(classifyAttendanceLateness(overnight, [permission({ startTime: '00:30' })])).toEqual({ kind: 'permit_exceeded', permittedMinutes: 90, unexcusedMinutes: 15 });
  });
});

describe('Pengingat sesi kerja tanpa clock out otomatis', () => {
  const open = record({ clockIn: '2026-10-15T15:00:00Z' }); // 22:00 WIB, target hari berikutnya.
  it('berubah tepat pada delapan dan dua belas jam lintas tanggal', () => {
    expect(attendanceSessionStatus(open, Date.parse('2026-10-15T22:59:59Z'))).toBe('working');
    expect(attendanceSessionStatus(open, Date.parse('2026-10-15T23:00:00Z'))).toBe('due');
    expect(attendanceSessionStatus(open, Date.parse('2026-10-16T02:59:59Z'))).toBe('due');
    expect(attendanceSessionStatus(open, Date.parse('2026-10-16T03:00:00Z'))).toBe('stale');
    expect(open.clockOut).toBeNull();
  });
  it('sesi yang sudah selesai tetap selesai setelah dua belas jam', () => {
    expect(attendanceSessionStatus({ ...open, clockOut: '2026-10-15T23:00:00Z' }, Date.parse('2026-10-17T00:00:00Z'))).toBe('complete');
  });
});


describe('Durasi aktual dan bagian yang diizinkan', () => {
  it('menandai sesi panjang meskipun sudah ditutup', () => {
    expect(attendanceSessionStatus(record({ clockIn: '2026-10-15T00:00:00Z', clockOut: '2026-10-15T12:00:00Z' }))).toBe('review');
  });
  it('memisahkan pulang berizin dan pulang sebelum batas izin', () => {
    const attendance = record({ clockIn: '2026-10-15T00:00:00Z', clockOut: '2026-10-15T06:00:00Z', durationMinutes: 360, lateMinutes: 0 });
    const review = attendanceDurationReview(attendance, [permission({ extent: 'early_departure', startTime: '14:00' })]);
    expect(review.actualMinutes).toBe(360); expect(review.shortfallMinutes).toBe(120);
    expect(review.permittedEarlyMinutes).toBe(60); expect(review.unexplainedMinutes).toBe(60);
  });
  it('hanya memakai izin yang disetujui dan tidak menganggap jam kembali sudah dilacak', () => {
    const attendance = record({ clockIn: '2026-10-15T00:00:00Z', clockOut: '2026-10-15T07:00:00Z', durationMinutes: 420, lateMinutes: 0 });
    const review = attendanceDurationReview(attendance, [permission({ extent: 'early_departure', startTime: '14:00', status: 'pending' }), permission({ extent: 'temporary_exit', startTime: '12:00', endTime: '13:00' })]);
    expect(review.permittedMinutes).toBe(0); expect(review.unexplainedMinutes).toBe(60);
    expect(review.temporaryExit).toEqual(['12:00–13:00 WIB']);
  });
  it('menangani izin pulang untuk shift lintas tengah malam', () => {
    const attendance = record({ shift: 'middle', scheduledStart: null, clockIn: '2026-10-15T15:00:00Z', clockOut: '2026-10-15T22:00:00Z', durationMinutes: 420, lateMinutes: 0 });
    const review = attendanceDurationReview(attendance, [permission({ extent: 'early_departure', startTime: '05:00' })]);
    expect(review.permittedEarlyMinutes).toBe(60); expect(review.unexplainedMinutes).toBe(0);
  });
});
