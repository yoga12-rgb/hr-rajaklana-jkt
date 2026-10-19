import { describe, expect, it } from 'vitest';
import type { CashierAssignment, CashierRosterChange } from './types';
import { cashierRosterChangesReflected, reconcileUncertainCashierRosterSave } from './cashier-roster-reconcile';

const row = (overrides: Partial<CashierAssignment> = {}): CashierAssignment => ({
  id: 'assignment-1', employeeId: 'employee-1', workDate: '2026-10-26', outletId: 'outlet-1', shift: 'morning',
  status: 'active', reason: 'Jadwal pekan ini', createdBy: 'admin-1', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
  ...overrides
});
const change = (overrides: Partial<CashierRosterChange> = {}): CashierRosterChange => ({
  id: 'assignment-1', employeeId: 'employee-1', workDate: '2026-10-26', outletId: 'outlet-1', shift: 'morning', reason: 'Jadwal pekan ini',
  ...overrides
});

describe('cashier roster save reconciliation', () => {
  it('confirms all requested active assignments are visible', () => {
    expect(cashierRosterChangesReflected([change()], [row()])).toBe(true);
  });

  it('confirms a cancellation only when the requested assignment is cancelled', () => {
    expect(cashierRosterChangesReflected([change({ cancel: true })], [row({ status: 'cancelled' })])).toBe(true);
    expect(cashierRosterChangesReflected([change({ cancel: true })], [row()])).toBe(false);
    expect(cashierRosterChangesReflected([change({ id: 'other-assignment', cancel: true })], [row({ status: 'cancelled' })])).toBe(false);
  });

  it('does not confirm a partially reflected or mismatched batch', () => {
    const second = change({ id: 'assignment-2', workDate: '2026-10-27', shift: 'afternoon' });
    expect(cashierRosterChangesReflected([change(), second], [row()])).toBe(false);
    expect(cashierRosterChangesReflected([change()], [row({ outletId: 'outlet-2' })])).toBe(false);
    expect(cashierRosterChangesReflected([], [row()])).toBe(false);
  });
});

describe('uncertain cashier roster save reconciliation flow', () => {
  const transportError = new TypeError('Failed to fetch');

  it('refreshes server state and confirms the whole batch when it is reflected', async () => {
    let assignments: CashierAssignment[] = [], refreshCount = 0;
    const confirmed = await reconcileUncertainCashierRosterSave(transportError, [change()], async () => {
      refreshCount += 1; assignments = [row()];
    }, () => assignments);

    expect(refreshCount).toBe(1);
    expect(confirmed).toBe(true);
  });

  it('can confirm a Realtime update even if the follow-up refresh fails', async () => {
    let assignments: CashierAssignment[] = [];
    const confirmed = await reconcileUncertainCashierRosterSave(transportError, [change()], async () => {
      assignments = [row()];
      throw new Error('Refresh response lost');
    }, () => assignments);

    expect(confirmed).toBe(true);
  });

  it('keeps the result uncertain when refreshed state does not match the full batch', async () => {
    let refreshCount = 0;
    const confirmed = await reconcileUncertainCashierRosterSave(transportError, [change()], async () => {
      refreshCount += 1;
    }, () => [row({ shift: 'afternoon' })]);

    expect(refreshCount).toBe(1);
    expect(confirmed).toBe(false);
  });

  it('does not refresh for a definite database rejection', async () => {
    let refreshCount = 0;
    const databaseError = Object.assign(new Error('Jadwal berubah.'), { code: 'P0001', status: 400 });
    const confirmed = await reconcileUncertainCashierRosterSave(databaseError, [change()], async () => {
      refreshCount += 1;
    }, () => [row()]);

    expect(refreshCount).toBe(0);
    expect(confirmed).toBe(false);
  });
});
