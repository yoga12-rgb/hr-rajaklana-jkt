import type { SpvFollowup, SpvFollowupUpdate } from './types';

export type SpvFollowupDraft = {
  baselineRevision: number;
  ownerId: string | null;
  status: SpvFollowup['status'];
  note: string;
  resolutionNote: string;
  dueAt: string | null;
  reason: string;
  pendingAttempt: SpvFollowupAttempt | null;
  conflict: SpvFollowup | null;
};

export type SpvFollowupAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  payload: SpvFollowupUpdate;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(['new','in_progress','completed']);

export function spvFollowupDraftStorageKey(employeeId: string, caseId: string) {
  return `rajaklana-hr-spv-followup-v1:${encodeURIComponent(employeeId)}:${encodeURIComponent(caseId)}`;
}
export function draftFromSpvFollowup(row: SpvFollowup): SpvFollowupDraft {
  return { baselineRevision: row.revision, ownerId: row.ownerId, status: row.status, note: row.note,
    resolutionNote: row.resolutionNote, dueAt: row.dueAt, reason: '', pendingAttempt: null, conflict: null };
}

function validRow(value: unknown): value is SpvFollowup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string,unknown>;
  return typeof row.id === 'string' && typeof row.caseKey === 'string' && typeof row.revision === 'number'
    && Number.isInteger(row.revision) && row.revision > 0 && typeof row.status === 'string' && statuses.has(row.status);
}

function validPayload(value: unknown): value is SpvFollowupUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string,unknown>;
  return typeof row.id === 'string' && typeof row.expectedRevision === 'number' && Number.isInteger(row.expectedRevision) && row.expectedRevision > 0
    && typeof row.idempotencyKey === 'string' && uuid.test(row.idempotencyKey)
    && typeof row.status === 'string' && statuses.has(row.status)
    && (row.ownerId === null || typeof row.ownerId === 'string') && typeof row.note === 'string' && row.note.length <= 2000
    && typeof row.resolutionNote === 'string' && row.resolutionNote.length <= 2000
    && (row.dueAt === null || typeof row.dueAt === 'string' && Number.isFinite(Date.parse(row.dueAt)))
    && typeof row.reason === 'string' && row.reason.length <= 2000;
}

export function parseSpvFollowupDraft(serialized: string | null): SpvFollowupDraft | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const draft = value as Record<string,unknown>;
    if (draft.version !== 1 || typeof draft.baselineRevision !== 'number' || !Number.isInteger(draft.baselineRevision) || draft.baselineRevision < 1
      || (draft.ownerId !== null && typeof draft.ownerId !== 'string') || typeof draft.status !== 'string' || !statuses.has(draft.status)
      || typeof draft.note !== 'string' || draft.note.length > 2000 || typeof draft.resolutionNote !== 'string' || draft.resolutionNote.length > 2000
      || (draft.dueAt !== null && !(typeof draft.dueAt === 'string' && Number.isFinite(Date.parse(draft.dueAt))))
      || typeof draft.reason !== 'string' || draft.reason.length > 2000
      || (draft.conflict !== null && !validRow(draft.conflict))) return null;
    let pendingAttempt: SpvFollowupAttempt | null = null;
    if (draft.pendingAttempt !== null) {
      if (!draft.pendingAttempt || typeof draft.pendingAttempt !== 'object' || Array.isArray(draft.pendingAttempt)) return null;
      const attempt = draft.pendingAttempt as Record<string,unknown>;
      if (typeof attempt.fingerprint !== 'string' || typeof attempt.idempotencyKey !== 'string' || !uuid.test(attempt.idempotencyKey)
        || !validPayload(attempt.payload) || attempt.payload.idempotencyKey !== attempt.idempotencyKey
        || JSON.stringify(attempt.payload) !== attempt.fingerprint) return null;
      pendingAttempt = { fingerprint: attempt.fingerprint, idempotencyKey: attempt.idempotencyKey, payload: structuredClone(attempt.payload) };
    }
    return { baselineRevision: draft.baselineRevision, ownerId: draft.ownerId as string|null,
      status: draft.status as SpvFollowup['status'], note: draft.note, resolutionNote: draft.resolutionNote,
      dueAt: draft.dueAt as string|null, reason: draft.reason, pendingAttempt, conflict: draft.conflict as SpvFollowup|null };
  } catch { return null; }
}

export function serializeSpvFollowupDraft(draft: SpvFollowupDraft) {
  return JSON.stringify({ version: 1, ...draft });
}

export function createSpvFollowupAttempt(payload: Omit<SpvFollowupUpdate,'idempotencyKey'>, previous: SpvFollowupAttempt | null,
  createKey: () => string = () => crypto.randomUUID()): SpvFollowupAttempt {
  const withoutKey = JSON.stringify(payload);
  if (previous && JSON.stringify((({ idempotencyKey: _ignored, ...previousPayload }) => previousPayload)(previous.payload)) === withoutKey) return previous;
  const next = { ...payload, idempotencyKey: createKey() };
  return { fingerprint: JSON.stringify(next), idempotencyKey: next.idempotencyKey, payload: structuredClone(next) };
}

export function markSpvFollowupConflict(draft: SpvFollowupDraft, server: SpvFollowup, keepPending = false): SpvFollowupDraft {
  return { ...draft, pendingAttempt: keepPending ? draft.pendingAttempt : null, conflict: structuredClone(server) };
}

export function settleSpvFollowupAttempt(draft: SpvFollowupDraft, attempt: SpvFollowupAttempt,
  result: SpvFollowup): SpvFollowupDraft | null {
  if (!draft.pendingAttempt || draft.pendingAttempt.idempotencyKey !== attempt.idempotencyKey
    || draft.pendingAttempt.fingerprint !== attempt.fingerprint) return null;
  const unchanged = draft.ownerId === attempt.payload.ownerId && draft.status === attempt.payload.status
    && draft.note === attempt.payload.note && draft.resolutionNote === attempt.payload.resolutionNote
    && draft.dueAt === attempt.payload.dueAt && draft.reason === attempt.payload.reason;
  if (!unchanged) return { ...draft, pendingAttempt: null, baselineRevision: result.revision, conflict: result };
  return draftFromSpvFollowup(result);
}
