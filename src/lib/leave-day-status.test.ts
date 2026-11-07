import { describe, expect, it } from 'vitest';
import { approvedFullDayLeave, leaveMarkersFor } from './leave-day-status';
import type { LeaveRequest } from './types';

const day = '2026-11-14';
const leave = (overrides: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: 'leave-1', employeeId: 'employee-4', type: 'annual', startDate: day, endDate: day,
  startTime: '', endTime: '', reason: 'Cuti keluarga', status: 'approved', deductionDays: 1,
  approverId: 'employee-1', note: '', externalApproverName: '', createdAt: '', adjustment: null,
  extent: 'full_day', ...overrides
});
const state = (...requests: LeaveRequest[]) => ({ leaveRequests: requests });

describe('leave day markers', () => {
  it('marks an approved full-day leave on the exact work date only', () => {
    expect(leaveMarkersFor(state(leave()), 'employee-4', day)).toEqual([
      { kind: 'full_day', status: 'approved', label: 'Cuti disetujui' }
    ]);
    expect(leaveMarkersFor(state(leave()), 'employee-4', '2026-11-15')).toEqual([]);
    expect(leaveMarkersFor(state(leave()), 'employee-6', day)).toEqual([]);
  });

  it('covers every calendar day of a multi-day range and treats a missing extent as full day', () => {
    const range = leave({ startDate: '2026-11-14', endDate: '2026-11-16', extent: undefined });
    expect(leaveMarkersFor(state(range), 'employee-4', '2026-11-15')).toMatchObject([{ kind: 'full_day', status: 'approved' }]);
    expect(leaveMarkersFor(state(range), 'employee-4', '2026-11-16')).toHaveLength(1);
    expect(leaveMarkersFor(state(range), 'employee-4', '2026-11-17')).toEqual([]);
  });

  it('labels partial extents with the permit clock, normalising HH:MM:SS', () => {
    expect(leaveMarkersFor(state(leave({ extent: 'late_arrival', startTime: '10:30', endTime: '' })), 'employee-4', day))
      .toEqual([{ kind: 'partial', status: 'approved', label: 'Izin 10:30' }]);
    expect(leaveMarkersFor(state(leave({ extent: 'temporary_exit', startTime: '10:00:00', endTime: '11:00:00' })), 'employee-4', day))
      .toEqual([{ kind: 'partial', status: 'approved', label: 'Izin 10:00–11:00' }]);
    expect(leaveMarkersFor(state(leave({ extent: 'early_departure', startTime: '', endTime: '15:00' })), 'employee-4', day))
      .toEqual([{ kind: 'partial', status: 'approved', label: 'Izin 15:00' }]);
    expect(leaveMarkersFor(state(leave({ extent: 'temporary_exit', startTime: 'x', endTime: 'y' })), 'employee-4', day))
      .toEqual([{ kind: 'partial', status: 'approved', label: 'Izin sebagian jam' }]);
  });

  it('separates undecided requests from decided ones', () => {
    expect(leaveMarkersFor(state(leave({ status: 'pending' })), 'employee-4', day))
      .toEqual([{ kind: 'full_day', status: 'pending', label: 'Izin menunggu keputusan' }]);
    expect(leaveMarkersFor(state(leave({ status: 'needs_info' })), 'employee-4', day))
      .toEqual([{ kind: 'full_day', status: 'pending', label: 'Izin menunggu keputusan' }]);
    expect(leaveMarkersFor(state(leave({ status: 'rejected' })), 'employee-4', day)).toEqual([]);
    expect(leaveMarkersFor(state(leave({ status: 'cancelled' })), 'employee-4', day)).toEqual([]);
  });

  it('reports a pending adjustment instead of the still-approved dates', () => {
    const request = leave({ adjustment: { id: 'adj-1', type: 'change', startDate: '2026-11-20', endDate: '2026-11-20',
      reason: 'Tanggal bergeser', status: 'pending', requestedAt: '' } });
    expect(leaveMarkersFor(state(request), 'employee-4', day))
      .toEqual([{ kind: 'full_day', status: 'adjustment_pending', label: 'Perubahan cuti menunggu' }]);
    expect(approvedFullDayLeave(state(request), 'employee-4', day)).toBe(false);
  });

  it('orders the approved full-day leave before partial markers and de-duplicates identical labels', () => {
    const markers = leaveMarkersFor(state(
      leave({ id: 'leave-pending', status: 'pending', extent: 'temporary_exit', startTime: '10:00', endTime: '12:00' }),
      leave({ id: 'leave-full' }),
      leave({ id: 'leave-full-duplicate' })
    ), 'employee-4', day);
    expect(markers).toEqual([
      { kind: 'full_day', status: 'approved', label: 'Cuti disetujui' },
      { kind: 'partial', status: 'pending', label: 'Izin menunggu keputusan' }
    ]);
  });

  it('exposes the scheduling guard for approved full-day leave only', () => {
    expect(approvedFullDayLeave(state(leave()), 'employee-4', day)).toBe(true);
    expect(approvedFullDayLeave(state(leave({ extent: 'late_arrival', startTime: '10:30' })), 'employee-4', day)).toBe(false);
    expect(approvedFullDayLeave(state(leave({ startDate: '2026-11-20' })), 'employee-4', day)).toBe(false);
    expect(approvedFullDayLeave({ leaveRequests: [] }, 'employee-4', day)).toBe(false);
  });
});
