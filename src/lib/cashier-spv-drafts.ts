import type { CashierAssignment, CashierRosterChange, Shift } from './types';

export type CashierRosterDraftCell = { shift: Shift | 'off' | ''; outletId: string };
export type CashierRosterBaseline = {
  id: string | null;
  updatedAt: string | null;
  status: 'empty' | 'active' | 'cancelled';
  shift: CashierRosterDraftCell['shift'];
  outletId: string;
};
export type CashierRosterDraftEntry = CashierRosterDraftCell & {
  baseline: CashierRosterBaseline | null;
  needsReview: boolean;
};
export type CashierRosterSaveAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  weekStart: string;
  changes: CashierRosterChange[];
};
export type CashierRosterDraft = {
  drafts: Record<string, CashierRosterDraftEntry>;
  reason: string;
  pendingAttempt: CashierRosterSaveAttempt | null;
  legacyAttemptNeedsReview: boolean;
};

const allowedShifts = new Set(['', 'morning', 'afternoon', 'middle', 'off']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
};

export function cashierRosterDraftStorageKey(employeeId: string, weekStart: string): string {
  // Keep the v1 key so existing browser drafts can be migrated in place.
  return `rajaklana-hr-roster-draft-v1:${encodeURIComponent(employeeId)}:${weekStart}`;
}

export function cashierRosterBaseline(
  assignment: Pick<CashierAssignment, 'id' | 'updatedAt' | 'status' | 'shift' | 'outletId'> | undefined,
  defaultOutletId: string
): CashierRosterBaseline {
  return assignment
    ? { id: assignment.id, updatedAt: assignment.updatedAt, status: assignment.status, shift: assignment.shift, outletId: assignment.outletId }
    : { id: null, updatedAt: null, status: 'empty', shift: '', outletId: defaultOutletId };
}

export function cashierRosterBaselinesEqual(a: CashierRosterBaseline | null, b: CashierRosterBaseline): boolean {
  return !!a && a.id === b.id && a.updatedAt === b.updatedAt && a.status === b.status
    && a.shift === b.shift && a.outletId === b.outletId;
}

function parseCell(value: unknown): CashierRosterDraftCell | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cell = value as Record<string, unknown>;
  if (typeof cell.shift !== 'string' || !allowedShifts.has(cell.shift) || typeof cell.outletId !== 'string' || cell.outletId.length > 200) return null;
  return { shift: cell.shift as CashierRosterDraftCell['shift'], outletId: cell.outletId };
}

function parseBaseline(value: unknown): CashierRosterBaseline | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const baseline = value as Record<string, unknown>;
  if (!(baseline.id === null || typeof baseline.id === 'string' && baseline.id.length <= 200)
    || !(baseline.updatedAt === null || typeof baseline.updatedAt === 'string' && Number.isFinite(Date.parse(baseline.updatedAt)))
    || !['empty', 'active', 'cancelled'].includes(String(baseline.status))
    || typeof baseline.shift !== 'string' || !allowedShifts.has(baseline.shift)
    || typeof baseline.outletId !== 'string' || baseline.outletId.length > 200) return null;
  if (baseline.status === 'empty' && (baseline.id !== null || baseline.updatedAt !== null)
    || baseline.status !== 'empty' && (!baseline.id || !baseline.updatedAt)) return null;
  return { id: baseline.id as string | null, updatedAt: baseline.updatedAt as string | null,
    status: baseline.status as CashierRosterBaseline['status'], shift: baseline.shift as CashierRosterBaseline['shift'], outletId: baseline.outletId };
}

function parseAttempt(fingerprint: unknown, idempotencyKey: unknown): CashierRosterSaveAttempt | null {
  if (typeof fingerprint !== 'string' || fingerprint.length > 500_000 || typeof idempotencyKey !== 'string' || !uuid.test(idempotencyKey)) return null;
  try {
    const value: unknown = JSON.parse(fingerprint);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const attempt = value as Record<string, unknown>;
    if (!validDay(attempt.weekStart) || !Array.isArray(attempt.changes) || attempt.changes.length < 1 || attempt.changes.length > 500) return null;
    const changes: CashierRosterChange[] = [];
    for (const raw of attempt.changes) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const change = raw as Record<string, unknown>;
      if (typeof change.employeeId !== 'string' || !change.employeeId || !validDay(change.workDate)
        || typeof change.outletId !== 'string' || !change.outletId
        || typeof change.shift !== 'string' || !['morning', 'afternoon', 'middle', 'off'].includes(change.shift)
        || typeof change.reason !== 'string' || !(change.id === undefined || change.id === null || typeof change.id === 'string')
        || !(change.expectedUpdatedAt === undefined || change.expectedUpdatedAt === null || typeof change.expectedUpdatedAt === 'string')
        || !(change.cancel === undefined || typeof change.cancel === 'boolean')) return null;
      changes.push({ id: change.id as string | undefined, employeeId: change.employeeId, workDate: change.workDate,
        outletId: change.outletId, shift: change.shift as CashierRosterChange['shift'], reason: change.reason,
        expectedUpdatedAt: change.expectedUpdatedAt as string | null | undefined, cancel: change.cancel as boolean | undefined });
    }
    return { fingerprint, idempotencyKey, weekStart: attempt.weekStart, changes };
  } catch { return null; }
}

function parseDraftEntries(raw: unknown, legacy: boolean): Record<string, CashierRosterDraftEntry> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 500) return null;
  const drafts: Record<string, CashierRosterDraftEntry> = {};
  for (const [key, value] of entries) {
    const separator = key.lastIndexOf(':');
    const employeeId = key.slice(0, separator), day = key.slice(separator + 1);
    if (!employeeId || !validDay(day)) return null;
    const cell = parseCell(value);
    if (!cell) return null;
    if (legacy) {
      drafts[key] = { ...cell, baseline: null, needsReview: true };
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    const baseline = entry.baseline === null ? null : parseBaseline(entry.baseline);
    if (entry.baseline !== null && !baseline || typeof entry.needsReview !== 'boolean') return null;
    drafts[key] = { ...cell, baseline, needsReview: entry.needsReview || !baseline };
  }
  return drafts;
}

export function serializeCashierRosterDraft(value: CashierRosterDraft): string {
  return JSON.stringify({ version: 2, ...value });
}

export function parseCashierRosterDraft(serialized: string | null): CashierRosterDraft | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.reason !== 'string' || candidate.reason.length > 2000) return null;
    if (candidate.version === 1) {
      const drafts = parseDraftEntries(candidate.drafts, true);
      if (!drafts) return null;
      const attempt = parseAttempt(candidate.idempotencyFingerprint, candidate.idempotencyKey);
      const hasLegacyAttempt = Boolean(candidate.idempotencyFingerprint || candidate.idempotencyKey);
      return { drafts, reason: candidate.reason, pendingAttempt: attempt, legacyAttemptNeedsReview: hasLegacyAttempt && !attempt };
    }
    if (candidate.version !== 2 || typeof candidate.legacyAttemptNeedsReview !== 'boolean') return null;
    const drafts = parseDraftEntries(candidate.drafts, false);
    if (!drafts) return null;
    let pendingAttempt: CashierRosterSaveAttempt | null = null;
    if (candidate.pendingAttempt !== null) {
      if (!candidate.pendingAttempt || typeof candidate.pendingAttempt !== 'object' || Array.isArray(candidate.pendingAttempt)) return null;
      const raw = candidate.pendingAttempt as Record<string, unknown>;
      if (!validDay(raw.weekStart) || !Array.isArray(raw.changes)) return null;
      const attempt = parseAttempt(JSON.stringify({ weekStart: raw.weekStart, changes: raw.changes }), raw.idempotencyKey);
      if (!attempt || raw.fingerprint !== attempt.fingerprint) return null;
      pendingAttempt = attempt;
    }
    return { drafts, reason: candidate.reason, pendingAttempt, legacyAttemptNeedsReview: candidate.legacyAttemptNeedsReview };
  } catch { return null; }
}

export function createCashierRosterAttempt(
  weekStart: string,
  changes: readonly CashierRosterChange[],
  previous: CashierRosterSaveAttempt | null,
  createKey: () => string = () => crypto.randomUUID()
): CashierRosterSaveAttempt {
  const fingerprint = JSON.stringify({ weekStart, changes });
  if (previous?.fingerprint === fingerprint && uuid.test(previous.idempotencyKey)) return previous;
  return { fingerprint, idempotencyKey: createKey(), weekStart, changes: structuredClone([...changes]) };
}
