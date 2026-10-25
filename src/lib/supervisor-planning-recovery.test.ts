import { describe, expect, it } from 'vitest';
import { listPlanningPending, planningPendingKey, readPlanningPending, writePlanningPending } from './supervisor-planning-recovery';

const account = 'employee-a';
const requirement = {
  id: null, expectedRevision: null, idempotencyKey: '40000000-0000-4000-8000-000000000001', outletId: 'outlet-a', weekday: 1,
  startsAt: '07:00', endsAt: '15:00', minimum: 2, effectiveFrom: '2026-10-26', effectiveUntil: null, reason: ''
};
const middle = {
  assignmentId: 'assignment-a', expectedUpdatedAt: '2026-10-24T01:00:00.000Z', idempotencyKey: '40000000-0000-4000-8000-000000000002',
  startsAt: '15:00', endsAt: '23:00', reason: 'Kebutuhan layanan sore hari'
};
function storage() {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; }, getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null, map
  };
}

describe('supervisor planning recovery', () => {
  it('persists the original payload/key across reloads only for its account and entity', () => {
    const local = storage();
    writePlanningPending(local, account, 'requirement', 'new', requirement);
    const first = readPlanningPending<typeof requirement>(local, account, 'requirement', 'new');
    expect(first).toEqual(requirement);
    const second = readPlanningPending<typeof requirement>(local, account, 'requirement', 'new');
    expect(second?.idempotencyKey).toBe(requirement.idempotencyKey);
    expect(readPlanningPending(local, 'employee-b', 'requirement', 'new')).toBeNull();
  });

  it('discovers a pending Middle save after a cold reload without exposing another account', () => {
    const local = storage();
    writePlanningPending(local, account, 'middle', middle.assignmentId, middle);
    writePlanningPending(local, 'employee-b', 'middle', 'assignment-b', { ...middle, assignmentId: 'assignment-b', idempotencyKey: '40000000-0000-4000-8000-000000000003' });
    expect(listPlanningPending(local, account)).toMatchObject([{ kind: 'middle', entity: 'assignment-a', payload: middle }]);
  });

  it('clears malformed or mismatched recovery records instead of replaying a different payload', () => {
    const local = storage(); const key = planningPendingKey(account, 'middle', middle.assignmentId);
    local.setItem(key, JSON.stringify({ version: 1, accountId: account, kind: 'middle', entity: middle.assignmentId, payload: { ...middle, idempotencyKey: 'not-a-uuid' } }));
    expect(readPlanningPending(local, account, 'middle', middle.assignmentId)).toBeNull();
    expect(local.getItem(key)).toBeNull();
  });
});
