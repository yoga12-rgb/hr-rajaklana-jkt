import type { Outlet, Shift } from './types';

export function jakartaDate(value: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function eligibilityDate(joinDate: string): string {
  const [year, month, day] = joinDate.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + 3, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}
export function leaveEntitlement(joinDate: string, year: number, asOf = jakartaDate()): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) return 0;
  const eligible = eligibilityDate(joinDate);
  const eligibleYear = Number(eligible.slice(0, 4));
  if (asOf < eligible || year < eligibleYear) return 0;
  return year === eligibleYear ? 13 - Number(eligible.slice(5, 7)) : 12;
}
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function attendanceTiming(clockIn: string, shift: Shift, outlet: Outlet): { scheduledStart: string | null; lateMinutes: number } {
  if (shift === 'middle') return { scheduledStart: null, lateMinutes: 0 };
  const time = shift === 'morning' ? outlet.morningStart : outlet.afternoonStart;
  const scheduledStart = new Date(`${jakartaDate(clockIn)}T${time}:00+07:00`).toISOString();
  const delta = (new Date(clockIn).getTime() - new Date(scheduledStart).getTime()) / 60000;
  return { scheduledStart, lateMinutes: delta > outlet.lateToleranceMinutes ? Math.max(0, Math.ceil(delta)) : 0 };
}
export function dateRange(start: string, end: string): string[] {
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(+a) || Number.isNaN(+b) || a > b || +b - +a > 366 * 86400000) throw new Error('Rentang tanggal tidak valid atau melebihi satu tahun.');
  const result: string[] = [];
  for (; a <= b; a.setUTCDate(a.getUTCDate() + 1)) result.push(a.toISOString().slice(0, 10));
  return result;
}
export function deductionByYear(start: string, end: string, total: number): Record<number, number> {
  if (!Number.isFinite(total) || total < 0) throw new Error('Potongan cuti harus berupa angka nol atau positif.');
  const dates = dateRange(start, end), result: Record<number, number> = {};
  // Allocate a dynamic deduction proportionally across dates; rounding residue belongs to last year.
  const years = [...new Set(dates.map(d => Number(d.slice(0, 4))))];
  let allocated = 0;
  years.forEach((year, index) => {
    const days = index === years.length - 1 ? total - allocated : Math.round(total * dates.filter(d => Number(d.slice(0, 4)) === year).length / dates.length * 100) / 100;
    result[year] = Math.round(days * 100) / 100; allocated += days;
  });
  return result;
}
export function formatDate(value: string, withTime = false): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value);
  if (Number.isNaN(+parsed)) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(parsed);
}
export function formatTime(value: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
