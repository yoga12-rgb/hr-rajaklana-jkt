import { describe, expect, it } from 'vitest';
import { cashierRosterBaseline, cashierRosterBaselinesEqual, cashierRosterDraftStorageKey, createCashierRosterAttempt, parseCashierRosterDraft, serializeCashierRosterDraft } from './cashier-spv-drafts';

const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'assignment-1', updatedAt: '2026-10-20T03:00:00.000Z', status: 'active' as const, shift: 'morning' as const, outletId: 'outlet-a', ...overrides
});
const change = (overrides: Record<string, unknown> = {}) => ({ employeeId: 'cashier-1', workDate: '2026-10-26', outletId: 'outlet-b', shift: 'afternoon' as const,
  reason: 'Rotasi jadwal disetujui', id: 'assignment-1', expectedUpdatedAt: '2026-10-20T03:00:00.000Z', ...overrides });

describe('cashier roster draft persistence', () => {
  it('scopes a draft to its signed-in account and work week while retaining the legacy key', () => {
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).not.toBe(cashierRosterDraftStorageKey('admin:2', '2026-10-19'));
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).not.toBe(cashierRosterDraftStorageKey('admin:1', '2026-10-26'));
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).toContain('-v1:');
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

  it.each([
    '{bad json',
    JSON.stringify({ version: 3, drafts: {}, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
    JSON.stringify({ version: 2, drafts: { 'cashier-1:2026-02-30': { shift: 'morning', outletId: 'outlet-a', baseline: null, needsReview: true } }, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
    JSON.stringify({ version: 2, drafts: { 'cashier-1:2026-10-20': { shift: 'unknown', outletId: 'outlet-a', baseline: null, needsReview: true } }, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }),
  ])('rejects malformed saved payload %s', serialized => {
    expect(parseCashierRosterDraft(serialized)).toBeNull();
  });
});
