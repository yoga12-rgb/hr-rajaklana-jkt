export type RefreshTarget = 'all' | 'notifications' | 'attendance' | 'leave' | 'schedule' | 'supervisor';
const groups: Record<Exclude<RefreshTarget, 'all'>, string[]> = {
  notifications: ['notifications'],
  attendance: ['attendance', 'attendance_correction_requests', 'notifications', 'audit_events', 'spv_followups'],
  leave: ['leave_requests', 'leave_adjustments', 'leave_ledger', 'notifications', 'audit_events', 'spv_followups'],
  schedule: ['cashier_assignments', 'staffing_requirements', 'notifications', 'spv_followups', 'audit_events'],
  supervisor: ['spv_followups', 'notifications', 'audit_events']
};
export function refreshTables(targets: ReadonlySet<RefreshTarget>): Set<string> | null {
  if (targets.has('all') || targets.size === 0) return null;
  return new Set([...targets].flatMap(target => groups[target as Exclude<RefreshTarget, 'all'>]));
}
export function realtimeRefreshTarget(table: string): RefreshTarget {
  if (table === 'notifications') return 'notifications';
  if (['attendance', 'attendance_correction_requests'].includes(table)) return 'attendance';
  if (['leave_requests', 'leave_adjustments', 'leave_ledger'].includes(table)) return 'leave';
  if (['cashier_assignments', 'staffing_requirements'].includes(table)) return 'schedule';
  if (['spv_followups', 'outlet_issues', 'shift_handovers', 'shift_exchange_requests', 'staffing_interval_requirements'].includes(table)) return 'supervisor';
  // Account, role, outlet and organization changes must re-read all RLS-scoped
  // data. Unknown tables fail conservatively to that same full refresh.
  return 'all';
}
