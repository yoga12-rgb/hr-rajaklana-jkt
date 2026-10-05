import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app } from './state/app';
import { initialDemo } from './state/demo';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('./state/client', () => ({ configured: true, supabase: { auth: { signOut }, removeChannel: vi.fn() } }));

beforeEach(() => {
  signOut.mockReset();
  vi.stubGlobal('navigator', { onLine: true });
  const state = initialDemo();
  state.mode = 'live';
  state.initialized = true;
  state.user = state.employees[0];
  state.balanceCache = { 'employee-1:2026': 12 };
  app.set(state);
});
afterEach(() => vi.unstubAllGlobals());

describe('Mengakhiri sesi sebelum masuk dengan akun lain', () => {
  it('mempertahankan sesi lama dan menolak perpindahan ketika layanan gagal mengakhiri sesi', async () => {
    signOut.mockResolvedValue({ error: new Error('Sesi belum berhasil diakhiri') });
    const before = get(app);
    await expect(actions.logout()).rejects.toThrow('Sesi belum berhasil diakhiri');
    expect(get(app)).toBe(before);
    expect(get(app).user?.id).toBe('employee-1');
  });
  it('menghapus data akun lama setelah layanan berhasil mengakhiri sesi', async () => {
    signOut.mockResolvedValue({ error: null });
    await actions.logout();
    expect(get(app)).toMatchObject({ mode: 'live', initialized: true, user: null, employees: [], leaveRequests: [], attendanceRecords: [], balanceCache: {} });
    expect(signOut).toHaveBeenCalledOnce();
  });
});
