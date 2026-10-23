import { describe, expect, it } from 'vitest';
import { clearSavedFollowupDraft } from './spv-followup-drafts';

describe('SPV follow-up form drafts', () => {
  it('clears the value included in a successful save so later server updates are visible', () => {
    const saved = clearSavedFollowupDraft({ caseA: 'Catatan A', caseB: 'Catatan lain' }, 'caseA', 'Catatan A');
    expect(saved).toEqual({ caseB: 'Catatan lain' });
  });

  it('keeps a newer value typed while the previous save was in flight', () => {
    const current = { caseA: 'Catatan terbaru' };
    expect(clearSavedFollowupDraft(current, 'caseA', 'Catatan yang dikirim')).toBe(current);
  });

  it('keeps the typed resolution when an in-progress save does not persist that field', () => {
    const current = { caseA: 'Kasir sudah tiba, menunggu pemeriksaan' };
    expect(clearSavedFollowupDraft(current, 'caseA', current.caseA, false)).toBe(current);
  });

  it('clears the matching resolution after completion actually saves the field', () => {
    const current = { caseA: 'Kasir sudah tiba dan sudah diperiksa', caseB: 'Kasus lain' };
    expect(clearSavedFollowupDraft(current, 'caseA', current.caseA, true)).toEqual({ caseB: 'Kasus lain' });
    expect(clearSavedFollowupDraft({ ...current, caseA: 'Edit setelah pengiriman' }, 'caseA', current.caseA, true))
      .toEqual({ ...current, caseA: 'Edit setelah pengiriman' });
  });
});
