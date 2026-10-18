import type { AppNotification, AppState, LeaveRequest } from './types';

/** Demo mirrors server triggers; each recipient sees only their own inbox. */
export function demoNotifications(before: AppState, after: AppState): AppNotification[] {
  const result: AppNotification[] = [], actor = after.user?.id;
  const send = (employeeId: string, request: LeaveRequest, title: string) => {
    if (employeeId === actor || !after.employees.some(e => e.id === employeeId && e.status === 'active' && e.accountStatus === 'active')) return;
    result.push({ id: crypto.randomUUID(), employeeId, title, body: 'Buka rincian pengajuan untuk melihat informasi terbaru.',
      href: `/leave?request=${encodeURIComponent(request.id)}`, entityId: request.id, createdAt: new Date().toISOString(), readAt: null });
  };
  const reviewers = (request: LeaveRequest, title: string) => {
    const employee = after.employees.find(e => e.id === request.employeeId);
    if (!employee) return;
    if (employee.approvalMode === 'external') after.employees.filter(e => e.roles.includes('admin_hr') && e.id !== employee.id).forEach(e => send(e.id, request, title));
    else if (employee.managerId && employee.managerId !== employee.id) send(employee.managerId, request, title);
  };
  for (const request of after.leaveRequests) {
    const old = before.leaveRequests.find(r => r.id === request.id);
    if (!old) { reviewers(request, 'Pengajuan cuti/izin baru'); continue; }
    const adjustment = request.adjustment, previous = old.adjustment;
    if (adjustment?.status === 'pending' && adjustment.id !== previous?.id) reviewers(request, adjustment.type === 'cancel' ? 'Permintaan pembatalan cuti' : 'Permintaan perubahan cuti');
    if (adjustment && adjustment.id === previous?.id && previous.status === 'pending' && adjustment.status !== 'pending') {
      send(request.employeeId, request, adjustment.status === 'approved' ? 'Perubahan cuti disetujui' : 'Perubahan cuti ditolak'); continue;
    }
    if (request.status !== old.status) {
      if (request.status === 'pending') reviewers(request, 'Pengajuan dilengkapi kembali');
      else {
        const titles = { approved: 'Pengajuan disetujui', rejected: 'Pengajuan ditolak', needs_info: 'Pengajuan perlu dilengkapi', cancelled: 'Pengajuan dibatalkan' };
        send(request.employeeId, request, titles[request.status]);
        if (request.status === 'cancelled') reviewers(request, 'Pengajuan dibatalkan');
      }
    } else if (['startDate', 'endDate', 'startTime', 'endTime', 'reason', 'attachmentUrl', 'deductionDays', 'note', 'approverId', 'externalApproverName'].some(key => request[key as keyof LeaveRequest] !== old[key as keyof LeaveRequest])) {
      if (request.status === 'pending') reviewers(request, 'Pengajuan diperbarui');
      else if (request.status === 'approved') { send(request.employeeId, request, 'Catatan cuti dikoreksi HR'); reviewers(request, 'Catatan cuti dikoreksi HR'); }
    }
  }
  return result;
}
