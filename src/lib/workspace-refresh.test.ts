import { describe, expect, it } from 'vitest';
import { refreshTables, realtimeRefreshTarget } from './workspace-refresh';
describe('scoped workspace refresh dependencies', () => {
  it('unions related changes without discarding another pending group', () => {
    const tables = refreshTables(new Set(['notifications', 'leave', 'schedule']));
    for (const table of ['notifications', 'leave_requests', 'leave_adjustments', 'leave_ledger', 'cashier_assignments', 'staffing_requirements', 'spv_followups']) expect(tables?.has(table)).toBe(true);
    expect(tables?.has('attendance')).toBe(false);
  });
  it('forces full validation for organization, role and unknown changes', () => {
    for (const table of ['employees','employee_roles','positions','outlets','future_sensitive_table']) expect(realtimeRefreshTarget(table)).toBe('all');
    expect(refreshTables(new Set(['notifications','all']))).toBeNull();
    expect(refreshTables(new Set())).toBeNull();
  });
  it('includes affected receipts, notifications and case context with attendance', () => {
    const tables = refreshTables(new Set([realtimeRefreshTarget('attendance_correction_requests')]));
    for (const table of ['attendance','attendance_correction_requests','audit_events','notifications','spv_followups']) expect(tables?.has(table)).toBe(true);
    expect(tables?.has('leave_requests')).toBe(false);
  });
});
