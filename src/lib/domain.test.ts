import { describe, expect, it } from 'vitest';
import { attendanceTiming, deductionByYear, eligibilityDate, haversineMeters, leaveEntitlement } from './domain';
import type { Outlet } from './types';
describe('Hak cuti tahun kalender', () => {
  it('menghitung bulan mulai hak secara penuh setelah 3 bulan', () => {
    expect(leaveEntitlement('2026-07-15', 2026, '2026-10-14')).toBe(0);
    expect(leaveEntitlement('2026-07-15', 2026, '2026-10-15')).toBe(3);
    expect(leaveEntitlement('2026-07-15', 2027, '2027-01-01')).toBe(12);
  });
  it('menangani tanggal akhir bulan dan tahun kabisat', () => {
    expect(eligibilityDate('2026-01-31')).toBe('2026-04-30');
    expect(eligibilityDate('2023-11-30')).toBe('2024-02-29');
  });
  it('memisahkan potongan lintas tahun tanpa menggeser saldo lama', () => {
    expect(deductionByYear('2026-12-31', '2027-01-01', 1)).toEqual({ 2026: 0.5, 2027: 0.5 });
    expect(() => deductionByYear('2026-01-01', '2026-01-02', -1)).toThrow();
  });
});
describe('Absensi kasir', () => {
  const outlet = { morningStart: '07:00', afternoonStart: '15:00', lateToleranceMinutes: 5 } as Outlet;
  it('membandingkan waktu di zona Jakarta dan menerapkan toleransi', () => {
    expect(attendanceTiming('2026-10-03T00:05:00Z', 'morning', outlet).lateMinutes).toBe(0);
    expect(attendanceTiming('2026-10-03T00:12:00Z', 'morning', outlet).lateMinutes).toBe(12);
    expect(attendanceTiming('2026-10-03T08:10:00Z', 'afternoon', outlet).lateMinutes).toBe(10);
  });
  it('middle tidak diberi keterlambatan buatan', () => expect(attendanceTiming('2026-10-03T04:30:00Z', 'middle', outlet)).toEqual({ scheduledStart: null, lateMinutes: 0 }));
  it('jarak lokasi masuk/outlet benar', () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBe(0);
    expect(haversineMeters(0, 0, 0, 0.001)).toBeCloseTo(111.195, 1);
  });
});
