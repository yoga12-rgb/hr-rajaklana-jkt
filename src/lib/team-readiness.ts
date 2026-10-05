import type { Employee, Outlet } from './types';

type ReadinessEmployee = Pick<Employee, 'id' | 'status' | 'accountStatus' | 'approvalMode' | 'managerId'>;
type ReadinessOutlet = Pick<Outlet, 'active' | 'latitude' | 'longitude' | 'radiusMeters'>;

export interface TeamReadinessSummary {
  activeOutlets: number;
  activeEmployees: number;
  outletsMissingLocation: number;
  employeesWithoutActiveAccount: number;
  employeesWithoutActiveApprover: number;
}

export function teamReadiness(employees: readonly ReadinessEmployee[], outlets: readonly ReadinessOutlet[]): TeamReadinessSummary {
  const activeEmployees = employees.filter((employee) => employee.status === 'active');
  const activeOutlets = outlets.filter((outlet) => outlet.active);
  const readyApprovers = new Set(activeEmployees.filter((employee) => employee.accountStatus === 'active').map((employee) => employee.id));

  return {
    activeOutlets: activeOutlets.length,
    activeEmployees: activeEmployees.length,
    outletsMissingLocation: activeOutlets.filter((outlet) =>
      outlet.latitude === null || !Number.isFinite(outlet.latitude) || Math.abs(outlet.latitude) > 90 ||
      outlet.longitude === null || !Number.isFinite(outlet.longitude) || Math.abs(outlet.longitude) > 180 ||
      !Number.isFinite(outlet.radiusMeters) || outlet.radiusMeters <= 0
    ).length,
    employeesWithoutActiveAccount: activeEmployees.filter((employee) => employee.accountStatus !== 'active').length,
    employeesWithoutActiveApprover: activeEmployees.filter((employee) =>
      employee.approvalMode === 'internal' &&
      (!employee.managerId || employee.managerId === employee.id || !readyApprovers.has(employee.managerId))
    ).length
  };
}
