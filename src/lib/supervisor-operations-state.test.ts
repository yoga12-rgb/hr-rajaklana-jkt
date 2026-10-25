import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { actions, app } from './state/app';
import { initialDemo } from './state/demo';

vi.mock('./state/client', () => ({ configured: false, supabase: null }));

const key = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  const state = initialDemo();
  state.initialized = true;
  state.user = state.employees.find((employee) => employee.id === 'employee-1')!;
  app.set(state);
});

describe('supervisor operation state boundary', () => {
  it('does not invent operational records in demo mode', async () => {
    await expect(actions.loadSupervisorIssueCategories()).resolves.toEqual([]);
    await expect(actions.loadOutletIssues({ view: 'open' })).resolves.toMatchObject({ items: [], total: 0, hasMore: false });
    await expect(actions.loadShiftHandovers()).resolves.toMatchObject({ items: [], total: 0, hasMore: false });
    await expect(actions.loadShiftExchanges()).resolves.toMatchObject({ items: [], total: 0, hasMore: false });
    await expect(actions.loadIntervalRequirements()).resolves.toEqual([]);
  });

  it('fails closed before creating a non-atomic demo substitute for server workflows', async () => {
    const before = get(app);
    await expect(actions.submitOutletIssue({ outletId: 'outlet-a', categoryId: key, description: 'Mesin kasir tidak dapat digunakan.', urgency: 'high', idempotencyKey: key })).rejects.toThrow('Supabase Preview');
    await expect(actions.saveShiftHandover({ idempotencyKey: key, outletId: 'outlet-a', workDate: '2026-10-25', senderAssignmentId: key,
      recipientEmployeeId: null, recipientAssignmentId: null, pendingWork: 'Uang kecil perlu dihitung ulang.', outletCondition: '', notes: '', send: false, reason: '' })).rejects.toThrow('Supabase Preview');
    await expect(actions.submitShiftExchange({ requestType: 'replacement', requesterAssignmentId: key, peerEmployeeId: 'employee-6', reason: 'Perlu pengganti untuk jadwal besok.', idempotencyKey: key })).rejects.toThrow('Supabase Preview');
    await expect(actions.saveIntervalRequirement({ idempotencyKey: key, outletId: 'outlet-a', weekday: 1, startsAt: '14:00', endsAt: '16:00',
      minimum: 2, effectiveFrom: '2026-10-25', effectiveUntil: null, reason: '' })).rejects.toThrow('Supabase Preview');
    expect(get(app)).toBe(before);
  });
});
