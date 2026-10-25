import { describe,expect,it } from 'vitest';
import type { SpvFollowup } from './types';
import { createSpvFollowupAttempt,draftFromSpvFollowup,markSpvFollowupConflict,parseSpvFollowupDraft,
  serializeSpvFollowupDraft,settleSpvFollowupAttempt,spvFollowupDraftStorageKey } from './spv-followup-recovery';

const row=(revision=3):SpvFollowup=>({id:'case-1',caseKey:'missing:assignment-1',issueType:'missing_clockin',sourceType:'assignment',sourceId:'assignment-1',
  workDate:'2026-10-22',outletId:'outlet-1',employeeId:'employee-1',shift:'morning',ownerId:null,status:'new',note:'',resolutionNote:'',
  createdBy:'admin-a',updatedBy:'admin-a',createdAt:'2026-10-22T00:00:00.000Z',updatedAt:'2026-10-22T00:00:00.000Z',reopenedCount:0,revision,dueAt:null});
const keys=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];

describe('SPV follow-up durable recovery',()=>{
  it('isolates drafts by account and case',()=>{
    expect(spvFollowupDraftStorageKey('admin-a','case-1')).not.toBe(spvFollowupDraftStorageKey('admin-b','case-1'));
    expect(spvFollowupDraftStorageKey('admin-a','case-1')).not.toBe(spvFollowupDraftStorageKey('admin-a','case-2'));
  });
  it('persists and reloads the exact key and payload',()=>{
    const draft={...draftFromSpvFollowup(row()),ownerId:'admin-b',reason:'Tetapkan petugas'};
    const attempt=createSpvFollowupAttempt({id:'case-1',expectedRevision:3,status:'in_progress',ownerId:'admin-b',note:'Hubungi kasir',resolutionNote:'',dueAt:'2026-10-23T10:00:00.000Z',reason:'Tetapkan petugas'},null,()=>keys[0]);
    draft.pendingAttempt=attempt;
    const restored=parseSpvFollowupDraft(serializeSpvFollowupDraft(draft));
    expect(restored?.pendingAttempt).toEqual(attempt);
    const {idempotencyKey:_ignored,...payload}=attempt.payload;
    expect(createSpvFollowupAttempt(payload,restored!.pendingAttempt,()=>keys[1])).toEqual(attempt);
  });
  it('does not clear edits typed while a request is pending',()=>{
    const draft={...draftFromSpvFollowup(row()),note:'Nilai dikirim'};
    const attempt=createSpvFollowupAttempt({id:'case-1',expectedRevision:3,status:'new',ownerId:null,note:'Nilai dikirim',resolutionNote:'',dueAt:null,reason:''},null,()=>keys[0]);
    draft.pendingAttempt=attempt;
    draft.note='Edit setelah kirim';
    const settled=settleSpvFollowupAttempt(draft,attempt,{...row(4),note:'Nilai dikirim'});
    expect(settled).toMatchObject({note:'Edit setelah kirim',pendingAttempt:null,baselineRevision:4});
    expect(settled?.conflict?.note).toBe('Nilai dikirim');
  });
  it('keeps the local draft beside a newer server conflict',()=>{
    const draft={...draftFromSpvFollowup(row()),note:'Catatan lokal'};
    const conflicted=markSpvFollowupConflict(draft,{...row(4),ownerId:'admin-b',note:'Catatan server'});
    expect(conflicted.note).toBe('Catatan lokal');
    expect(conflicted.conflict).toMatchObject({revision:4,note:'Catatan server'});
  });
});
