import { describe, expect, it } from 'vitest';
import { initialDemo } from './state/demo';
import { cashierDayStatuses, operationalSignals, previewPreviousWeekCopy, staffingCoverage, startOfWorkWeek, validateRosterBatch, workWeekDates } from './cashier-spv';

const monday = '2027-01-04';
const assignment = (id: string, employeeId: string, workDate: string, outletId: string, shift: 'morning' | 'afternoon' | 'middle' | 'off' = 'morning') => ({
  id, employeeId, workDate, outletId, shift, status: 'active' as const, reason: 'Rencana mingguan', createdBy: 'employee-1',
  createdAt: '2026-12-01T00:00:00.000Z', updatedAt: '2026-12-01T00:00:00.000Z'
});

describe('cashier SPV domain', () => {
  it('maps a Monday to seven WIB work dates without shifting the calendar day', () => {
    expect(startOfWorkWeek('2027-01-06')).toBe(monday);
    expect(workWeekDates(monday)).toEqual(['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']);
    expect(startOfWorkWeek('2027-01-10')).toBe(monday);
  });

  it('distinguishes unset minimum, zero requirement, planned coverage and actual attendance', () => {
    const state = initialDemo();
    state.cashierAssignments = [assignment('a1', 'employee-4', monday, 'outlet-a'), assignment('a2', 'employee-6', monday, 'outlet-a')];
    const unset = staffingCoverage(state, monday).find(row => row.outletId === 'outlet-a' && row.shift === 'morning')!;
    expect(unset).toMatchObject({ minimum: null, scheduled: 2, available: 2, actual: 0, status: 'not_configured' });
    state.staffingRequirements = [{ id: 'r1', outletId: 'outlet-a', weekday: 1, shift: 'morning', minimum: 0,
      effectiveFrom: '2027-01-01', createdBy: 'employee-1', createdAt: '', updatedAt: '' }];
    const zero = staffingCoverage(state, monday).find(row => row.outletId === 'outlet-a' && row.shift === 'morning')!;
    expect(zero).toMatchObject({ minimum: 0, scheduled: 2, available: 2, actual: 0, status: 'not_needed' });
    state.leaveRequests.push({ id: 'leave1', employeeId: 'employee-6', type: 'annual', startDate: monday, endDate: monday,
      startTime: '', endTime: '', reason: 'Cuti contoh', status: 'approved', deductionDays: 0, approverId: 'employee-1', note: '',
      externalApproverName: '', createdAt: '', adjustment: null, extent: 'full_day' });
    const leave = staffingCoverage(state, monday).find(row => row.outletId === 'outlet-a' && row.shift === 'morning')!;
    expect(leave).toMatchObject({ scheduled: 2, available: 1, absentOnApprovedFullDay: 1, status: 'not_needed' });
    state.staffingRequirements[0].minimum = 2;
    expect(staffingCoverage(state, monday).find(row => row.outletId === 'outlet-a' && row.shift === 'morning')?.status).toBe('shortage');
  });

  it('marks approved partial leave for hour review without reducing a full shift headcount', () => {
    const state = initialDemo();
    state.cashierAssignments = [assignment('a1', 'employee-4', monday, 'outlet-a')];
    state.staffingRequirements = [{ id: 'r1', outletId: 'outlet-a', weekday: 1, shift: 'morning', minimum: 1,
      effectiveFrom: '2027-01-01', createdBy: 'employee-1', createdAt: '', updatedAt: '' }];
    state.leaveRequests.push({ id: 'leave1', employeeId: 'employee-4', type: 'personal', startDate: monday, endDate: monday,
      startTime: '10:00', endTime: '11:00', reason: 'Izin contoh', status: 'approved', deductionDays: 0, approverId: 'employee-1', note: '',
      externalApproverName: '', createdAt: '', adjustment: null, extent: 'temporary_exit' });
    expect(staffingCoverage(state, monday).find(row => row.outletId === 'outlet-a' && row.shift === 'morning')).toMatchObject({
      available: 1, needsHourReview: 1, status: 'needs_time_review'
    });
  });

  it('copies only active source rows into entirely empty target cells and reports skipped rows', () => {
    const state = initialDemo();
    state.cashierAssignments = [assignment('source', 'employee-4', '2026-12-28', 'outlet-a')];
    let preview = previewPreviousWeekCopy(state, monday);
    expect(preview).toMatchObject({ sourceWeek: '2026-12-28', targetWeek: monday, skipped: 0, conflicts: [] });
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({ employeeId: 'employee-4', workDate: monday, outletId: 'outlet-a', shift: 'morning', expectedUpdatedAt: null });
    state.cashierAssignments.push({ ...assignment('target-cancelled', 'employee-4', monday, 'outlet-a'), status: 'cancelled' });
    preview = previewPreviousWeekCopy(state, monday);
    expect(preview).toMatchObject({ skipped: 1, changes: [] });
  });

  it('rejects a batch that was previewed against a stale or attended assignment', () => {
    const state = initialDemo();
    state.cashierAssignments = [assignment('existing', 'employee-4', monday, 'outlet-a')];
    const change = { id: 'existing', employeeId: 'employee-4', workDate: monday, outletId: 'outlet-a', shift: 'afternoon' as const,
      reason: 'Ubah jadwal karena kebutuhan', expectedUpdatedAt: '2026-12-02T00:00:00.000Z' };
    expect(() => validateRosterBatch(state, 'employee-1', monday, [change])).toThrow(/berubah sejak pratinjau/);
    state.cashierAssignments[0].updatedAt = change.expectedUpdatedAt;
    state.attendanceRecords.push({ id: 'attendance', employeeId: 'employee-4', outletId: 'outlet-a', shift: 'morning', workDate: monday,
      clockIn: `${monday}T00:00:00.000Z`, clockOut: null, scheduledStart: null, lateMinutes: 0, durationMinutes: null,
      inLatitude: null, inLongitude: null, inAccuracy: null, inDistance: null, selfiePath: '', corrected: false, correctionReason: '' });
    expect(() => validateRosterBatch(state, 'employee-1', monday, [change])).toThrow(/sudah memiliki absensi/);
  });

  it('does not create an automatic absence signal for Middle, fixed day off, or approved full-day leave', () => {
    const state = initialDemo();
    const yesterday = '2026-10-18';
    state.cashierAssignments = [assignment('middle', 'employee-4', yesterday, 'outlet-a', 'middle'), assignment('leave', 'employee-6', yesterday, 'outlet-b')];
    state.leaveRequests.push({ id: 'leave1', employeeId: 'employee-6', type: 'annual', startDate: yesterday, endDate: yesterday,
      startTime: '', endTime: '', reason: 'Cuti contoh', status: 'approved', deductionDays: 0, approverId: 'employee-1', note: '',
      externalApproverName: '', createdAt: '', adjustment: null, extent: 'full_day' });
    const signals = operationalSignals(state, yesterday);
    expect(signals.filter(item => item.input.issueType === 'missing_clockin')).toEqual([]);
    expect(signals.map(item => item.input.issueType)).toEqual(['leave_conflict']);
    state.cashierAssignments = [];
    state.employees.find(employee => employee.id === 'employee-4')!.weeklyOffDays = [0];
    state.employees.find(employee => employee.id === 'employee-6')!.weeklyOffDays = [];
    expect(operationalSignals(state, yesterday).some(item => item.input.employeeId === 'employee-6')).toBe(false);
    state.employees.find(employee => employee.id === 'employee-6')!.weeklyOffDays = [0];
    expect(operationalSignals(state, '2026-10-18')).toEqual([]);
  });

  it('keeps real attendance visible for review when it overlaps approved full-day leave', () => {
    const state = initialDemo(), day = '2026-10-18';
    state.cashierAssignments = [assignment('leave-conflict', 'employee-4', day, 'outlet-a')];
    state.leaveRequests.push({ id: 'leave1', employeeId: 'employee-4', type: 'annual', startDate: day, endDate: day,
      startTime: '', endTime: '', reason: 'Cuti contoh', status: 'approved', deductionDays: 0, approverId: 'employee-1', note: '',
      externalApproverName: '', createdAt: '', adjustment: null, extent: 'full_day' });
    state.attendanceRecords.push({ id: 'worked-on-leave', employeeId: 'employee-4', outletId: 'outlet-a', shift: 'morning', workDate: day,
      clockIn: `${day}T00:00:00.000Z`, clockOut: `${day}T08:00:00.000Z`, scheduledStart: null, lateMinutes: 0, durationMinutes: 480,
      inLatitude: null, inLongitude: null, inAccuracy: null, inDistance: null, selfiePath: '', corrected: false, correctionReason: '' });
    expect(cashierDayStatuses(state, day).find(row => row.employee.id === 'employee-4')).toMatchObject({ status: 'needs_review', detail: expect.stringContaining('saat cuti') });
  });

  it('labels planned, flexible, off, completed and attention states without inventing attendance', () => {
    const state = initialDemo();
    const day = '2026-10-18';
    state.employees.find(employee => employee.id === 'employee-2')!.positionId = 'pos-cashier';
    state.employees.find(employee => employee.id === 'employee-3')!.positionId = 'pos-cashier';
    state.employees.find(employee => employee.id === 'employee-5')!.positionId = 'pos-cashier';
    state.employees.find(employee => employee.id === 'employee-6')!.weeklyOffDays = [];
    state.employees.find(employee => employee.id === 'employee-3')!.weeklyOffDays = [0];
    state.cashierAssignments = [assignment('morning', 'employee-4', day, 'outlet-a'), assignment('middle', 'employee-6', day, 'outlet-b', 'middle')];
    state.leaveRequests.push({ id: 'leave1', employeeId: 'employee-2', type: 'annual', startDate: day, endDate: day,
      startTime: '', endTime: '', reason: 'Cuti contoh', status: 'approved', deductionDays: 0, approverId: 'employee-1', note: '',
      externalApproverName: '', createdAt: '', adjustment: null, extent: 'full_day' });
    state.attendanceRecords.push({ id: 'done', employeeId: 'employee-5', outletId: 'outlet-a', shift: 'afternoon', workDate: day,
      clockIn: `${day}T08:00:00.000Z`, clockOut: `${day}T16:00:00.000Z`, scheduledStart: null, lateMinutes: 0, durationMinutes: 480,
      inLatitude: null, inLongitude: null, inAccuracy: null, inDistance: null, selfiePath: '', corrected: false, correctionReason: '' });
    const statuses = cashierDayStatuses(state, day, Date.parse(`${day}T12:00:00+07:00`));
    expect(statuses.find(row => row.employee.id === 'employee-4')?.status).toBe('needs_confirmation');
    expect(statuses.find(row => row.employee.id === 'employee-6')?.status).toBe('flexible');
    expect(statuses.find(row => row.employee.id === 'employee-2')?.status).toBe('leave');
    expect(statuses.find(row => row.employee.id === 'employee-3')?.status).toBe('off');
    expect(statuses.find(row => row.employee.id === 'employee-5')?.status).toBe('completed');
    expect(statuses.find(row => row.employee.id === 'employee-4')?.detail).toContain('Belum ada clock in');
  });
});
