import { describe, expect, it } from 'vitest';
import type { CashierAssignment, CashierRosterChange } from './types';
import { cashierRosterChangesReflected } from './cashier-roster-reconcile';

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
