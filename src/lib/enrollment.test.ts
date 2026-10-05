import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app } from './state/app';
import { initialDemo } from './state/demo';

vi.mock('./state/client', () => ({ configured: false, supabase: null }));

const employeeId = 'employee-4';
const password = 'KaryawanBaru123!';
const tokenFrom = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
const account = () => get(app).employees.find(employee => employee.id === employeeId)!;
const deactivate = () => app.update(state => ({ ...state, employees: state.employees.map(employee => employee.id === employeeId ? { ...employee, status: 'inactive' as const, accountStatus: 'disabled' as const } : employee) }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:4173' });
  const state = initialDemo();
  state.initialized = true;
  state.user = state.employees[0];
  state.employees.find(employee => employee.id === employeeId)!.accountStatus = 'not_invited';
  app.set(state);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Undangan dan aktivasi akun demo lokal', () => {
  it('menerbitkan undangan, mengaktifkan akun sekali, dan memakai kata sandi yang dipilih karyawan', async () => {
    const invitation = await actions.issueLink(employeeId, 'activate');
    const token = tokenFrom(invitation.url);
    expect(invitation.message).toContain('DEMO: hanya bekerja pada browser yang sama');
    expect(account().accountStatus).toBe('invited');
    expect(await actions.inspectToken(token)).toMatchObject({ purpose: 'activate', employee_number: 'RK000004', full_name: 'Nadia Putri' });

    await actions.activate(token, password);
    expect(account().accountStatus).toBe('active');
    expect(localStorage.getItem('rk-demo-passwords')).not.toContain(password);
    await expect(actions.inspectToken(token)).rejects.toThrow('Tautan tidak berlaku');
    await expect(actions.activate(token, password)).rejects.toThrow('Tautan tidak berlaku');
    await actions.logout();
    await expect(actions.login('RK000004', 'DemoRajaklana123!')).rejects.toThrow('Nomor karyawan atau kata sandi tidak sesuai');
    await actions.login(' rk000004 ', password);
    expect(get(app).user?.id).toBe(employeeId);
  });

  it('menolak penerbitan undangan maupun pemulihan untuk karyawan nonaktif', async () => {
    deactivate();
    await expect(actions.issueLink(employeeId, 'activate')).rejects.toThrow('Akun karyawan tidak aktif');
    await expect(actions.issueLink(employeeId, 'reset')).rejects.toThrow('Akun karyawan tidak aktif');
    expect(localStorage.getItem('rk-demo-links')).toBeNull();
    expect(account().accountStatus).toBe('disabled');
  });

  it('membatasi panjang kata sandi sesuai backend tanpa mengonsumsi token yang valid', async () => {
    const token = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    await expect(actions.activate(token, '123456789')).rejects.toThrow('10–128 karakter');
    await expect(actions.activate(token, 'a'.repeat(129))).rejects.toThrow('10–128 karakter');
    expect(await actions.inspectToken(token)).toMatchObject({ purpose: 'activate' });
    expect(localStorage.getItem('rk-demo-passwords')).toBeNull();
    await actions.activate(token, 'a'.repeat(128));
    expect(account().accountStatus).toBe('active');
  });

  it('menolak tautan yang sudah diterbitkan ketika karyawan kemudian dinonaktifkan', async () => {
    const token = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    deactivate();
    await expect(actions.inspectToken(token)).rejects.toThrow('Akun karyawan tidak aktif');
    await expect(actions.activate(token, password)).rejects.toThrow('Akun karyawan tidak aktif');
    expect(account().accountStatus).toBe('disabled');
    expect(localStorage.getItem('rk-demo-passwords')).toBeNull();
  });

  it('menolak tautan yang merujuk karyawan yang tidak lagi tersedia', async () => {
    const token = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    app.update(state => ({ ...state, employees: state.employees.filter(employee => employee.id !== employeeId) }));
    await expect(actions.inspectToken(token)).rejects.toThrow('Akun karyawan tidak aktif');
    await expect(actions.activate(token, password)).rejects.toThrow('Akun karyawan tidak aktif');
    expect(localStorage.getItem('rk-demo-passwords')).toBeNull();
  });

  it('membatalkan tautan sebelumnya saat undangan baru diterbitkan dan menolak batas 24 jam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
    const first = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    const second = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    await expect(actions.inspectToken(first)).rejects.toThrow('Tautan tidak berlaku');
    expect(await actions.inspectToken(second)).toMatchObject({ purpose: 'activate' });
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
    await expect(actions.inspectToken(second)).rejects.toThrow('Tautan tidak berlaku');
    await expect(actions.activate(second, password)).rejects.toThrow('Tautan tidak berlaku');
    expect(localStorage.getItem('rk-demo-passwords')).toBeNull();
  });

  it('tidak mengonsumsi token pemulihan untuk aktivasi dan tetap menerima pemulihan yang sesuai', async () => {
    const activation = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    await actions.activate(activation, password);
    const reset = tokenFrom((await actions.issueLink(employeeId, 'reset')).url);
    const previousPassword = localStorage.getItem('rk-demo-passwords');
    await expect(actions.activate(reset, 'KataSandiBaru123!', 'activate')).rejects.toThrow('Jenis tautan tidak sesuai');
    expect(localStorage.getItem('rk-demo-passwords')).toBe(previousPassword);
    expect(await actions.inspectToken(reset)).toMatchObject({ purpose: 'reset' });
    await actions.activate(reset, 'KataSandiBaru123!', 'reset');
    await actions.logout();
    await expect(actions.login('RK000004', password)).rejects.toThrow('Nomor karyawan atau kata sandi tidak sesuai');
    await actions.login('RK000004', 'KataSandiBaru123!');
    expect(get(app).user?.id).toBe(employeeId);
  });

  it('memeriksa ulang status karyawan setelah pemrosesan kata sandi yang asinkron', async () => {
    const token = tokenFrom((await actions.issueLink(employeeId, 'activate')).url);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { await pending; return digest(...args); });
    const activation = actions.activate(token, password);
    deactivate();
    release();
    await expect(activation).rejects.toThrow('Akun karyawan tidak aktif');
    expect(account().accountStatus).toBe('disabled');
    expect(localStorage.getItem('rk-demo-passwords')).toBeNull();
  });
});
