export type Role = 'employee' | 'admin_hr' | 'head_baker';
export type Shift = 'morning' | 'afternoon' | 'middle';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'needs_info' | 'cancelled';
export type LeaveExtent = 'full_day' | 'late_arrival' | 'temporary_exit' | 'early_departure';
export interface Department { id: string; name: string; code: string; active: boolean }
export interface Position { id: string; name: string; departmentId: string; active: boolean; isCashier: boolean }
export interface Outlet {
  id: string; code: string; name: string; address: string; active: boolean; isProduction: boolean;
  latitude: number | null; longitude: number | null; radiusMeters: number;
  opensAt: string; closesAt: string; morningStart: string; afternoonStart: string; lateToleranceMinutes: number;
  maxAccuracyMeters?: number;
}
export interface Employee {
  id: string; employeeNumber: string; fullName: string; phone: string; departmentId: string;
  positionId: string; outletId: string; managerId: string | null; joinDate: string;
  status: 'active' | 'inactive'; employmentType: 'permanent'; accountStatus: 'not_invited' | 'invited' | 'active' | 'disabled';
  authUserId?: string | null; roles: Role[]; canMiddleShift: boolean; weeklyOffDays: number[];
  approvalMode: 'internal' | 'external'; address: string; birthDate: string; gender: string;
  emergencyName: string; emergencyPhone: string; photoUrl?: string; exitDate?: string; exitReason?: string;
}
export interface LeaveAdjustment {
  id: string; type: 'change' | 'cancel'; startDate?: string; endDate?: string;
  reason: string; status: 'pending' | 'approved' | 'rejected'; requestedAt: string;
  note?: string; decidedAt?: string; deciderName?: string;
}
export interface LeaveRequest {
  id: string; employeeId: string; type: 'annual' | 'personal' | 'sick'; startDate: string; endDate: string;
  startTime: string; endTime: string; reason: string; status: LeaveStatus; deductionDays: number;
  approverId: string | null; note: string; externalApproverName: string; createdAt: string;
  adjustment: LeaveAdjustment | null;
  extent?: LeaveExtent; attachmentUrl?: string; attachmentName?: string;
  attachmentPath?: string;
}
export interface AttendanceRecord {
  id: string; employeeId: string; outletId: string; shift: Shift; clockIn: string; clockOut: string | null;
  workDate?: string;
  scheduledStart: string | null; lateMinutes: number; durationMinutes: number | null;
  inLatitude: number | null; inLongitude: number | null; inAccuracy: number | null; inDistance: number | null;
  outLatitude?: number | null; outLongitude?: number | null; outDistance?: number | null; outAccuracy?: number | null;
  selfiePath: string; selfieUrl?: string; corrected: boolean; correctionReason: string;
  // Device capture metadata is distinct from the recorded clock-in time.
  selfieCapturedAt?: string; selfieOutletName?: string;
  source?: 'device' | 'manual';
  assignmentId?: string | null;
  outletSnapshot?: Pick<Outlet, 'morningStart' | 'afternoonStart' | 'lateToleranceMinutes' | 'latitude' | 'longitude' | 'radiusMeters'>;
}
export interface AuditEntry { id: string; actorId: string; action: string; entityId: string; at: string; detail: string }
export interface LeaveLedgerEntry { id: string; employeeId: string; year: number; days: number; requestId: string }
export interface AppNotification {
  id: string; employeeId: string; title: string; body: string; href: string;
  entityId: string; createdAt: string; readAt: string | null;
  entityType?: 'leave' | 'attendance_correction' | 'assignment' | 'assignment_week' | 'attendance_reminder';
}
export interface CashierAssignment {
  id: string; employeeId: string; workDate: string; outletId: string; shift: Shift | 'off';
  status: 'active' | 'cancelled'; reason: string; createdBy: string;
  createdAt: string; updatedAt: string;
}
export interface AttendanceCorrectionRequest {
  id: string; employeeId: string; attendanceId: string | null; workDate: string; outletId: string; shift: Shift;
  proposedClockIn: string; proposedClockOut: string | null; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; decisionNote: string;
  decisionBy: string | null; createdAt: string; decidedAt: string | null;
  originalSnapshot?: { clockIn: string; clockOut: string | null; shift: Shift; outletId: string } | null;
}
export interface StaffingRequirement {
  id: string; outletId: string; weekday: number; shift: Shift; minimum: number; effectiveFrom: string;
  createdBy: string; createdAt: string; updatedAt: string;
}
export type SpvFollowupIssue = 'missing_clockin' | 'unassigned' | 'open_session' | 'unexcused_lateness' | 'correction_pending' | 'leave_conflict' | 'short_duration';
export interface SpvFollowup {
  id: string; caseKey: string; issueType: SpvFollowupIssue; sourceType: 'assignment' | 'attendance' | 'correction' | 'roster';
  sourceId: string | null; workDate: string; outletId: string; employeeId: string | null; shift: Shift | 'off' | null;
  ownerId: string | null; status: 'new' | 'in_progress' | 'completed'; note: string; resolutionNote: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; reopenedCount: number;
}
export interface CashierRosterChange {
  id?: string; employeeId: string; workDate: string; outletId: string; shift: Shift | 'off'; reason: string;
  expectedUpdatedAt?: string | null; cancel?: boolean;
}
export interface StaffingRequirementInput { outletId: string; weekday: number; shift: Shift; minimum: number; effectiveFrom: string }
export interface SpvFollowupInput {
  issueType: SpvFollowupIssue; sourceType: SpvFollowup['sourceType']; sourceId: string | null;
  workDate: string; outletId: string; employeeId: string | null; shift: Shift | 'off' | null;
}
export interface SpvFollowupUpdate { id: string; status: SpvFollowup['status']; ownerId: string | null; note: string; resolutionNote: string }
export interface CashierAssignmentInput {
  id?: string; employeeId: string; workDate: string; outletId: string; shift: Shift | 'off'; reason: string; cancel?: boolean;
}
export interface AttendanceCorrectionInput {
  attendanceId: string | null; workDate: string; clockIn: string; clockOut: string | null; shift: Shift; reason: string;
}
export interface RetrospectiveLeaveInput {
  employeeId: string; type: 'personal' | 'sick'; startDate: string; endDate: string; reason: string;
  extent: LeaveExtent; startTime?: string; endTime?: string; deductionDays: number; note: string; externalApproverName?: string;
}
export interface AppState {
  mode: 'demo' | 'live'; initialized: boolean; loading: boolean; user: Employee | null;
  employees: Employee[]; outlets: Outlet[]; departments: Department[]; positions: Position[];
  leaveRequests: LeaveRequest[]; attendanceRecords: AttendanceRecord[]; auditEntries: AuditEntry[];
  leaveLedger: LeaveLedgerEntry[];
  notifications?: AppNotification[];
  cashierAssignments?: CashierAssignment[];
  attendanceCorrectionRequests?: AttendanceCorrectionRequest[];
  staffingRequirements?: StaffingRequirement[];
  spvFollowups?: SpvFollowup[];
  balanceCache?: Record<string, number>;
  connected: boolean; error: string | null;
}
export interface LeaveInput { type: LeaveRequest['type']; startDate: string; endDate: string; startTime?: string; endTime?: string; reason: string; attachment?: File; extent?: LeaveExtent }
export interface LeaveDecision { decision: 'approve' | 'reject' | 'needs_info'; deductionDays: number; note?: string; externalApproverName?: string }
export interface ClockInInput { outletId: string; shift: Shift; latitude: number; longitude: number; accuracy: number; selfie: Blob; selfieCapturedAt?: string; selfieOutletName?: string; geoCapturedAt?: string; verificationToken?: string }
export interface ClockOutInput { latitude: number; longitude: number; accuracy: number; geoCapturedAt?: string }
