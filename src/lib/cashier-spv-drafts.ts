export type CashierRosterDraftCell = { shift: 'morning' | 'afternoon' | 'middle' | 'off' | ''; outletId: string };
export type CashierRosterDraft = {
  drafts: Record<string, CashierRosterDraftCell>;
  reason: string;
  idempotencyFingerprint: string;
  idempotencyKey: string;
};

export function cashierRosterIdempotencyAttempt(
  fingerprint: string,
  previous: Pick<CashierRosterDraft, 'idempotencyFingerprint' | 'idempotencyKey'>,
  createKey: () => string = () => crypto.randomUUID()
): Pick<CashierRosterDraft, 'idempotencyFingerprint' | 'idempotencyKey'> {
  if (fingerprint === previous.idempotencyFingerprint
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous.idempotencyKey)) return previous;
  return { idempotencyFingerprint: fingerprint, idempotencyKey: createKey() };
}

const allowedShifts = new Set(['', 'morning', 'afternoon', 'middle', 'off']);
const validDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
};

export function cashierRosterDraftStorageKey(employeeId: string, weekStart: string): string {
  return `rajaklana-hr-roster-draft-v1:${encodeURIComponent(employeeId)}:${weekStart}`;
}

export function serializeCashierRosterDraft(value: CashierRosterDraft): string {
  return JSON.stringify({ version: 1, ...value });
}

export function parseCashierRosterDraft(serialized: string | null): CashierRosterDraft | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || !candidate.drafts || typeof candidate.drafts !== 'object' || Array.isArray(candidate.drafts)
      || typeof candidate.reason !== 'string' || candidate.reason.length > 2000
      || typeof candidate.idempotencyFingerprint !== 'string' || candidate.idempotencyFingerprint.length > 500_000
      || typeof candidate.idempotencyKey !== 'string' || candidate.idempotencyKey.length > 100) return null;
    const entries = Object.entries(candidate.drafts as Record<string, unknown>);
    if (entries.length > 500) return null;
    const drafts: Record<string, CashierRosterDraftCell> = {};
    for (const [key, entry] of entries) {
      const separator = key.lastIndexOf(':');
      const employeeId = key.slice(0, separator), day = key.slice(separator + 1);
      if (!employeeId || !validDay(day) || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const cell = entry as Record<string, unknown>;
      if (typeof cell.shift !== 'string' || !allowedShifts.has(cell.shift) || typeof cell.outletId !== 'string' || cell.outletId.length > 200) return null;
      drafts[key] = { shift: cell.shift as CashierRosterDraftCell['shift'], outletId: cell.outletId };
    }
    return { drafts, reason: candidate.reason, idempotencyFingerprint: candidate.idempotencyFingerprint, idempotencyKey: candidate.idempotencyKey };
  } catch {
    return null;
  }
}
