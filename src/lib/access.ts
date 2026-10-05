import type { Employee } from './types';

type Reviewer = Pick<Employee, 'id' | 'status' | 'roles'>;
type TeamMember = Pick<Employee, 'id' | 'status' | 'managerId' | 'approvalMode'>;

export function hasApproverAccess(
  employee: Reviewer | null | undefined,
  employees: readonly TeamMember[]
): boolean {
  if (!employee || employee.status !== 'active') return false;
  if (employee.roles.includes('admin_hr') || employee.roles.includes('head_baker')) return true;
  return employees.some(member =>
    member.id !== employee.id &&
    member.status === 'active' &&
    member.approvalMode === 'internal' &&
    member.managerId === employee.id
  );
}
