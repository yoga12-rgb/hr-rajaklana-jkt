import type { CashierAssignment, CashierRosterChange } from './types';

export function cashierRosterChangesReflected(
  changes: readonly CashierRosterChange[],
  assignments: readonly CashierAssignment[]
): boolean {
  return changes.length > 0 && changes.every(change => {
    const row = assignments.find(assignment => assignment.employeeId === change.employeeId && assignment.workDate === change.workDate);
    if (!row || (change.id && row.id !== change.id)) return false;
    if (change.cancel) return row.status === 'cancelled';
    return row.status === 'active' && row.shift === change.shift && row.outletId === change.outletId;
  });
}
