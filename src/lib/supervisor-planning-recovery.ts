import type { CashierAssignmentPlanInput, StaffingIntervalRequirementInput } from './types';

export type PlanningPendingKind = 'requirement' | 'middle';
export type PlanningPendingPayload = StaffingIntervalRequirementInput | CashierAssignmentPlanInput;
type PlanningStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface PlanningPendingEnvelope<T extends PlanningPendingPayload = PlanningPendingPayload> {
  version: 1;
  accountId: string;
  kind: PlanningPendingKind;
  entity: string;
  payload: T;
}

const namespace = 'rajaklana:planning:v2';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = /^\d{4}-\d{2}-\d{2}$/;
const time = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const string = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is string => typeof value === 'string' && value.length >= min && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isUuid = (value: unknown): value is string => string(value, 36, 36) && uuid.test(value);
const isDate = (value: unknown): value is string => string(value, 10, 10) && date.test(value);
const isTime = (value: unknown): value is string => string(value, 5, 8) && time.test(value);

export function planningPendingKey(accountId: string, kind: PlanningPendingKind, entity: string) {
  return `${namespace}:${accountId}:${kind}:${entity}`;
}

function isRequirement(value: unknown): value is StaffingIntervalRequirementInput {
  if (!record(value)) return false;
  return (value.id === undefined || value.id === null || string(value.id, 1, 80))
    && (value.expectedRevision === undefined || value.expectedRevision === null || (Number.isInteger(value.expectedRevision) && Number(value.expectedRevision) > 0))
    && isUuid(value.idempotencyKey)
    && string(value.outletId, 1, 80) && Number.isInteger(value.weekday) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6
    && isTime(value.startsAt) && isTime(value.endsAt)
    && Number.isInteger(value.minimum) && Number(value.minimum) >= 0 && Number(value.minimum) <= 100
    && isDate(value.effectiveFrom)
    && (value.effectiveUntil === null || isDate(value.effectiveUntil))
    && string(value.reason, 0, 2000);
}

function isMiddle(value: unknown): value is CashierAssignmentPlanInput {
  if (!record(value)) return false;
  return string(value.assignmentId, 1, 80) && string(value.expectedUpdatedAt, 1, 80)
    && isUuid(value.idempotencyKey)
    && isTime(value.startsAt) && isTime(value.endsAt)
    && string(value.reason, 5, 2000);
}

function parse(value: string | null): PlanningPendingEnvelope | null {
  if (!value) return null;
  try {
    const raw: unknown = JSON.parse(value);
    if (!record(raw) || raw.version !== 1 || (raw.kind !== 'requirement' && raw.kind !== 'middle')
      || !string(raw.accountId, 1, 128) || !string(raw.entity, 1, 128)) return null;
    if (raw.kind === 'requirement' ? !isRequirement(raw.payload) : !isMiddle(raw.payload)) return null;
    return raw as unknown as PlanningPendingEnvelope;
  } catch { return null; }
}

export function writePlanningPending(storage: PlanningStorage, accountId: string, kind: PlanningPendingKind, entity: string, payload: PlanningPendingPayload | null) {
  const key = planningPendingKey(accountId, kind, entity);
  if (!payload) { storage.removeItem(key); return; }
  const envelope: PlanningPendingEnvelope = { version: 1, accountId, kind, entity, payload };
  storage.setItem(key, JSON.stringify(envelope));
}

export function readPlanningPending<T extends PlanningPendingPayload>(storage: PlanningStorage, accountId: string, kind: PlanningPendingKind, entity: string): T | null {
  const key = planningPendingKey(accountId, kind, entity);
  const envelope = parse(storage.getItem(key));
  if (!envelope || envelope.accountId !== accountId || envelope.kind !== kind || envelope.entity !== entity) {
    if (storage.getItem(key) !== null) storage.removeItem(key);
    return null;
  }
  return envelope.payload as T;
}

export function listPlanningPending(storage: PlanningStorage, accountId: string): PlanningPendingEnvelope[] {
  const prefix = `${namespace}:${accountId}:`;
  const result: PlanningPendingEnvelope[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const envelope = parse(storage.getItem(key));
    if (!envelope || envelope.accountId !== accountId || !key.endsWith(`:${envelope.entity}`)) {
      storage.removeItem(key);
      continue;
    }
    result.push(envelope);
  }
  return result;
}
