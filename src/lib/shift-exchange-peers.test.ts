import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app } from './state/app';
import { initialDemo } from './state/demo';
import type { CashierAssignment } from './types';

// Demo mode computes the candidate list from local state, but it has to apply
// the same rules as shift_exchange_peer_options: the requester is never a
// candidate, a peer must be an active cashier, and an explicit Libur row blocks
// both swap and replacement.
vi.mock('./state/client', () => ({ configured: false, supabase: null }));

const workDate = '2026-11-20';
function assignment(id: string, employeeId: string, overrides: Partial<CashierAssignment> = {}): CashierAssignment {
  return { id, employeeId, workDate, outletId: 'outlet-a', shift: 'morning', status: 'active',
    reason: 'Penugasan uji kandidat', createdBy: 'employee-1',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function seed(assignments: CashierAssignment[]) {
  const state = initialDemo();
  state.initialized = true;
  state.user = state.employees.find((employee) => employee.id === 'employee-4')!;
  state.cashierAssignments = assignments;
  app.set(state);
}

beforeEach(() => seed([
  assignment('assign-self', 'employee-4'),
  assignment('assign-peer', 'employee-6', { shift: 'afternoon', outletId: 'outlet-b' })
]));
afterEach(() => vi.restoreAllMocks());

describe('Kandidat rekan tukar shift', () => {
  it('menampilkan rekan berpenugasan pada tanggal yang sama tanpa menyertakan pengusul', async () => {
    const peers = await actions.loadShiftExchangePeers('assign-self');
    expect(peers.some((peer) => peer.employeeId === 'employee-4')).toBe(false);
    expect(peers.find((peer) => peer.employeeId === 'employee-6')).toEqual({
      employeeId: 'employee-6', employeeNumber: 'RK000006', fullName: 'Sari Lestari', assignmentId: 'assign-peer',
      shift: 'afternoon', outletId: 'outlet-b', workDate, hasActiveAssignment: true, blockedReason: ''
    });
  });

  it('menandai rekan bukan kasir dan rekan yang sedang Libur sebagai kandidat terblokir', async () => {
    seed([
      assignment('assign-self', 'employee-4'),
      assignment('assign-libur', 'employee-6', { shift: 'off' })
    ]);
    const peers = await actions.loadShiftExchangePeers('assign-self');
    const libur = peers.find((peer) => peer.employeeId === 'employee-6')!;
    expect(libur).toMatchObject({ hasActiveAssignment: false, blockedReason: 'Rekan sedang Libur pada tanggal ini' });
    const nonCashier = peers.find((peer) => peer.employeeId === 'employee-5')!;
    expect(nonCashier).toMatchObject({ hasActiveAssignment: false, blockedReason: 'Rekan harus kasir aktif' });
  });

  it('tidak membuka kandidat untuk jadwal yang bukan milik pengusul atau tanpa jadwal', async () => {
    await expect(actions.loadShiftExchangePeers('assign-peer')).resolves.toEqual([]);
    await expect(actions.loadShiftExchangePeers('')).resolves.toEqual([]);
    expect(get(app).cashierAssignments).toHaveLength(2);
  });
});
