import type { AppState, LeaveInput, LeaveRequest } from './types';
import { jakartaDate } from './domain';

const active = (request: LeaveRequest) => ['pending', 'needs_info', 'approved'].includes(request.status);
const extent = (input: Pick<LeaveInput, 'extent' | 'startTime'>) => input.extent ?? (input.startTime ? 'temporary_exit' : 'full_day');
export function duplicateLeave(state: AppState, employeeId: string, input: LeaveInput, excludedId?: string): boolean {
  return state.leaveRequests.some(r => r.id !== excludedId && r.employeeId === employeeId && active(r)
    && r.type === input.type && extent(r) === extent(input) && r.startDate === input.startDate && r.endDate === input.endDate
    && (r.startTime || '') === (input.startTime || '') && (r.endTime || '') === (input.endTime || ''));
}
export interface LeaveConflict { id: string; kind: 'leave' | 'attendance'; label: string }
export function findLeaveConflicts(state: AppState, employeeId: string, start: string, end: string, excludedId?: string): LeaveConflict[] {
  if (!start || !end || start > end) return [];
  const leaves: LeaveConflict[] = state.leaveRequests.filter(r => r.id !== excludedId && r.employeeId === employeeId && active(r)
    && r.startDate <= end && start <= r.endDate).map(r => ({ id: r.id, kind: 'leave', label: `Pengajuan cuti/izin lain pada ${r.startDate}${r.startDate !== r.endDate ? `–${r.endDate}` : ''}` }));
  const attendance: LeaveConflict[] = state.attendanceRecords.filter(r => {
    if (r.employeeId !== employeeId) return false;
    const last = r.clockOut && Date.parse(r.clockOut) > Date.parse(r.clockIn) ? new Date(Date.parse(r.clockOut) - 1) : r.clockIn;
    return jakartaDate(r.clockIn) <= end && start <= jakartaDate(last);
  }).map(r => ({ id: r.id, kind: 'attendance', label: `Ada catatan kehadiran pada ${jakartaDate(r.clockIn)}` }));
  return [...leaves, ...attendance];
}
