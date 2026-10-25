<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { app, actions, displayName, isAdmin, isCashier, shiftLabel } from '#lib/state/app';
  import type { CashierAssignment, Shift } from '#lib/types';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { dateLabel, todayJakarta } from '#lib/components/format';

  /*
   * The operational actions are deliberately invoked through app.actions.  The
   * server remains the authority for scopes, assignment context, revision
   * checks, and every final decision.  These structural types keep this route
   * independently readable while the state layer maps SQL rows to app types.
   */
  type IssueStatus = 'new' | 'assigned' | 'in_progress' | 'completed';
  type IssueView = 'open' | 'mine' | 'unassigned' | 'history';
  type HandoverStatus = 'draft' | 'sent' | 'accepted' | 'revision_requested';
  type ExchangeStatus = 'pending_peer' | 'pending_spv' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  type ExchangeType = 'swap' | 'replacement';
  type Cursor = Record<string, string | number> | null;

  interface IssueCategory { id: string; name: string; code?: string; active?: boolean; revision: number; updatedAt?: string }
  interface OutletIssue {
    id: string; issueNumber?: number; outletId: string; reporterEmployeeId: string | null; createdBy: string;
    categoryId: string; categoryName: string; routedToEmployeeId: string | null; ownerId: string | null;
    urgency: 'low' | 'normal' | 'high' | 'urgent'; description: string; photoPath: string | null;
    status: IssueStatus; dueAt: string | null; resolutionNote: string; revision: number;
    createdAt: string; updatedAt: string; completedAt: string | null;
  }
  interface ShiftHandover {
    id: string; outletId: string; workDate: string; senderEmployeeId: string; senderAssignmentId: string | null;
    recipientEmployeeId: string | null; recipientAssignmentId: string | null; status: HandoverStatus; version: number;
    pendingWork: string; outletCondition: string; notes: string; sentAt: string | null; acceptedAt: string | null;
    createdAt: string; updatedAt: string;
  }
  interface ShiftExchange {
    id: string; requestNumber?: number; requestType: ExchangeType; workDate: string;
    requesterEmployeeId: string; peerEmployeeId: string; requesterAssignmentId: string; peerAssignmentId: string | null;
    reason: string; status: ExchangeStatus; peerNote: string; decisionNote: string; decidedBy: string | null;
    revision: number; createdAt: string; updatedAt: string; decidedAt: string | null;
  }
  interface Page<T> { items: T[]; total: number; hasMore: boolean; nextCursor: Cursor; asOf: string; categories?: IssueCategory[] }
  // A pending request is written to localStorage, so it deliberately contains
  // only JSON values.  Files cannot survive JSON serialization: an optional
  // photo is uploaded to its deterministic private path before this payload is
  // persisted, then the exact path/key can be replayed after a reload.
  interface IssueSubmitInput { outletId: string; categoryId: string; description: string; urgency: OutletIssue['urgency']; photoPath?: string | null; reporterEmployeeId?: string | null; idempotencyKey: string }
  interface IssueUpdateInput { id: string; expectedRevision: number; idempotencyKey: string; status: IssueStatus; ownerId: string | null; dueAt: string | null; resolutionNote: string; reason: string }
  interface HandoverSaveInput { id: string | null; expectedVersion: number | null; idempotencyKey: string; outletId: string; workDate: string; senderAssignmentId: string | null; recipientEmployeeId: string | null; recipientAssignmentId: string | null; pendingWork: string; outletCondition: string; notes: string; send: boolean; reason: string }
  interface HandoverResponseInput { id: string; expectedVersion: number; idempotencyKey: string; accept: boolean; reason: string }
  interface ExchangeSubmitInput { requestType: ExchangeType; requesterAssignmentId: string; peerEmployeeId: string; reason: string; idempotencyKey: string }
  interface ExchangeResponseInput { id: string; expectedRevision: number; idempotencyKey: string; accept: boolean; note: string }
  interface ExchangeDecisionInput { id: string; expectedRevision: number; idempotencyKey: string; approved: boolean; note: string }
  interface ExchangeCancelInput { id: string; expectedRevision: number; idempotencyKey: string; note: string }
  interface CategoryForm { id: string; expectedRevision: number | null; code: string; name: string; active: boolean }
  interface RouteForm { id: string; expectedRevision: number | null; categoryId: string; outletId: string; recipientEmployeeId: string; active: boolean }
  interface CapabilityForm { id: string; expectedRevision: number | null; employeeId: string; capability: string; outletId: string; categoryId: string; granted: boolean }
  interface CategorySaveInput { id?: string | null; expectedRevision?: number | null; idempotencyKey: string; code: string; name: string; active: boolean }
  interface RouteSaveInput { id?: string | null; expectedRevision?: number | null; idempotencyKey: string; categoryId: string; outletId?: string | null; recipientEmployeeId?: string | null; active: boolean }
  interface CapabilitySaveInput { id?: string | null; expectedRevision?: number | null; idempotencyKey: string; employeeId: string; capability: string; outletId?: string | null; categoryId?: string | null; granted: boolean }
  interface OperationsActions {
    loadSupervisorIssueCategories(includeInactive?: boolean): Promise<IssueCategory[]>;
    loadSupervisorOperationConfiguration(): Promise<OperationsConfiguration>;
    saveSupervisorIssueCategory(input: CategorySaveInput): Promise<IssueCategory>;
    saveSupervisorIssueRoute(input: RouteSaveInput): Promise<IssueRoute>;
    saveSupervisorCapability(input: CapabilitySaveInput): Promise<unknown>;
    uploadOutletIssuePhoto(photo: File, idempotencyKey: string): Promise<string>;
    createOutletIssuePhotoUrl?(path: string): Promise<string>;
    loadOutletIssues(input: { view: IssueView; outletId?: string; categoryId?: string; pageSize?: number; cursor?: Cursor }): Promise<Page<OutletIssue>>;
    submitOutletIssue(input: IssueSubmitInput): Promise<OutletIssue>;
    updateOutletIssue(input: IssueUpdateInput): Promise<OutletIssue>;
    loadShiftHandovers(input: { outletId?: string; from?: string; to?: string; pageSize?: number; cursor?: Cursor }): Promise<Page<ShiftHandover>>;
    saveShiftHandover(input: HandoverSaveInput): Promise<ShiftHandover>;
    respondShiftHandover(input: HandoverResponseInput): Promise<ShiftHandover>;
    loadShiftExchanges(input: { view: 'active' | 'history' | 'pending_spv'; pageSize?: number; cursor?: Cursor }): Promise<Page<ShiftExchange>>;
    submitShiftExchange(input: ExchangeSubmitInput): Promise<ShiftExchange>;
    respondShiftExchange(input: ExchangeResponseInput): Promise<ShiftExchange>;
    decideShiftExchange(input: ExchangeDecisionInput): Promise<ShiftExchange>;
    cancelShiftExchange(input: ExchangeCancelInput): Promise<ShiftExchange>;
    expireStaleShiftExchanges(idempotencyKey: string): Promise<{ expiredCount: number; asOf: string }>;
  }
  const operational = actions as unknown as OperationsActions;

  type Tab = 'issues' | 'handovers' | 'exchanges' | 'config';
  type RecoveryKind = 'issue-submit' | 'issue-update' | 'handover-save' | 'handover-response' | 'exchange-submit' | 'exchange-response' | 'exchange-decision' | 'exchange-cancel' | 'exchange-expire' | 'config-category' | 'config-route' | 'config-capability';
  interface PendingAttempt { idempotencyKey: string; payload: unknown; createdAt: string }
  interface StoredDraft<T> { baseline: number; values: T; pendingAttempt: PendingAttempt | null; conflict: string | null }
  interface IssueRoute { id: string; categoryId: string; outletId: string | null; recipientEmployeeId: string | null; active: boolean; revision: number; updatedAt: string }
  interface CapabilityGrant { id: string; employeeId: string; capability: string; outletId: string | null; categoryId: string | null; grantedBy: string; revision: number; createdAt: string; updatedAt: string }
  interface OperationsConfiguration { categories: IssueCategory[]; routes: IssueRoute[]; capabilities: CapabilityGrant[]; asOf: string }

  let tab: Tab = 'issues';
  let message = '', failed = false, loading = true, busy = '';
  let issueView: IssueView = 'open', issueOutletId = '', issueCategoryId = '', issueRows: OutletIssue[] = [], issueTotal = 0, issueAsOf = '', issueHasMore = false, issueNextCursor: Cursor = null;
  let issueCategories: IssueCategory[] = [], selectedIssueId = '', issueDraft: StoredDraft<IssueUpdateInput> | null = null;
  let issuePhoto: File | null = null;
  let issuePhotoUrl = '', issuePhotoLoading = false;
  let issueSubmitAttempt: PendingAttempt | null = null;
  let newIssue = { outletId: '', categoryId: '', reporterEmployeeId: '', urgency: 'normal' as OutletIssue['urgency'], description: '' };

  let handoverRows: ShiftHandover[] = [], handoverTotal = 0, handoverHasMore = false, handoverNextCursor: Cursor = null, selectedHandoverId = '', handoverDraft: StoredDraft<HandoverSaveInput> | null = null;
  let handoverResponseReason = '';
  let exchangeRows: ShiftExchange[] = [], exchangeTotal = 0, exchangeHasMore = false, exchangeNextCursor: Cursor = null, selectedExchangeId = '', exchangeResponseNote = '', exchangeDecisionNote = '', exchangeCancelNote = '';
  let exchangeSubmitAttempt: PendingAttempt | null = null;
  let exchangeForm = { requestType: 'swap' as ExchangeType, requesterAssignmentId: '', peerEmployeeId: '', reason: '' };
  let configuration: OperationsConfiguration | null = null;
  let categoryForm: CategoryForm = { id: '', expectedRevision: null, code: '', name: '', active: true };
  let routeForm: RouteForm = { id: '', expectedRevision: null, categoryId: '', outletId: '', recipientEmployeeId: '', active: true };
  let capabilityForm: CapabilityForm = { id: '', expectedRevision: null, employeeId: '', capability: 'issue_view', outletId: '', categoryId: '', granted: true };
  let categoryDraft: StoredDraft<CategoryForm> | null = null;
  let routeDraft: StoredDraft<RouteForm> | null = null;
  let capabilityDraft: StoredDraft<CapabilityForm> | null = null;
  let recoveryTick = 0;
  let loadingMore: '' | 'issues' | 'handovers' | 'exchanges' = '';
  let discardedLegacyIssuePhotoAttempt = false;
  let mounted = false, observedDataRevision = -1, pendingAuthoritativeRefresh = false, refreshingAuthoritativeData = false;

  $: admin = isAdmin($app.user);
  $: activeOutlets = $app.outlets.filter((outlet) => outlet.active);
  $: activeEmployees = $app.employees.filter((employee) => employee.status === 'active' && employee.accountStatus === 'active');
  $: cashiers = activeEmployees.filter((employee) => isCashier(employee));
  $: allAssignments = ($app.cashierAssignments ?? []).filter((assignment) => assignment.status === 'active');
  $: selectedIssue = issueRows.find((row) => row.id === selectedIssueId) ?? null;
  $: selectedHandover = handoverRows.find((row) => row.id === selectedHandoverId) ?? null;
  $: selectedExchange = exchangeRows.find((row) => row.id === selectedExchangeId) ?? null;
  $: selectedExchangeRequester = selectedExchange ? assignmentById(selectedExchange.requesterAssignmentId) : null;
  $: selectedExchangePeer = selectedExchange?.peerAssignmentId ? assignmentById(selectedExchange.peerAssignmentId) : null;
  $: requesterAssignment = assignmentById(exchangeForm.requesterAssignmentId);
  $: peerAssignment = requesterAssignment ? allAssignments.find((row) => row.employeeId === exchangeForm.peerEmployeeId && row.workDate === requesterAssignment.workDate) ?? null : null;
  $: handoverSenderAssignments = allAssignments.filter((row) => row.employeeId === $app.user?.id && row.shift !== 'off');
  $: handoverRecipientAssignments = (() => {
    const draft = handoverDraft;
    return draft ? allAssignments.filter((row) => row.employeeId === draft.values.recipientEmployeeId && row.outletId === draft.values.outletId && row.workDate === draft.values.workDate && row.shift !== 'off') : [];
  })();
  $: handoverRecipientCandidates = activeEmployees.filter((employee) => employee.id !== $app.user?.id && allAssignments.some((assignment) =>
    assignment.employeeId === employee.id && assignment.outletId === handoverDraft?.values.outletId && assignment.workDate === handoverDraft?.values.workDate && assignment.shift !== 'off'
  ));
  $: if (mounted && ($app.dataRevision ?? 0) !== observedDataRevision) {
    observedDataRevision = $app.dataRevision ?? 0;
    pendingAuthoritativeRefresh = true;
  }
  $: if (mounted && pendingAuthoritativeRefresh && !refreshingAuthoritativeData && !loading && !busy && !loadingMore) {
    pendingAuthoritativeRefresh = false;
    void refreshFromAuthoritativeData();
  }

  $: tabs = [
    { id: 'issues', label: 'Kendala outlet', detail: 'Lapor, tetapkan PIC, dan selesaikan kendala.' },
    { id: 'handovers', label: 'Serah terima', detail: 'Catatan antar-shift yang dikonfirmasi penerima.' },
    { id: 'exchanges', label: 'Tukar / pengganti', detail: 'Usulan kasir yang tetap menunggu keputusan HR.' },
    ...(admin ? [{ id: 'config' as Tab, label: 'Konfigurasi', detail: 'Kategori, routing, dan akses operasional.' }] : [])
  ] satisfies { id: Tab; label: string; detail: string }[];
  const issueViews: { id: IssueView; label: string }[] = [
    { id: 'open', label: 'Terbuka' }, { id: 'mine', label: 'Tugas saya' }, { id: 'unassigned', label: 'Belum ada PIC' }, { id: 'history', label: 'Riwayat' }
  ];
  const issueStatusLabel: Record<IssueStatus, string> = { new: 'Baru', assigned: 'Ditugaskan', in_progress: 'Diproses', completed: 'Selesai' };
  const handoverStatusLabel: Record<HandoverStatus, string> = { draft: 'Draft', sent: 'Menunggu penerima', accepted: 'Diterima', revision_requested: 'Perlu perbaikan' };
  const exchangeStatusLabel: Record<ExchangeStatus, string> = { pending_peer: 'Menunggu rekan', pending_spv: 'Menunggu HR', approved: 'Disetujui', rejected: 'Ditolak', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa' };
  const urgencyLabel: Record<OutletIssue['urgency'], string> = { low: 'Rendah', normal: 'Normal', high: 'Tinggi', urgent: 'Mendesak' };

  function randomKey() { return crypto.randomUUID(); }
  function outletName(id: string | null | undefined) { return $app.outlets.find((outlet) => outlet.id === id)?.name ?? 'Outlet tidak tersedia'; }
  function employeeName(id: string | null | undefined) { return id ? displayName(id) : 'Belum ditetapkan'; }
  function assignmentById(id: string | null | undefined) { return allAssignments.find((row) => row.id === id) ?? null; }
  function assignmentText(row: CashierAssignment | null | undefined) { return row ? `${outletName(row.outletId)} · ${row.shift === 'off' ? 'Libur' : shiftLabel(row.shift as Shift)} · ${dateLabel(row.workDate)}` : 'Belum ada penugasan'; }
  function isoToLocal(value: string | null | undefined) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date(value)).replace(', ', 'T');
  }
  function localToIso(value: string) { return value ? new Date(`${value}:00+07:00`).toISOString() : null; }
  function dateTimeLabel(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) + ' WIB' : 'Belum ditetapkan'; }
  function setFeedback(next: string, error = false) { message = next; failed = error; }
  function recoveryKey(kind: RecoveryKind, id: string) { return `rajaklana-hr:operations:${$app.user?.id ?? 'anonymous'}:${kind}:${id}`; }
  function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function containsSerializedIssuePhoto(value: unknown) {
    if (!isRecord(value)) return false;
    const candidates = [value.values, isRecord(value.pendingAttempt) ? value.pendingAttempt.payload : null];
    return candidates.some((candidate) => {
      if (!isRecord(candidate) || !Object.prototype.hasOwnProperty.call(candidate, 'photo')) return false;
      const photo = candidate.photo;
      // File objects are not JSON-serializable.  A stored object here is an
      // old attempt whose source image cannot be reconstructed safely.
      return photo !== null && photo !== undefined;
    });
  }
  function readRecovery<T>(kind: RecoveryKind, id: string): StoredDraft<T> | null {
    try {
      const key = recoveryKey(kind, id);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as StoredDraft<T>;
      if (kind === 'issue-submit' && containsSerializedIssuePhoto(value)) {
        localStorage.removeItem(key);
        discardedLegacyIssuePhotoAttempt = true;
        recoveryTick += 1;
        return null;
      }
      return value && typeof value === 'object' && typeof value.baseline === 'number' && value.values ? value : null;
    } catch { return null; }
  }
  function writeRecovery<T>(kind: RecoveryKind, id: string, value: StoredDraft<T>) {
    try { localStorage.setItem(recoveryKey(kind, id), JSON.stringify(value)); } catch { /* A failed local cache must not block a server request. */ }
    recoveryTick += 1;
  }
  function clearRecovery(kind: RecoveryKind, id: string) {
    try { localStorage.removeItem(recoveryKey(kind, id)); } catch { /* no-op */ }
    recoveryTick += 1;
  }
  function pendingFor(kind: RecoveryKind, id: string) {
    void recoveryTick;
    return readRecovery<Record<string, unknown>>(kind, id)?.pendingAttempt ?? null;
  }
  function issueDefaultOutlet() {
    const scheduled = allAssignments.find((row) => row.employeeId === $app.user?.id && row.workDate >= todayJakarta() && row.shift !== 'off');
    return scheduled?.outletId ?? $app.user?.outletId ?? activeOutlets[0]?.id ?? '';
  }
  function blankHandover(): HandoverSaveInput {
    const sender = handoverSenderAssignments.find((row) => row.workDate === todayJakarta()) ?? handoverSenderAssignments[0] ?? null;
    return { id: null, expectedVersion: null, idempotencyKey: '', outletId: sender?.outletId ?? issueDefaultOutlet(), workDate: sender?.workDate ?? todayJakarta(), senderAssignmentId: sender?.id ?? null,
      recipientEmployeeId: null, recipientAssignmentId: null, pendingWork: '', outletCondition: '', notes: '', send: false, reason: '' };
  }
  function issueEditFrom(row: OutletIssue): IssueUpdateInput {
    return { id: row.id, expectedRevision: row.revision, idempotencyKey: '', status: row.status, ownerId: row.ownerId, dueAt: row.dueAt, resolutionNote: row.resolutionNote, reason: '' };
  }
  function handoverEditFrom(row: ShiftHandover): HandoverSaveInput {
    return { id: row.id, expectedVersion: row.version, idempotencyKey: '', outletId: row.outletId, workDate: row.workDate, senderAssignmentId: row.senderAssignmentId,
      recipientEmployeeId: row.recipientEmployeeId, recipientAssignmentId: row.recipientAssignmentId, pendingWork: row.pendingWork, outletCondition: row.outletCondition, notes: row.notes, send: row.status !== 'draft', reason: '' };
  }
  function setQuery(key: string, value: string | null) {
    const url = new URL(window.location.href);
    for (const item of ['issue', 'handover', 'exchange']) if (item !== key) url.searchParams.delete(item);
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    replaceState(`${url.pathname}${url.search}${url.hash}`, {});
  }
  function selectIssue(row: OutletIssue) {
    selectedIssueId = row.id; issuePhotoUrl = ''; setQuery('issue', row.id);
    const fallback = issueEditFrom(row), stored = readRecovery<IssueUpdateInput>('issue-update', row.id);
    issueDraft = stored && stored.baseline === row.revision ? stored : { baseline: row.revision, values: stored?.values ?? fallback, pendingAttempt: stored?.pendingAttempt ?? null,
      conflict: stored && stored.baseline !== row.revision ? 'Kendala berubah di sesi lain. Periksa versi terbaru sebelum menyimpan draft Anda.' : null };
    writeRecovery('issue-update', row.id, issueDraft);
  }
  function selectHandover(row: ShiftHandover) {
    selectedHandoverId = row.id; setQuery('handover', row.id);
    const fallback = handoverEditFrom(row), stored = readRecovery<HandoverSaveInput>('handover-save', row.id);
    handoverDraft = stored && stored.baseline === row.version ? stored : { baseline: row.version, values: stored?.values ?? fallback, pendingAttempt: stored?.pendingAttempt ?? null,
      conflict: stored && stored.baseline !== row.version ? 'Serah terima berubah di sesi lain. Versi lama tidak akan menimpa catatan terbaru.' : null };
    writeRecovery('handover-save', row.id, handoverDraft);
    handoverResponseReason = '';
  }
  function selectExchange(row: ShiftExchange) {
    selectedExchangeId = row.id; setQuery('exchange', row.id); exchangeResponseNote = ''; exchangeDecisionNote = ''; exchangeCancelNote = '';
  }
  function startHandover() {
    selectedHandoverId = ''; setQuery('handover', null);
    const stored = readRecovery<HandoverSaveInput>('handover-save', 'new');
    handoverDraft = stored ?? { baseline: 0, values: blankHandover(), pendingAttempt: null, conflict: null };
    writeRecovery('handover-save', 'new', handoverDraft);
  }
  function rememberIssue() { if (selectedIssue && issueDraft) writeRecovery('issue-update', selectedIssue.id, issueDraft); }
  function rememberHandover() { if (handoverDraft) writeRecovery('handover-save', handoverDraft.values.id ?? 'new', handoverDraft); }
  function discardIssueDraft() { if (!selectedIssue) return; issueDraft = { baseline: selectedIssue.revision, values: issueEditFrom(selectedIssue), pendingAttempt: null, conflict: null }; writeRecovery('issue-update', selectedIssue.id, issueDraft); }
  function discardHandoverDraft() { if (selectedHandover) handoverDraft = { baseline: selectedHandover.version, values: handoverEditFrom(selectedHandover), pendingAttempt: null, conflict: null }; else handoverDraft = { baseline: 0, values: blankHandover(), pendingAttempt: null, conflict: null }; rememberHandover(); }
  function reviewIssueLatest() { if (!selectedIssue || !issueDraft) return; issueDraft = { ...issueDraft, baseline: selectedIssue.revision, values: { ...issueDraft.values, expectedRevision: selectedIssue.revision, idempotencyKey: '' }, pendingAttempt: null, conflict: null }; rememberIssue(); }
  function reviewHandoverLatest() { if (!selectedHandover || !handoverDraft) return; handoverDraft = { ...handoverDraft, baseline: selectedHandover.version, values: { ...handoverDraft.values, expectedVersion: selectedHandover.version, idempotencyKey: '' }, pendingAttempt: null, conflict: null }; rememberHandover(); }

  // Configuration writes use the same recovery discipline as operational
  // workflows: an uncertain network response remains bound to its original
  // payload and idempotency key.  The fixed per-kind slot is intentionally
  // namespaced by the signed-in employee in recoveryKey(), so one Admin HR
  // cannot restore another admin's local draft on the same device.
  const configDraftId = 'active';
  function emptyCategoryForm(): CategoryForm { return { id: '', expectedRevision: null, code: '', name: '', active: true }; }
  function emptyRouteForm(): RouteForm { return { id: '', expectedRevision: null, categoryId: '', outletId: '', recipientEmployeeId: '', active: true }; }
  function emptyCapabilityForm(): CapabilityForm { return { id: '', expectedRevision: null, employeeId: '', capability: 'issue_view', outletId: '', categoryId: '', granted: true }; }
  function isConflictError(error: unknown) { return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '40001'; }
  function categoryConfigDraft() { return categoryDraft ?? readRecovery<CategoryForm>('config-category', configDraftId); }
  function routeConfigDraft() { return routeDraft ?? readRecovery<RouteForm>('config-route', configDraftId); }
  function capabilityConfigDraft() { return capabilityDraft ?? readRecovery<CapabilityForm>('config-capability', configDraftId); }
  function rememberCategoryDraft() {
    const previous = categoryConfigDraft();
    categoryDraft = { baseline: categoryForm.expectedRevision ?? 0, values: { ...categoryForm }, pendingAttempt: previous?.pendingAttempt ?? null, conflict: previous?.conflict ?? null };
    writeRecovery('config-category', configDraftId, categoryDraft);
  }
  function rememberRouteDraft() {
    const previous = routeConfigDraft();
    routeDraft = { baseline: routeForm.expectedRevision ?? 0, values: { ...routeForm }, pendingAttempt: previous?.pendingAttempt ?? null, conflict: previous?.conflict ?? null };
    writeRecovery('config-route', configDraftId, routeDraft);
  }
  function rememberCapabilityDraft() {
    const previous = capabilityConfigDraft();
    capabilityDraft = { baseline: capabilityForm.expectedRevision ?? 0, values: { ...capabilityForm }, pendingAttempt: previous?.pendingAttempt ?? null, conflict: previous?.conflict ?? null };
    writeRecovery('config-capability', configDraftId, capabilityDraft);
  }
  function clearCategoryDraft() { categoryDraft = null; clearRecovery('config-category', configDraftId); }
  function clearRouteDraft() { routeDraft = null; clearRecovery('config-route', configDraftId); }
  function clearCapabilityDraft() { capabilityDraft = null; clearRecovery('config-capability', configDraftId); }
  function categoryChangedElsewhere(draft: StoredDraft<CategoryForm>) {
    if (!draft.values.id || draft.pendingAttempt) return draft;
    const latest = configuration?.categories.find((row) => row.id === draft.values.id);
    if (latest && latest.revision === draft.values.expectedRevision) return draft;
    return { ...draft, conflict: latest
      ? `Kategori diubah di sesi lain (revisi ${latest.revision}). Draft lokal tetap disimpan sampai Anda meninjaunya.`
      : 'Kategori tidak lagi tersedia di konfigurasi terbaru. Draft lokal tetap disimpan untuk ditinjau.' };
  }
  function routeChangedElsewhere(draft: StoredDraft<RouteForm>) {
    if (!draft.values.id || draft.pendingAttempt) return draft;
    const latest = configuration?.routes.find((row) => row.id === draft.values.id);
    if (latest && latest.revision === draft.values.expectedRevision) return draft;
    return { ...draft, conflict: latest
      ? `Routing diubah di sesi lain (revisi ${latest.revision}). Draft lokal tetap disimpan sampai Anda meninjaunya.`
      : 'Routing tidak lagi tersedia di konfigurasi terbaru. Draft lokal tetap disimpan untuk ditinjau.' };
  }
  function capabilityChangedElsewhere(draft: StoredDraft<CapabilityForm>) {
    if (draft.pendingAttempt) return draft;
    if (draft.values.id) {
      const latest = configuration?.capabilities.find((row) => row.id === draft.values.id);
      if (latest && latest.revision === draft.values.expectedRevision) return draft;
      return { ...draft, conflict: latest
        ? `Capability diubah di sesi lain (revisi ${latest.revision}). Tinjau data terbaru sebelum mencabut akses.`
        : 'Capability tidak lagi tersedia di konfigurasi terbaru. Tinjau daftar akses sebelum melanjutkan.' };
    }
    if (draft.values.employeeId && draft.values.granted && configuration?.capabilities.some((row) => row.employeeId === draft.values.employeeId
      && row.capability === draft.values.capability && row.outletId === (draft.values.outletId || null) && row.categoryId === (draft.values.categoryId || null))) {
      return { ...draft, conflict: 'Capability yang sama sudah dibuat di sesi lain. Tinjau daftar akses sebelum membuat perubahan baru.' };
    }
    return draft;
  }
  function reconcileConfigurationDrafts() {
    if (categoryDraft) {
      const next = categoryChangedElsewhere(categoryDraft);
      if (next !== categoryDraft) { categoryDraft = next; categoryForm = { ...next.values }; writeRecovery('config-category', configDraftId, next); }
    }
    if (routeDraft) {
      const next = routeChangedElsewhere(routeDraft);
      if (next !== routeDraft) { routeDraft = next; routeForm = { ...next.values }; writeRecovery('config-route', configDraftId, next); }
    }
    if (capabilityDraft) {
      const next = capabilityChangedElsewhere(capabilityDraft);
      if (next !== capabilityDraft) { capabilityDraft = next; capabilityForm = { ...next.values }; writeRecovery('config-capability', configDraftId, next); }
    }
  }
  function restoreConfigurationDrafts() {
    const storedCategory = readRecovery<CategoryForm>('config-category', configDraftId);
    const storedRoute = readRecovery<RouteForm>('config-route', configDraftId);
    const storedCapability = readRecovery<CapabilityForm>('config-capability', configDraftId);
    if (storedCategory) { categoryDraft = storedCategory; categoryForm = { ...storedCategory.values }; }
    if (storedRoute) { routeDraft = storedRoute; routeForm = { ...storedRoute.values }; }
    if (storedCapability) { capabilityDraft = storedCapability; capabilityForm = { ...storedCapability.values }; }
    reconcileConfigurationDrafts();
  }
  function editCategory(category: IssueCategory) {
    if (categoryConfigDraft()?.pendingAttempt) { setFeedback('Selesaikan retry kategori sebelumnya terlebih dahulu agar payload dan key asli tetap aman.', true); return; }
    categoryForm = { id: category.id, expectedRevision: category.revision, code: category.code ?? '', name: category.name, active: category.active !== false };
    categoryDraft = null; rememberCategoryDraft();
  }
  function resetCategory() { if (categoryConfigDraft()?.pendingAttempt) return; categoryForm = emptyCategoryForm(); clearCategoryDraft(); }
  function editRoute(route: IssueRoute) {
    if (routeConfigDraft()?.pendingAttempt) { setFeedback('Selesaikan retry routing sebelumnya terlebih dahulu agar payload dan key asli tetap aman.', true); return; }
    routeForm = { id: route.id, expectedRevision: route.revision, categoryId: route.categoryId, outletId: route.outletId ?? '', recipientEmployeeId: route.recipientEmployeeId ?? '', active: route.active };
    routeDraft = null; rememberRouteDraft();
  }
  function resetRoute() { if (routeConfigDraft()?.pendingAttempt) return; routeForm = emptyRouteForm(); clearRouteDraft(); }
  function reviewCategoryLatest() {
    const latest = categoryForm.id ? configuration?.categories.find((row) => row.id === categoryForm.id) : null;
    if (!latest) { setFeedback('Kategori versi terbaru tidak ditemukan. Muat ulang lalu buat ulang bila diperlukan.', true); return; }
    categoryForm = { ...categoryForm, expectedRevision: latest.revision };
    categoryDraft = { baseline: latest.revision, values: { ...categoryForm }, pendingAttempt: null, conflict: null }; writeRecovery('config-category', configDraftId, categoryDraft);
  }
  function reviewRouteLatest() {
    const latest = routeForm.id ? configuration?.routes.find((row) => row.id === routeForm.id) : null;
    if (!latest) { setFeedback('Routing versi terbaru tidak ditemukan. Muat ulang lalu buat ulang bila diperlukan.', true); return; }
    routeForm = { ...routeForm, expectedRevision: latest.revision };
    routeDraft = { baseline: latest.revision, values: { ...routeForm }, pendingAttempt: null, conflict: null }; writeRecovery('config-route', configDraftId, routeDraft);
  }
  function reviewCapabilityLatest() {
    const latest = capabilityForm.id ? configuration?.capabilities.find((row) => row.id === capabilityForm.id) : null;
    if (!latest) { setFeedback('Capability ini sudah tidak tersedia atau baru dibuat di sesi lain. Tinjau daftar akses sebelum melanjutkan.', true); return; }
    capabilityForm = { ...capabilityForm, expectedRevision: latest.revision };
    capabilityDraft = { baseline: latest.revision, values: { ...capabilityForm }, pendingAttempt: null, conflict: null }; writeRecovery('config-capability', configDraftId, capabilityDraft);
  }

  function mergePageRows<T extends { id: string }>(current: T[], incoming: T[]) {
    const ids = new Set(current.map((row) => row.id));
    return [...current, ...incoming.filter((row) => !ids.has(row.id))];
  }
  async function loadIssues(cursor: Cursor = null, append = false) {
    const page = await operational.loadOutletIssues({ view: issueView, outletId: issueOutletId || undefined, categoryId: issueCategoryId || undefined, pageSize: 25, cursor });
    issueRows = append ? mergePageRows(issueRows, page.items) : page.items; issueTotal = page.total; issueAsOf = page.asOf; issueHasMore = page.hasMore; issueNextCursor = page.nextCursor;
    if (page.categories?.length) issueCategories = page.categories.filter((category) => category.active !== false);
    const requested = new URL(window.location.href).searchParams.get('issue');
    const row = issueRows.find((item) => item.id === requested || item.id === selectedIssueId);
    if (row && !selectedIssueId) selectIssue(row);
    if (selectedIssueId && issueDraft) {
      const latest = issueRows.find((item) => item.id === selectedIssueId);
      if (latest && latest.revision !== issueDraft.baseline && !issueDraft.pendingAttempt) {
        issueDraft = { ...issueDraft, conflict: `Versi server sekarang ${latest.revision}. Draft lokal tetap tersimpan sampai Anda meninjaunya.` };
        rememberIssue();
      }
    }
  }
  async function loadIssueCategories() {
    // Read-only categories are available to reporters, while route and
    // capability configuration remains Admin-HR-only on the server.
    issueCategories = (await operational.loadSupervisorIssueCategories(false)).filter((category) => category.active !== false);
  }
  async function loadHandovers(cursor: Cursor = null, append = false) {
    const page = await operational.loadShiftHandovers({ pageSize: 25, cursor });
    handoverRows = append ? mergePageRows(handoverRows, page.items) : page.items; handoverTotal = page.total; handoverHasMore = page.hasMore; handoverNextCursor = page.nextCursor;
    const requested = new URL(window.location.href).searchParams.get('handover');
    const row = handoverRows.find((item) => item.id === requested || item.id === selectedHandoverId);
    if (row && !selectedHandoverId) selectHandover(row);
    if (selectedHandoverId && handoverDraft) {
      const latest = handoverRows.find((item) => item.id === selectedHandoverId);
      if (latest && latest.version !== handoverDraft.baseline && !handoverDraft.pendingAttempt) {
        handoverDraft = { ...handoverDraft, conflict: `Versi server sekarang ${latest.version}. Draft lokal tetap tersimpan sampai Anda meninjaunya.` };
        rememberHandover();
      }
    }
  }
  async function loadExchanges(cursor: Cursor = null, append = false) {
    const page = await operational.loadShiftExchanges({ view: 'active', pageSize: 25, cursor });
    exchangeRows = append ? mergePageRows(exchangeRows, page.items) : page.items; exchangeTotal = page.total; exchangeHasMore = page.hasMore; exchangeNextCursor = page.nextCursor;
    const requested = new URL(window.location.href).searchParams.get('exchange');
    const row = exchangeRows.find((item) => item.id === requested || item.id === selectedExchangeId);
    if (row && !selectedExchangeId) selectExchange(row);
  }
  async function loadConfiguration() {
    if (!admin) { configuration = null; return; }
    configuration = await operational.loadSupervisorOperationConfiguration();
    issueCategories = configuration.categories.filter((category) => category.active !== false);
    reconcileConfigurationDrafts();
  }
  async function reloadAll() {
    if (busy) return;
    loading = true; setFeedback('');
    try { await Promise.all([loadIssueCategories(), loadIssues(), loadHandovers(), loadExchanges(), ...(admin ? [loadConfiguration()] : [])]); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Data operasional belum dapat dimuat.', true); }
    finally { loading = false; }
  }
  async function refreshFromAuthoritativeData() {
    refreshingAuthoritativeData = true;
    try { await reloadAll(); }
    finally { refreshingAuthoritativeData = false; }
  }
  async function loadMoreIssues() {
    if (!issueHasMore || !issueNextCursor || loadingMore) return;
    loadingMore = 'issues';
    try { await loadIssues(issueNextCursor, true); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Kendala berikutnya belum dapat dimuat.', true); }
    finally { loadingMore = ''; }
  }
  async function loadMoreHandovers() {
    if (!handoverHasMore || !handoverNextCursor || loadingMore) return;
    loadingMore = 'handovers';
    try { await loadHandovers(handoverNextCursor, true); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Serah terima berikutnya belum dapat dimuat.', true); }
    finally { loadingMore = ''; }
  }
  async function loadMoreExchanges() {
    if (!exchangeHasMore || !exchangeNextCursor || loadingMore) return;
    loadingMore = 'exchanges';
    try { await loadExchanges(exchangeNextCursor, true); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Pengajuan berikutnya belum dapat dimuat.', true); }
    finally { loadingMore = ''; }
  }
  function chooseIssuePhoto(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) { issuePhoto = null; setFeedback('Foto harus berupa gambar maksimal 5 MB.', true); return; }
    issuePhoto = file;
  }
  async function requestIssuePhotoUrl() {
    if (!selectedIssue?.photoPath || issuePhotoLoading) return;
    const createUrl = operational.createOutletIssuePhotoUrl;
    if (typeof createUrl !== 'function') {
      setFeedback('Layanan untuk membuka foto privat belum tersedia. Perbarui aplikasi lalu coba lagi.', true);
      return;
    }
    issuePhotoLoading = true;
    try {
      issuePhotoUrl = await createUrl(selectedIssue.photoPath);
      setFeedback('Tautan foto privat siap dibuka. Tautan ini bersifat sementara.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Foto pendukung belum dapat dibuka.', true);
    } finally { issuePhotoLoading = false; }
  }
  async function submitIssue(replay = false) {
    if (busy) return;
    let attempt = issueSubmitAttempt;
    if (!replay || !attempt) {
      if (!newIssue.outletId || !newIssue.categoryId || newIssue.description.trim().length < 5) { setFeedback('Pilih outlet, kategori aktif, dan uraian minimal 5 karakter.', true); return; }
      const idempotencyKey = randomKey();
      let photoPath: string | null = null;
      if (issuePhoto) {
        busy = 'issue-upload'; setFeedback('Mengunggah foto pendukung secara privat…');
        try { photoPath = await operational.uploadOutletIssuePhoto(issuePhoto, idempotencyKey); }
        catch (error) { setFeedback(error instanceof Error ? error.message : 'Foto pendukung belum dapat diunggah.', true); return; }
        finally { busy = ''; }
      }
      const payload: IssueSubmitInput = { outletId: newIssue.outletId, categoryId: newIssue.categoryId, description: newIssue.description.trim(), urgency: newIssue.urgency, photoPath,
        reporterEmployeeId: newIssue.reporterEmployeeId || null, idempotencyKey };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      issueSubmitAttempt = attempt;
      writeRecovery('issue-submit', 'new', { baseline: 0, values: payload, pendingAttempt: attempt, conflict: null });
    }
    busy = 'issue-submit'; setFeedback('');
    try {
      if (!attempt) return;
      const result = await operational.submitOutletIssue(attempt.payload as IssueSubmitInput);
      clearRecovery('issue-submit', 'new'); issueSubmitAttempt = null; issuePhoto = null;
      newIssue = { outletId: issueDefaultOutlet(), categoryId: '', reporterEmployeeId: '', urgency: 'normal', description: '' };
      await loadIssues(); selectIssue(issueRows.find((row) => row.id === result.id) ?? result);
      setFeedback('Laporan kendala tersimpan. Jika koneksi sempat putus, retry dengan key yang sama tetap menghasilkan satu laporan.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Laporan belum memiliki hasil pasti. Gunakan coba lagi dengan payload yang sama.', true);
    } finally { busy = ''; }
  }
  async function saveIssue(replay = false) {
    if (!selectedIssue || !issueDraft || busy) return;
    let attempt = issueDraft.pendingAttempt;
    if (!replay || !attempt) {
      const payload: IssueUpdateInput = { ...issueDraft.values, id: selectedIssue.id, expectedRevision: issueDraft.baseline, idempotencyKey: randomKey(),
        resolutionNote: issueDraft.values.resolutionNote.trim(), reason: issueDraft.values.reason.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      issueDraft = { ...issueDraft, values: payload, pendingAttempt: attempt, conflict: null }; rememberIssue();
    }
    busy = `issue:${selectedIssue.id}`; setFeedback('');
    try {
      if (!attempt) return;
      const result = await operational.updateOutletIssue(attempt.payload as IssueUpdateInput);
      clearRecovery('issue-update', selectedIssue.id);
      issueDraft = { baseline: result.revision, values: issueEditFrom(result), pendingAttempt: null, conflict: null };
      writeRecovery('issue-update', result.id, issueDraft);
      await loadIssues();
      setFeedback('Kendala diperbarui dengan pemeriksaan revisi dan riwayat server.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Kendala belum memiliki hasil pasti.';
      if (/berubah sejak dibuka|40001/i.test(detail)) {
        await loadIssues().catch(() => undefined);
        const latest = issueRows.find((row) => row.id === selectedIssueId);
        if (latest && issueDraft) { issueDraft = { ...issueDraft, conflict: `Versi server sekarang ${latest.revision}. Draft dan percobaan asli tetap tersimpan untuk Anda tinjau.` }; rememberIssue(); }
      }
      setFeedback(detail, true);
    } finally { busy = ''; }
  }
  function senderChanged() {
    if (!handoverDraft) return;
    const assignment = assignmentById(handoverDraft.values.senderAssignmentId);
    if (assignment) handoverDraft = { ...handoverDraft, values: { ...handoverDraft.values, outletId: assignment.outletId, workDate: assignment.workDate } };
    recipientChanged(); rememberHandover();
  }
  function recipientChanged() {
    if (!handoverDraft) return;
    const candidate = allAssignments.find((row) => row.employeeId === handoverDraft!.values.recipientEmployeeId && row.outletId === handoverDraft!.values.outletId && row.workDate === handoverDraft!.values.workDate && row.shift !== 'off') ?? null;
    handoverDraft = { ...handoverDraft, values: { ...handoverDraft.values, recipientAssignmentId: candidate?.id ?? null } };
  }
  async function saveHandover(send: boolean, replay = false) {
    if (!handoverDraft || busy) return;
    const recoveryId = handoverDraft.values.id ?? 'new'; let attempt = handoverDraft.pendingAttempt;
    if (!replay || !attempt) {
      const payload: HandoverSaveInput = { ...handoverDraft.values, idempotencyKey: randomKey(), expectedVersion: handoverDraft.values.id ? handoverDraft.baseline : null,
        send, reason: handoverDraft.values.reason.trim(), pendingWork: handoverDraft.values.pendingWork.trim(), outletCondition: handoverDraft.values.outletCondition.trim(), notes: handoverDraft.values.notes.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      handoverDraft = { ...handoverDraft, values: payload, pendingAttempt: attempt, conflict: null }; rememberHandover();
    }
    busy = `handover:${recoveryId}`; setFeedback('');
    try {
      if (!attempt) return;
      const result = await operational.saveShiftHandover(attempt.payload as HandoverSaveInput);
      clearRecovery('handover-save', recoveryId);
      handoverDraft = { baseline: result.version, values: handoverEditFrom(result), pendingAttempt: null, conflict: null };
      writeRecovery('handover-save', result.id, handoverDraft);
      await loadHandovers(); selectHandover(handoverRows.find((row) => row.id === result.id) ?? result);
      setFeedback(send ? 'Serah terima dikirim. Penerima melihat versi yang sama dan dapat memberi respons.' : 'Draft serah terima tersimpan sebagai versi baru.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Serah terima belum memiliki hasil pasti.';
      if (/berubah sejak dibuka|40001/i.test(detail) && selectedHandover && handoverDraft) { await loadHandovers().catch(() => undefined); const latest = handoverRows.find((row) => row.id === selectedHandover.id); if (latest) { handoverDraft = { ...handoverDraft, conflict: `Versi server sekarang ${latest.version}. Periksa catatan sebelum menyimpan ulang.` }; rememberHandover(); } }
      setFeedback(detail, true);
    } finally { busy = ''; }
  }
  async function respondHandover(accept: boolean, replay = false) {
    if (!selectedHandover || busy) return;
    const key = `handover-response:${selectedHandover.id}`; let attempt = pendingFor('handover-response', selectedHandover.id);
    if (!replay || !attempt) {
      if (handoverResponseReason.trim().length < 3) { setFeedback('Tulis catatan respons minimal 3 karakter.', true); return; }
      const payload: HandoverResponseInput = { id: selectedHandover.id, expectedVersion: selectedHandover.version, idempotencyKey: randomKey(), accept, reason: handoverResponseReason.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      writeRecovery('handover-response', selectedHandover.id, { baseline: selectedHandover.version, values: payload, pendingAttempt: attempt, conflict: null });
    }
    if (!attempt) return;
    busy = key; setFeedback('');
    try { await operational.respondShiftHandover(attempt.payload as HandoverResponseInput); clearRecovery('handover-response', selectedHandover.id); handoverResponseReason = ''; await loadHandovers(); setFeedback(accept ? 'Serah terima diterima untuk versi ini.' : 'Permintaan perbaikan dikirim kepada pengirim.'); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Respons belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true); }
    finally { busy = ''; }
  }
  function exchangeRequesterChanged() {
    const assignment = requesterAssignment;
    if (!assignment) return;
    const peer = allAssignments.find((row) => row.employeeId === exchangeForm.peerEmployeeId && row.workDate === assignment.workDate && row.shift !== 'off');
    if (exchangeForm.requestType === 'swap' && !peer) exchangeForm = { ...exchangeForm, peerEmployeeId: '' };
  }
  async function submitExchange(replay = false) {
    if (busy) return;
    let attempt = exchangeSubmitAttempt;
    if (!replay || !attempt) {
      if (!exchangeForm.requesterAssignmentId || !exchangeForm.peerEmployeeId || exchangeForm.reason.trim().length < 5) { setFeedback('Pilih jadwal sendiri, rekan, dan alasan minimal 5 karakter.', true); return; }
      if (exchangeForm.requestType === 'swap' && !peerAssignment) { setFeedback('Tukar dua arah membutuhkan rekan yang memiliki penugasan aktif pada tanggal yang sama.', true); return; }
      if (exchangeForm.requestType === 'replacement' && peerAssignment) { setFeedback('Pengganti satu arah hanya dapat dipilih bila calon belum memiliki penugasan aktif pada tanggal itu.', true); return; }
      const payload: ExchangeSubmitInput = { ...exchangeForm, reason: exchangeForm.reason.trim(), idempotencyKey: randomKey() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      exchangeSubmitAttempt = attempt; writeRecovery('exchange-submit', 'new', { baseline: 0, values: payload, pendingAttempt: attempt, conflict: null });
    }
    busy = 'exchange-submit'; setFeedback('');
    try {
      if (!attempt) return;
      const result = await operational.submitShiftExchange(attempt.payload as ExchangeSubmitInput);
      clearRecovery('exchange-submit', 'new'); exchangeSubmitAttempt = null; exchangeForm = { requestType: 'swap', requesterAssignmentId: '', peerEmployeeId: '', reason: '' };
      await loadExchanges(); selectExchange(exchangeRows.find((row) => row.id === result.id) ?? result);
      setFeedback('Usulan dikirim ke rekan. Jadwal resmi belum berubah sampai Admin HR memutuskan.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Pengajuan belum memiliki hasil pasti. Coba lagi dengan payload yang sama.', true); }
    finally { busy = ''; }
  }
  async function respondExchange(accept: boolean, replay = false) {
    if (!selectedExchange || busy) return;
    let attempt = pendingFor('exchange-response', selectedExchange.id);
    if (!replay || !attempt) {
      if (exchangeResponseNote.trim().length < 3) { setFeedback('Catatan respons minimal 3 karakter.', true); return; }
      const payload: ExchangeResponseInput = { id: selectedExchange.id, expectedRevision: selectedExchange.revision, idempotencyKey: randomKey(), accept, note: exchangeResponseNote.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      writeRecovery('exchange-response', selectedExchange.id, { baseline: selectedExchange.revision, values: payload, pendingAttempt: attempt, conflict: null });
    }
    if (!attempt) return;
    busy = `exchange-response:${selectedExchange.id}`; setFeedback('');
    try { await operational.respondShiftExchange(attempt.payload as ExchangeResponseInput); clearRecovery('exchange-response', selectedExchange.id); exchangeResponseNote = ''; await loadExchanges(); setFeedback(accept ? 'Persetujuan rekan tercatat. Pengajuan menunggu keputusan Admin HR.' : 'Penolakan rekan tercatat; jadwal resmi tetap berlaku.'); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Respons belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true); }
    finally { busy = ''; }
  }
  async function decideExchange(approved: boolean, replay = false) {
    if (!selectedExchange || busy) return;
    let attempt = pendingFor('exchange-decision', selectedExchange.id);
    if (!replay || !attempt) {
      if (exchangeDecisionNote.trim().length < 5) { setFeedback('Catatan keputusan minimal 5 karakter.', true); return; }
      const payload: ExchangeDecisionInput = { id: selectedExchange.id, expectedRevision: selectedExchange.revision, idempotencyKey: randomKey(), approved, note: exchangeDecisionNote.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      writeRecovery('exchange-decision', selectedExchange.id, { baseline: selectedExchange.revision, values: payload, pendingAttempt: attempt, conflict: null });
    }
    if (!attempt) return;
    busy = `exchange-decision:${selectedExchange.id}`; setFeedback('');
    try { await operational.decideShiftExchange(attempt.payload as ExchangeDecisionInput); clearRecovery('exchange-decision', selectedExchange.id); exchangeDecisionNote = ''; await Promise.all([loadExchanges(), actions.refresh()]); setFeedback(approved ? 'Keputusan disimpan. Perubahan seluruh jadwal dilakukan atomik oleh server.' : 'Penolakan disimpan; jadwal resmi tidak diubah.'); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Keputusan belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true); }
    finally { busy = ''; }
  }
  async function cancelExchange(replay = false) {
    if (!selectedExchange || busy) return;
    let attempt = pendingFor('exchange-cancel', selectedExchange.id);
    if (!replay || !attempt) {
      if (exchangeCancelNote.trim().length < 3) { setFeedback('Alasan pembatalan minimal 3 karakter.', true); return; }
      const payload: ExchangeCancelInput = { id: selectedExchange.id, expectedRevision: selectedExchange.revision, idempotencyKey: randomKey(), note: exchangeCancelNote.trim() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      writeRecovery('exchange-cancel', selectedExchange.id, { baseline: selectedExchange.revision, values: payload, pendingAttempt: attempt, conflict: null });
    }
    if (!attempt) return;
    busy = `exchange-cancel:${selectedExchange.id}`; setFeedback('');
    try {
      await operational.cancelShiftExchange(attempt.payload as ExchangeCancelInput);
      clearRecovery('exchange-cancel', selectedExchange.id); exchangeCancelNote = ''; await loadExchanges();
      setFeedback('Pengajuan dibatalkan. Jadwal resmi tidak berubah.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Pembatalan belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true); }
    finally { busy = ''; }
  }
  async function expireStaleExchanges(replay = false) {
    if (!admin || busy) return;
    let attempt = pendingFor('exchange-expire', 'all');
    if (!replay || !attempt) {
      const payload = { idempotencyKey: randomKey() };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      writeRecovery('exchange-expire', 'all', { baseline: 0, values: payload, pendingAttempt: attempt, conflict: null });
    }
    if (!attempt) return;
    busy = 'exchange-expire'; setFeedback('');
    try {
      const result = await operational.expireStaleShiftExchanges((attempt.payload as { idempotencyKey: string }).idempotencyKey);
      clearRecovery('exchange-expire', 'all'); await loadExchanges();
      setFeedback(result.expiredCount ? `${result.expiredCount} pengajuan kedaluwarsa ditutup dengan riwayat tetap tersimpan.` : 'Tidak ada pengajuan aktif yang telah kedaluwarsa.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Penutupan pengajuan kedaluwarsa belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true); }
    finally { busy = ''; }
  }
  async function saveCategory(replay = false) {
    if (busy) return;
    let attempt = categoryConfigDraft()?.pendingAttempt ?? null;
    if (!replay && attempt) { setFeedback('Kategori sebelumnya belum memiliki hasil pasti. Coba lagi payload yang sama sebelum membuat perubahan baru.', true); return; }
    if (!replay) {
      const code = categoryForm.code.trim().toLowerCase(), name = categoryForm.name.trim();
      if (!/^[a-z][a-z0-9_]{1,47}$/.test(code) || name.length < 3 || name.length > 120) { setFeedback('Kode kategori dan nama 3–120 karakter tidak valid.', true); return; }
      const payload: CategorySaveInput = { id: categoryForm.id || null, expectedRevision: categoryForm.id ? categoryForm.expectedRevision : null,
        idempotencyKey: randomKey(), code, name, active: categoryForm.active };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      categoryDraft = { baseline: categoryForm.expectedRevision ?? 0, values: { ...categoryForm }, pendingAttempt: attempt, conflict: null };
      writeRecovery('config-category', configDraftId, categoryDraft);
    }
    if (!attempt) { setFeedback('Tidak ada permintaan kategori yang dapat dicoba ulang.', true); return; }
    busy = 'config-category'; setFeedback('');
    try {
      await operational.saveSupervisorIssueCategory(attempt.payload as CategorySaveInput);
      clearCategoryDraft(); await loadConfiguration(); categoryForm = emptyCategoryForm();
      setFeedback('Kategori kendala disimpan. Riwayat laporan tetap menggunakan snapshot kategori saat dibuat.');
    } catch (error) {
      if (isConflictError(error)) {
        categoryDraft = { baseline: categoryForm.expectedRevision ?? 0, values: { ...categoryForm }, pendingAttempt: null,
          conflict: 'Kategori berubah di sesi lain. Draft lokal dipertahankan; tinjau versi server sebelum menyimpan lagi.' };
        writeRecovery('config-category', configDraftId, categoryDraft);
        try { await loadConfiguration(); } catch { /* Retain the original conflict if refresh is unavailable. */ }
      }
      setFeedback(error instanceof Error ? error.message : 'Kategori belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true);
    } finally { busy = ''; }
  }
  async function saveRoute(replay = false) {
    if (busy) return;
    let attempt = routeConfigDraft()?.pendingAttempt ?? null;
    if (!replay && attempt) { setFeedback('Routing sebelumnya belum memiliki hasil pasti. Coba lagi payload yang sama sebelum membuat perubahan baru.', true); return; }
    if (!replay) {
      if (!routeForm.categoryId) { setFeedback('Pilih kategori untuk routing kendala.', true); return; }
      const payload: RouteSaveInput = { id: routeForm.id || null, expectedRevision: routeForm.id ? routeForm.expectedRevision : null,
        idempotencyKey: randomKey(), categoryId: routeForm.categoryId, outletId: routeForm.outletId || null,
        recipientEmployeeId: routeForm.recipientEmployeeId || null, active: routeForm.active };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      routeDraft = { baseline: routeForm.expectedRevision ?? 0, values: { ...routeForm }, pendingAttempt: attempt, conflict: null };
      writeRecovery('config-route', configDraftId, routeDraft);
    }
    if (!attempt) { setFeedback('Tidak ada permintaan routing yang dapat dicoba ulang.', true); return; }
    busy = 'config-route'; setFeedback('');
    try {
      await operational.saveSupervisorIssueRoute(attempt.payload as RouteSaveInput);
      clearRouteDraft(); await loadConfiguration(); routeForm = emptyRouteForm();
      setFeedback('Routing kendala disimpan. Perubahan ini hanya berlaku untuk laporan baru.');
    } catch (error) {
      if (isConflictError(error)) {
        routeDraft = { baseline: routeForm.expectedRevision ?? 0, values: { ...routeForm }, pendingAttempt: null,
          conflict: 'Routing berubah di sesi lain. Draft lokal dipertahankan; tinjau versi server sebelum menyimpan lagi.' };
        writeRecovery('config-route', configDraftId, routeDraft);
        try { await loadConfiguration(); } catch { /* Retain the original conflict if refresh is unavailable. */ }
      }
      setFeedback(error instanceof Error ? error.message : 'Routing belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true);
    } finally { busy = ''; }
  }
  async function saveCapability(replay = false) {
    if (busy) return;
    let attempt = capabilityConfigDraft()?.pendingAttempt ?? null;
    if (!replay && attempt) { setFeedback('Perubahan akses sebelumnya belum memiliki hasil pasti. Coba lagi payload yang sama sebelum membuat perubahan baru.', true); return; }
    if (!replay) {
      if (!capabilityForm.employeeId || !capabilityForm.capability) { setFeedback('Pilih karyawan dan capability operasional.', true); return; }
      if (!capabilityForm.granted && (!capabilityForm.id || !capabilityForm.expectedRevision)) { setFeedback('Pencabutan akses harus dimulai dari baris capability versi terbaru.', true); return; }
      const payload: CapabilitySaveInput = { id: capabilityForm.id || null, expectedRevision: capabilityForm.id ? capabilityForm.expectedRevision : null,
        idempotencyKey: randomKey(), employeeId: capabilityForm.employeeId, capability: capabilityForm.capability,
        outletId: capabilityForm.outletId || null, categoryId: capabilityForm.categoryId || null, granted: capabilityForm.granted };
      attempt = { idempotencyKey: payload.idempotencyKey, payload, createdAt: new Date().toISOString() };
      capabilityDraft = { baseline: capabilityForm.expectedRevision ?? 0, values: { ...capabilityForm }, pendingAttempt: attempt, conflict: null };
      writeRecovery('config-capability', configDraftId, capabilityDraft);
    }
    if (!attempt) { setFeedback('Tidak ada permintaan akses yang dapat dicoba ulang.', true); return; }
    busy = 'config-capability'; setFeedback('');
    try {
      await operational.saveSupervisorCapability(attempt.payload as CapabilitySaveInput);
      clearCapabilityDraft(); await loadConfiguration(); capabilityForm = emptyCapabilityForm();
      setFeedback('Hak operasional disimpan. Perubahan akses berikutnya tetap diperiksa pada setiap request server.');
    } catch (error) {
      if (isConflictError(error)) {
        capabilityDraft = { baseline: capabilityForm.expectedRevision ?? 0, values: { ...capabilityForm }, pendingAttempt: null,
          conflict: 'Capability berubah di sesi lain. Draft lokal dipertahankan; tinjau daftar akses sebelum menyimpan lagi.' };
        writeRecovery('config-capability', configDraftId, capabilityDraft);
        try { await loadConfiguration(); } catch { /* Retain the original conflict if refresh is unavailable. */ }
      }
      setFeedback(error instanceof Error ? error.message : 'Hak operasional belum memiliki hasil pasti. Coba lagi dengan key yang sama.', true);
    } finally { busy = ''; }
  }
  function grantFromExisting(grant: CapabilityGrant, granted: boolean) {
    if (capabilityConfigDraft()?.pendingAttempt) { setFeedback('Selesaikan retry akses sebelumnya terlebih dahulu agar payload dan key asli tetap aman.', true); return; }
    capabilityForm = { id: grant.id, expectedRevision: grant.revision, employeeId: grant.employeeId, capability: grant.capability,
      outletId: grant.outletId ?? '', categoryId: grant.categoryId ?? '', granted };
    capabilityDraft = null; rememberCapabilityDraft(); void saveCapability();
  }
  function changeTab(next: Tab) { tab = next; setFeedback(''); if (next === 'config') void loadConfiguration().catch((error) => setFeedback(error instanceof Error ? error.message : 'Konfigurasi belum dapat dimuat.', true)); }
  function changeIssueView(next: IssueView) { issueView = next; selectedIssueId = ''; issueDraft = null; void loadIssues().catch((error) => setFeedback(error instanceof Error ? error.message : 'Filter kendala belum diterapkan.', true)); }

  onMount(() => {
    newIssue.outletId = issueDefaultOutlet();
    const query = new URL(window.location.href).searchParams;
    if (query.has('handover')) tab = 'handovers';
    else if (query.has('exchange')) tab = 'exchanges';
    else if (query.has('issue')) tab = 'issues';
    observedDataRevision = $app.dataRevision ?? 0;
    mounted = true;
    const initialSubmit = readRecovery<IssueSubmitInput>('issue-submit', 'new'); issueSubmitAttempt = initialSubmit?.pendingAttempt ?? null;
    const initialExchange = readRecovery<ExchangeSubmitInput>('exchange-submit', 'new'); exchangeSubmitAttempt = initialExchange?.pendingAttempt ?? null;
    void (async () => {
      await reloadAll();
      if (admin) restoreConfigurationDrafts();
      if (discardedLegacyIssuePhotoAttempt && !message) {
        setFeedback('Percobaan laporan lama dengan foto tidak dapat dipulihkan setelah halaman dimuat ulang. Pilih foto kembali sebelum mengirim laporan baru.', true);
      }
    })();
  });
</script>

<PageHeading eyebrow="SUPERVISOR" title="Operasi outlet" description="Kendala, serah terima, dan perubahan jadwal dicatat sebagai alur terpisah. Hak akses dan keputusan akhir selalu diperiksa server.">
  <button class="btn btn-secondary" type="button" disabled={loading || !!busy} on:click={reloadAll}><Icon name="refresh" size={16}/>Perbarui</button>
</PageHeading>

<nav class="module-tabs" aria-label="Modul operasi">
  {#each tabs as item}
    <button type="button" class:active={tab === item.id} on:click={() => changeTab(item.id)}>
      <strong>{item.label}</strong><small>{item.detail}</small>
    </button>
  {/each}
</nav>

<Feedback {message} error={failed}/>

{#if loading}
  <section class="panel loading"><Icon name="refresh" size={22}/><span>Memuat data operasional sesuai akses akun…</span></section>
{:else if tab === 'issues'}
  <section class="two-column issues-layout">
    <div class="panel report-form">
      <div class="section-heading"><div><span class="eyebrow">LAPORKAN</span><h2>Kendala outlet</h2></div><Icon name="alert" size={21}/></div>
      <p class="hint">Outlet harus terkait penugasan atau absensi yang sah. Jika jadwal belum tercatat, hubungi petugas berwenang untuk membuat laporan atas nama kasir tanpa membuat jadwal fiktif.</p>
      {#if issueSubmitAttempt}
        <div class="pending" role="status"><strong>Laporan sebelumnya belum mempunyai hasil pasti</strong><p>Key dan isi asli tersimpan hanya pada akun ini. Kirim ulang tidak akan membuat laporan kedua bila server sudah menerimanya.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => submitIssue(true)}>Coba lagi laporan yang sama</button></div>
      {/if}
      <form on:submit|preventDefault={() => submitIssue(false)}>
        <fieldset class="form-fields" disabled={!!busy || !!issueSubmitAttempt}>
          <label class="field">Outlet<select class="select" bind:value={newIssue.outletId} required><option value="">Pilih outlet</option>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label>
          <label class="field">Kategori aktif<select class="select" bind:value={newIssue.categoryId} required disabled={issueCategories.length === 0}><option value="">{issueCategories.length ? 'Pilih kategori' : 'Kategori belum tersedia'}</option>{#each issueCategories as category}<option value={category.id}>{category.name}</option>{/each}</select></label>
          {#if issueCategories.length === 0}<p class="form-note"><Icon name="info" size={15}/>Admin HR perlu mengaktifkan kategori dan routing kendala terlebih dahulu. Kategori tidak dihardcode di aplikasi.</p>{/if}
          <label class="field">Pelapor<select class="select" bind:value={newIssue.reporterEmployeeId}><option value="">Saya sendiri</option>{#each activeEmployees.filter((employee) => employee.id !== $app.user?.id) as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label>
          <label class="field">Urgensi<select class="select" bind:value={newIssue.urgency}><option value="low">Rendah</option><option value="normal">Normal</option><option value="high">Tinggi</option><option value="urgent">Mendesak</option></select></label>
          <label class="field">Uraian kendala<textarea class="textarea" rows="4" bind:value={newIssue.description} minlength="5" maxlength="2000" placeholder="Contoh: mesin kasir outlet tidak menyala sejak pukul 14.00." required></textarea></label>
          <label class="field">Foto pendukung <span class="optional">opsional, privat</span><input class="file-input" type="file" accept="image/jpeg,image/png,image/webp" on:change={chooseIssuePhoto}/>{#if issuePhoto}<small>{issuePhoto.name} · {Math.ceil(issuePhoto.size / 1024)} KB</small>{/if}</label>
        </fieldset>
        <button class="btn btn-primary full" type="submit" disabled={!!busy || !!issueSubmitAttempt || !issueCategories.length}>{busy === 'issue-submit' ? 'Mengirim…' : 'Kirim laporan kendala'}</button>
      </form>
    </div>

    <div class="panel queue-panel">
      <div class="section-heading"><div><span class="eyebrow">ANTRIAN</span><h2>Kendala yang dapat Anda akses</h2></div><span class="count">{issueTotal}</span></div>
      <div class="filters compact">
        <label>Daftar<select class="select" bind:value={issueView} disabled={!!busy || loadingMore === 'issues'} on:change={() => changeIssueView(issueView)}>{#each issueViews as view}<option value={view.id}>{view.label}</option>{/each}</select></label>
        <label>Outlet<select class="select" bind:value={issueOutletId} disabled={!!busy || loadingMore === 'issues'} on:change={() => loadIssues()}><option value="">Semua outlet</option>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label>
        <label>Kategori<select class="select" bind:value={issueCategoryId} disabled={!!busy || loadingMore === 'issues'} on:change={() => loadIssues()}><option value="">Semua kategori</option>{#each issueCategories as category}<option value={category.id}>{category.name}</option>{/each}</select></label>
      </div>
      <p class="as-of">{issueAsOf ? `Dihitung ${dateTimeLabel(issueAsOf)}` : 'Daftar mengikuti pembatasan akses server.'}</p>
      <div class="case-list">
        {#if issueRows.length}
          {#each issueRows as row (row.id)}
            <button type="button" class="case-row" class:selected={selectedIssueId === row.id} disabled={!!busy} on:click={() => selectIssue(row)}>
              <span class="case-top"><strong>#{row.issueNumber ?? '—'} · {row.categoryName}</strong><i class:urgent={row.urgency === 'urgent'}>{issueStatusLabel[row.status]}</i></span>
              <span>{outletName(row.outletId)} · {urgencyLabel[row.urgency]}</span>
              <small>{row.description}</small><small>PIC {employeeName(row.ownerId)} · revisi {row.revision}</small>
            </button>
          {/each}
        {:else}<p class="empty">Belum ada kendala pada tampilan ini.</p>{/if}
      </div>
      {#if issueHasMore}<button class="btn btn-secondary load-more" type="button" disabled={!!busy || loadingMore === 'issues'} on:click={loadMoreIssues}>{loadingMore === 'issues' ? 'Memuat…' : `Muat lagi (${issueRows.length} dari ${issueTotal})`}</button>{/if}
    </div>
  </section>

  {#if selectedIssue && issueDraft}
    <section class="panel detail-panel" aria-label="Rincian kendala">
      <div class="detail-header"><div><span class="eyebrow">KENDALA #{selectedIssue.issueNumber ?? selectedIssue.id.slice(0, 8)}</span><h2>{selectedIssue.categoryName} · {outletName(selectedIssue.outletId)}</h2><p>Pelapor {employeeName(selectedIssue.reporterEmployeeId)} · revisi server {selectedIssue.revision} · dibuat {dateTimeLabel(selectedIssue.createdAt)}</p></div><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => { selectedIssueId = ''; issuePhotoUrl = ''; setQuery('issue', null); }}>Tutup detail</button></div>
      <div class="description-card"><strong>Uraian pelapor</strong><p>{selectedIssue.description}</p>{#if selectedIssue.photoPath}<small>Foto pendukung tersedia secara privat bagi akun yang berhak.</small><div class="photo-action">{#if issuePhotoUrl}<a class="btn btn-secondary" href={issuePhotoUrl} target="_blank" rel="noreferrer">Buka foto pendukung</a><button class="btn btn-secondary" type="button" disabled={issuePhotoLoading || !!busy} on:click={requestIssuePhotoUrl}>Buat tautan baru</button>{:else}<button class="btn btn-secondary" type="button" disabled={issuePhotoLoading || !!busy} on:click={requestIssuePhotoUrl}>{issuePhotoLoading ? 'Menyiapkan foto…' : 'Lihat foto pendukung'}</button>{/if}</div>{/if}</div>
      {#if issueDraft.conflict}<div class="conflict" role="alert"><strong>Versi perlu ditinjau</strong><p>{issueDraft.conflict}</p><div><button type="button" class="btn btn-secondary" on:click={discardIssueDraft}>Gunakan data server</button><button type="button" class="btn btn-primary" on:click={reviewIssueLatest}>Pertahankan draft, pakai revisi terbaru</button></div></div>{/if}
      {#if issueDraft.pendingAttempt}<div class="pending"><strong>Pembaruan sebelumnya belum mempunyai hasil pasti</strong><p>Payload dan key asli tetap tersimpan. Server akan mengembalikan receipt yang sama apabila commit sudah terjadi.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => saveIssue(true)}>Coba lagi pembaruan yang sama</button></div>{/if}
      <fieldset class="form-fields" disabled={!!busy || !!issueDraft.pendingAttempt || !!issueDraft.conflict}>
        <div class="form-grid">
          <label class="field">Status<select class="select" bind:value={issueDraft.values.status} on:change={rememberIssue}><option value="new">Baru</option><option value="assigned">Ditugaskan</option><option value="in_progress">Diproses</option><option value="completed">Selesai</option></select></label>
          <label class="field">PIC penanganan<select class="select" value={issueDraft.values.ownerId ?? ''} on:change={(event) => { issueDraft!.values.ownerId = event.currentTarget.value || null; rememberIssue(); }}><option value="">Belum ada PIC</option>{#each activeEmployees as employee}<option value={employee.id}>{employee.fullName}</option>{/each}</select></label>
          <label class="field">Tenggat (WIB)<input class="input" type="datetime-local" value={isoToLocal(issueDraft.values.dueAt)} on:change={(event) => { issueDraft!.values.dueAt = localToIso(event.currentTarget.value); rememberIssue(); }}/></label>
          <label class="field">Alasan perubahan PIC / tenggat<input class="input" bind:value={issueDraft.values.reason} on:input={rememberIssue} placeholder="Wajib bila PIC atau tenggat berubah" maxlength="2000"/></label>
          {#if issueDraft.values.status === 'completed'}<label class="field wide">Catatan penyelesaian<textarea class="textarea" rows="3" bind:value={issueDraft.values.resolutionNote} on:input={rememberIssue} minlength="5" maxlength="2000" placeholder="Tindakan yang sudah dilakukan dan hasilnya"></textarea></label>{/if}
        </div>
      </fieldset>
      <div class="form-actions"><button class="btn btn-secondary" type="button" disabled={!!busy || !!issueDraft.pendingAttempt} on:click={discardIssueDraft}>Batalkan draft</button><button class="btn btn-primary" type="button" disabled={!!busy || !!issueDraft.pendingAttempt || !!issueDraft.conflict} on:click={() => saveIssue(false)}>{busy.startsWith('issue:') ? 'Menyimpan…' : 'Simpan dengan pemeriksaan revisi'}</button></div>
    </section>
  {/if}

{:else if tab === 'handovers'}
  <section class="two-column handover-layout">
    <div class="panel queue-panel">
      <div class="section-heading"><div><span class="eyebrow">SERAH TERIMA</span><h2>Catatan shift</h2></div><button class="btn btn-primary" type="button" disabled={!!busy} on:click={startHandover}><Icon name="plus" size={16}/>Buat catatan</button></div>
      <p class="hint">Penerima mengonfirmasi versi catatan, bukan kehadiran fisik atau jam clock out pengirim.</p>
      <div class="case-list">
        {#if handoverRows.length}
          {#each handoverRows as row (row.id)}
            <button type="button" class="case-row" class:selected={selectedHandoverId === row.id} disabled={!!busy} on:click={() => selectHandover(row)}>
              <span class="case-top"><strong>{outletName(row.outletId)} · {dateLabel(row.workDate)}</strong><i>{handoverStatusLabel[row.status]}</i></span>
              <span>{employeeName(row.senderEmployeeId)} → {employeeName(row.recipientEmployeeId)}</span><small>Versi {row.version} · diperbarui {dateTimeLabel(row.updatedAt)}</small>
            </button>
          {/each}
        {:else}<p class="empty">Belum ada serah terima yang dapat Anda akses.</p>{/if}
      </div>
      <p class="as-of">{handoverTotal} catatan yang sesuai dengan akses akun Anda.</p>
      {#if handoverHasMore}<button class="btn btn-secondary load-more" type="button" disabled={!!busy || loadingMore === 'handovers'} on:click={loadMoreHandovers}>{loadingMore === 'handovers' ? 'Memuat…' : `Muat lagi (${handoverRows.length} dari ${handoverTotal})`}</button>{/if}
    </div>

    <div class="panel handover-editor">
      {#if handoverDraft}
        <div class="section-heading"><div><span class="eyebrow">{handoverDraft.values.id ? `VERSI ${handoverDraft.baseline}` : 'DRAFT BARU'}</span><h2>{handoverDraft.values.id ? 'Perbarui serah terima' : 'Tulis serah terima'}</h2></div>{#if selectedHandover}<span class="status-chip">{handoverStatusLabel[selectedHandover.status]}</span>{/if}</div>
        <p class="hint">Pengirim dan penerima harus sesuai dengan penugasan aktif pada outlet serta tanggal kerja yang sama. Server menolak perubahan yang tidak sah.</p>
        {#if handoverDraft.conflict}<div class="conflict" role="alert"><strong>Versi perlu ditinjau</strong><p>{handoverDraft.conflict}</p><div><button class="btn btn-secondary" type="button" on:click={discardHandoverDraft}>Gunakan data server</button><button class="btn btn-primary" type="button" on:click={reviewHandoverLatest}>Pertahankan draft, pakai versi terbaru</button></div></div>{/if}
        {#if handoverDraft.pendingAttempt}<div class="pending"><strong>Penyimpanan sebelumnya belum mempunyai hasil pasti</strong><p>Retry mengirim key dan payload asli, sehingga versi tidak digandakan setelah koneksi putus.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => saveHandover(handoverDraft!.values.send, true)}>Coba lagi penyimpanan yang sama</button></div>{/if}
        <fieldset class="form-fields" disabled={!!busy || !!handoverDraft.pendingAttempt || !!handoverDraft.conflict}>
          <div class="form-grid">
            <label class="field">Penugasan saya sebagai pengirim<select class="select" value={handoverDraft.values.senderAssignmentId ?? ''} on:change={(event) => { handoverDraft!.values.senderAssignmentId = event.currentTarget.value || null; senderChanged(); }}><option value="">Pilih penugasan saya</option>{#each handoverSenderAssignments as assignment}<option value={assignment.id}>{assignmentText(assignment)}</option>{/each}</select></label>
            <label class="field">Penerima<select class="select" value={handoverDraft.values.recipientEmployeeId ?? ''} on:change={(event) => { handoverDraft!.values.recipientEmployeeId = event.currentTarget.value || null; recipientChanged(); rememberHandover(); }}><option value="">Belum ditetapkan</option>{#each handoverRecipientCandidates as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select><small>Penerima dibatasi pada kasir dengan penugasan aktif pada outlet dan tanggal yang sama.</small></label>
            <label class="field">Penugasan penerima<select class="select" value={handoverDraft.values.recipientAssignmentId ?? ''} on:change={(event) => { handoverDraft!.values.recipientAssignmentId = event.currentTarget.value || null; rememberHandover(); }} disabled={!handoverDraft.values.recipientEmployeeId}><option value="">Pilih penugasan penerima</option>{#each handoverRecipientAssignments as assignment}<option value={assignment.id}>{assignmentText(assignment)}</option>{/each}</select></label>
            <label class="field">Alasan perubahan penerima<input class="input" bind:value={handoverDraft.values.reason} on:input={rememberHandover} maxlength="2000" placeholder="Wajib bila mengganti penerima"/></label>
            <label class="field wide">Pekerjaan tertunda<textarea class="textarea" rows="3" bind:value={handoverDraft.values.pendingWork} on:input={rememberHandover} maxlength="2000" placeholder="Contoh: pesanan outlet A belum selesai dihitung."></textarea></label>
            <label class="field wide">Kondisi outlet / perlengkapan<textarea class="textarea" rows="3" bind:value={handoverDraft.values.outletCondition} on:input={rememberHandover} maxlength="2000" placeholder="Contoh: printer struk kehabisan kertas cadangan."></textarea></label>
            <label class="field wide">Catatan penting<textarea class="textarea" rows="3" bind:value={handoverDraft.values.notes} on:input={rememberHandover} maxlength="2000" placeholder="Informasi penting yang perlu diketahui penerima."></textarea></label>
          </div>
        </fieldset>
        <div class="form-actions"><button class="btn btn-secondary" type="button" disabled={!!busy || !!handoverDraft.pendingAttempt} on:click={discardHandoverDraft}>Batalkan draft</button><button class="btn btn-secondary" type="button" disabled={!!busy || !!handoverDraft.pendingAttempt || !!handoverDraft.conflict} on:click={() => saveHandover(false)}>{busy.startsWith('handover:') ? 'Menyimpan…' : 'Simpan draft'}</button><button class="btn btn-primary" type="button" disabled={!!busy || !!handoverDraft.pendingAttempt || !!handoverDraft.conflict || !handoverDraft.values.recipientEmployeeId} on:click={() => saveHandover(true)}>Kirim ke penerima</button></div>
      {:else}
        <div class="empty editor-empty"><Icon name="file" size={27}/><strong>Pilih atau buat serah terima</strong><span>Versi catatan, penerima, dan respons akan muncul di sini.</span><button class="btn btn-primary" type="button" disabled={!!busy} on:click={startHandover}>Buat serah terima</button></div>
      {/if}
    </div>
  </section>
  {#if selectedHandover && selectedHandover.recipientEmployeeId === $app.user?.id && selectedHandover.status === 'sent'}
    <section class="panel response-panel"><div><span class="eyebrow">RESPONS PENERIMA</span><h2>Konfirmasi versi {selectedHandover.version}</h2><p>Catatan yang diterima tersimpan pada versi ini. Minta perbaikan bila isi belum tepat.</p></div><fieldset class="form-fields" disabled={!!busy || !!pendingFor('handover-response', selectedHandover.id)}><label class="field">Catatan respons<textarea class="textarea" rows="2" bind:value={handoverResponseReason} minlength="3" placeholder="Contoh: sudah diterima, stok awal akan dicek."></textarea></label></fieldset>{#if pendingFor('handover-response', selectedHandover.id)}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => respondHandover(true, true)}>Coba lagi respons yang sama</button>{:else}<div class="form-actions"><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => respondHandover(false)}>Minta perbaikan</button><button class="btn btn-primary" type="button" disabled={!!busy} on:click={() => respondHandover(true)}>Terima catatan</button></div>{/if}</section>
  {/if}

{:else if tab === 'config'}
  {#if admin}
    <section class="config-grid">
      <section class="panel config-card">
        <div class="section-heading"><div><span class="eyebrow">KATEGORI</span><h2>{categoryForm.id ? 'Ubah kategori kendala' : 'Tambah kategori kendala'}</h2></div>{#if categoryForm.id}<button class="btn btn-secondary" type="button" on:click={resetCategory}>Buat baru</button>{/if}</div>
        <p class="hint">Kategori aktif tersedia untuk pelapor. Riwayat laporan menyimpan nama kategori ketika laporan dibuat.</p>
        {#if categoryDraft?.conflict}<div class="conflict" role="alert"><strong>Versi kategori perlu ditinjau</strong><p>{categoryDraft.conflict}</p><div><button class="btn btn-secondary" type="button" on:click={resetCategory}>Buang draft lokal</button><button class="btn btn-primary" type="button" on:click={reviewCategoryLatest}>Pertahankan draft, pakai revisi terbaru</button></div></div>{/if}
        {#if categoryDraft?.pendingAttempt}<div class="pending"><strong>Penyimpanan kategori belum mempunyai hasil pasti</strong><p>Retry mengirim payload dan key asli. Form dikunci agar perubahan baru tidak mengganti permintaan yang sedang dipulihkan.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void saveCategory(true)}>Coba lagi kategori yang sama</button></div>{/if}
        <form on:submit|preventDefault={() => void saveCategory()}><fieldset class="form-fields" disabled={!!busy || !!categoryDraft?.pendingAttempt || !!categoryDraft?.conflict}><label class="field">Kode kategori<input class="input" bind:value={categoryForm.code} on:input={rememberCategoryDraft} pattern="[a-z][a-z0-9_]*" maxlength="48" required placeholder="contoh: perangkat_kasir"/></label><label class="field">Nama kategori<input class="input" bind:value={categoryForm.name} on:input={rememberCategoryDraft} minlength="3" maxlength="120" required placeholder="Contoh: Perangkat kasir"/></label><label class="check-field"><input type="checkbox" bind:checked={categoryForm.active} on:change={rememberCategoryDraft}/> Aktif untuk laporan baru</label><div class="form-actions"><button class="btn btn-primary" type="submit" disabled={!!busy || !!categoryDraft?.pendingAttempt || !!categoryDraft?.conflict}>{busy === 'config-category' ? 'Menyimpan…' : 'Simpan kategori'}</button></div></fieldset></form>
        <div class="config-list">{#each configuration?.categories ?? [] as category (category.id)}<button class="config-row" type="button" disabled={!!busy || !!categoryDraft?.pendingAttempt} on:click={() => editCategory(category)}><span><strong>{category.name}</strong><small>{category.code} · revisi {category.revision}</small></span><span>{category.active === false ? 'Nonaktif' : 'Aktif'}</span></button>{:else}<p class="empty">Belum ada kategori. Buat kategori sebelum laporan dapat dikirim.</p>{/each}</div>
      </section>

      <section class="panel config-card">
        <div class="section-heading"><div><span class="eyebrow">ROUTING</span><h2>{routeForm.id ? 'Ubah penerima kendala' : 'Atur penerima kendala'}</h2></div>{#if routeForm.id}<button class="btn btn-secondary" type="button" on:click={resetRoute}>Buat baru</button>{/if}</div>
        <p class="hint">Routing berlaku untuk laporan baru. Server menolak penerima yang tidak aktif atau tidak memiliki hak menangani kendala pada cakupan yang dipilih.</p>
        {#if routeDraft?.conflict}<div class="conflict" role="alert"><strong>Versi routing perlu ditinjau</strong><p>{routeDraft.conflict}</p><div><button class="btn btn-secondary" type="button" on:click={resetRoute}>Buang draft lokal</button><button class="btn btn-primary" type="button" on:click={reviewRouteLatest}>Pertahankan draft, pakai revisi terbaru</button></div></div>{/if}
        {#if routeDraft?.pendingAttempt}<div class="pending"><strong>Penyimpanan routing belum mempunyai hasil pasti</strong><p>Retry mengirim payload dan key asli. Form dikunci agar perubahan baru tidak mengganti permintaan yang sedang dipulihkan.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void saveRoute(true)}>Coba lagi routing yang sama</button></div>{/if}
        <form on:submit|preventDefault={() => void saveRoute()}><fieldset class="form-fields" disabled={!!busy || !!routeDraft?.pendingAttempt || !!routeDraft?.conflict}><label class="field">Kategori<select class="select" bind:value={routeForm.categoryId} on:change={rememberRouteDraft} required><option value="">Pilih kategori</option>{#each configuration?.categories ?? [] as category}<option value={category.id}>{category.name}</option>{/each}</select></label><label class="field">Outlet <span class="optional">kosong = semua outlet</span><select class="select" bind:value={routeForm.outletId} on:change={rememberRouteDraft}><option value="">Semua outlet</option>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label><label class="field">Penerima <span class="optional">kosong = tanpa PIC</span><select class="select" bind:value={routeForm.recipientEmployeeId} on:change={rememberRouteDraft}><option value="">Tanpa PIC otomatis</option>{#each activeEmployees as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label><label class="check-field"><input type="checkbox" bind:checked={routeForm.active} on:change={rememberRouteDraft}/> Routing aktif</label><div class="form-actions"><button class="btn btn-primary" type="submit" disabled={!!busy || !!routeDraft?.pendingAttempt || !!routeDraft?.conflict}>{busy === 'config-route' ? 'Menyimpan…' : 'Simpan routing'}</button></div></fieldset></form>
        <div class="config-list">{#each configuration?.routes ?? [] as route (route.id)}<button class="config-row" type="button" disabled={!!busy || !!routeDraft?.pendingAttempt} on:click={() => editRoute(route)}><span><strong>{configuration?.categories.find((category) => category.id === route.categoryId)?.name ?? 'Kategori'}</strong><small>{route.outletId ? outletName(route.outletId) : 'Semua outlet'} · {employeeName(route.recipientEmployeeId)} · revisi {route.revision}</small></span><span>{route.active ? 'Aktif' : 'Nonaktif'}</span></button>{:else}<p class="empty">Belum ada routing. Laporan tetap masuk sebagai tanpa PIC sampai routing dibuat.</p>{/each}</div>
      </section>

      <section class="panel config-card capability-card">
        <div class="section-heading"><div><span class="eyebrow">AKSES</span><h2>Capability operasional</h2></div></div>
        <p class="hint">Hak di bawah ini tidak menggantikan role HR. Setiap request tetap diperiksa terhadap akun aktif, outlet, dan kategori oleh server.</p>
        {#if capabilityDraft?.conflict}<div class="conflict" role="alert"><strong>Versi capability perlu ditinjau</strong><p>{capabilityDraft.conflict}</p><div><button class="btn btn-secondary" type="button" on:click={() => { capabilityForm = emptyCapabilityForm(); clearCapabilityDraft(); }}>Buang draft lokal</button>{#if capabilityForm.id}<button class="btn btn-primary" type="button" on:click={reviewCapabilityLatest}>Pertahankan draft, pakai revisi terbaru</button>{/if}</div></div>{/if}
        {#if capabilityDraft?.pendingAttempt}<div class="pending"><strong>Perubahan akses belum mempunyai hasil pasti</strong><p>Retry mengirim payload dan key asli. Form dikunci agar perubahan baru tidak mengganti permintaan yang sedang dipulihkan.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void saveCapability(true)}>Coba lagi perubahan akses yang sama</button></div>{/if}
        <form on:submit|preventDefault={() => void saveCapability()}><fieldset class="form-fields" disabled={!!busy || !!capabilityDraft?.pendingAttempt || !!capabilityDraft?.conflict}><label class="field">Karyawan<select class="select" bind:value={capabilityForm.employeeId} on:change={rememberCapabilityDraft} required><option value="">Pilih karyawan</option>{#each activeEmployees as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label><label class="field">Kemampuan<select class="select" bind:value={capabilityForm.capability} on:change={rememberCapabilityDraft}><option value="issue_report">Melapor kendala</option><option value="issue_report_for_other">Melapor untuk orang lain</option><option value="issue_view">Melihat kendala</option><option value="issue_handle">Menangani kendala</option><option value="issue_configure">Mengatur kendala</option><option value="handover_monitor">Memantau serah terima</option><option value="summary_view">Melihat ringkasan</option><option value="coverage_configure">Mengatur cakupan</option></select></label><label class="field">Outlet <span class="optional">kosong = semua outlet</span><select class="select" bind:value={capabilityForm.outletId} on:change={rememberCapabilityDraft}><option value="">Semua outlet</option>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label><label class="field">Kategori <span class="optional">kosong = semua kategori</span><select class="select" bind:value={capabilityForm.categoryId} on:change={rememberCapabilityDraft}><option value="">Semua kategori</option>{#each configuration?.categories ?? [] as category}<option value={category.id}>{category.name}</option>{/each}</select></label><label class="check-field"><input type="checkbox" bind:checked={capabilityForm.granted} on:change={rememberCapabilityDraft}/> Berikan capability ini</label><div class="form-actions"><button class="btn btn-primary" type="submit" disabled={!!busy || !!capabilityDraft?.pendingAttempt || !!capabilityDraft?.conflict}>{busy === 'config-capability' ? 'Menyimpan…' : 'Simpan akses'}</button></div></fieldset></form>
        <div class="config-list">{#each configuration?.capabilities ?? [] as grant (grant.id)}<div class="config-row grant-row"><span><strong>{employeeName(grant.employeeId)}</strong><small>{grant.capability} · {grant.outletId ? outletName(grant.outletId) : 'semua outlet'} · {grant.categoryId ? configuration?.categories.find((category) => category.id === grant.categoryId)?.name ?? 'kategori' : 'semua kategori'} · revisi {grant.revision}</small></span><button class="btn btn-secondary" type="button" disabled={!!busy || !!capabilityDraft?.pendingAttempt} on:click={() => grantFromExisting(grant, false)}>Cabut</button></div>{:else}<p class="empty">Belum ada capability operasional khusus.</p>{/each}</div>
      </section>
    </section>
  {:else}
    <aside class="access-note"><Icon name="lock" size={16}/>Konfigurasi hanya tersedia untuk Admin HR. Server juga menolak perubahan konfigurasi dari akun lain.</aside>
  {/if}

{:else}
  <section class="two-column exchange-layout">
    <div class="panel exchange-form">
      <div class="section-heading"><div><span class="eyebrow">AJUKAN</span><h2>Tukar atau pengganti</h2></div><Icon name="calendar" size={21}/></div>
      <p class="hint">Jadwal resmi tidak berubah ketika usulan dibuat atau rekan setuju. Admin HR aktif yang bukan peserta membuat keputusan final setelah server memeriksa konflik terbaru.</p>
      {#if exchangeSubmitAttempt}<div class="pending"><strong>Usulan sebelumnya belum mempunyai hasil pasti</strong><p>Key dan payload asli disimpan untuk akun ini.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => submitExchange(true)}>Coba lagi usulan yang sama</button></div>{/if}
      <form on:submit|preventDefault={() => submitExchange(false)}>
        <label class="field">Jenis usulan<select class="select" bind:value={exchangeForm.requestType} on:change={exchangeRequesterChanged}><option value="swap">Tukar dua arah</option><option value="replacement">Pengganti satu arah</option></select></label>
        <label class="field">Jadwal saya<select class="select" bind:value={exchangeForm.requesterAssignmentId} on:change={exchangeRequesterChanged} required><option value="">Pilih jadwal aktif mendatang</option>{#each allAssignments.filter((assignment) => assignment.employeeId === $app.user?.id && assignment.shift !== 'off' && assignment.workDate >= todayJakarta()) as assignment}<option value={assignment.id}>{assignmentText(assignment)}</option>{/each}</select></label>
        <label class="field">Rekan kasir<select class="select" bind:value={exchangeForm.peerEmployeeId} on:change={exchangeRequesterChanged} required><option value="">Pilih rekan</option>{#each cashiers.filter((employee) => employee.id !== $app.user?.id) as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label>
        {#if requesterAssignment}<div class="preview"><strong>Pratinjau perubahan</strong><p>Pengusul: {assignmentText(requesterAssignment)}</p>{#if exchangeForm.requestType === 'swap'}<p>Rekan: {assignmentText(peerAssignment)}</p>{:else}<p>{peerAssignment ? 'Calon pengganti sudah memiliki jadwal aktif; pilih kandidat lain.' : 'Jika disetujui, jadwal pengusul dibatalkan dan kandidat menerima konteks jadwal tersebut.'}</p>{/if}<small>Server mengecek ulang absensi, Libur, waktu mulai, versi jadwal, izin Middle, serta konflik sebelum keputusan.</small></div>{/if}
        <label class="field">Alasan pengajuan<textarea class="textarea" rows="3" bind:value={exchangeForm.reason} minlength="5" maxlength="2000" placeholder="Jelaskan kebutuhan pertukaran atau pengganti."></textarea></label>
        <button class="btn btn-primary full" type="submit" disabled={!!busy}>{busy === 'exchange-submit' ? 'Mengirim…' : 'Kirim ke rekan'}</button>
      </form>
    </div>
    <div class="panel queue-panel">
      <div class="section-heading"><div><span class="eyebrow">PENGAJUAN</span><h2>Tukar / pengganti yang dapat Anda akses</h2></div><div class="queue-actions">{#if admin}{#if pendingFor('exchange-expire', 'all')}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void expireStaleExchanges(true)}>Coba lagi penutupan</button>{:else}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void expireStaleExchanges()}>Tutup yang kedaluwarsa</button>{/if}{/if}<span class="count">{exchangeTotal}</span></div></div>
      <div class="case-list">
        {#if exchangeRows.length}
          {#each exchangeRows as row (row.id)}
            <button type="button" class="case-row" class:selected={selectedExchangeId === row.id} on:click={() => selectExchange(row)}>
              <span class="case-top"><strong>#{row.requestNumber ?? '—'} · {row.requestType === 'swap' ? 'Tukar' : 'Pengganti'}</strong><i>{exchangeStatusLabel[row.status]}</i></span>
              <span>{dateLabel(row.workDate)} · {employeeName(row.requesterEmployeeId)} → {employeeName(row.peerEmployeeId)}</span><small>{row.reason}</small><small>Revisi {row.revision}</small>
            </button>
          {/each}
        {:else}<p class="empty">Belum ada pengajuan tukar atau pengganti yang dapat Anda akses.</p>{/if}
      </div>
    </div>
  </section>
  {#if selectedExchange}
    <section class="panel exchange-detail">
      <div class="detail-header"><div><span class="eyebrow">PENGAJUAN #{selectedExchange.requestNumber ?? selectedExchange.id.slice(0, 8)}</span><h2>{selectedExchange.requestType === 'swap' ? 'Tukar shift dua arah' : 'Pengganti satu arah'}</h2><p>{dateLabel(selectedExchange.workDate)} · revisi {selectedExchange.revision} · {exchangeStatusLabel[selectedExchange.status]}</p></div><button class="btn btn-secondary" type="button" on:click={() => { selectedExchangeId = ''; setQuery('exchange', null); }}>Tutup detail</button></div>
      <div class="assignment-preview"><div><small>Pengusul</small><strong>{employeeName(selectedExchange.requesterEmployeeId)}</strong><span>{assignmentText(selectedExchangeRequester)}</span></div><div><small>{selectedExchange.requestType === 'swap' ? 'Rekan tukar' : 'Calon pengganti'}</small><strong>{employeeName(selectedExchange.peerEmployeeId)}</strong><span>{selectedExchange.requestType === 'swap' ? assignmentText(selectedExchangePeer) : selectedExchangePeer ? assignmentText(selectedExchangePeer) : 'Belum ada jadwal aktif pada tanggal tersebut'}</span></div></div>
      <div class="description-card"><strong>Alasan pengusul</strong><p>{selectedExchange.reason}</p>{#if selectedExchange.peerNote}<small>Respons rekan: {selectedExchange.peerNote}</small>{/if}{#if selectedExchange.decisionNote}<small>Keputusan HR: {selectedExchange.decisionNote}</small>{/if}</div>
      {#if selectedExchange.peerEmployeeId === $app.user?.id && selectedExchange.status === 'pending_peer'}
        <div class="response-block"><span class="eyebrow">RESPONS REKAN</span><h3>Setujui atau tolak usulan</h3><label class="field">Catatan respons<textarea class="textarea" rows="2" bind:value={exchangeResponseNote} minlength="3" placeholder="Catatan akan menjadi riwayat pengajuan."></textarea></label>{#if pendingFor('exchange-response', selectedExchange.id)}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => respondExchange(true, true)}>Coba lagi respons yang sama</button>{:else}<div class="form-actions"><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => respondExchange(false)}>Tolak usulan</button><button class="btn btn-primary" type="button" disabled={!!busy} on:click={() => respondExchange(true)}>Setujui untuk ditinjau HR</button></div>{/if}</div>
      {/if}
      {#if selectedExchange.requesterEmployeeId === $app.user?.id && (selectedExchange.status === 'pending_peer' || selectedExchange.status === 'pending_spv')}
        <div class="response-block"><span class="eyebrow">PEMBATALAN PENGUSUL</span><h3>Batalkan sebelum keputusan final</h3><p>Jadwal resmi tetap berlaku; pembatalan hanya menutup pengajuan ini dan mempertahankan riwayatnya.</p><label class="field">Alasan pembatalan<textarea class="textarea" rows="2" bind:value={exchangeCancelNote} minlength="3" placeholder="Contoh: kebutuhan kerja sudah berubah."></textarea></label>{#if pendingFor('exchange-cancel', selectedExchange.id)}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void cancelExchange(true)}>Coba lagi pembatalan yang sama</button>{:else}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => void cancelExchange()}>Batalkan pengajuan</button>{/if}</div>
      {/if}
      {#if admin && selectedExchange.status === 'pending_spv' && selectedExchange.requesterEmployeeId !== $app.user?.id && selectedExchange.peerEmployeeId !== $app.user?.id}
        <div class="decision-block"><span class="eyebrow">KEPUTUSAN ADMIN HR</span><h3>Putuskan jadwal resmi</h3><p>Server mengunci dan memeriksa baseline seluruh penugasan sebelum perubahan atomik dibuat. Jika jadwal berubah setelah pengajuan, keputusan ditolak untuk review ulang.</p><label class="field">Dasar keputusan<textarea class="textarea" rows="2" bind:value={exchangeDecisionNote} minlength="5" placeholder="Jelaskan dasar persetujuan atau penolakan."></textarea></label>{#if pendingFor('exchange-decision', selectedExchange.id)}<button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => decideExchange(true, true)}>Coba lagi keputusan yang sama</button>{:else}<div class="form-actions"><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={() => decideExchange(false)}>Tolak</button><button class="btn btn-primary" type="button" disabled={!!busy} on:click={() => decideExchange(true)}>Setujui & ubah jadwal</button></div>{/if}</div>
      {/if}
      {#if selectedExchange.status === 'pending_spv' && (!admin || selectedExchange.requesterEmployeeId === $app.user?.id || selectedExchange.peerEmployeeId === $app.user?.id)}<p class="access-note"><Icon name="lock" size={15}/>Pengajuan telah menunggu keputusan Admin HR lain yang bukan peserta. Jadwal resmi belum berubah.</p>{/if}
    </section>
  {/if}
{/if}

<style>
  .module-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.8rem;margin:0 0 1.2rem}.module-tabs button{text-align:left;background:var(--surface);border:1px solid var(--panel-border);box-shadow:var(--raised-sm);border-radius:16px;padding:1rem;color:var(--muted);min-height:82px}.module-tabs button.active{background:var(--yellow-soft);border-color:#d8c36c;color:var(--ink);box-shadow:var(--inset)}.module-tabs strong{display:block;font-size:.78rem;color:inherit}.module-tabs small{display:block;font-size:.64rem;line-height:1.5;margin-top:.38rem;color:var(--muted)}.two-column{display:grid;grid-template-columns:minmax(300px,.82fr) minmax(370px,1.18fr);gap:1.1rem;align-items:start}.panel{margin-bottom:1.15rem}.section-heading,.detail-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem}.section-heading h2,.detail-header h2{font-size:1.02rem;margin:.32rem 0 0;color:var(--ink)}.section-heading>:global(svg){color:var(--accent);margin-top:.25rem}.queue-actions{display:flex;align-items:center;justify-content:flex-end;gap:.55rem;flex-wrap:wrap}.queue-actions .btn{min-height:34px;font-size:.62rem}.eyebrow{display:block;font-size:.58rem;letter-spacing:.1em;color:var(--muted);font-weight:700}.hint,.detail-header p{font-size:.69rem;line-height:1.65;color:var(--muted);margin:.8rem 0 1rem}.field{display:grid;gap:.38rem;font-size:.67rem;color:var(--muted);margin:.78rem 0}.optional{font-size:.6rem;font-weight:400}.textarea{resize:vertical;min-height:72px}.file-input{font:inherit;font-size:.67rem;color:var(--muted);padding:.5rem 0}.file-input::file-selector-button{border:1px solid var(--panel-border);background:var(--surface);box-shadow:var(--raised-sm);border-radius:9px;padding:.48rem .7rem;color:var(--ink);margin-right:.6rem}.full{width:100%;justify-content:center}.form-fields{border:0;padding:0;margin:0;min-width:0}.form-note,.access-note{display:flex;align-items:flex-start;gap:.45rem;font-size:.65rem;line-height:1.6;color:#725c23;background:var(--surface-cream);border:1px solid #dfd0a4;border-radius:12px;padding:.7rem .75rem;margin:.75rem 0}.filters.compact{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.55rem;margin:.8rem 0}.filters label{display:grid;gap:.3rem;font-size:.62rem;color:var(--muted)}.filters .select{font-size:.68rem;padding:.55rem}.as-of{font-size:.62rem;color:var(--muted);margin:.8rem 0}.count,.status-chip{display:grid;place-items:center;min-width:30px;min-height:30px;border-radius:10px;background:var(--yellow-soft);color:var(--accent);font-size:.7rem;font-weight:700}.case-list{display:flex;flex-direction:column;gap:.55rem;max-height:545px;overflow:auto;padding:.1rem}.case-row{text-align:left;background:var(--surface);border:1px solid var(--panel-border);box-shadow:var(--raised-sm);border-radius:13px;padding:.82rem;color:var(--muted)}.case-row.selected{border-color:#c9ad48;background:#fff7d8}.case-row .case-top{display:flex;align-items:flex-start;justify-content:space-between;gap:.55rem}.case-row strong{font-size:.72rem;color:var(--ink);line-height:1.35}.case-row i{font-style:normal;white-space:nowrap;border-radius:99px;background:#eee6ce;color:#6c5b2d;padding:.2rem .42rem;font-size:.56rem}.case-row i.urgent{background:#f5d7b7;color:#8a4829}.case-row>span:not(.case-top),.case-row small{display:block;font-size:.63rem;line-height:1.45;margin-top:.38rem}.case-row small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail-panel{padding:1.2rem}.description-card,.preview,.assignment-preview{background:var(--surface-cream);border:1px solid var(--panel-border);box-shadow:var(--inset);border-radius:14px;padding:.9rem;margin:1rem 0}.description-card strong,.preview strong{font-size:.72rem;color:var(--ink)}.description-card p,.preview p{font-size:.7rem;line-height:1.7;margin:.4rem 0;color:#655b39}.description-card small,.preview small{display:block;font-size:.62rem;color:var(--muted);line-height:1.55}.photo-action{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:.7rem}.load-more{display:flex;margin:1rem auto 0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.1rem .9rem}.form-grid .wide{grid-column:1/-1}.form-actions{display:flex;justify-content:flex-end;gap:.6rem;flex-wrap:wrap;border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem}.pending,.conflict{border:1px solid #d8bd70;background:#fff4d2;border-radius:14px;padding:.85rem;margin:1rem 0}.conflict{background:#f8e7d8;border-color:#d5b59d}.pending strong,.conflict strong{font-size:.73rem;color:var(--ink)}.pending p,.conflict p{font-size:.66rem;line-height:1.65;color:#655b39;margin:.45rem 0 .75rem}.conflict>div{display:flex;gap:.5rem;flex-wrap:wrap}.editor-empty{min-height:430px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;gap:.65rem;color:var(--muted)}.editor-empty strong{color:var(--ink);font-size:.8rem}.editor-empty span{font-size:.67rem}.response-panel,.exchange-detail{padding:1.2rem}.response-panel h2,.decision-block h3,.response-block h3{font-size:.94rem;margin:.3rem 0}.response-panel p,.decision-block p,.response-block p{font-size:.68rem;line-height:1.6;color:var(--muted)}.response-panel .field{max-width:700px}.exchange-form .preview{margin-top:.9rem}.assignment-preview{display:grid;grid-template-columns:1fr 1fr;gap:1px;padding:1px;overflow:hidden}.assignment-preview>div{padding:.9rem;background:var(--surface-cream)}.assignment-preview small,.assignment-preview strong,.assignment-preview span{display:block}.assignment-preview small{font-size:.61rem;color:var(--muted)}.assignment-preview strong{font-size:.75rem;margin:.35rem 0;color:var(--ink)}.assignment-preview span{font-size:.64rem;line-height:1.5;color:#655b39}.response-block,.decision-block{border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem}.decision-block{background:#faf7ed;border:1px solid var(--panel-border);border-radius:14px;padding:1rem}.config-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.1rem;align-items:start}.config-card{padding:1.15rem}.capability-card{grid-column:1/-1}.check-field{display:flex;align-items:center;gap:.55rem;font-size:.67rem;color:var(--muted);margin:.8rem 0}.check-field input{inline-size:1rem;block-size:1rem}.config-list{display:grid;gap:.5rem;border-top:1px solid var(--border);margin-top:1.1rem;padding-top:1rem;max-height:310px;overflow:auto}.config-row{display:flex;justify-content:space-between;align-items:center;gap:.7rem;width:100%;text-align:left;border:1px solid var(--panel-border);background:var(--surface);box-shadow:var(--raised-sm);border-radius:12px;padding:.7rem;color:var(--muted);font:inherit}.config-row:not(.grant-row):hover{border-color:#cbae42}.config-row strong{font-size:.7rem;color:var(--ink)}.config-row small{display:block;font-size:.6rem;line-height:1.5;margin-top:.25rem}.grant-row{cursor:default}.empty{padding:1.5rem;text-align:center;color:var(--muted);font-size:.7rem}.loading{min-height:220px;display:flex;align-items:center;justify-content:center;gap:.7rem;color:var(--muted);font-size:.75rem}@media(max-width:950px){.two-column,.config-grid{grid-template-columns:1fr}.capability-card{grid-column:auto}.case-list{max-height:350px}.module-tabs{grid-template-columns:1fr}.module-tabs button{min-height:unset}.filters.compact{grid-template-columns:1fr 1fr}.filters label:last-child{grid-column:1/-1}.handover-layout .queue-panel{order:2}.handover-layout .handover-editor{order:1}}@media(max-width:620px){.detail-panel,.response-panel,.exchange-detail,.config-card{padding:1rem}.filters.compact,.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.form-actions{display:grid}.form-actions .btn{width:100%;justify-content:center}.detail-header{display:grid}.assignment-preview{grid-template-columns:1fr}.module-tabs{gap:.55rem}.module-tabs button{padding:.8rem}.case-row small{white-space:normal}.pending .btn,.conflict .btn{width:100%;justify-content:center}}
</style>
