import { expect, it } from 'vitest';
import { attendanceWindowFilter, workspaceDataMode } from './workspace-window';
it('retains complete context for operational forms and uses recent context for entry and reports', () => {
  for (const path of ['/attendance','/leave','/assignments','/supervisor','/operations','/planning']) expect(workspaceDataMode(path)).toBe('full');
  for (const path of ['/login','/dashboard','/reports','/profile','/employees']) expect(workspaceDataMode(path)).toBe('recent');
});
it('preserves old open shifts, recently ended shifts and historical unresolved cases', () => {
  const filter = attendanceWindowFilter('recent', ['2025-01-01','2025-01-01','bad),clock_out.not.is.null'], Date.parse('2026-11-04T00:00:00Z'));
  expect(filter).toBe('clock_out.is.null,clock_in.gte.2026-10-04T00:00:00.000Z,clock_out.gte.2026-10-04T00:00:00.000Z,worked_minutes.gte.720,work_date.in.(2025-01-01)');
  expect(attendanceWindowFilter('full', [])).toBeNull();
});
