import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app, canDecideLeave, leaveBalance } from './state/app';
import { initialDemo } from './state/demo';
import type { LeaveInput } from './types';

vi.mock('./state/client', () => ({ configured: false, supabase: null }));

const employeeId = 'employee-4';
const actAs = (id: string) => app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === id)! }));
const request = () => get(app).leaveRequests[0];
const annual = (overrides: Partial<LeaveInput> = {}): LeaveInput => ({
  type: 'annual', extent: 'full_day', startDate: '2026-10-08', endDate: '2026-10-09', reason: 'Kebutuhan keluarga', ...overrides
});
const approve = (deductionDays: number) => actions.decideLeave(request().id, { decision: 'approve', deductionDays });
const submitApproved = async (days = 2) => {
  await actions.submitLeave(annual());
  actAs('employee-1');
  await approve(days);
  actAs(employeeId);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T03:00:00Z'));
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
  const state = initialDemo();
  state.initialized = true;
  state.leaveRequests = [];
  state.user = state.employees.find(employee => employee.id === employeeId)!;
  app.set(state);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Pengajuan dan keputusan cuti demo lokal', () => {
  it('mengubah saldo setelah keputusan, mempertahankan tanggal lama selama perubahan, dan mengembalikan potongan sekali', async () => {
    await actions.submitLeave(annual());
    expect(leaveBalance(employeeId)).toBe(12);
    actAs('employee-1');
    await approve(3);
    expect(leaveBalance(employeeId)).toBe(9);

    actAs(employeeId);
    await actions.changeLeave(request().id, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Jadwal keluarga berubah' });
    expect(request().startDate).toBe('2026-10-08');
    expect(leaveBalance(employeeId)).toBe(9);
    actAs('employee-1');
    await actions.decideAdjustment(request().id, { decision: 'approve', deductionDays: 2 });
    expect(request().startDate).toBe('2026-10-12');
    expect(leaveBalance(employeeId)).toBe(10);
    expect(request().adjustment).toMatchObject({ status: 'approved', deciderName: 'Alya Pratama', decidedAt: expect.any(String) });

    actAs(employeeId);
    await actions.cancelLeave(request().id, 'Rencana dibatalkan');
    expect(request().status).toBe('approved');
    expect(leaveBalance(employeeId)).toBe(10);
    actAs('employee-1');
    await actions.decideAdjustment(request().id, { decision: 'approve', deductionDays: 0 });
    expect(request().status).toBe('cancelled');
    expect(leaveBalance(employeeId)).toBe(12);
    expect(request().adjustment).toMatchObject({ type: 'cancel', status: 'approved', deciderName: 'Alya Pratama' });
    await expect(actions.decideAdjustment(request().id, { decision: 'approve', deductionDays: 0 })).rejects.toThrow();
    expect(leaveBalance(employeeId)).toBe(12);
  });

  it('memerlukan alasan penolakan perubahan dan mempertahankan pengajuan serta saldo sebelumnya', async () => {
    await submitApproved();
    await actions.changeLeave(request().id, { startDate: '2026-10-14', endDate: '2026-10-15', reason: 'Kebutuhan tanggal baru' });
    actAs('employee-1');
    const before = get(app);
    await expect(actions.decideAdjustment(request().id, { decision: 'reject', deductionDays: 0, note: '  ' })).rejects.toThrow();
    expect(get(app)).toBe(before);
    await expect(actions.decideAdjustment(request().id, { decision: 'reject', deductionDays: 0, note: 'x' })).rejects.toThrow();
    await actions.decideAdjustment(request().id, { decision: 'reject', deductionDays: 0, note: 'Outlet membutuhkan tim' });
    expect(request()).toMatchObject({ status: 'approved', startDate: '2026-10-08', deductionDays: 2 });
    expect(leaveBalance(employeeId)).toBe(10);
    expect(request().adjustment).toMatchObject({ status: 'rejected', note: 'Outlet membutuhkan tim', deciderName: 'Alya Pratama', decidedAt: expect.any(String) });
    expect(request().note).toBe('');
    actAs(employeeId);
    await actions.changeLeave(request().id, { startDate: '2026-10-16', endDate: '2026-10-17', reason: 'Mengajukan alternatif tanggal' });
    expect(request().adjustment).toMatchObject({ status: 'pending', startDate: '2026-10-16' });
    expect(leaveBalance(employeeId)).toBe(10);
  });

  it('mengirim kembali pengajuan yang perlu dilengkapi tanpa mengurangi saldo', async () => {
    await actions.submitLeave(annual());
    actAs('employee-1');
    await actions.decideLeave(request().id, { decision: 'needs_info', deductionDays: 0, note: 'Jelaskan keperluan tanggal tersebut' });
    actAs(employeeId);
    await actions.changeLeave(request().id, { startDate: '2026-10-08', endDate: '2026-10-09', reason: 'Mendampingi orang tua mengurus dokumen' });
    expect(request()).toMatchObject({ status: 'pending', reason: 'Mendampingi orang tua mengurus dokumen', adjustment: null });
    expect(leaveBalance(employeeId)).toBe(12);
  });

  it('mencegah persetujuan sendiri, atasan yang tidak berwenang, dan pengguna nonaktif', async () => {
    await actions.submitLeave(annual());
    expect(canDecideLeave(request())).toBe(false);
    await expect(approve(1)).rejects.toThrow();
    actAs('employee-3');
    await expect(approve(1)).rejects.toThrow();
    actAs('employee-1');
    app.update(state => ({ ...state, user: { ...state.user!, status: 'inactive' } }));
    expect(canDecideLeave(request())).toBe(false);
    await expect(approve(1)).rejects.toThrow();
    expect(request().status).toBe('pending');
  });

  it('menolak saldo tidak cukup tanpa mengubah ledger dan mencegah keputusan berulang', async () => {
    await actions.submitLeave(annual());
    actAs('employee-1');
    const before = get(app);
    await expect(approve(13)).rejects.toThrow();
    expect(get(app)).toBe(before);
    expect(request().status).toBe('pending');
    expect(leaveBalance(employeeId)).toBe(12);
    await approve(12);
    await expect(approve(12)).rejects.toThrow();
    expect(leaveBalance(employeeId)).toBe(0);
  });

  it('mempertahankan potongan lama ketika perubahan yang disetujui akan melebihi saldo', async () => {
    await submitApproved(3);
    await actions.changeLeave(request().id, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Rencana baru' });
    actAs('employee-1');
    const before = get(app);
    await expect(actions.decideAdjustment(request().id, { decision: 'approve', deductionDays: 13 })).rejects.toThrow();
    expect(get(app)).toBe(before);
    expect(request()).toMatchObject({ startDate: '2026-10-08', deductionDays: 3, adjustment: { status: 'pending' } });
    expect(leaveBalance(employeeId)).toBe(9);
  });

  it('memerlukan nama pemberi keputusan eksternal tanpa memberikan persetujuan kepada pemohon', async () => {
    actAs('employee-1');
    await actions.submitLeave(annual());
    await expect(actions.decideLeave(request().id, { decision: 'approve', deductionDays: 0, externalApproverName: 'Manager Jogja' })).rejects.toThrow();
    actAs('employee-2');
    await expect(actions.decideLeave(request().id, { decision: 'approve', deductionDays: 0, externalApproverName: 'x' })).rejects.toThrow();
    await actions.decideLeave(request().id, { decision: 'approve', deductionDays: 0, externalApproverName: 'Manager Jogja' });
    expect(request()).toMatchObject({ status: 'approved', deductionDays: 0, externalApproverName: 'Manager Jogja' });
  });

  it('memberi hak prorata setelah tiga bulan kalender dan menolak cuti tahunan sebelum waktunya', async () => {
    app.update(state => ({ ...state, employees: state.employees.map(employee => employee.id === employeeId ? { ...employee, joinDate: '2026-07-15' } : employee) }));
    actAs(employeeId);
    vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
    expect(leaveBalance(employeeId)).toBe(0);
    await expect(actions.submitLeave(annual({ startDate: '2026-10-16', endDate: '2026-10-16' }))).rejects.toThrow();
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
    expect(leaveBalance(employeeId)).toBe(3);
    await actions.submitLeave(annual({ startDate: '2026-10-16', endDate: '2026-10-16' }));
    expect(request().status).toBe('pending');
  });

  it('memisahkan saldo lintas tahun dan tidak membawa pengembalian tahun hangus ke tahun baru', async () => {
    vi.setSystemTime(new Date('2026-12-30T03:00:00Z'));
    await actions.submitLeave(annual({ startDate: '2026-12-31', endDate: '2027-01-01' }));
    actAs('employee-1');
    await approve(2);
    expect(leaveBalance(employeeId, 2026)).toBe(11);
    expect(leaveBalance(employeeId, 2027)).toBe(11);
    actAs(employeeId);
    await actions.cancelLeave(request().id, 'Rencana akhir tahun dibatalkan');
    vi.setSystemTime(new Date('2027-01-01T03:00:00Z'));
    actAs('employee-1');
    await actions.decideAdjustment(request().id, { decision: 'approve', deductionDays: 0 });
    expect(leaveBalance(employeeId, 2026)).toBe(0);
    expect(leaveBalance(employeeId, 2027)).toBe(12);
  });
});

describe('Izin sebagian hari dan batas perubahan demo lokal', () => {
  const personal = (overrides: Partial<LeaveInput> = {}): LeaveInput => ({
    type: 'personal', extent: 'temporary_exit', startDate: '2026-10-08', endDate: '2026-10-08', startTime: '10:00', endTime: '12:00', reason: 'Mengurus dokumen keluarga', ...overrides
  });

  it('mencatat izin beberapa jam, datang terlambat, dan pulang awal tanpa potongan otomatis', async () => {
    for (const input of [personal(), personal({ extent: 'late_arrival', startTime: '08:00', endTime: '' }), personal({ extent: 'early_departure', startTime: '14:00', endTime: '' })]) {
      await actions.submitLeave(input);
      actAs('employee-1');
      await approve(0);
      expect(request()).toMatchObject({ status: 'approved', extent: input.extent, startTime: input.startTime, deductionDays: 0 });
      actAs(employeeId);
    }
    expect(leaveBalance(employeeId)).toBe(12);
  });

  it('menolak izin jam tanpa waktu yang diperlukan atau dengan rentang beberapa hari', async () => {
    for (const input of [personal({ startTime: '' }), personal({ endTime: '' }), personal({ endTime: '09:00' }), personal({ endDate: '2026-10-09' }), personal({ extent: 'early_departure', startTime: '', endTime: '' })]) {
      await expect(actions.submitLeave(input)).rejects.toThrow();
    }
    expect(get(app).leaveRequests).toHaveLength(0);
    expect(leaveBalance(employeeId)).toBe(12);
  });

  it('mencegah perubahan izin beberapa jam menjadi rentang beberapa hari', async () => {
    await actions.submitLeave(personal());
    const before = get(app);
    await expect(actions.changeLeave(request().id, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Mengganti tanggal izin' })).rejects.toThrow();
    expect(get(app)).toBe(before);
    await actions.changeLeave(request().id, { startDate: '2026-10-12', endDate: '2026-10-12', reason: 'Mengganti tanggal izin' });
    expect(request()).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-12', startTime: '10:00', endTime: '12:00' });
  });

  it('menolak pembatalan cuti disetujui yang sudah dijalani dan tetap mengizinkan pembatalan pengajuan pending', async () => {
    await submitApproved();
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    const before = get(app);
    await expect(actions.cancelLeave(request().id, 'Cuti sudah berlangsung')).rejects.toThrow();
    expect(get(app)).toBe(before);
    expect(leaveBalance(employeeId)).toBe(10);

    vi.setSystemTime(new Date('2026-10-06T03:00:00Z'));
    await actions.submitLeave(annual());
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    await actions.cancelLeave(request().id, 'Pengajuan belum disetujui');
    expect(request().status).toBe('cancelled');
    expect(leaveBalance(employeeId)).toBe(10);
  });
});
