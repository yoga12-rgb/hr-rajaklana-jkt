import { describe, expect, it } from 'vitest';
import type { Employee, Outlet } from './types';
import { teamReadiness } from './team-readiness';

type ReadinessEmployee = Pick<Employee, 'id' | 'status' | 'accountStatus' | 'approvalMode' | 'managerId'>;
type ReadinessOutlet = Pick<Outlet, 'active' | 'latitude' | 'longitude' | 'radiusMeters'>;
const employee = (id: string, overrides: Partial<ReadinessEmployee> = {}): ReadinessEmployee => ({ id, status: 'active', accountStatus: 'active', approvalMode: 'internal', managerId: 'manager', ...overrides });
const outlet = (overrides: Partial<ReadinessOutlet> = {}): ReadinessOutlet => ({ active: true, latitude: -6.2, longitude: 106.8, radiusMeters: 100, ...overrides });

describe('team readiness', () => {
  it('counts only active outlets and employees while allowing categories to overlap', () => {
    const employees = [employee('manager', { approvalMode: 'external', managerId: null }), employee('staff'), employee('new', { accountStatus: 'invited', managerId: null }), employee('former', { status: 'inactive', accountStatus: 'disabled', managerId: null })];
    expect(teamReadiness(employees, [outlet(), outlet({ latitude: null }), outlet({ active: false, latitude: null })])).toEqual({ activeEmployees: 3, activeOutlets: 2, outletsMissingLocation: 1, employeesWithoutActiveAccount: 1, employeesWithoutActiveApprover: 1 });
  });

  it('rejects missing, out-of-range, and non-finite coordinates or invalid radii', () => {
    const invalid = [outlet({ latitude: null }), outlet({ longitude: null }), outlet({ latitude: NaN }), outlet({ longitude: Infinity }), outlet({ latitude: 90.01 }), outlet({ longitude: -180.01 }), outlet({ radiusMeters: 0 }), outlet({ radiusMeters: -1 }), outlet({ radiusMeters: Infinity })];
    expect(teamReadiness([], invalid).outletsMissingLocation).toBe(invalid.length);
    expect(teamReadiness([], [outlet({ latitude: 0, longitude: 0 }), outlet({ latitude: 90, longitude: 180, radiusMeters: 1 }), outlet({ latitude: -90, longitude: -180 })]).outletsMissingLocation).toBe(0);
  });

  it('flags internal employees whose approver is missing or has left', () => {
    expect(teamReadiness([employee('staff'), employee('manager', { status: 'inactive', approvalMode: 'external' }), employee('missing', { managerId: 'unknown' }), employee('unset', { managerId: null })], []).employeesWithoutActiveApprover).toBe(3);
  });

  it('requires an active approver account and does not allow self-approval', () => {
    const employees = [employee('staff'), employee('manager', { accountStatus: 'disabled', approvalMode: 'external' }), employee('self', { managerId: 'self' })];
    expect(teamReadiness(employees, []).employeesWithoutActiveApprover).toBe(2);
    expect(teamReadiness([employee('manager', { approvalMode: 'external' }), employee('staff')], []).employeesWithoutActiveApprover).toBe(0);
  });

  it('does not request an internal approver for externally decided employees', () => {
    expect(teamReadiness([employee('spv', { approvalMode: 'external', managerId: null }), employee('head-office', { approvalMode: 'external', managerId: 'head-office' })], []).employeesWithoutActiveApprover).toBe(0);
  });
});
