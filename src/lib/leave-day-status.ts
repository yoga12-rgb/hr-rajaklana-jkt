import type { AppState, LeaveRequest } from './types';

/**
 * Read-only view of leave requests for one employee and one work date. The
 * planner and the daily roster tables never altered assignments automatically,
 * so an approved full-day leave must stay visible next to a saved shift.
 */
export type LeaveDayMarker = {
  kind: 'full_day' | 'partial';
  status: 'approved' | 'pending' | 'adjustment_pending';
  label: string;
};

const isFullDay = (request: LeaveRequest) => request.extent === 'full_day' || !request.extent;
const covers = (request: LeaveRequest, day: string) => request.startDate <= day && day <= request.endDate;
// Stored values are HH:MM:SS in live mode and HH:MM in local/demo state.
const clock = (value: string | undefined) => /^([01]\d|2[0-3]):[0-5]\d/.test(value ?? '') ? value!.slice(0, 5) : '';
const priority = (marker: LeaveDayMarker) => marker.kind === 'full_day'
  ? (marker.status === 'approved' ? 0 : 2)
  : (marker.status === 'approved' ? 1 : 3);

function push(markers: LeaveDayMarker[], marker: LeaveDayMarker) {
  if (markers.some(item => item.kind === marker.kind && item.status === marker.status && item.label === marker.label)) return;
  markers.push(marker);
}

/**
 * Markers for the calendar day, most relevant first: the approved full-day
 * leave wins over a partial window, then pending adjustments and requests.
 */
export function leaveMarkersFor(state: Pick<AppState, 'leaveRequests'>, employeeId: string, day: string): LeaveDayMarker[] {
  const markers: LeaveDayMarker[] = [];
  for (const request of state.leaveRequests ?? []) {
    if (request.employeeId !== employeeId || !covers(request, day)) continue;
    if (request.status === 'rejected' || request.status === 'cancelled') continue;
    const kind = isFullDay(request) ? 'full_day' as const : 'partial' as const;
    if (request.adjustment?.status === 'pending') {
      push(markers, { kind, status: 'adjustment_pending', label: 'Perubahan cuti menunggu' });
      continue;
    }
    if (request.status === 'pending' || request.status === 'needs_info') {
      push(markers, { kind, status: 'pending', label: 'Izin menunggu keputusan' });
      continue;
    }
    if (request.status !== 'approved') continue;
    if (kind === 'full_day') { push(markers, { kind, status: 'approved', label: 'Cuti disetujui' }); continue; }
    const from = clock(request.startTime), to = clock(request.endTime);
    push(markers, { kind, status: 'approved',
      label: from && to ? `Izin ${from}–${to}` : from || to ? `Izin ${from || to}` : 'Izin sebagian jam' });
  }
  return markers.sort((a, b) => priority(a) - priority(b));
}

/** True when a work shift may not be scheduled on this day. */
export function approvedFullDayLeave(state: Pick<AppState, 'leaveRequests'>, employeeId: string, day: string): boolean {
  return leaveMarkersFor(state, employeeId, day).some(marker => marker.kind === 'full_day' && marker.status === 'approved');
}
