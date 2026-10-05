import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app } from './state/app';
import { initialDemo } from './state/demo';
import type { ClockInInput, ClockOutInput } from './types';

vi.mock('./state/client', () => ({ configured: false, supabase: null }));

const coordinates: ClockOutInput = { latitude: -6.2, longitude: 106.816666, accuracy: 10 };
const input = (overrides: Partial<ClockInInput> = {}): ClockInInput => ({
  outletId: 'outlet-a', shift: 'morning', ...coordinates,
  selfie: new Blob(['selfie hasil kamera uji'], { type: 'image/jpeg' }), ...overrides
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T00:10:00Z'));
  vi.stubGlobal('navigator', { onLine: true });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:selfie-uji');
  const state = initialDemo();
  state.initialized = true;
  state.user = state.employees.find(employee => employee.id === 'employee-4')!;
  app.set(state);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Pencatatan absensi kasir lokal', () => {
  it('menyimpan waktu Jakarta, keterlambatan, bukti GPS dan selfie tanpa menyelesaikan sesi', async () => {
    await actions.clockIn(input());
    const state = get(app), record = state.attendanceRecords[0];
    expect(record).toMatchObject({
      employeeId: 'employee-4', outletId: 'outlet-a', shift: 'morning',
      clockIn: '2026-10-06T00:10:00.000Z', scheduledStart: '2026-10-06T00:00:00.000Z',
      lateMinutes: 10, clockOut: null, durationMinutes: null,
      inLatitude: coordinates.latitude, inLongitude: coordinates.longitude,
      inAccuracy: 10, inDistance: 0, selfieUrl: 'blob:selfie-uji', corrected: false
    });
    expect(state.auditEntries[0]).toMatchObject({ actorId: 'employee-4', action: 'clock_in', entityId: record.id });
    // Foto demo hanya hidup pada sesi browser; data URL tidak dipersistenkan.
    expect(localStorage.getItem('rajaklana-hr-demo-v1')).not.toContain('blob:selfie-uji');
  });

  it.each([
    { latitude: NaN }, { latitude: Infinity }, { latitude: 91 },
    { longitude: NaN }, { longitude: Infinity }, { longitude: 181 },
    { accuracy: NaN }, { accuracy: Infinity }, { accuracy: -1 },
    { accuracy: 0 }, { accuracy: 101 }
  ])('menolak GPS masuk maupun pulang yang tidak valid: %j', async invalid => {
    await expect(actions.clockIn(input(invalid))).rejects.toThrow();
    expect(get(app).attendanceRecords).toHaveLength(0);
    expect(get(app).auditEntries).toHaveLength(0);
    await actions.clockIn(input());
    await expect(actions.clockOut({ ...coordinates, ...invalid })).rejects.toThrow();
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
    expect(get(app).auditEntries).toHaveLength(1);
  });

  it('menolak clock in di luar radius atau outlet tanpa lokasi', async () => {
    await expect(actions.clockIn(input({ latitude: -6.3, longitude: 106.9 }))).rejects.toThrow('Radius yang diizinkan');
    app.update(state => ({ ...state, outlets: state.outlets.map(outlet => outlet.id === 'outlet-a' ? { ...outlet, latitude: null, longitude: null } : outlet) }));
    await expect(actions.clockIn(input())).rejects.toThrow('Lokasi outlet belum diatur');
    expect(get(app).attendanceRecords).toHaveLength(0);
  });

  it('menolak outlet penempatan nonaktif', async () => {
    app.update(state => ({ ...state, outlets: state.outlets.map(outlet => outlet.id === 'outlet-a' ? { ...outlet, active: false } : outlet) }));
    await expect(actions.clockIn(input())).rejects.toThrow();
    expect(get(app).attendanceRecords).toHaveLength(0);
  });

  it('mewajibkan selfie berisi gambar dan membatasi ukuran', async () => {
    for (const selfie of [
      new Blob([], { type: 'image/jpeg' }),
      new Blob(['bukan foto'], { type: 'text/plain' }),
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
    ]) {
      await expect(actions.clockIn(input({ selfie }))).rejects.toThrow('Ambil selfie langsung dari kamera');
    }
    expect(get(app).attendanceRecords).toHaveLength(0);
  });

  it('membatasi clock in kepada kasir di outlet penempatannya', async () => {
    await expect(actions.clockIn(input({ outletId: 'outlet-b' }))).rejects.toThrow('outlet penempatannya');
    app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === 'employee-3')! }));
    await expect(actions.clockIn(input())).rejects.toThrow('hanya untuk kasir');
    expect(get(app).attendanceRecords).toHaveLength(0);
  });

  it('menolak nilai shift yang tidak dikenal tanpa menyimpan kehadiran', async () => {
    await expect(actions.clockIn(input({ shift: 'shift-tidak-ada' as ClockInInput['shift'] }))).rejects.toThrow('Shift tidak valid');
    expect(get(app).attendanceRecords).toHaveLength(0);
  });

  it('middle memerlukan izin, lalu menggunakan jam aktual tanpa keterlambatan', async () => {
    app.update(state => ({ ...state, user: { ...state.user!, canMiddleShift: false } }));
    await expect(actions.clockIn(input({ shift: 'middle' }))).rejects.toThrow('izin SPV');
    app.update(state => ({ ...state, user: { ...state.user!, canMiddleShift: true } }));
    await actions.clockIn(input({ shift: 'middle' }));
    expect(get(app).attendanceRecords[0]).toMatchObject({ shift: 'middle', scheduledStart: null, lateMinutes: 0 });
  });

  it('menolak sesi rangkap, termasuk clock in kedua setelah pulang pada tanggal sama', async () => {
    await actions.clockIn(input());
    await expect(actions.clockIn(input())).rejects.toThrow('belum clock out');
    vi.setSystemTime(new Date('2026-10-06T08:10:00Z'));
    await actions.clockOut(coordinates);
    await expect(actions.clockIn(input({ shift: 'afternoon' }))).rejects.toThrow('hari ini sudah tercatat');
    expect(get(app).attendanceRecords).toHaveLength(1);
  });

  it('memeriksa GPS pulang kembali dan menghitung delapan jam termasuk istirahat', async () => {
    await actions.clockIn(input({ shift: 'middle' }));
    vi.setSystemTime(new Date('2026-10-06T08:10:00Z'));
    await expect(actions.clockOut({ ...coordinates, latitude: -6.3, longitude: 106.9 })).rejects.toThrow('Radius yang diizinkan');
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
    await expect(actions.clockOut({ ...coordinates, accuracy: 101 })).rejects.toThrow('Akurasi lokasi');
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
    await actions.clockOut(coordinates);
    const state = get(app);
    expect(state.attendanceRecords[0]).toMatchObject({
      clockOut: '2026-10-06T08:10:00.000Z', durationMinutes: 480,
      outLatitude: coordinates.latitude, outLongitude: coordinates.longitude,
      outAccuracy: 10, outDistance: 0
    });
    expect(state.auditEntries[0].action).toBe('clock_out');
    expect(state.leaveLedger).toHaveLength(0);
  });

  it('tetap mencatat pulang lebih awal tanpa potongan cuti otomatis', async () => {
    await actions.clockIn(input());
    vi.setSystemTime(new Date('2026-10-06T07:40:00Z'));
    await actions.clockOut(coordinates);
    expect(get(app).attendanceRecords[0].durationMinutes).toBe(450);
    expect(get(app).leaveLedger).toHaveLength(0);
  });

  it('menolak absensi offline dan clock out tanpa sesi', async () => {
    await expect(actions.clockOut(coordinates)).rejects.toThrow('Tidak ada sesi kerja aktif');
    vi.stubGlobal('navigator', { onLine: false });
    await expect(actions.clockIn(input())).rejects.toThrow('koneksi internet');
    vi.stubGlobal('navigator', { onLine: true });
    await actions.clockIn(input());
    vi.stubGlobal('navigator', { onLine: false });
    await expect(actions.clockOut(coordinates)).rejects.toThrow('koneksi internet');
    expect(get(app).attendanceRecords[0].clockOut).toBeNull();
  });
});

describe('Koreksi absensi oleh HR', () => {
  async function prepareRecord() {
    await actions.clockIn(input());
    const record = get(app).attendanceRecords[0];
    vi.setSystemTime(new Date('2026-10-06T08:30:00Z'));
    await actions.clockOut(coordinates);
    app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === 'employee-1')! }));
    return record.id;
  }

  it('mengoreksi waktu, menghitung ulang keterlambatan dan menyimpan bukti catatan asli', async () => {
    const recordId = await prepareRecord();
    const original = structuredClone(get(app).attendanceRecords[0]);
    await actions.correctAttendance(recordId, {
      clockIn: '2026-10-06T00:05:01Z', clockOut: '2026-10-06T08:05:01Z',
      shift: 'morning', reason: 'Jam dikonfirmasi kasir melalui WhatsApp.'
    });
    const state = get(app), record = state.attendanceRecords[0];
    expect(record).toMatchObject({
      clockIn: '2026-10-06T00:05:01Z', clockOut: '2026-10-06T08:05:01Z',
      lateMinutes: 6, durationMinutes: 480, corrected: true,
      correctionReason: 'Jam dikonfirmasi kasir melalui WhatsApp.',
      inLatitude: coordinates.latitude, inLongitude: coordinates.longitude, inDistance: 0,
      outLatitude: coordinates.latitude, outLongitude: coordinates.longitude, outDistance: 0
    });
    const audit = state.auditEntries.find(entry => entry.action === 'attendance_original');
    expect(audit).toMatchObject({ actorId: 'employee-1', entityId: recordId });
    expect(JSON.parse(audit!.detail)).toEqual(original);
    expect(state.auditEntries[0]).toMatchObject({ action: 'attendance_corrected', actorId: 'employee-1' });
  });

  it('menolak tanggal lain, waktu invalid/future, pulang sebelum masuk dan alasan kosong', async () => {
    const recordId = await prepareRecord(), originalState = get(app);
    const valid = { clockIn: '2026-10-06T00:05:00Z', clockOut: '2026-10-06T08:05:00Z', reason: 'Konfirmasi jam kasir.' };
    for (const changes of [
      { clockIn: 'bukan-tanggal' }, { clockOut: 'bukan-tanggal' },
      { clockIn: '2026-10-06T09:00:00Z' }, { clockOut: '2026-10-06T09:00:00Z' },
      { clockIn: '2026-10-05T00:05:00Z' },
      { clockOut: '2026-10-06T00:04:59Z' }, { reason: '    ' }, { reason: 'a' },
      { shift: 'shift-tidak-ada' as ClockInInput['shift'] }
    ]) {
      await expect(actions.correctAttendance(recordId, { ...valid, ...changes })).rejects.toThrow();
      expect(get(app)).toEqual(originalState);
    }
  });

  it('kasir tidak boleh mengoreksi dan HR tidak boleh mengoreksi absensi sendiri', async () => {
    await actions.clockIn(input());
    const recordId = get(app).attendanceRecords[0].id;
    const correction = { clockIn: '2026-10-06T00:05:00Z', clockOut: null, reason: 'Konfirmasi jam kasir.' };
    await expect(actions.correctAttendance(recordId, correction)).rejects.toThrow('Admin HR');
    app.update(state => ({
      ...state,
      employees: state.employees.map(employee => employee.id === 'employee-4' ? { ...employee, roles: ['employee', 'admin_hr'] } : employee),
      user: { ...state.user!, roles: ['employee', 'admin_hr'] }
    }));
    await expect(actions.correctAttendance(recordId, correction)).rejects.toThrow('absensi sendiri');
    expect(get(app).attendanceRecords[0].corrected).toBe(false);
  });

  it('tidak membuka kembali catatan lama ketika sesi kasir lain masih berjalan', async () => {
    const recordId = await prepareRecord();
    vi.setSystemTime(new Date('2026-10-07T00:10:00Z'));
    app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === 'employee-4')! }));
    await actions.clockIn(input());
    app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === 'employee-1')! }));
    const original = get(app);
    await expect(actions.correctAttendance(recordId, {
      clockIn: '2026-10-06T00:05:00Z', clockOut: null, reason: 'Buka kembali untuk konfirmasi.'
    })).rejects.toThrow();
    expect(get(app)).toEqual(original);
    expect(get(app).attendanceRecords.filter(record => record.clockOut === null)).toHaveLength(1);
  });
});

describe('Pencatatan manual untuk kendala absensi', () => {
  beforeEach(() => {
    app.update(state => ({ ...state, user: state.employees.find(employee => employee.id === 'employee-1')! }));
  });

  it('mencatat 8 jam tanpa bukti GPS/selfie dan mengaudit alasan serta pencatat HR', async () => {
    const reason = 'Kamera bermasalah; jam masuk dan pulang dikonfirmasi kasir melalui WhatsApp.';
    await actions.recordManualAttendance({
      employeeId: 'employee-4', shift: 'morning',
      clockIn: '2026-10-05T00:10:00Z', clockOut: '2026-10-05T08:10:00Z', reason
    });
    const state = get(app), record = state.attendanceRecords[0];
    expect(record).toMatchObject({
      employeeId: 'employee-4', outletId: 'outlet-a', shift: 'morning',
      clockIn: '2026-10-05T00:10:00Z', clockOut: '2026-10-05T08:10:00Z',
      durationMinutes: 480, lateMinutes: 10, source: 'manual',
      inLatitude: null, inLongitude: null, inAccuracy: null, inDistance: null,
      selfiePath: '', corrected: true, correctionReason: reason
    });
    expect(record.selfieUrl).toBeUndefined();
    expect(state.auditEntries[0]).toMatchObject({
      actorId: 'employee-1', action: 'attendance_manual', entityId: record.id, detail: reason
    });
  });

  it('menolak benturan dengan sesi tertutup lintas tanggal tanpa mengubah data atau audit', async () => {
    vi.setSystemTime(new Date('2026-10-06T09:00:00Z'));
    await actions.recordManualAttendance({
      employeeId: 'employee-4', shift: 'middle',
      clockIn: '2026-10-05T16:00:00Z', clockOut: '2026-10-06T01:00:00Z',
      reason: 'Sesi malam tanggal sebelumnya dikonfirmasi kasir.'
    });
    const originalState = structuredClone(get(app));
    await expect(actions.recordManualAttendance({
      employeeId: 'employee-4', shift: 'morning',
      clockIn: '2026-10-06T00:00:00Z', clockOut: '2026-10-06T08:00:00Z',
      reason: 'Usulan sesi pagi yang bertabrakan dengan sesi malam.'
    })).rejects.toThrow('Waktu absensi bertabrakan');
    expect(get(app)).toEqual(originalState);
    expect(get(app).attendanceRecords).toHaveLength(1);
    expect(get(app).auditEntries).toHaveLength(1);
  });
});
