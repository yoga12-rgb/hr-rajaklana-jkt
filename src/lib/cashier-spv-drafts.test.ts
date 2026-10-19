import { describe, expect, it } from 'vitest';
import { cashierRosterDraftStorageKey, cashierRosterIdempotencyAttempt, parseCashierRosterDraft, serializeCashierRosterDraft } from './cashier-spv-drafts';

describe('cashier roster draft persistence', () => {
  it('scopes a draft to its signed-in account and work week', () => {
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).not.toBe(cashierRosterDraftStorageKey('admin:2', '2026-10-19'));
    expect(cashierRosterDraftStorageKey('admin:1', '2026-10-19')).not.toBe(cashierRosterDraftStorageKey('admin:1', '2026-10-26'));
  });

  it('round trips schedule cells, the reason, and the idempotent retry key', () => {
    const draft = {
      drafts: { 'employee-4:2026-10-20': { shift: 'morning' as const, outletId: 'outlet-a' } },
      reason: 'Jadwal mingguan sudah dikonfirmasi',
      idempotencyFingerprint: '{"weekStart":"2026-10-19"}',
      idempotencyKey: 'retry-key-1',
    };
    expect(parseCashierRosterDraft(serializeCashierRosterDraft(draft))).toEqual(draft);
  });

  it('reuses the same key after restoring an unchanged batch draft', () => {
    const fingerprint = '{"weekStart":"2026-10-26","changes":[{"employeeId":"cashier-1","shift":"morning"}]}';
    const firstAttempt = cashierRosterIdempotencyAttempt(fingerprint, { idempotencyFingerprint: '', idempotencyKey: '' }, () => '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1');
    const savedDraft = parseCashierRosterDraft(serializeCashierRosterDraft({
      drafts: { 'cashier-1:2026-10-26': { shift: 'morning', outletId: 'outlet-a' } },
      reason: 'Jadwal uji',
      ...firstAttempt
    }));

    expect(savedDraft).not.toBeNull();
    const retry = cashierRosterIdempotencyAttempt(fingerprint, savedDraft!, () => 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f');
    expect(retry.idempotencyKey).toBe(firstAttempt.idempotencyKey);
    expect(retry.idempotencyFingerprint).toBe(fingerprint);
  });

  it('creates a new key after the user changes the batch payload', () => {
    const previous = { idempotencyFingerprint: 'week-one', idempotencyKey: '1d1b5a7e-4dbf-4c93-9fc8-a015ae8440b1' };
    const next = cashierRosterIdempotencyAttempt('week-two', previous, () => 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f');
    expect(next).toEqual({ idempotencyFingerprint: 'week-two', idempotencyKey: 'd131a6bb-a823-49ef-92c0-2b281d2b8c6f' });
  });

  it.each([
    '{bad json',
    JSON.stringify({ version: 2, drafts: {}, reason: '', idempotencyFingerprint: '', idempotencyKey: '' }),
    JSON.stringify({ version: 1, drafts: { 'employee-4:2026-02-30': { shift: 'morning', outletId: 'outlet-a' } }, reason: '', idempotencyFingerprint: '', idempotencyKey: '' }),
    JSON.stringify({ version: 1, drafts: { 'employee-4:2026-10-20': { shift: 'unknown', outletId: 'outlet-a' } }, reason: '', idempotencyFingerprint: '', idempotencyKey: '' }),
  ])('ignores invalid saved payload %s', (serialized) => {
    expect(parseCashierRosterDraft(serialized)).toBeNull();
  });
});
