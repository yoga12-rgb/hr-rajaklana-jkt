<script lang="ts">
  import { get } from 'svelte/store';
  import { onDestroy, onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { app, actions, isCashier } from '#lib/state/app';
  import type { CashierRosterChange } from '#lib/types';
  import { cashierRosterAttemptsEqual, cashierRosterBaseline, cashierRosterBaselinesEqual, cashierRosterDraftStorageKey, cashierRosterDraftStorageSnapshot, createCashierRosterAttempt, parseCashierRosterDraft, resolveCashierRosterDraftAttempt, serializeCashierRosterDraft, settleCashierRosterDraftAttempt, subscribeCashierRosterDraftSettlements, writeCashierRosterDraft, type CashierRosterAttemptOutcome, type CashierRosterBaseline, type CashierRosterDraft, type CashierRosterDraftCell, type CashierRosterDraftEntry, type CashierRosterSaveAttempt } from '#lib/cashier-spv-drafts';
  import { cashierRosterSaveErrorMessage, cashierRosterSaveOutcomeIsDefiniteBaselineConflict, cashierRosterSaveOutcomeIsDefiniteLeaveConflict, cashierRosterSaveOutcomeIsUncertain } from '../cashier-roster-save-error';
  import { reconcileUncertainCashierRosterSave } from '../cashier-roster-reconcile';
  import { addWorkDays, isValidWorkDate, previewPreviousWeekCopy, startOfWorkWeek, validateRosterBatch, workWeekDates, workWeekLabel } from '#lib/cashier-spv';
  import { todayJakarta, dateLabel } from './format';
  import Feedback from './Feedback.svelte';
  import StaffingRequirementEditor from './StaffingRequirementEditor.svelte';

  type Draft = CashierRosterDraftEntry;
  function requestedWeekFromSearch(search: string): string | null {
    const requested = new URLSearchParams(search).get('week');
    return isValidWorkDate(requested) ? startOfWorkWeek(requested) : null;
  }
  let weekStart = requestedWeekFromSearch(page.url.search) ?? startOfWorkWeek(todayJakarta()), drafts: Record<string, Draft> = {}, reason = '', message = '', failed = false, saving = false;
  let copyPreview: ReturnType<typeof previewPreviousWeekCopy> | null = null, copySkippedDrafts = 0;
  let pendingAttempt: CashierRosterSaveAttempt | null = null, legacyAttemptNeedsReview = false;
  let activeDraftStorageKey = '', draftStorageWarning = false, draftStorageConflict = false;
  let observedDraftStorageKey = '', observedDraftSnapshot: string | null = null;
  let scopeGeneration = 0, accountGeneration = 0, destroyed = false, accountId: string | undefined;
  type SaveOperation = { accountId: string; accountGeneration: number; storageKey: string; weekStart: string; generation: number };
  let activeSave: SaveOperation | null = null;
  const unsubscribeAccount = app.subscribe(state => {
    if (accountId !== state.user?.id) { accountId = state.user?.id; accountGeneration++; }
  });
  const currentDraft = (): CashierRosterDraft => ({ drafts, reason, pendingAttempt, legacyAttemptNeedsReview });
  function applyDraft(saved: CashierRosterDraft) {
    drafts = saved.drafts; reason = saved.reason; pendingAttempt = saved.pendingAttempt; legacyAttemptNeedsReview = saved.legacyAttemptNeedsReview;
  }
  const unsubscribeSettlements = subscribeCashierRosterDraftSettlements(event => {
    if (destroyed || activeDraftStorageKey !== event.storageKey || !get(app).user
      || cashierRosterDraftStorageKey(get(app).user!.id, weekStart) !== event.storageKey) return;
    const resolved = resolveCashierRosterDraftAttempt(currentDraft(), event.attempt, event.outcome);
    if (!resolved) return;
    try {
      // Never replace unpublished edits or another tab's newer snapshot.
      if (JSON.stringify(currentDraft()) !== JSON.stringify(event.previousDraft)) { draftStorageWarning = true; return; }
      applyDraft(resolved);
      observedDraftStorageKey = event.storageKey;
      observedDraftSnapshot = cashierRosterDraftStorageSnapshot(resolved);
      draftStorageWarning = false; draftStorageConflict = false;
    } catch { draftStorageWarning = true; }
  });
  onDestroy(() => { destroyed = true; unsubscribeAccount(); unsubscribeSettlements(); });
  function emptyDraft(): CashierRosterDraft { return { drafts: {}, reason: '', pendingAttempt: null, legacyAttemptNeedsReview: false }; }
  function matchesSnapshot(snapshot: string | null): boolean {
    const saved = parseCashierRosterDraft(snapshot);
    return serializeCashierRosterDraft(currentDraft()) === serializeCashierRosterDraft(saved ?? emptyDraft());
  }
  function onDraftStorage(event: StorageEvent) {
    if (event.key !== activeDraftStorageKey || !activeDraftStorageKey || observedDraftStorageKey !== activeDraftStorageKey) return;
    if (!matchesSnapshot(event.oldValue)) { draftStorageConflict = true; draftStorageWarning = true; return; }
    const latest = parseCashierRosterDraft(event.newValue);
    if (event.newValue && !latest) { draftStorageConflict = true; draftStorageWarning = true; return; }
    applyDraft(latest ?? emptyDraft());
    observedDraftSnapshot = event.newValue;
    draftStorageConflict = false; draftStorageWarning = false;
  }
  onMount(() => { window.addEventListener('storage', onDraftStorage); return () => window.removeEventListener('storage', onDraftStorage); });
  let wantedDraftStorageKey = '';
  $: wantedDraftStorageKey = $app.user?.id ? cashierRosterDraftStorageKey($app.user.id, weekStart) : '';
  $: if (wantedDraftStorageKey !== activeDraftStorageKey) activateDraftKey(wantedDraftStorageKey);

  function persistDraft(storageKey = activeDraftStorageKey): boolean {
    if (!storageKey) { draftStorageWarning = true; return false; }
    try {
      const expected = storageKey === observedDraftStorageKey ? observedDraftSnapshot : null;
      const draft = currentDraft(), writtenSnapshot = cashierRosterDraftStorageSnapshot(draft);
      if (!writeCashierRosterDraft(localStorage, storageKey, draft, expected)) {
        draftStorageWarning = true; draftStorageConflict = true; return false;
      }
      observedDraftStorageKey = storageKey;
      observedDraftSnapshot = writtenSnapshot;
      draftStorageWarning = false;
      draftStorageConflict = false;
      return true;
    } catch { draftStorageWarning = true; return false; }
  }
  function activateDraftKey(nextKey: string) {
    persistDraft(activeDraftStorageKey);
    activeDraftStorageKey = nextKey;
    scopeGeneration++; activeSave = null; saving = false; message = ''; failed = false;
    copyPreview = null; copySkippedDrafts = 0;
    if (!nextKey) { drafts = {}; reason = ''; pendingAttempt = null; legacyAttemptNeedsReview = false; observedDraftStorageKey = ''; observedDraftSnapshot = null; draftStorageWarning = false; draftStorageConflict = false; return; }
    try {
      const raw = localStorage.getItem(nextKey), saved = parseCashierRosterDraft(raw);
      observedDraftStorageKey = nextKey; observedDraftSnapshot = raw;
      applyDraft(saved ?? emptyDraft());
      draftStorageWarning = false; draftStorageConflict = false;
    } catch { drafts = {}; reason = ''; pendingAttempt = null; legacyAttemptNeedsReview = false; draftStorageWarning = true; }
  }
  afterNavigate(() => {
    const nextWeek = requestedWeekFromSearch(window.location.search);
    if (nextWeek && nextWeek !== weekStart) {
      if (!persistDraft()) {
        const url = new URL(window.location.href); url.searchParams.set('week', weekStart);
        void goto(url, { state: page.state, shallow: true, replace: true });
        return;
      }
      weekStart = nextWeek; copyPreview = null;
    }
  });
  $: days = workWeekDates(weekStart);
  $: cashiers = $app.employees.filter(employee => employee.status === 'active' && isCashier(employee));
  $: today = todayJakarta();
  const key = (employeeId: string, day: string) => `${employeeId}:${day}`;
  const existingFor = (employeeId: string, day: string) => ($app.cashierAssignments ?? []).find(row => row.employeeId === employeeId && row.workDate === day);
  function cell(employeeId: string, day: string, currentDrafts: Record<string, Draft> = drafts): CashierRosterDraftCell {
    const existing = existingFor(employeeId, day);
    const activeDraft = currentDrafts[key(employeeId, day)];
    if (activeDraft) return { shift: activeDraft.shift, outletId: activeDraft.outletId };
    return { shift: existing?.status === 'active' ? existing.shift : '', outletId: existing?.outletId ?? $app.employees.find(employee => employee.id === employeeId)?.outletId ?? '' };
  }
  const defaultOutletFor = (employeeId: string) => $app.employees.find(employee => employee.id === employeeId)?.outletId ?? '';
  const baselineFor = (employeeId: string, day: string): CashierRosterBaseline => cashierRosterBaseline(existingFor(employeeId, day), defaultOutletFor(employeeId));
  const sameDraftValue = (entry: CashierRosterDraftCell, baseline: CashierRosterBaseline) =>
    baseline.status === 'active' ? entry.shift === baseline.shift && entry.outletId === baseline.outletId : entry.shift === '';
  const dayName = (day: string) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const shiftName = (shift: string) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle', off: 'Libur' }[shift] ?? 'Belum diatur');
  function changeCell(employeeId: string, day: string, field: keyof Draft, value: string) {
    if (day < today) return;
    const current = cell(employeeId, day);
    const next = { ...current, [field]: value } as Draft;
    const previous = drafts[key(employeeId, day)];
    const baseline = previous?.baseline ?? baselineFor(employeeId, day);
    const nextDrafts = { ...drafts }, draftKey = key(employeeId, day);
    if (!previous?.needsReview && sameDraftValue(next, baseline)) delete nextDrafts[draftKey];
    else nextDrafts[draftKey] = { shift: next.shift, outletId: next.outletId, baseline, needsReview: previous?.needsReview ?? false };
    drafts = nextDrafts;
    persistDraft();
  }
  function buildChanges(currentDrafts: Record<string, Draft> = drafts): CashierRosterChange[] {
    const changes: CashierRosterChange[] = [];
    for (const employee of cashiers) for (const day of days) {
      if (day < today) continue;
      const draft = currentDrafts[key(employee.id, day)]; if (!draft || !draft.baseline || draft.needsReview) continue;
      const baseline = draft.baseline;
      if (draft.shift === '') {
        if (baseline.status === 'active') changes.push({ id: baseline.id ?? undefined, employeeId: employee.id, workDate: day, outletId: baseline.outletId,
          shift: baseline.shift as CashierRosterChange['shift'], reason, expectedUpdatedAt: baseline.updatedAt, cancel: true });
        continue;
      }
      if (baseline.status === 'active' && baseline.shift === draft.shift && baseline.outletId === draft.outletId) continue;
      changes.push({ id: baseline.id ?? undefined, employeeId: employee.id, workDate: day, outletId: draft.outletId,
        shift: draft.shift as CashierRosterChange['shift'], reason, expectedUpdatedAt: baseline.updatedAt });
    }
    return changes;
  }
  $: changes = buildChanges(drafts);
  $: reviewEntries = Object.entries(drafts).flatMap(([draftKey, draft]) => {
    const separator = draftKey.lastIndexOf(':'), employeeId = draftKey.slice(0, separator), workDate = draftKey.slice(separator + 1);
    // Read the store directly so Svelte tracks source updates as a dependency
    // and refreshes the review controls without an unrelated draft edit.
    const current = cashierRosterBaseline(($app.cashierAssignments ?? []).find(row => row.employeeId === employeeId && row.workDate === workDate), cashiers.find(item => item.id === employeeId)?.outletId ?? '');
    return draft.needsReview || !cashierRosterBaselinesEqual(draft.baseline, current)
      ? [{ key: draftKey, employeeId, workDate, draft, current }] : [];
  });
  $: validationConflicts = changes.flatMap(change => {
    // A stale baseline already has a per-cell review action above. Do not count
    // the same source change again as a second generic validation conflict.
    if (reviewEntries.some(entry => entry.employeeId === change.employeeId && entry.workDate === change.workDate)) return [];
    try { validateRosterBatch($app, $app.user?.id ?? '', weekStart, [{ ...change, reason: 'Pratinjau jadwal' }]); return []; }
    catch (error) { const employee = cashiers.find(item => item.id === change.employeeId); return [`${employee?.fullName ?? 'Kasir'} · ${dateLabel(change.workDate)}: ${error instanceof Error ? error.message : 'Konflik jadwal'}`]; }
  });
  $: conflicts = [...reviewEntries.map(entry => `${cashiers.find(item => item.id === entry.employeeId)?.fullName ?? 'Kasir'} · ${dateLabel(entry.workDate)}: jadwal berubah sejak draft dibuat atau draft lama perlu ditinjau.`), ...validationConflicts];
  function reviewDraft(draftKey: string, action: 'server' | 'reapply') {
    const entry = drafts[draftKey], review = reviewEntries.find(item => item.key === draftKey);
    if (!entry || !review) return;
    const next = { ...drafts };
    if (action === 'server' || sameDraftValue(entry, review.current)) delete next[draftKey];
    else next[draftKey] = { ...entry, baseline: review.current, needsReview: false };
    drafts = next; persistDraft();
  }
  function acknowledgeLegacyAttemptAfterReview() { legacyAttemptNeedsReview = false; persistDraft(); }
  $: warnings = changes.flatMap(change => {
    const employee = cashiers.find(item => item.id === change.employeeId);
    const rows = $app.leaveRequests.filter(request => request.employeeId === change.employeeId && request.startDate <= change.workDate && request.endDate >= change.workDate);
    const pending = rows.some(request => request.status === 'pending' || request.adjustment?.status === 'pending');
    const partial = rows.some(request => request.extent !== 'full_day' && (request.status === 'approved' || request.status === 'pending'));
    return [pending ? `${employee?.fullName ?? 'Kasir'} · ${dateLabel(change.workDate)}: ada izin/perubahan yang masih menunggu; keputusan lama tetap berlaku.` : '',
      partial ? `${employee?.fullName ?? 'Kasir'} · ${dateLabel(change.workDate)}: izin sebagian jam perlu ditinjau sepanjang shift.` : ''].filter(Boolean);
  });
  function showCopyPreview() { copyPreview = previewPreviousWeekCopy($app, weekStart); copySkippedDrafts = 0; message = ''; failed = false; }
  function applyCopyPreview() {
    if (!copyPreview) return;
    const next = { ...drafts }; let skipped = 0;
    for (const change of copyPreview.changes) {
      const cellKey = key(change.employeeId, change.workDate);
      if (next[cellKey] || existingFor(change.employeeId, change.workDate)) { skipped++; continue; }
      next[cellKey] = { shift: change.shift, outletId: change.outletId, baseline: baselineFor(change.employeeId, change.workDate), needsReview: false };
    }
    drafts = next; copySkippedDrafts = skipped; persistDraft();
  }
  const sameAccount = (operation: SaveOperation) => !destroyed && get(app).user?.id === operation.accountId && accountGeneration === operation.accountGeneration;
  const sameOrigin = (operation: SaveOperation) => !destroyed && get(app).user?.id === operation.accountId
    && activeDraftStorageKey === operation.storageKey && weekStart === operation.weekStart;
  const canShowResult = (operation: SaveOperation) => sameAccount(operation) && sameOrigin(operation)
    && scopeGeneration === operation.generation && activeSave === operation;
  function settleOperation(operation: SaveOperation, attempt: CashierRosterSaveAttempt, outcome: CashierRosterAttemptOutcome): boolean | null {
    const activeOrigin = sameOrigin(operation);
    // A concurrent replay may already have resolved this attempt, or the
    // planner may now hold a replacement. Neither is a storage failure.
    if (activeOrigin && !cashierRosterAttemptsEqual(pendingAttempt, attempt)) return null;
    const settled = settleCashierRosterDraftAttempt(localStorage, operation.storageKey, attempt, outcome, activeOrigin ? currentDraft() : undefined);
    if (activeOrigin && !settled) draftStorageWarning = true;
    return settled && (!activeOrigin || !cashierRosterAttemptsEqual(pendingAttempt, attempt));
  }
  async function save() {
    if (saving || legacyAttemptNeedsReview || (!pendingAttempt && (!changes.length || conflicts.length))) return;
    const actorId = get(app).user?.id;
    if (!actorId || activeDraftStorageKey !== cashierRosterDraftStorageKey(actorId, weekStart)) return;
    const operation: SaveOperation = { accountId: actorId, accountGeneration, storageKey: activeDraftStorageKey, weekStart, generation: scopeGeneration };
    activeSave = operation;
    saving = true; message = ''; failed = false;
    let attempt = pendingAttempt;
    const replayingPersistedAttempt = attempt !== null;
    let attemptedChanges: CashierRosterChange[] = [];
    try {
      if (!attempt) {
        attemptedChanges = changes.map(change => ({ ...change, reason: reason.trim() }));
        validateRosterBatch($app, $app.user?.id ?? '', weekStart, attemptedChanges);
        attempt = createCashierRosterAttempt(weekStart, attemptedChanges, null);
        pendingAttempt = attempt;
        if (!persistDraft()) {
          pendingAttempt = null;
          failed = true;
          message = 'Jadwal belum dikirim karena catatan pemulihan gagal disimpan di perangkat ini. Coba kembali setelah ruang penyimpanan tersedia.';
          return;
        }
      } else attemptedChanges = structuredClone(attempt.changes);
      const result = await actions.saveCashierRosterBatch(attempt.weekStart, attemptedChanges, attempt.idempotencyKey, replayingPersistedAttempt);
      const settled = settleOperation(operation, attempt, 'saved');
      if (canShowResult(operation) && settled !== null) {
        message = settled ? `${result.saved_count} perubahan jadwal tersimpan bersama.` : 'Jadwal tersimpan di server, tetapi pemulihan perangkat belum dapat diselesaikan. Ulangi percobaan yang sama setelah penyimpanan tersedia.';
        failed = !settled; copyPreview = null;
      }
    } catch (error) {
      if (attempt && sameOrigin(operation) && !cashierRosterAttemptsEqual(pendingAttempt, attempt)) return;
      if (canShowResult(operation)) { failed = true; message = cashierRosterSaveErrorMessage(error); }
      if (sameAccount(operation) && await reconcileUncertainCashierRosterSave(error, attemptedChanges,
        async () => { if (sameAccount(operation)) await actions.refresh(); },
        () => sameAccount(operation) ? get(app).cashierAssignments ?? [] : [])) {
        const settled = attempt && settleOperation(operation, attempt, 'saved');
        if (canShowResult(operation) && settled !== null) {
          copyPreview = null; failed = !settled;
          message = settled ? 'Semua perubahan sudah terlihat pada jadwal dan draft telah disinkronkan.' : 'Jadwal terlihat di server, tetapi catatan pemulihan perangkat belum dapat diselesaikan. Ulangi percobaan yang sama setelah penyimpanan tersedia.';
        }
      } else if (attempt && cashierRosterSaveOutcomeIsDefiniteBaselineConflict(error)) {
        if (!sameAccount(operation)) return;
        try { await actions.refresh(); } catch { /* Keep the original attempt until the latest source is available. */ }
        if (!sameAccount(operation)) return;
        const refreshed = get(app);
        const sourceChanged = attempt.changes.some(change => {
          const current = (refreshed.cashierAssignments ?? []).find(row => row.employeeId === change.employeeId && row.workDate === change.workDate);
          return (current?.id ?? null) !== (change.id ?? null) || (current?.updatedAt ?? null) !== (change.expectedUpdatedAt ?? null);
        });
        if (!refreshed.error && sourceChanged) {
          const settled = settleOperation(operation, attempt, 'rejected');
          if (canShowResult(operation) && settled) {
            message = 'Server memastikan percobaan lama tidak tersimpan karena jadwal berubah. Draft Anda tetap ada; tinjau jadwal terbaru sebelum menyimpan lagi.';
          } else if (canShowResult(operation) && settled !== null) {
            message = 'Jadwal berubah dan server menolak percobaan lama. Status pemulihan belum tersimpan di perangkat, jadi percobaan lama tetap ditahan sampai penyimpanan tersedia.';
          }
        } else if (canShowResult(operation)) {
          message = 'Server menolak percobaan karena jadwal berubah, tetapi jadwal terbaru belum dapat dipastikan. Percobaan lama tetap tersimpan; coba ulangi setelah koneksi pulih.';
        }
      } else if (attempt && cashierRosterSaveOutcomeIsDefiniteLeaveConflict(error)) {
        if (!sameAccount(operation)) return;
        const settled = settleOperation(operation, attempt, 'rejected');
        if (canShowResult(operation) && settled) {
          message = 'Server memastikan jadwal lama tidak tersimpan karena cuti sehari penuh sudah disetujui. Draft Anda tetap ada; ubah shift yang berbenturan lalu simpan sebagai percobaan baru.';
        } else if (canShowResult(operation) && settled === false) {
          message = 'Server memastikan jadwal lama tidak tersimpan, tetapi catatan pemulihan perangkat belum dapat diperbarui. Percobaan lama tetap ditahan sampai penyimpanan perangkat tersedia.';
        }
      } else if (attempt && !replayingPersistedAttempt && !cashierRosterSaveOutcomeIsUncertain(error)) { settleOperation(operation, attempt, 'rejected'); }
    }
    finally { if (activeSave === operation) { saving = false; activeSave = null; } }
  }
  async function retryPendingAttempt() { await save(); }
  function selectWeek(nextWeek: string) {
    if (!persistDraft()) return;
    weekStart = nextWeek;
    const url = new URL(window.location.href); url.searchParams.set('week', nextWeek);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }
  function moveWeek(offset: number) { selectWeek(addWorkDays(weekStart, offset * 7)); }
  function moveToCurrentWeek() { selectWeek(startOfWorkWeek(today)); }
</script>

<section class="weekly-planner">
  <div class="planner-heading"><div><span class="eyebrow">PENUGASAN KASIR</span><h2>Jadwal mingguan</h2><p>{workWeekLabel(weekStart)} · waktu kerja WIB</p></div><div class="week-nav"><button class="btn btn-secondary" type="button" disabled={saving} on:click={() => moveWeek(-1)}>Minggu sebelumnya</button><button class="btn btn-secondary" type="button" disabled={saving} on:click={moveToCurrentWeek}>Minggu ini</button><button class="btn btn-secondary" type="button" disabled={saving} on:click={() => moveWeek(1)}>Minggu berikutnya</button></div></div>
  <Feedback {message} error={failed}/>
  <p class="notice">Jadwal lampau hanya dapat dilihat. Libur tetap adalah saran; jadwal tidak dibuat otomatis. Perubahan berbenturan, jadwal usang, atau tanggal dengan absensi akan ditolak sebelum disimpan.</p>
  {#if draftStorageConflict}<p class="draft-status draft-warning" role="alert">Draft minggu ini berubah di tab lain. Tab ini tidak menimpa data yang lebih baru dan perpindahan minggu ditahan. Muat ulang halaman untuk membuka draft tersimpan terbaru; perubahan tab ini yang belum tersimpan tetap tampil sampai dimuat ulang.</p>{:else if draftStorageWarning}<p class="draft-status draft-warning" role="alert">Browser tidak dapat menyimpan draft dan kunci pemulihan. Jadwal tidak dikirim sampai penyimpanan perangkat kembali tersedia.</p>{:else if Object.keys(drafts).length || reason}<p class="draft-status" role="status">Draft jadwal tersimpan di perangkat dan akun ini; draft akan dipulihkan saat halaman dibuka kembali.</p>{/if}
  {#if legacyAttemptNeedsReview}<section class="draft-review" role="alert"><strong>Draft lama membawa percobaan simpan yang tidak dapat dipastikan.</strong><p>Periksa jadwal terbaru dan bandingkan dengan draft sebelum mengizinkan penyimpanan baru. Kunci percobaan lama tidak dapat dipulihkan secara aman.</p><button class="btn btn-secondary" type="button" disabled={saving} on:click={acknowledgeLegacyAttemptAfterReview}>Saya sudah memeriksa status jadwal di server</button></section>{/if}
  {#if pendingAttempt}<section class="pending-attempt" role="status"><strong>Ada percobaan simpan sebelumnya yang belum dipastikan</strong><p>{pendingAttempt.changes.length} perubahan dari minggu {dateLabel(pendingAttempt.weekStart)} akan dikirim ulang dengan payload dan kunci yang sama. Draft baru tetap tersimpan lokal sampai percobaan ini selesai.</p><button class="btn btn-secondary" type="button" disabled={saving || draftStorageWarning} on:click={retryPendingAttempt}>{saving ? 'Memeriksa hasil…' : 'Ulangi percobaan simpan sebelumnya'}</button></section>{/if}
  {#if reviewEntries.length}<section class="draft-review" aria-labelledby="draft-review-title"><strong id="draft-review-title">Tinjau {reviewEntries.length} sel sebelum menyimpan</strong><p>Perubahan dari sesi lain atau draft lama perlu ditinjau satu per satu. Menyentuh sel lain tidak menghapus konflik.</p>{#each reviewEntries as item (item.key)}{@const employee = cashiers.find(person => person.id === item.employeeId)}<article class="review-cell"><div><strong>{employee?.fullName ?? 'Kasir'} · {dateLabel(item.workDate)}</strong><span>Draft Anda: {item.draft.shift ? `${shiftName(item.draft.shift)} · ${$app.outlets.find(outlet => outlet.id === item.draft.outletId)?.name ?? 'Outlet tidak dikenal'}` : 'Belum ditugaskan'}</span><span>Jadwal terbaru: {item.current.status === 'active' ? `${shiftName(item.current.shift)} · ${$app.outlets.find(outlet => outlet.id === item.current.outletId)?.name ?? 'Outlet tidak dikenal'}` : item.current.status === 'cancelled' ? `Dibatalkan · ${shiftName(item.current.shift)}` : `Belum ditugaskan · outlet utama ${$app.outlets.find(outlet => outlet.id === item.current.outletId)?.name ?? 'belum diatur'}`}</span></div><div class="review-actions"><button class="btn btn-secondary" type="button" disabled={saving} on:click={() => reviewDraft(item.key, 'server')}>Gunakan jadwal terbaru</button><button class="btn btn-primary" type="button" disabled={saving} on:click={() => reviewDraft(item.key, 'reapply')}>Terapkan kembali draft saya</button></div></article>{/each}</section>{/if}
  <div class="copy-tools"><button class="btn btn-secondary" type="button" disabled={saving} on:click={showCopyPreview}>Pratinjau salin minggu sebelumnya</button>{#if copyPreview}<div class="copy-summary"><strong>Salin {copyPreview.sourceWeek} → {copyPreview.targetWeek}</strong><span>{copyPreview.changes.length} sel baru · {copyPreview.skipped} target sudah terisi{copyPreview.conflicts.length ? ` · ${copyPreview.conflicts.length} perlu diperiksa` : ''}{copySkippedDrafts ? ` · ${copySkippedDrafts} draft lokal dilewati` : ''}</span>{#if copyPreview.conflicts.length}<ul>{#each copyPreview.conflicts.slice(0,5) as conflict}<li>{conflict}</li>{/each}</ul>{/if}{#if copyPreview.changes.length}<button class="btn btn-primary" type="button" disabled={saving} on:click={applyCopyPreview}>Terapkan sel kosong ke grid</button>{/if}</div>{/if}</div>
  {#if cashiers.length}
    <div class="table-scroll"><table class="week-grid"><thead><tr><th class="employee-col">Kasir</th>{#each days as day}<th><strong>{dayName(day)}</strong><small>{dateLabel(day)}</small></th>{/each}</tr></thead><tbody>
      {#each cashiers as employee (employee.id)}<tr><th class="employee-cell"><strong>{employee.fullName}</strong><small>{employee.employeeNumber}</small></th>{#each days as day (day)}{@const current = cell(employee.id, day, drafts)}{@const original = existingFor(employee.id, day)}{@const fixedOff = employee.weeklyOffDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())}<td class:readonly={day < today}>
        {#if day < today}<strong class="read-only-value">{shiftName(current.shift)}</strong><small>{current.shift ? ($app.outlets.find(outlet => outlet.id === current.outletId)?.name ?? '—') : fixedOff ? 'Libur tetap · belum dijadwalkan' : 'Belum dijadwalkan'}</small>
        {:else}<select class="select shift-select" aria-label={`Shift ${employee.fullName}, ${dateLabel(day)}`} disabled={saving} value={current.shift} on:change={(event) => changeCell(employee.id, day, 'shift', event.currentTarget.value)}><option value="">Belum ditugaskan</option><option value="morning">Pagi</option><option value="afternoon">Sore</option>{#if employee.canMiddleShift}<option value="middle">Middle</option>{/if}<option value="off">Libur</option></select>
          {#if current.shift}<select class="select outlet-select" aria-label={`Outlet ${employee.fullName}, ${dateLabel(day)}`} disabled={saving} value={current.outletId} on:change={(event) => changeCell(employee.id, day, 'outletId', event.currentTarget.value)}>{#each $app.outlets.filter(outlet => outlet.active || outlet.id === current.outletId) as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select>{:else if fixedOff}<small class="off-hint">Libur tetap · saran</small>{/if}
          {#if original?.status === 'cancelled' && current.shift}<small class="cancelled-hint">Aktifkan kembali jadwal batal</small>{/if}
        {/if}
      </td>{/each}</tr>{/each}
    </tbody></table></div>
  {:else}<p class="empty">Belum ada kasir aktif untuk dijadwalkan.</p>{/if}
  <div class="save-row"><label class="field">Alasan perubahan batch<input class="input" bind:value={reason} on:input={() => persistDraft()} disabled={saving} maxlength="2000" placeholder="Contoh: jadwal mingguan dikonfirmasi SPV"/></label><div class="save-info"><strong>{changes.length} perubahan draft</strong>{#if conflicts.length}<span class="conflicts">{conflicts.length} konflik harus ditinjau</span>{:else}<span>Setiap baris akan disimpan dalam satu transaksi</span>{/if}{#if !pendingAttempt}<button class="btn btn-primary" type="button" disabled={saving || draftStorageWarning || !changes.length || reason.trim().length < 5 || conflicts.length > 0 || legacyAttemptNeedsReview} on:click={save}>{saving ? 'Menyimpan semua…' : 'Simpan jadwal mingguan'}</button>{/if}</div></div>
  {#if reason.trim().length > 0 && reason.trim().length < 5}<p class="validation-hint">Alasan perubahan minimal 5 karakter.</p>{/if}
  {#if warnings.length}<ul class="warnings">{#each [...new Set(warnings)].slice(0,6) as warning}<li>{warning}</li>{/each}</ul>{/if}

  <StaffingRequirementEditor/>
</section>

<style>
  .draft-status,.pending-attempt,.draft-review{margin:0 1.3rem .9rem;padding:.7rem .85rem;border:1px solid var(--panel-border);border-radius:12px;background:var(--surface);font-size:.66rem;color:var(--muted)}.draft-warning,.draft-review{color:#7b3d28;background:#fff5da}.pending-attempt{background:var(--yellow-soft)}.pending-attempt p,.draft-review p{margin:.35rem 0 .6rem;line-height:1.5}.review-cell{display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.65rem 0;border-top:1px solid var(--border)}.review-cell>div:first-child{display:grid;gap:.25rem}.review-cell span{font-size:.62rem;color:var(--muted)}.review-actions{display:flex;gap:.45rem;flex-wrap:wrap}.review-actions .btn,.draft-review .btn,.pending-attempt .btn{min-height:38px;font-size:.64rem}
  .weekly-planner{padding:0 0 1.1rem}.planner-heading{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1.3rem 1.4rem}.eyebrow{font-size:.62rem;letter-spacing:.12em;color:var(--accent);font-weight:700}.planner-heading h2{font-size:1rem;margin:.35rem 0}.planner-heading p{font-size:.7rem;color:var(--muted);margin:0}.week-nav{display:flex;flex-wrap:wrap;gap:.45rem}.week-nav .btn{font-size:.65rem;min-height:40px;padding:.55rem .7rem}.notice{margin:0 1.3rem .9rem;padding:.8rem;border:1px solid var(--panel-border);border-radius:13px;background:var(--yellow-soft);font-size:.68rem;line-height:1.6;color:var(--ink)}.copy-tools{display:grid;gap:.55rem;padding:0 1.3rem .9rem}.copy-summary{display:grid;gap:.45rem;padding:.8rem;border:1px solid var(--panel-border);border-radius:14px;background:var(--surface)}.copy-summary strong{font-size:.72rem}.copy-summary span,.copy-summary li{font-size:.66rem;color:var(--muted)}.copy-summary ul{margin:0;padding-left:1.1rem}.table-scroll{width:100%;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.week-grid{min-width:1120px;width:100%;border-collapse:separate;border-spacing:0;text-align:left}.week-grid th,.week-grid td{padding:.6rem;vertical-align:top;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface)}.week-grid thead th{position:sticky;top:0;z-index:2;background:var(--yellow-soft);font-size:.67rem}.week-grid thead th strong,.week-grid thead th small{display:block}.week-grid thead th small{font-weight:400;color:var(--muted);margin-top:.25rem}.week-grid .employee-col{min-width:160px;left:0;z-index:3}.employee-cell{position:sticky;left:0;z-index:1;min-width:160px;background:var(--surface-cream)!important}.employee-cell strong,.employee-cell small{display:block}.employee-cell strong{font-size:.68rem}.employee-cell small{font-size:.61rem;color:var(--muted);margin-top:.25rem}.week-grid td{min-width:138px;max-width:172px}.week-grid td.readonly{background:#f5f0df}.shift-select,.outlet-select{width:100%;min-width:0;min-height:39px;padding:.45rem;margin:.08rem 0;font-size:.63rem}.read-only-value{font-size:.67rem}.week-grid td small{display:block;font-size:.58rem;color:var(--muted);line-height:1.4;margin-top:.2rem}.off-hint{color:var(--accent)!important}.cancelled-hint{color:#8c4c31!important}.save-row{display:grid;grid-template-columns:minmax(240px,1fr) 1.2fr;align-items:end;gap:1rem;padding:1rem 1.3rem}.save-row .field{font-size:.68rem}.save-info{display:flex;align-items:center;justify-content:flex-end;gap:.7rem;flex-wrap:wrap}.save-info strong,.save-info span{font-size:.66rem}.save-info span{color:var(--muted)}.save-info .conflicts{color:#7b3d28;font-weight:700}.save-info .btn{min-height:44px}.empty{padding:1rem 1.3rem;font-size:.72rem;color:var(--muted)}.validation-hint,.warnings{margin:0 1.3rem .6rem;font-size:.66rem;color:#805012;line-height:1.5}.warnings{padding:.6rem 1.7rem;background:#fff5da;border-radius:11px}.warnings li{margin:.2rem 0}@media(max-width:850px){.planner-heading{align-items:flex-start;flex-direction:column}.save-row{grid-template-columns:1fr}.save-info{justify-content:space-between}}@media(max-width:620px){.week-nav{width:100%}.week-nav .btn{flex:1;font-size:.58rem}.save-info .btn{width:100%}.table-scroll{touch-action:pan-x}.employee-cell,.week-grid .employee-col{min-width:130px}.week-grid td{min-width:130px}.review-cell{align-items:flex-start;flex-direction:column}.review-actions{width:100%}.review-actions .btn{flex:1}}
</style>
