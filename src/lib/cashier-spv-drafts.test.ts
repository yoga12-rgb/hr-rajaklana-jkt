import { describe, expect, it, vi } from 'vitest';
import { cashierRosterBaseline, cashierRosterBaselinesEqual, cashierRosterDraftStorageKey, cashierRosterDraftStorageSnapshot, createCashierRosterAttempt, parseCashierRosterDraft, resolveCashierRosterDraftAttempt, serializeCashierRosterDraft, settleCashierRosterDraftAttempt, subscribeCashierRosterDraftSettlements, writeCashierRosterDraft } from './cashier-spv-drafts';
import type { CashierRosterDraft } from './cashier-spv-drafts';

const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'assignment-1', updatedAt: '2026-10-20T03:00:00.000Z', status: 'active' as const, shift: 'morning' as const, outletId: 'outlet-a', ...overrides
});
const change = (overrides: Record<string, unknown> = {}) => ({ employeeId: 'cashier-1', workDate: '2026-10-26', outletId: 'outlet-b', shift: 'afternoon' as const,
  reason: 'Rotasi jadwal disetujui', id: 'assignment-1', expectedUpdatedAt: '2026-10-20T03:00:00.000Z', ...overrides });

describe('cashier roster draft persistence', () => {
  it('scopes a draft to its signed-in account and work week while retaining the legacy key', () => {
    const accountA = cashierRosterDraftStorageKey('admin:1', '2026-10-19');
    const accountB = cashierRosterDraftStorageKey('admin:2', '2026-10-19');
    expect(accountA).not.toBe(accountB);
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).not.toBe(cashierRosterDraftStorageKey('admin:1', '2026-10-26'));
    expect(accountA).toContain('-v1:');

    const change = { employeeId: 'cashier-1', workDate: '2026-10-19', outletId: 'outlet-a', shift: 'morning' as const,
      reason: 'Penugasan uji', id: 'assignment-1', expectedUpdatedAt: '2026-10-18T03:00:00Z' };
    const attempt = createCashierRosterAttempt('2026-10-19', [change], null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1');
    const localStorage = new Map([[accountA, serializeCashierRosterDraft({
      drafts: { 'cashier-1:2026-10-19': { shift: 'morning', outletId: 'outlet-a', baseline: cashierRosterBaseline(assignment(), 'outlet-a'), needsReview: false } },
      reason: 'Penugasan uji', pendingAttempt: attempt, legacyAttemptNeedsReview: false
    })]]);
    expect(parseCashierRosterDraft(localStorage.get(accountB) ?? null)).toBeNull();
    expect(parseCashierRosterDraft(localStorage.get(accountA) ?? null)?.pendingAttempt?.idempotencyKey).toBe(attempt.idempotencyKey);
  });

  it('round trips cell baselines, review state, and an unresolved immutable attempt', () => {
    const attempted = [change()];
    const fingerprint = JSON.stringify({ weekStart: '2026-10-26', changes: attempted });
    const draft = {
      drafts: { 'cashier-1:2026-10-26': { shift: 'afternoon' as const, outletId: 'outlet-b', baseline: cashierRosterBaseline(assignment(), 'outlet-a'), needsReview: false } },
      reason: 'Rotasi jadwal disetujui', legacyAttemptNeedsReview: false,
      pendingAttempt: { fingerprint, idempotencyKey: '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1', weekStart: '2026-10-26', changes: attempted }
    };
    expect(parseCashierRosterDraft(serializeCashierRosterDraft(draft))).toEqual(draft);
  });

  it('retains the exact replay body, fingerprint and key across repeated persist and reload cycles', () => {
    const changes = [change({ cancel: false }), {
      reason: 'Libur bergilir', employeeId: 'cashier-2', shift: 'off' as const, workDate: '2026-10-27', outletId: 'outlet-a'
    }];
    const attempted = createCashierRosterAttempt('2026-10-26', changes, null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1');
    const replayBody = JSON.stringify(attempted.changes);
    let serialized = serializeCashierRosterDraft({ drafts: {}, reason: 'Rotasi jadwal disetujui', pendingAttempt: attempted, legacyAttemptNeedsReview: false });
    for (let reload = 0; reload < 3; reload += 1) {
      const restored = parseCashierRosterDraft(serialized);
      expect(restored, `recovery payload after reload ${reload + 1}`).not.toBeNull();
      expect(restored?.pendingAttempt?.idempotencyKey).toBe(attempted.idempotencyKey);
      expect(restored?.pendingAttempt?.fingerprint).toBe(attempted.fingerprint);
      expect(JSON.stringify(restored?.pendingAttempt?.changes)).toBe(replayBody);
      expect(restored?.pendingAttempt?.changes[1]).not.toHaveProperty('id');
      expect(restored?.pendingAttempt?.changes[1]).not.toHaveProperty('expectedUpdatedAt');
      serialized = serializeCashierRosterDraft(restored!);
    }
  });

  it('migrates v1 intent without inventing a baseline and preserves a reconstructable attempt', () => {
    const changes = [change()];
    const fingerprint = JSON.stringify({ weekStart: '2026-10-26', changes });
    const saved = parseCashierRosterDraft(JSON.stringify({ version: 1,
      drafts: { 'cashier-1:2026-10-26': { shift: 'afternoon', outletId: 'outlet-b' } }, reason: 'Rotasi jadwal disetujui',
      idempotencyFingerprint: fingerprint, idempotencyKey: '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1' }));

    expect(saved?.drafts['cashier-1:2026-10-26']).toEqual({ shift: 'afternoon', outletId: 'outlet-b', baseline: null, needsReview: true });
    expect(saved?.pendingAttempt).toEqual({ fingerprint, idempotencyKey: '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1', weekStart: '2026-10-26', changes });
    expect(saved?.legacyAttemptNeedsReview).toBe(false);
  });

  it('blocks a v1 key when its exact previous payload cannot be reconstructed', () => {
    const saved = parseCashierRosterDraft(JSON.stringify({ version: 1,
      drafts: { 'cashier-1:2026-10-26': { shift: 'afternoon', outletId: 'outlet-b' } }, reason: 'Rotasi jadwal',
      idempotencyFingerprint: 'old-fingerprint', idempotencyKey: '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1' }));
    expect(saved?.pendingAttempt).toBeNull();
    expect(saved?.legacyAttemptNeedsReview).toBe(true);
  });

  it('distinguishes empty, active and cancelled source baselines', () => {
    const empty = cashierRosterBaseline(undefined, 'outlet-a');
    const active = cashierRosterBaseline(assignment(), 'outlet-a');
    const cancelled = cashierRosterBaseline(assignment({ status: 'cancelled' }), 'outlet-a');
    expect(empty.status).toBe('empty');
    expect(active.status).toBe('active');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.shift).toBe('morning');
    expect(cashierRosterBaselinesEqual(active, cashierRosterBaseline(assignment(), 'outlet-a'))).toBe(true);
    expect(cashierRosterBaselinesEqual(active, cashierRosterBaseline(assignment({ shift: 'middle', updatedAt: '2026-10-20T04:00:00.000Z' }), 'outlet-a'))).toBe(false);
    expect(cashierRosterBaselinesEqual(empty, cashierRosterBaseline(assignment(), 'outlet-a'))).toBe(false);
    expect(cashierRosterBaselinesEqual(cancelled, active)).toBe(false);
  });

  it('reuses the exact key and payload on retry, then makes a new batch attempt after review changes it', () => {
    const first = createCashierRosterAttempt('2026-10-26', [change()], null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1');
    const retry = createCashierRosterAttempt('2026-10-26', [change()], first, () => 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f');
    expect(retry).toBe(first);
    expect(retry.changes).toEqual(first.changes);
    const rebased = createCashierRosterAttempt('2026-10-26', [change({ expectedUpdatedAt: '2026-10-20T04:00:00.000Z' })], first,
      () => 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f');
    expect(rebased.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(rebased.fingerprint).not.toBe(first.fingerprint);
    expect(first.changes[0].expectedUpdatedAt).toBe('2026-10-20T03:00:00.000Z');
  });

  it('refuses a stale tab write or delete when another tab has published a pending replay', () => {
    const key = cashierRosterDraftStorageKey('admin-a', '2026-10-26');
    const records = new Map<string, string>();
    const storage = {
      getItem: (name: string) => records.get(name) ?? null,
      setItem: (name: string, value: string) => { records.set(name, value); },
      removeItem: (name: string) => { records.delete(name); }
    };
    const staleTabSnapshot = storage.getItem(key);
    const pending = createCashierRosterAttempt('2026-10-26', [change()], null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1');
    const published = { drafts: {}, reason: 'Rotasi jadwal disetujui', pendingAttempt: pending, legacyAttemptNeedsReview: false };
    expect(writeCashierRosterDraft(storage, key, published, null)).toBe(true);
    const afterTabA = storage.getItem(key);

    expect(writeCashierRosterDraft(storage, key, emptyRosterDraft(), staleTabSnapshot)).toBe(false);
    expect(storage.getItem(key)).toBe(afterTabA);
    expect(parseCashierRosterDraft(storage.getItem(key))?.pendingAttempt).toEqual(pending);
  });

  it('acknowledges only the exact written snapshot when another tab publishes before the next persist', () => {
    const key = cashierRosterDraftStorageKey('admin-a', '2026-10-26');
    const records = new Map<string, string>();
    const storage = {
      getItem: (name: string) => records.get(name) ?? null,
      setItem: (name: string, value: string) => { records.set(name, value); },
      removeItem: (name: string) => { records.delete(name); }
    };
    expect(cashierRosterDraftStorageSnapshot(emptyRosterDraft())).toBeNull();
    const writtenDraft = { ...emptyRosterDraft(), reason: 'Alasan tab A' };
    const acknowledgedSnapshot = cashierRosterDraftStorageSnapshot(writtenDraft);
    expect(writeCashierRosterDraft(storage, key, writtenDraft, null)).toBe(true);
    expect(records.get(key)).toBe(acknowledgedSnapshot);

    const latest = { ...emptyRosterDraft(), reason: 'Alasan tab B',
      pendingAttempt: createCashierRosterAttempt('2026-10-26', [change()], null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1') };
    const latestSnapshot = cashierRosterDraftStorageSnapshot(latest)!;
    records.set(key, latestSnapshot);

    expect(writeCashierRosterDraft(storage, key, emptyRosterDraft(), acknowledgedSnapshot)).toBe(false);
    expect(records.get(key)).toBe(latestSnapshot);
  });

  it.each([
    '{bad json',
    JSON.stringify({ version: 3, drafts: {}, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
    JSON.stringify({ version: 2, drafts: { 'cashier-1:2026-02-30': { shift: 'morning', outletId: 'outlet-a', baseline: null, needsReview: true } }, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
    JSON.stringify({ version: 2, drafts: { 'cashier-1:2026-10-20': { shift: 'unknown', outletId: 'outlet-a', baseline: null, needsReview: true } }, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
  ])('rejects malformed saved payload %s', serialized => {
    expect(parseCashierRosterDraft(serialized)).toBeNull();
  });
});

function emptyRosterDraft(): CashierRosterDraft {
  return { drafts: {}, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false };
}

describe('cashier roster attempt settlement across planner scopes', () => {
  const originKey = cashierRosterDraftStorageKey('admin-a', '2026-10-26');
  const cellKey = 'cashier-1:2026-10-26';
  function pendingDraft(): CashierRosterDraft {
    return {
      drafts: { [cellKey]: { shift: 'afternoon', outletId: 'outlet-b', baseline: cashierRosterBaseline(assignment(), 'outlet-a'), needsReview: false } },
      reason: 'Rotasi jadwal disetujui',
      pendingAttempt: createCashierRosterAttempt('2026-10-26', [change()], null, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1'),
      legacyAttemptNeedsReview: false
    };
  }
  function draftStorage(initial: string | null) {
    const records = new Map<string, string>(initial === null ? [] : [[originKey, initial]]);
    const storage = {
      getItem: vi.fn((key: string) => records.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { records.set(key, value); }),
      removeItem: vi.fn((key: string) => { records.delete(key); })
    };
    return { records, storage };
  }

  it('cleans only saved cells that still match the submitted value and baseline, retaining newer edits and reason', () => {
    const current = pendingDraft(), attempt = current.pendingAttempt!;
    const original = structuredClone(current);
    current.drafts['cashier-2:2026-10-27'] = {
      shift: 'middle', outletId: 'outlet-c', baseline: cashierRosterBaseline(undefined, 'outlet-c'), needsReview: false
    };
    current.reason = 'Alasan baru setelah pengiriman';
    const resolved = resolveCashierRosterDraftAttempt(current, attempt, 'saved');

    expect(resolved?.drafts).toEqual({ 'cashier-2:2026-10-27': current.drafts['cashier-2:2026-10-27'] });
    expect(resolved?.reason).toBe('Alasan baru setelah pengiriman');
    expect(resolved?.pendingAttempt).toBeNull();
    expect(current.pendingAttempt).toEqual(original.pendingAttempt);
    expect(current.drafts[cellKey]).toEqual(original.drafts[cellKey]);
  });

  it.each(['value', 'baseline', 'review'] as const)('preserves a submitted cell whose %s changed while the RPC was pending', changed => {
    const current = pendingDraft(), attempt = current.pendingAttempt!;
    if (changed === 'value') current.drafts[cellKey].shift = 'middle';
    if (changed === 'baseline') current.drafts[cellKey].baseline!.updatedAt = '2026-10-21T03:00:00.000Z';
    if (changed === 'review') current.drafts[cellKey].needsReview = true;
    const expectedCell = structuredClone(current.drafts[cellKey]);

    const resolved = resolveCashierRosterDraftAttempt(current, attempt, 'saved');

    expect(resolved?.drafts[cellKey]).toEqual(expectedCell);
    expect(resolved?.pendingAttempt).toBeNull();
  });

  it('settles a definite rejection while retaining every draft cell and its reason for review', () => {
    const current = pendingDraft(), before = structuredClone(current);
    const { storage, records } = draftStorage(serializeCashierRosterDraft(current));

    expect(settleCashierRosterDraftAttempt(storage, originKey, current.pendingAttempt!, 'rejected', current)).toBe(true);

    const persisted = parseCashierRosterDraft(records.get(originKey)!);
    expect(persisted).toEqual({ ...before, pendingAttempt: null });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(current).toEqual(before);
  });

  it.each(['key', 'fingerprint'] as const)('refuses to settle another pending attempt when its %s differs', mismatch => {
    const current = pendingDraft(), attempted = current.pendingAttempt!;
    const other = mismatch === 'key'
      ? { ...attempted, idempotencyKey: 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f' }
      : createCashierRosterAttempt('2026-10-26', [change({ outletId: 'outlet-c' })], null, () => attempted.idempotencyKey);
    const raw = serializeCashierRosterDraft({ ...current, pendingAttempt: other });
    const { storage, records } = draftStorage(raw);
    const notified = vi.fn(), unsubscribe = subscribeCashierRosterDraftSettlements(notified);
    try {
      expect(settleCashierRosterDraftAttempt(storage, originKey, attempted, 'saved')).toBe(false);
      expect(records.get(originKey)).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(notified).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it.each([null, '{invalid json', '{"version":2,"reason":"broken"}'])('refuses missing or corrupted origin storage without rebuilding it from memory: %s', raw => {
    const current = pendingDraft(), { storage, records } = draftStorage(raw);

    expect(settleCashierRosterDraftAttempt(storage, originKey, current.pendingAttempt!, 'saved', current)).toBe(false);

    expect(records.get(originKey) ?? null).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(current.pendingAttempt).not.toBeNull();
  });

  it.each(['getItem', 'setItem', 'removeItem'] as const)('retains the original pending record and sends no event when %s fails', operation => {
    const current = pendingDraft(), before = structuredClone(current);
    const raw = serializeCashierRosterDraft(current), { storage, records } = draftStorage(raw);
    storage[operation].mockImplementationOnce(() => { throw new Error(`Storage ${operation} denied`); });
    const notified = vi.fn(), unsubscribe = subscribeCashierRosterDraftSettlements(notified);
    try {
      // Rejection retains cells and uses setItem; a clean success uses removeItem.
      const outcome = operation === 'setItem' ? 'rejected' : 'saved';
      expect(settleCashierRosterDraftAttempt(storage, originKey, current.pendingAttempt!, outcome, current)).toBe(false);
      expect(storage[operation]).toHaveBeenCalledTimes(1);
      expect(records.get(originKey)).toBe(raw);
      expect(current).toEqual(before);
      expect(parseCashierRosterDraft(records.get(originKey)!)?.pendingAttempt).toEqual(before.pendingAttempt);
      expect(notified).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('reads the latest saved scope snapshot and preserves edits made by a remounted planner', () => {
    const oldSnapshot = pendingDraft(), attempted = oldSnapshot.pendingAttempt!;
    const { storage, records } = draftStorage(serializeCashierRosterDraft(oldSnapshot));
    const latest = structuredClone(oldSnapshot);
    latest.drafts[cellKey].shift = 'middle';
    latest.drafts['cashier-2:2026-10-27'] = {
      shift: 'off', outletId: 'outlet-a', baseline: cashierRosterBaseline(undefined, 'outlet-a'), needsReview: false
    };
    latest.reason = 'Perubahan dari planner yang dibuka kembali';
    records.set(originKey, serializeCashierRosterDraft(latest));

    expect(settleCashierRosterDraftAttempt(storage, originKey, attempted, 'saved')).toBe(true);

    expect(parseCashierRosterDraft(records.get(originKey)!)).toEqual({ ...latest, pendingAttempt: null });
    expect(oldSnapshot.pendingAttempt).toEqual(attempted);
  });

  it('refuses settlement when unpublished active edits differ from the current persisted scope', () => {
    const persisted = pendingDraft(), active = structuredClone(persisted);
    active.reason = 'Alasan yang belum berhasil disimpan';
    active.drafts[cellKey].shift = 'middle';
    const raw = serializeCashierRosterDraft(persisted), { storage, records } = draftStorage(raw);

    expect(settleCashierRosterDraftAttempt(storage, originKey, persisted.pendingAttempt!, 'saved', active)).toBe(false);

    expect(records.get(originKey)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(active.reason).toBe('Alasan yang belum berhasil disimpan');
    expect(active.pendingAttempt).toEqual(persisted.pendingAttempt);
  });

  it.each(['edits', 'pending'] as const)('does not authorize an older settlement with a newer %s snapshot read during the write guard', changed => {
    const current = pendingDraft(), attempted = current.pendingAttempt!;
    const latest = structuredClone(current);
    if (changed === 'edits') {
      latest.reason = 'Perubahan tab lain sesudah settlement membaca storage';
      latest.drafts[cellKey].shift = 'middle';
    } else {
      latest.pendingAttempt = createCashierRosterAttempt('2026-10-26', [change({ shift: 'middle' })], null,
        () => 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f');
    }
    const raw = serializeCashierRosterDraft(current), latestRaw = serializeCashierRosterDraft(latest);
    const { storage, records } = draftStorage(raw);
    let reads = 0;
    storage.getItem.mockImplementation(key => {
      // Another renderer publishes after the snapshot used to calculate the
      // outcome, but before the compare-before-write guard reads storage.
      if (++reads === 2) records.set(originKey, latestRaw);
      return records.get(key) ?? null;
    });
    const notified = vi.fn(), unsubscribe = subscribeCashierRosterDraftSettlements(notified);
    try {
      expect(settleCashierRosterDraftAttempt(storage, originKey, attempted, 'saved', current)).toBe(false);
      expect(records.get(originKey)).toBe(latestRaw);
      expect(parseCashierRosterDraft(records.get(originKey)!)).toEqual(latest);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(notified).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it.each(['saved', 'rejected'] as const)('notifies remounted listeners only after the %s result is durable', outcome => {
    const current = pendingDraft(), attempted = current.pendingAttempt!;
    const { storage, records } = draftStorage(serializeCashierRosterDraft(current));
    const sequence: string[] = [];
    storage.setItem.mockImplementation((key, raw) => { records.set(key, raw); sequence.push('write'); });
    storage.removeItem.mockImplementation(key => { records.delete(key); sequence.push('remove'); });
    const listener = vi.fn((event: Parameters<Parameters<typeof subscribeCashierRosterDraftSettlements>[0]>[0]) => {
      sequence.push('notify');
      return { event, rawAtNotification: records.get(originKey) ?? null };
    });
    const unsubscribe = subscribeCashierRosterDraftSettlements(listener);
    try {
      expect(settleCashierRosterDraftAttempt(storage, originKey, attempted, outcome, structuredClone(current))).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(sequence).toEqual([outcome === 'saved' ? 'remove' : 'write', 'notify']);
      // Assertions stay outside callbacks because observer exceptions are isolated.
      const observed = listener.mock.results[0].value!;
      expect(observed.event.storageKey).toBe(originKey);
      expect(observed.event.attempt).toEqual(attempted);
      expect(observed.event.outcome).toBe(outcome);
      expect(observed.event.previousDraft).toEqual(current);
      expect(observed.event.draft.pendingAttempt).toBeNull();
      if (outcome === 'saved') expect(observed.rawAtNotification).toBeNull();
      else expect(parseCashierRosterDraft(observed.rawAtNotification)).toEqual(observed.event.draft);
    } finally { unsubscribe(); }
    listener.mockClear();
    const next = pendingDraft();
    records.set(originKey, serializeCashierRosterDraft(next));
    expect(settleCashierRosterDraftAttempt(storage, originKey, next.pendingAttempt!, 'rejected')).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a durable outcome successful and still notifies other remounts if one observer throws', () => {
    const current = pendingDraft(), { storage, records } = draftStorage(serializeCashierRosterDraft(current));
    const brokenListener = vi.fn(() => { throw new Error('Remounted observer failed'); });
    const nextListener = vi.fn();
    const unsubscribeBroken = subscribeCashierRosterDraftSettlements(brokenListener);
    const unsubscribeNext = subscribeCashierRosterDraftSettlements(nextListener);
    try {
      expect(settleCashierRosterDraftAttempt(storage, originKey, current.pendingAttempt!, 'rejected', current)).toBe(true);
      expect(parseCashierRosterDraft(records.get(originKey)!)?.pendingAttempt).toBeNull();
      expect(brokenListener).toHaveBeenCalledTimes(1);
      expect(nextListener).toHaveBeenCalledTimes(1);
    } finally { unsubscribeBroken(); unsubscribeNext(); }
  });
});
