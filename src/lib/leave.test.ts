import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app, canDecideLeave, leaveBalance, leaveConflicts } from './state/app';
import { initialDemo } from './state/demo';
import type { LeaveInput } from './types';

const liveBackend = vi.hoisted(() => ({ configured: false, supabase: null as Record<string, unknown> | null }));
vi.mock('./state/client', () => ({ get configured() { return liveBackend.configured; }, get supabase() { return liveBackend.supabase; } }));

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
  liveBackend.configured = false;
  liveBackend.supabase = null;
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
    await actions.submitLeave(annual({ startDate: '2026-10-07', endDate: '2026-10-07' }));
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    await actions.cancelLeave(request().id, 'Pengajuan belum disetujui');
    expect(request().status).toBe('cancelled');
    expect(leaveBalance(employeeId)).toBe(10);
  });
});

describe('Perbaikan alur cuti dan notifikasi', () => {
  it('memeriksa ulang duplikat ketika pengajuan lain dibuat setelah usulan perubahan', async () => {
    await submitApproved();
    const originalId = request().id;
    await actions.changeLeave(originalId, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Memindahkan tanggal cuti' });
    await actions.submitLeave(annual({ startDate: '2026-10-12', endDate: '2026-10-13' }));
    actAs('employee-1');
    const before = get(app);
    await expect(actions.decideAdjustment(originalId, { decision: 'approve', deductionDays: 1 })).rejects.toThrow('sama');
    expect(get(app)).toBe(before);
    expect(get(app).leaveRequests.find(r => r.id === originalId)).toMatchObject({ startDate: '2026-10-08', deductionDays: 2, adjustment: { status: 'pending' } });
    expect(leaveBalance(employeeId)).toBe(10);
    await actions.decideAdjustment(originalId, { decision: 'reject', deductionDays: 0, note: 'Jadwal sama dengan pengajuan baru' });
    expect(get(app).leaveRequests.find(r => r.id === originalId)?.adjustment?.status).toBe('rejected');
  });

  it('mempertahankan ledger koreksi ketika perubahan berikutnya disetujui lalu dibatalkan', async () => {
    await submitApproved(3);
    const leaveId = request().id, charge = structuredClone(get(app).leaveLedger[0]);
    actAs('employee-1');
    await actions.correctLeave(leaveId, { startDate: '2026-10-08', endDate: '2026-10-09', deductionDays: 2, reason: 'Memperbaiki potongan awal', cancel: false });
    const correctionEntries = structuredClone(get(app).leaveLedger);
    expect(correctionEntries.map(e => e.days)).toEqual([3,-1]);
    actAs(employeeId);
    await actions.changeLeave(leaveId, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Mengganti jadwal setelah koreksi' });
    actAs('employee-1');
    await actions.decideAdjustment(leaveId, { decision: 'approve', deductionDays: 1 });
    expect(get(app).leaveLedger.slice(0,2)).toEqual(correctionEntries);
    expect(get(app).leaveLedger.map(e => e.days)).toEqual([3,-1,-1]);
    expect(leaveBalance(employeeId)).toBe(11);
    actAs(employeeId);
    await actions.cancelLeave(leaveId, 'Cuti akhirnya tidak dijalani');
    actAs('employee-1');
    await actions.decideAdjustment(leaveId, { decision: 'approve', deductionDays: 0 });
    expect(get(app).leaveLedger[0]).toEqual(charge);
    expect(get(app).leaveLedger.map(e => e.days)).toEqual([3,-1,-1,-1]);
    expect(leaveBalance(employeeId)).toBe(12);
    const settled = get(app);
    await expect(actions.decideAdjustment(leaveId, { decision: 'approve', deductionDays: 0 })).rejects.toThrow();
    expect(get(app)).toBe(settled);
  });

  it('menyimpan pengembalian lintas tahun sebagai entri per tahun tanpa menghapus biaya asli', async () => {
    vi.setSystemTime(new Date('2026-12-30T03:00:00Z'));
    await actions.submitLeave(annual({ startDate: '2026-12-31', endDate: '2027-01-01' }));
    const leaveId = request().id;
    actAs('employee-1'); await approve(2);
    const originalCharges = structuredClone(get(app).leaveLedger);
    actAs(employeeId); await actions.cancelLeave(leaveId, 'Jadwal akhir tahun dibatalkan');
    vi.setSystemTime(new Date('2027-01-01T03:00:00Z'));
    actAs('employee-1'); await actions.decideAdjustment(leaveId, { decision: 'approve', deductionDays: 0 });
    expect(get(app).leaveLedger.slice(0,2)).toEqual(originalCharges);
    expect(get(app).leaveLedger.filter(e => e.year === 2026).map(e => e.days)).toEqual([1,-1]);
    expect(get(app).leaveLedger.filter(e => e.year === 2027).map(e => e.days)).toEqual([1,-1]);
    expect(leaveBalance(employeeId,2026)).toBe(0);
    expect(leaveBalance(employeeId,2027)).toBe(12);
  });

  it('menolak tindakan akun nonaktif walaupun status karyawan masih aktif', async () => {
    await actions.submitLeave(annual());
    const leaveId = request().id;
    app.update(state => ({ ...state, user: { ...state.user!, accountStatus:'disabled' }, employees: state.employees.map(e => e.id === employeeId ? { ...e,accountStatus:'disabled' } : e) }));
    const disabled = get(app);
    await expect(actions.changeLeave(leaveId, { startDate:'2026-10-12',endDate:'2026-10-13',reason:'Tidak boleh diubah akun nonaktif' })).rejects.toThrow('aktif');
    await expect(actions.readNotification()).rejects.toThrow('aktif');
    await expect(actions.submitLeave(annual({ startDate:'2026-10-14',endDate:'2026-10-15' }))).rejects.toThrow('aktif');
    await expect(actions.switchDemoUser(employeeId)).rejects.toThrow('aktif');
    expect(get(app)).toBe(disabled);
    actAs('employee-1');
    app.update(state => ({ ...state,user:{ ...state.user!,accountStatus:'disabled' } }));
    expect(canDecideLeave(request())).toBe(false);
    await expect(actions.decideLeave(leaveId, { decision:'approve',deductionDays:1 })).rejects.toThrow();
    await expect(actions.correctLeave(leaveId, { startDate:request().startDate,endDate:request().endDate,deductionDays:0,reason:'Koreksi akun HR nonaktif',cancel:true })).rejects.toThrow('aktif');
    expect(request().status).toBe('pending');
  });

  it('mempertahankan unggahan jika hasil RPC edit ambigu dan hanya membersihkan penolakan PostgreSQL', async () => {
    await actions.submitLeave(annual());
    const remove = vi.fn().mockResolvedValue({ data:[],error:null }), upload = vi.fn().mockResolvedValue({ data:{ path:'uploaded' },error:null });
    const rejectedRpc = vi.fn().mockResolvedValue({ data:null,error:{ message:'Koneksi terputus saat menunggu hasil',code:'' } });
    liveBackend.supabase = { auth:{ getSession:vi.fn().mockResolvedValue({ data:{ session:{ user:{ id:'auth-owner' } } } }) },storage:{ from:vi.fn(() => ({ upload,remove })) },rpc:rejectedRpc };
    liveBackend.configured = true;
    const edit = { startDate:request().startDate,endDate:request().endDate,reason:'Mengganti bukti dengan unggahan',attachment:new File(['bukti'],'bukti.pdf',{ type:'application/pdf' }) };
    await expect(actions.changeLeave(request().id,edit)).rejects.toThrow('Koneksi terputus');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    rejectedRpc.mockResolvedValue({ data:null,error:{ message:'Lampiran tidak dimiliki',code:'P0001' } });
    await expect(actions.changeLeave(request().id,edit)).rejects.toThrow('Lampiran tidak dimiliki');
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRejectedValue(new Error('Pembersihan gagal sementara'));
    await expect(actions.changeLeave(request().id,edit)).rejects.toThrow('Lampiran tidak dimiliki');
  });

  it('menolak duplikat persis tetapi mengizinkan tanggal beririsan untuk ditinjau atasan', async () => {
    await actions.submitLeave(annual());
    const before = get(app);
    await expect(actions.submitLeave(annual({ reason: 'Alasan lain, tanggal sama' }))).rejects.toThrow('sama');
    expect(get(app)).toBe(before);
    await actions.submitLeave(annual({ endDate: '2026-10-10' }));
    expect(get(app).leaveRequests).toHaveLength(2);
    expect(leaveConflicts(employeeId, '2026-10-08', '2026-10-10', request().id)).toHaveLength(1);
  });

  it('melengkapi jam dan bukti setelah needs_info, menghapus keputusan lama, lalu dapat menghapus lampiran', async () => {
    await actions.submitLeave(annual({ type: 'personal', extent: 'late_arrival', endDate: '2026-10-08', startTime: '08:00' }));
    actAs('employee-1');
    await actions.decideLeave(request().id, { decision: 'needs_info', deductionDays: 0, note: 'Lengkapi bukti dan jam izin' });
    actAs(employeeId);
    await actions.changeLeave(request().id, { startDate: request().startDate, endDate: request().endDate, startTime: '09:00', endTime: '', reason: 'Melengkapi bukti izin', attachment: new File(['bukti'], 'bukti.pdf', { type: 'application/pdf' }) });
    expect(request()).toMatchObject({ status: 'pending', startTime: '09:00', note: '', externalApproverName: '', attachmentName: 'bukti.pdf' });
    expect(leaveBalance(employeeId)).toBe(12);
    expect(request().attachmentUrl).toBeTruthy();
    await actions.changeLeave(request().id, { startDate: request().startDate, endDate: request().endDate, reason: 'Menghapus lampiran yang keliru', removeAttachment: true });
    expect(request().attachmentUrl).toBeUndefined();
    expect(request().attachmentName).toBeUndefined();
  });

  it('tidak mengubah lampiran/jam cuti disetujui melalui edit langsung', async () => {
    await submitApproved();
    const before = get(app);
    await expect(actions.changeLeave(request().id, { startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Mengubah bukti setelah disetujui', removeAttachment: true })).rejects.toThrow('disetujui');
    expect(get(app)).toBe(before);
  });

  it('HR memperbaiki cuti lampau dengan selisih saldo, menyimpan riwayat, dan tidak menggandakan pengembalian', async () => {
    await submitApproved();
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    actAs('employee-1');
    const leaveId = request().id;
    const correction = { startDate: '2026-10-08', endDate: '2026-10-08', deductionDays: 1, reason: 'Konfirmasi atasan: hanya satu hari dipakai', cancel: false };
    await actions.correctLeave(leaveId, correction);
    expect(leaveBalance(employeeId)).toBe(11);
    expect(request()).toMatchObject({ status: 'approved', deductionDays: 1, endDate: '2026-10-08' });
    expect(get(app).auditEntries[0].detail).toContain('Sebelum:');
    await actions.correctLeave(leaveId, correction);
    expect(leaveBalance(employeeId)).toBe(11);
    await actions.correctLeave(leaveId, { ...correction, reason: 'Konfirmasi atasan: cuti tidak dijalani', cancel: true });
    expect(leaveBalance(employeeId)).toBe(12);
    expect(request().status).toBe('cancelled');
    await expect(actions.correctLeave(leaveId, { ...correction, cancel: true })).rejects.toThrow();
    expect(leaveBalance(employeeId)).toBe(12);
  });

  it('menolak koreksi oleh karyawan dan koreksi pengajuan sendiri oleh HR', async () => {
    await submitApproved();
    const correction = { startDate: request().startDate, endDate: request().endDate, deductionDays: 0, reason: 'Koreksi tidak berwenang', cancel: true };
    await expect(actions.correctLeave(request().id, correction)).rejects.toThrow('Admin HR');
    actAs('employee-2');
    await actions.submitLeave(annual());
    actAs('employee-1'); await approve(1);
    actAs('employee-2');
    await expect(actions.correctLeave(request().id, correction)).rejects.toThrow('sendiri');
  });

  it('pengembalian tahun lampau tetap historis dan tidak menambah saldo tahun berjalan', async () => {
    await submitApproved();
    const leaveId = request().id;
    app.update(s => ({ ...s, leaveRequests: s.leaveRequests.map(r => ({ ...r, startDate: '2025-12-30', endDate: '2025-12-31' })), leaveLedger: [{ id: 'old-charge', employeeId, requestId: leaveId, year: 2025, days: 2 }] }));
    actAs('employee-1');
    const balance = leaveBalance(employeeId);
    await actions.correctLeave(leaveId, { startDate: '2025-12-30', endDate: '2025-12-31', deductionDays: 0, reason: 'Konfirmasi pembatalan tahun lampau', cancel: true });
    expect(leaveBalance(employeeId)).toBe(balance);
    expect(get(app).leaveLedger.filter(e => e.year === 2025).reduce((sum,e) => sum + e.days,0)).toBe(0);
  });

  it('notifikasi keputusan hanya dapat ditandai dibaca oleh penerimanya dan tidak muncul ganda', async () => {
    await actions.submitLeave(annual());
    const reviewerNotification = get(app).notifications!.find(n => n.employeeId === 'employee-1')!;
    expect(reviewerNotification).toBeTruthy();
    await actions.readNotification(reviewerNotification.id);
    expect(get(app).notifications!.find(n => n.id === reviewerNotification.id)?.readAt).toBeNull();
    actAs('employee-1'); await approve(1);
    const ownNotification = get(app).notifications!.find(n => n.employeeId === employeeId)!;
    expect(ownNotification.title).toBe('Pengajuan disetujui');
    actAs(employeeId); await actions.readNotification(ownNotification.id);
    const readAt = get(app).notifications!.find(n => n.id === ownNotification.id)?.readAt;
    expect(readAt).toBeTruthy();
    const count = get(app).notifications!.length;
    await actions.readNotification(ownNotification.id);
    expect(get(app).notifications).toHaveLength(count);
    expect(get(app).notifications!.find(n => n.id === ownNotification.id)?.readAt).toBe(readAt);
  });
});
