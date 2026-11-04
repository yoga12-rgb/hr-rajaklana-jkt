export type WorkspaceDataMode = 'recent' | 'full';
export function workspaceDataMode(path: string): WorkspaceDataMode {
  // These forms inspect historical assignment/leave/attendance footprints.
  // Load their complete canonical context before permitting client actions.
  return ['/attendance','/leave','/assignments','/supervisor','/operations','/planning']
    .some(route => path === route || path.startsWith(route + '/')) ? 'full' : 'recent';
}
export function attendanceWindowFilter(mode: WorkspaceDataMode, caseDates: unknown[], now = Date.now()): string | null {
  if (mode === 'full') return null;
  const cutoff = new Date(now - 31 * 86_400_000).toISOString();
  const dates = [...new Set(caseDates.filter((value): value is string => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value))];
  // Never drop old open shifts, recent clock-outs or historical cases that
  // still need SPV action just because their clock-in precedes the window.
  return [`clock_out.is.null`, `clock_in.gte.${cutoff}`, `clock_out.gte.${cutoff}`, 'worked_minutes.gte.720',
    ...(dates.length ? [`work_date.in.(${dates.join(',')})`] : [])].join(',');
}
