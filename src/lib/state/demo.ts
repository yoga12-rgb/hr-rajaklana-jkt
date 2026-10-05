import type { AppState, Employee } from '../types';
import { jakartaDate } from '../domain';
export function initialDemo(): AppState {
  const defaults: Employee = { id: '', employeeNumber: '', fullName: '', phone: '081234567890', departmentId: 'dept-sales', positionId: '', outletId: 'outlet-a', managerId: 'employee-1', joinDate: '2025-01-01', status: 'active', employmentType: 'permanent', accountStatus: 'active', roles: ['employee'], canMiddleShift: false, weeklyOffDays: [0], approvalMode: 'internal', address: '', birthDate: '', gender: '', emergencyName: '', emergencyPhone: '' };
  return {
    mode: 'demo', initialized: false, loading: false, user: null, connected: true, error: null,
    departments: [
      { id: 'dept-production', code: 'PRD', name: 'Produksi', active: true },
      { id: 'dept-admin', code: 'ADM', name: 'Administrasi', active: true },
      { id: 'dept-sales', code: 'PSD', name: 'Penjualan & SDM', active: true },
      { id: 'dept-finance', code: 'SKF', name: 'Sarana, Prasarana & Keuangan', active: true },
      { id: 'dept-distribution', code: 'DPP', name: 'Distribusi & Persediaan Produk', active: true }
    ],
    positions: [
      { id: 'pos-spv', name: 'Supervisor Penjualan & SDM', departmentId: 'dept-sales', active: true, isCashier: false },
      { id: 'pos-baker', name: 'Head Baker', departmentId: 'dept-production', active: true, isCashier: false },
      { id: 'pos-assistant', name: 'Asisten Baker', departmentId: 'dept-production', active: true, isCashier: false },
      { id: 'pos-helper', name: 'Helper Produksi', departmentId: 'dept-production', active: true, isCashier: false },
      { id: 'pos-premix', name: 'Staf Premix', departmentId: 'dept-production', active: true, isCashier: false },
      { id: 'pos-stock', name: 'Stock Keeper Bahan Produksi', departmentId: 'dept-production', active: true, isCashier: false },
      { id: 'pos-cashier', name: 'Kasir', departmentId: 'dept-sales', active: true, isCashier: true },
      { id: 'pos-admin', name: 'Admin Operasional & Produksi', departmentId: 'dept-admin', active: true, isCashier: false },
      { id: 'pos-finance', name: 'Supervisor Sarpras & Keuangan', departmentId: 'dept-finance', active: true, isCashier: false },
      { id: 'pos-logistics', name: 'Staf Distribusi', departmentId: 'dept-distribution', active: true, isCashier: false },
      { id: 'pos-spv-stock', name: 'Supervisor Persediaan Produk Outlet', departmentId: 'dept-distribution', active: true, isCashier: false }
    ],
    outlets: [
      { id: 'outlet-a', code: 'OT001', name: 'Outlet Contoh A', address: 'Data contoh — ganti dengan outlet Jabodetabek Anda', active: true, isProduction: true, latitude: -6.2, longitude: 106.816666, radiusMeters: 100, opensAt: '07:00', closesAt: '23:00', morningStart: '07:00', afternoonStart: '15:00', lateToleranceMinutes: 0 },
      { id: 'outlet-b', code: 'OT002', name: 'Outlet Contoh B', address: 'Data contoh — lokasi belum dikonfigurasi', active: true, isProduction: false, latitude: null, longitude: null, radiusMeters: 100, opensAt: '08:00', closesAt: '22:00', morningStart: '07:00', afternoonStart: '15:00', lateToleranceMinutes: 0 }
    ],
    employees: [
      { ...defaults, id: 'employee-1', employeeNumber: 'RK000001', fullName: 'Alya Pratama', positionId: 'pos-spv', managerId: null, roles: ['employee', 'admin_hr'], approvalMode: 'external' },
      { ...defaults, id: 'employee-2', employeeNumber: 'RK000002', fullName: 'Dimas Saputra', positionId: 'pos-finance', departmentId: 'dept-finance', roles: ['employee', 'admin_hr'], weeklyOffDays: [1] },
      { ...defaults, id: 'employee-3', employeeNumber: 'RK000003', fullName: 'Raka Wijaya', positionId: 'pos-baker', departmentId: 'dept-production', roles: ['employee', 'head_baker'], weeklyOffDays: [2] },
      { ...defaults, id: 'employee-4', employeeNumber: 'RK000004', fullName: 'Nadia Putri', positionId: 'pos-cashier', canMiddleShift: true, weeklyOffDays: [] },
      { ...defaults, id: 'employee-5', employeeNumber: 'RK000005', fullName: 'Budi Santoso', positionId: 'pos-assistant', departmentId: 'dept-production', managerId: 'employee-3', weeklyOffDays: [3] },
      { ...defaults, id: 'employee-6', employeeNumber: 'RK000006', fullName: 'Sari Lestari', positionId: 'pos-cashier', outletId: 'outlet-b', weeklyOffDays: [] }
    ],
    leaveRequests: [
      { id: 'leave-example-1', employeeId: 'employee-5', type: 'personal', startDate: jakartaDate(), endDate: jakartaDate(), startTime: '10:00', endTime: '12:00', reason: 'Mengurus dokumen keluarga (data contoh)', status: 'pending', deductionDays: 0, approverId: 'employee-3', note: '', externalApproverName: '', createdAt: new Date().toISOString(), adjustment: null }
    ],
    leaveLedger: [], attendanceRecords: [], auditEntries: []
  };
}
