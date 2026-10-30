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
  entityType?: 'leave' | 'attendance_correction' | 'assignment' | 'assignment_week' | 'attendance_reminder' | 'spv_followup' | 'outlet_issue' | 'handover' | 'shift_exchange';
}
export interface CashierAssignment {
  id: string; employeeId: string; workDate: string; outletId: string; shift: Shift | 'off';
  status: 'active' | 'cancelled'; reason: string; createdBy: string;
  createdAt: string; updatedAt: string;
  // These are snapshots for coverage planning.  Missing values on older rows
  // deliberately remain unknown; a client must never invent a Middle interval.
  plannedStartsAt?: string | null; plannedEndsAt?: string | null;
  plannedEndsNextDay?: boolean; plannedSource?: 'unknown' | 'outlet_snapshot' | 'manual_middle';
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
  revision: number; dueAt: string | null;
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
export type SpvFollowupView = 'all_open' | 'mine' | 'unassigned' | 'overdue' | 'history';
export interface SpvFollowupPage {
  items: SpvFollowup[]; total: number; hasMore: boolean; nextCursor: Record<string, string | number> | null; asOf: string;
}
export interface SpvFollowupUpdate {
  id: string; expectedRevision: number; idempotencyKey: string; status: SpvFollowup['status']; ownerId: string | null;
  note: string; resolutionNote: string; dueAt: string | null; reason: string;
}
export type SupervisorCapabilityName =
  | 'issue_report' | 'issue_report_for_other' | 'issue_view' | 'issue_handle' | 'issue_configure'
  | 'handover_monitor' | 'summary_view' | 'coverage_configure';
export interface SupervisorIssueCategory {
  id: string; code: string; name: string; active: boolean; revision: number; createdBy?: string; createdAt?: string; updatedAt: string;
}
export interface SupervisorCapability {
  id: string; employeeId: string; capability: SupervisorCapabilityName; outletId: string | null;
  categoryId: string | null; grantedBy: string; revision: number; createdAt: string; updatedAt: string;
}
export interface SupervisorCapabilitySaveInput {
  id?: string | null; expectedRevision?: number | null; idempotencyKey: string;
  employeeId: string; capability: SupervisorCapabilityName; outletId?: string | null; categoryId?: string | null; granted: boolean;
}
export type SupervisorCapabilitySaveResult =
  | { granted: true; capability: SupervisorCapability }
  | { granted: false; id: string; employeeId: string; capability: SupervisorCapabilityName; outletId: string | null; categoryId: string | null; revision: number };
export type OutletIssueUrgency = 'low' | 'normal' | 'high' | 'urgent';
export type OutletIssueStatus = 'new' | 'assigned' | 'in_progress' | 'completed';
export type OutletIssueView = 'open' | 'mine' | 'unassigned' | 'history';
export interface OutletIssue {
  id: string; issueNumber: number; outletId: string; reporterEmployeeId: string | null; createdBy: string;
  categoryId: string; categoryName: string; routedToEmployeeId: string | null; ownerId: string | null;
  urgency: OutletIssueUrgency; description: string; photoPath: string | null; status: OutletIssueStatus;
  dueAt: string | null; resolutionNote: string; revision: number; createdAt: string; updatedAt: string;
  completedAt: string | null;
}
export interface SupervisorPage<T> {
  items: T[]; total: number; hasMore: boolean; nextCursor: Record<string, string | number> | null; asOf: string;
}
export interface OutletIssueSubmitInput {
  outletId: string; categoryId: string; description: string; urgency: OutletIssueUrgency;
  reporterEmployeeId?: string | null; idempotencyKey: string; photo?: File | null;
  // A persisted draft/replay keeps the same stored object path rather than
  // selecting a newly uploaded image after a response is lost.
  photoPath?: string | null;
}
export interface SupervisorIssueCategorySaveInput {
  id?: string | null; expectedRevision?: number | null; idempotencyKey: string; code: string; name: string; active: boolean;
}
export interface SupervisorIssueRouteSaveInput {
  id?: string | null; expectedRevision?: number | null; idempotencyKey: string;
  categoryId: string; outletId?: string | null; recipientEmployeeId?: string | null; active: boolean;
}
export interface SupervisorIssueRoute {
  id: string; categoryId: string; outletId: string | null; recipientEmployeeId: string | null; active: boolean;
  revision: number; createdBy: string; createdAt: string; updatedAt: string;
}
export interface SupervisorOperationConfiguration {
  categories: SupervisorIssueCategory[]; routes: SupervisorIssueRoute[]; capabilities: SupervisorCapability[]; asOf: string;
}
export interface OutletIssueUpdate {
  id: string; expectedRevision: number; idempotencyKey: string; status: OutletIssueStatus;
  ownerId: string | null; dueAt: string | null; resolutionNote: string; reason: string;
}
export type ShiftHandoverStatus = 'draft' | 'sent' | 'accepted' | 'revision_requested';
export interface ShiftHandover {
  id: string; outletId: string; workDate: string; senderEmployeeId: string; senderAssignmentId: string | null;
  recipientEmployeeId: string | null; recipientAssignmentId: string | null; status: ShiftHandoverStatus; version: number;
  pendingWork: string; outletCondition: string; notes: string; sentAt: string | null; acceptedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ShiftHandoverSaveInput {
  id?: string | null; expectedVersion?: number | null; idempotencyKey: string; outletId: string; workDate: string;
  senderAssignmentId: string; recipientEmployeeId: string | null; recipientAssignmentId: string | null;
  pendingWork: string; outletCondition: string; notes: string; send: boolean; reason: string;
}
export interface ShiftHandoverResponseInput {
  id: string; expectedVersion: number; idempotencyKey: string; accept: boolean; reason: string;
}
export type ShiftExchangeType = 'swap' | 'replacement';
export type ShiftExchangeStatus = 'pending_peer' | 'pending_spv' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type ShiftExchangeView = 'active' | 'history' | 'pending_spv';
export interface ShiftExchangeRequest {
  id: string; requestNumber: number; requestType: ShiftExchangeType; workDate: string;
  requesterEmployeeId: string; peerEmployeeId: string; requesterAssignmentId: string; peerAssignmentId: string | null;
  requesterAssignmentUpdatedAt: string; peerAssignmentUpdatedAt: string | null; reason: string; status: ShiftExchangeStatus;
  peerNote: string; decisionNote: string; decidedBy: string | null; revision: number;
  createdAt: string; updatedAt: string; decidedAt: string | null;
}
export interface ShiftExchangeSubmitInput {
  requestType: ShiftExchangeType; requesterAssignmentId: string; peerEmployeeId: string; reason: string; idempotencyKey: string;
}
export interface ShiftExchangeResponseInput {
  id: string; expectedRevision: number; idempotencyKey: string; accept: boolean; note: string;
}
export interface ShiftExchangeDecisionInput {
  id: string; expectedRevision: number; idempotencyKey: string; approved: boolean; note: string;
}
export interface ShiftExchangeCancelInput {
  id: string; expectedRevision: number; idempotencyKey: string; note: string;
}
export interface StaffingIntervalRequirement {
  id: string; outletId: string; weekday: number; startsAt: string; endsAt: string; minimum: number;
  effectiveFrom: string; effectiveUntil: string | null; revision: number; createdBy: string; createdAt: string; updatedAt: string;
}
export interface StaffingIntervalRequirementInput {
  id?: string | null; expectedRevision?: number | null; idempotencyKey: string; outletId: string; weekday: number;
  startsAt: string; endsAt: string; minimum: number; effectiveFrom: string; effectiveUntil: string | null; reason: string;
}
export interface CashierAssignmentPlanInput {
  assignmentId: string; expectedUpdatedAt: string; idempotencyKey: string; startsAt: string; endsAt: string; reason: string;
}
export interface SupervisorCoverageSegment {
  requirementId: string; startsAt: string; endsAt: string; minimum: number; plannedCount: number; availableCount: number;
  attendanceRecordedCount: number; shortage: number; employeeIds: string[];
}
export interface SupervisorCoverage {
  outletId: string; workDate: string; asOf: string; configured: boolean; coverage: SupervisorCoverageSegment[];
  unknownMiddleCount: number; unknownMiddleEmployeeIds: string[];
  legacyShiftRequirements: Array<{ shift: Shift; minimum: number }>;
}
export interface SupervisorReportSummary {
  scheduledDays: number; attendanceDays: number; approvedFullLeaveDays: number; approvedPartialLeaveDays: number;
  lateMinutes: number; corrections: number; coverageUnconfiguredDays: number; coverageShortageIntervals: number;
  coverageUnknownMiddleAssignments: number; followupsOpenNow: number | null; followupsCompletedNow: number | null;
  followupsOverdueNow: number | null;
}
export interface SupervisorReportPerson {
  employeeId: string; scheduledDays: number; attendanceDays: number; approvedFullLeaveDays: number;
  approvedPartialLeaveDays: number; lateMinutes: number; corrections: number;
}
export interface SupervisorReportDetail {
  employeeId: string | null; workDate: string; outletId: string; shift: Shift | 'off';
  plannedSource: CashierAssignment['plannedSource']; attendanceRecorded: boolean; fullLeave: boolean;
  partialLeave: boolean; lateMinutes: number; corrections: number;
}
export interface SupervisorReport {
  from: string; to: string; outletId: string | null; employeeId: string | null; asOf: string; basis: string;
  summary: SupervisorReportSummary; people: SupervisorReportPerson[]; details: SupervisorReportDetail[];
}
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
  // Bumps only when the authoritative data snapshot changes. Feature pages
  // use this to refetch their paged/query-local data after Realtime refreshes
  // without treating a connection-indicator change as a data conflict.
  dataRevision?: number;
  connected: boolean; error: string | null;
}
export interface LeaveInput { type: LeaveRequest['type']; startDate: string; endDate: string; startTime?: string; endTime?: string; reason: string; attachment?: File; extent?: LeaveExtent }
export interface LeaveDecision { decision: 'approve' | 'reject' | 'needs_info'; deductionDays: number; note?: string; externalApproverName?: string }
export interface ClockInInput { outletId: string; shift: Shift; latitude: number; longitude: number; accuracy: number; selfie: Blob; selfieCapturedAt?: string; selfieOutletName?: string; geoCapturedAt?: string; verificationToken?: string }
export interface ClockOutInput { latitude: number; longitude: number; accuracy: number; geoCapturedAt?: string }
