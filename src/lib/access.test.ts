import { describe, expect, it } from 'vitest';
import { hasApproverAccess } from './access';
import type { Employee } from './types';

const reviewer = (roles: Employee['roles'] = ['employee'], status: Employee['status'] = 'active') => ({ id: 'manager', roles, status });
const member = (overrides: Partial<Pick<Employee, 'id' | 'status' | 'managerId' | 'approvalMode'>> = {}) => ({
  id: 'team-member', status: 'active' as const, managerId: 'manager', approvalMode: 'internal' as const, ...overrides
});

describe('Akses peninjauan pengajuan tim', () => {
  it('membuka ruang persetujuan bagi atasan internal meskipun hanya memiliki peran karyawan', () => {
    expect(hasApproverAccess(reviewer(), [member()])).toBe(true);
    expect(hasApproverAccess(reviewer(), [member({ managerId: 'other-manager' })])).toBe(false);
  });

  it('mempertahankan akses Admin HR dan Head Baker tanpa memberikan akses kepada karyawan lain', () => {
    expect(hasApproverAccess(reviewer(['employee', 'admin_hr']), [])).toBe(true);
    expect(hasApproverAccess(reviewer(['employee', 'head_baker']), [])).toBe(true);
    expect(hasApproverAccess(reviewer(), [])).toBe(false);
  });

  it('tidak memberikan akses tambahan dari hubungan diri sendiri atau keputusan eksternal', () => {
    expect(hasApproverAccess(reviewer(), [member({ id: 'manager' })])).toBe(false);
    expect(hasApproverAccess(reviewer(), [member({ approvalMode: 'external' })])).toBe(false);
    expect(hasApproverAccess(reviewer(['employee', 'admin_hr']), [member({ approvalMode: 'external' })])).toBe(true);
  });

  it('menolak pengguna nonaktif, pengguna belum masuk, dan hubungan tim nonaktif', () => {
    expect(hasApproverAccess(reviewer(['admin_hr'], 'inactive'), [member()])).toBe(false);
    expect(hasApproverAccess(null, [member()])).toBe(false);
    expect(hasApproverAccess(undefined, [member()])).toBe(false);
    expect(hasApproverAccess(reviewer(), [member({ status: 'inactive' })])).toBe(false);
  });
});
