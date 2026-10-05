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
}
export interface LeaveRequest {
  id: string; employeeId: string; type: 'annual' | 'personal' | 'sick'; startDate: string; endDate: string;
  startTime: string; endTime: string; reason: string; status: LeaveStatus; deductionDays: number;
  approverId: string | null; note: string; externalApproverName: string; createdAt: string;
  adjustment: LeaveAdjustment | null;
  extent?: LeaveExtent; attachmentUrl?: string; attachmentName?: string;
}
export interface AttendanceRecord {
  id: string; employeeId: string; outletId: string; shift: Shift; clockIn: string; clockOut: string | null;
  scheduledStart: string | null; lateMinutes: number; durationMinutes: number | null;
  inLatitude: number | null; inLongitude: number | null; inAccuracy: number | null; inDistance: number | null;
  outLatitude?: number | null; outLongitude?: number | null; outDistance?: number | null; outAccuracy?: number | null;
  selfiePath: string; selfieUrl?: string; corrected: boolean; correctionReason: string;
  source?: 'device' | 'manual';
}
export interface AuditEntry { id: string; actorId: string; action: string; entityId: string; at: string; detail: string }
export interface LeaveLedgerEntry { id: string; employeeId: string; year: number; days: number; requestId: string }
export interface AppState {
  mode: 'demo' | 'live'; initialized: boolean; loading: boolean; user: Employee | null;
  employees: Employee[]; outlets: Outlet[]; departments: Department[]; positions: Position[];
  leaveRequests: LeaveRequest[]; attendanceRecords: AttendanceRecord[]; auditEntries: AuditEntry[];
  leaveLedger: LeaveLedgerEntry[];
  balanceCache?: Record<string, number>;
  connected: boolean; error: string | null;
}
export interface LeaveInput { type: LeaveRequest['type']; startDate: string; endDate: string; startTime?: string; endTime?: string; reason: string; attachment?: File; extent?: LeaveExtent }
export interface LeaveDecision { decision: 'approve' | 'reject' | 'needs_info'; deductionDays: number; note?: string; externalApproverName?: string }
export interface ClockInInput { outletId: string; shift: Shift; latitude: number; longitude: number; accuracy: number; selfie: Blob }
export interface ClockOutInput { latitude: number; longitude: number; accuracy: number }
