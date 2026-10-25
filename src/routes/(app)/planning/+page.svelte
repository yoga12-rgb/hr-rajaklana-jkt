<script lang="ts">
  import { onMount } from 'svelte';
  import { app, actions, displayName, isAdmin } from '#lib/state/app';
  import type { CashierAssignment, CashierAssignmentPlanInput, StaffingIntervalRequirement, StaffingIntervalRequirementInput, SupervisorCapability, SupervisorCoverage, SupervisorReport } from '#lib/types';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import MetricCard from '#lib/components/MetricCard.svelte';
  import StatusPill from '#lib/components/StatusPill.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { dateLabel, todayJakarta } from '#lib/components/format';
  import { listPlanningPending, readPlanningPending, writePlanningPending } from '#lib/supervisor-planning-recovery';

  type PlanningTab = 'coverage' | 'middle' | 'report';
  type PlannedCashierAssignment = CashierAssignment;
  type RequirementPayload = StaffingIntervalRequirementInput;
  type MiddlePlanPayload = CashierAssignmentPlanInput;
  type PlanningActions = {
    loadSupervisorCoverage: (outletId: string, workDate: string) => Promise<SupervisorCoverage>;
    loadIntervalRequirements: (outletId?: string) => Promise<StaffingIntervalRequirement[]>;
    saveIntervalRequirement: (input: RequirementPayload) => Promise<StaffingIntervalRequirement>;
    saveCashierAssignmentPlan: (input: MiddlePlanPayload) => Promise<PlannedCashierAssignment>;
    loadSupervisorReport: (input: { from: string; to: string; outletId?: string | null; employeeId?: string | null }) => Promise<SupervisorReport>;
    loadMySupervisorCapabilities: () => Promise<SupervisorCapability[]>;
  };
  const planningActions = actions as typeof actions & PlanningActions;

  const weekdayLabels = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayFor = (date: string) => new Date(`${date}T12:00:00+07:00`).getUTCDay();
  const datePlus = (date: string, days: number) => {
    const value = new Date(`${date}T12:00:00+07:00`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const mondayRange = () => {
    const today = todayJakarta(), weekday = dayFor(today), offset = weekday === 0 ? -6 : 1 - weekday;
    return { from: datePlus(today, offset), to: datePlus(today, offset + 6) };
  };
  const monthRange = () => {
    const [year, month] = todayJakarta().split('-').map(Number);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    return { from, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  };
  const randomKey = () => crypto.randomUUID();
  const localTime = (value: string | null | undefined) => {
    if (!value) return '—';
    const direct = String(value).match(/T(\d{2}:\d{2})/)?.[1];
    if (direct) return direct;
    const match = String(value).match(/(\d{2}:\d{2})/);
    return match?.[1] ?? String(value);
  };
  const localDateTime = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) + ' WIB'
    : '—';
  const outletName = (id: string) => $app.outlets.find((outlet) => outlet.id === id)?.name ?? 'Outlet tidak dikenal';
  const employeeName = (id: string | null | undefined) => id ? displayName(id) : 'Disamarkan oleh akses';
  const planLabel = (assignment: PlannedCashierAssignment) => assignment.plannedStartsAt && assignment.plannedEndsAt
    ? `${localTime(assignment.plannedStartsAt)}–${localTime(assignment.plannedEndsAt)} WIB${assignment.plannedEndsNextDay ? ' (+1 hari)' : ''}`
    : 'Belum ditentukan';
  const durationMinutes = (startsAt: string, endsAt: string) => {
    if (!/^\d{2}:\d{2}$/.test(startsAt) || !/^\d{2}:\d{2}$/.test(endsAt)) return null;
    const [startHours, startMinutes] = startsAt.split(':').map(Number);
    const [endHours, endMinutes] = endsAt.split(':').map(Number);
    let result = endHours * 60 + endMinutes - startHours * 60 - startMinutes;
    if (result <= 0) result += 24 * 60;
    return result;
  };

  let tab: PlanningTab = 'coverage';
  let coverageOutletId = '', coverageDate = todayJakarta(), coverage: SupervisorCoverage | null = null;
  let requirements: StaffingIntervalRequirement[] = [], coverageLoading = false, requirementsLoading = false, reportLoading = false;
  let savingRequirement = false, savingMiddle = false, message = '', failed = false;
  let requirementEditing: StaffingIntervalRequirement | null = null;
  let requirementOutletId = '', requirementWeekday = dayFor(todayJakarta()), requirementStart = '07:00', requirementEnd = '15:00';
  let requirementMinimum = 1, requirementFrom = todayJakarta(), requirementUntil = '', requirementReason = '';
  let requirementPending: RequirementPayload | null = null;
  let middleOutletId = '', middleDate = todayJakarta(), middleAssignmentId = '', middleStart = '08:00', middleEnd = '16:00', middleReason = '';
  let middlePending: MiddlePlanPayload | null = null;
  const initialWeek = mondayRange();
  let reportFrom = initialWeek.from, reportTo = initialWeek.to, reportOutletId = '', reportEmployeeId = '', report: SupervisorReport | null = null;
  let capabilities: SupervisorCapability[] = [], capabilitiesLoaded = false;
  let requirementConflict: StaffingIntervalRequirement | null = null, middleConflict: PlannedCashierAssignment | null = null;
  let middleBaselineUpdatedAt = '', observedDataRevision = -1, pendingAuthoritativeRefresh = false, refreshingAuthoritativeData = false;

  $: admin = isAdmin($app.user ?? undefined);
  $: canConfigureCoverage = admin || capabilities.some((capability) => capability.capability === 'coverage_configure');
  $: canViewPlanning = admin || capabilities.some((capability) => capability.capability === 'coverage_configure' || capability.capability === 'summary_view');
  // Configuring a scoped coverage target is deliberately narrower than reading
  // period reports. Keep the tab aligned with the server-side summary_view
  // boundary instead of inviting a user into a request that will be denied.
  $: canViewReports = admin || capabilities.some((capability) => capability.capability === 'summary_view');
  $: activeOutlets = $app.outlets.filter((outlet) => outlet.active);
  $: if (!coverageOutletId && activeOutlets.length) coverageOutletId = activeOutlets[0].id;
  $: if (!middleOutletId && activeOutlets.length) middleOutletId = activeOutlets[0].id;
  $: if (!requirementOutletId && activeOutlets.length) requirementOutletId = activeOutlets[0].id;
  $: activeMiddleAssignments = (($app.cashierAssignments ?? []) as PlannedCashierAssignment[]).filter((assignment) =>
    assignment.status === 'active' && assignment.shift === 'middle' && assignment.workDate === middleDate && assignment.outletId === middleOutletId
  );
  $: selectedMiddle = activeMiddleAssignments.find((assignment) => assignment.id === middleAssignmentId) ?? null;
  $: middleDuration = durationMinutes(middleStart, middleEnd);
  $: coverageRows = coverage?.coverage ?? [];
  $: shortageRows = coverageRows.filter((row) => row.shortage > 0);
  $: matchedRequirements = requirements.filter((item) => !coverageOutletId || item.outletId === coverageOutletId);
  $: reportDetails = report?.details ?? [];
  $: if ($app.initialized && ($app.dataRevision ?? 0) !== observedDataRevision) {
    observedDataRevision = $app.dataRevision ?? 0;
    pendingAuthoritativeRefresh = true;
  }
  $: if (pendingAuthoritativeRefresh && !refreshingAuthoritativeData && !savingRequirement && !savingMiddle && capabilitiesLoaded && canViewPlanning) {
    pendingAuthoritativeRefresh = false;
    void refreshFromAuthoritativeData();
  }
  $: if (selectedMiddle && middleBaselineUpdatedAt && selectedMiddle.updatedAt !== middleBaselineUpdatedAt && !savingMiddle && !middlePending) {
    middleConflict = selectedMiddle;
  }

  function accountId() { return $app.user?.id ?? 'anonymous'; }
  function persistPending(kind: 'requirement' | 'middle', entity: string, value: RequirementPayload | MiddlePlanPayload | null) {
    if (typeof localStorage === 'undefined') return;
    writePlanningPending(localStorage, accountId(), kind, entity, value);
  }
  function readPending<T>(kind: 'requirement' | 'middle', entity: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    return readPlanningPending<T & (RequirementPayload | MiddlePlanPayload)>(localStorage, accountId(), kind, entity);
  }
  function clearFeedback() { message = ''; failed = false; }
  function showError(error: unknown, fallback: string) { failed = true; message = error instanceof Error ? error.message : fallback; }

  async function refreshCoverage() {
    if (!coverageOutletId || !coverageDate) return;
    coverageLoading = true; clearFeedback();
    try {
      coverage = await planningActions.loadSupervisorCoverage(coverageOutletId, coverageDate);
    } catch (error) { coverage = null; showError(error, 'Cakupan outlet belum dapat dimuat.'); }
    finally { coverageLoading = false; }
  }
  async function refreshRequirements() {
    requirementsLoading = true;
    try {
      const latest = await planningActions.loadIntervalRequirements(coverageOutletId || undefined);
      requirements = latest;
      if (requirementEditing) {
        const server = latest.find((row) => row.id === requirementEditing?.id);
        if (server && server.revision !== requirementEditing.revision && !savingRequirement && !requirementPending) requirementConflict = server;
      }
    }
    catch (error) { showError(error, 'Kebutuhan interval belum dapat dimuat.'); }
    finally { requirementsLoading = false; }
  }
  async function refreshCoverageArea() { await Promise.all([refreshCoverage(), refreshRequirements()]); }
  async function refreshFromAuthoritativeData() {
    refreshingAuthoritativeData = true;
    try {
      await refreshCoverageArea();
      if (report) await loadReport();
    } finally { refreshingAuthoritativeData = false; }
  }
  async function loadCapabilities() {
    try { capabilities = await planningActions.loadMySupervisorCapabilities(); }
    catch (error) { showError(error, 'Hak perencanaan belum dapat dimuat.'); }
    finally { capabilitiesLoaded = true; }
  }

  function resetRequirement() {
    requirementEditing = null; requirementOutletId = coverageOutletId || activeOutlets[0]?.id || '';
    requirementWeekday = dayFor(coverageDate); requirementStart = '07:00'; requirementEnd = '15:00'; requirementMinimum = 1;
    requirementFrom = coverageDate; requirementUntil = ''; requirementReason = ''; requirementPending = null; requirementConflict = null;
  }
  function editRequirement(row: StaffingIntervalRequirement) {
    requirementEditing = row; requirementOutletId = row.outletId; requirementWeekday = row.weekday; requirementStart = localTime(row.startsAt);
    requirementEnd = localTime(row.endsAt); requirementMinimum = row.minimum; requirementFrom = row.effectiveFrom;
    requirementUntil = row.effectiveUntil ?? ''; requirementReason = '';
    requirementPending = readPending<RequirementPayload>('requirement', row.id); requirementConflict = null;
  }
  function reviewRequirementConflict() {
    if (!requirementConflict) return;
    // Keep every local field, but explicitly adopt the server revision before
    // the operator sends a new attempt. This is never an implicit rebase.
    requirementEditing = requirementConflict;
    requirementConflict = null;
  }
  function requirementAttempt(): RequirementPayload {
    if (!requirementOutletId || requirementMinimum < 0 || requirementMinimum > 100 || !requirementFrom || requirementStart >= requirementEnd) {
      throw new Error('Isi outlet, hari, interval waktu yang valid, dan kebutuhan 0–100 orang.');
    }
    if (requirementUntil && requirementUntil < requirementFrom) throw new Error('Tanggal akhir berlaku tidak boleh sebelum tanggal mulai.');
    if (requirementEditing && requirementReason.trim().length < 5) throw new Error('Alasan perubahan kebutuhan minimal 5 karakter.');
    return {
      id: requirementEditing?.id ?? null, expectedRevision: requirementEditing?.revision ?? null, idempotencyKey: randomKey(),
      outletId: requirementOutletId, weekday: Number(requirementWeekday), startsAt: requirementStart, endsAt: requirementEnd,
      minimum: Number(requirementMinimum), effectiveFrom: requirementFrom, effectiveUntil: requirementUntil || null, reason: requirementReason.trim()
    };
  }
  async function saveRequirement(retry = false) {
    if (savingRequirement) return;
    let attempt = requirementPending;
    try {
      if (!retry || !attempt) {
        attempt = requirementAttempt(); requirementPending = attempt;
        persistPending('requirement', attempt.id ?? 'new', attempt);
      }
    } catch (error) { showError(error, 'Kebutuhan interval belum siap disimpan.'); return; }
    savingRequirement = true; clearFeedback();
    try {
      await planningActions.saveIntervalRequirement(attempt);
      persistPending('requirement', attempt.id ?? 'new', null); requirementPending = null;
      message = requirementEditing ? 'Kebutuhan interval diperbarui dengan pemeriksaan revisi.' : 'Kebutuhan interval baru tersimpan.';
      resetRequirement(); await refreshCoverageArea();
    } catch (error) {
      showError(error, 'Kebutuhan interval belum tersimpan. Payload dan key asli tetap tersedia untuk dicoba lagi.');
      if (/berubah sejak dibuka|40001/i.test(message)) await refreshRequirements();
    } finally { savingRequirement = false; }
  }

  function chooseMiddle() {
    const selected = activeMiddleAssignments.find((assignment) => assignment.id === middleAssignmentId);
    middleStart = localTime(selected?.plannedStartsAt) === '—' ? '08:00' : localTime(selected?.plannedStartsAt);
    middleEnd = localTime(selected?.plannedEndsAt) === '—' ? '16:00' : localTime(selected?.plannedEndsAt);
    middleReason = '';
    middlePending = selected ? readPending<MiddlePlanPayload>('middle', selected.id) : null;
    middleBaselineUpdatedAt = selected?.updatedAt ?? '';
    middleConflict = null;
  }
  function middleAttempt(): MiddlePlanPayload {
    if (!selectedMiddle) throw new Error('Pilih penugasan Middle aktif yang ingin diberi jam rencana.');
    if (middleDuration !== 480) throw new Error('Jam rencana Middle harus tepat 8 jam termasuk istirahat.');
    if (middleReason.trim().length < 5) throw new Error('Alasan penetapan jam Middle minimal 5 karakter.');
    return { assignmentId: selectedMiddle.id, expectedUpdatedAt: middleBaselineUpdatedAt || selectedMiddle.updatedAt, idempotencyKey: randomKey(), startsAt: middleStart, endsAt: middleEnd, reason: middleReason.trim() };
  }
  function reviewMiddleConflict() {
    if (!middleConflict) return;
    // Preserve the entered interval; changing to the current server version is
    // a conscious operator action after reviewing the conflict notice.
    middleBaselineUpdatedAt = middleConflict.updatedAt;
    middleConflict = null;
  }
  async function saveMiddlePlan(retry = false) {
    if (savingMiddle) return;
    let attempt = middlePending;
    try {
      if (!retry || !attempt) {
        attempt = middleAttempt(); middlePending = attempt; persistPending('middle', attempt.assignmentId, attempt);
      }
    } catch (error) { showError(error, 'Jam Middle belum siap disimpan.'); return; }
    savingMiddle = true; clearFeedback();
    try {
      await planningActions.saveCashierAssignmentPlan(attempt);
      persistPending('middle', attempt.assignmentId, null); middlePending = null;
      middleBaselineUpdatedAt = selectedMiddle?.updatedAt ?? middleBaselineUpdatedAt;
      middleConflict = null;
      message = 'Jam Middle tersimpan. Cakupan akan memakai interval rencana ini.';
      await refreshCoverage();
    } catch (error) { showError(error, 'Jam Middle belum tersimpan. Payload dan key asli tetap tersedia untuk dicoba lagi.'); }
    finally { savingMiddle = false; }
  }

  async function loadReport() {
    if (!canViewReports) { showError(new Error('Hak Ringkasan diperlukan untuk membuka laporan periode.'), 'Laporan belum dapat dimuat.'); return; }
    if (!reportFrom || !reportTo || reportTo < reportFrom) { showError(new Error('Rentang tanggal laporan belum valid.'), 'Laporan belum dapat dimuat.'); return; }
    const length = Math.round((Date.parse(`${reportTo}T12:00:00+07:00`) - Date.parse(`${reportFrom}T12:00:00+07:00`)) / 86_400_000);
    if (length > 62) { showError(new Error('Rentang laporan maksimal 63 hari.'), 'Laporan belum dapat dimuat.'); return; }
    reportLoading = true; clearFeedback();
    try { report = await planningActions.loadSupervisorReport({ from: reportFrom, to: reportTo, outletId: reportOutletId || undefined, employeeId: reportEmployeeId || undefined }); }
    catch (error) { report = null; showError(error, 'Laporan belum dapat dimuat.'); }
    finally { reportLoading = false; }
  }
  function exportReportCsv() {
    if (!report) return;
    const safe = (value: string | number | boolean | null | undefined) => {
      let cell = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(cell)) cell = `'${cell}`;
      return `"${cell.replace(/"/g, '""')}"`;
    };
    const data: (string | number | boolean | null | undefined)[][] = [
      ['Tanggal kerja WIB', 'Outlet', 'Karyawan', 'Shift', 'Sumber jam rencana', 'Absensi tercatat', 'Cuti penuh disetujui', 'Izin parsial disetujui', 'Terlambat menit', 'Koreksi'],
      ...report.details.map((row) => [row.workDate, outletName(row.outletId), row.employeeId ? employeeName(row.employeeId) : 'Disamarkan oleh akses', row.shift, row.plannedSource ?? 'belum ada', row.attendanceRecorded ? 'Ya' : 'Tidak', row.fullLeave ? 'Ya' : 'Tidak', row.partialLeave ? 'Ya' : 'Tidak', row.lateMinutes, row.corrections])
    ];
    const csv = '\uFEFF' + data.map((row) => row.map(safe).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `rajaklana-laporan-supervisor-${report.from}-${report.to}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function useThisWeek() { const range = mondayRange(); reportFrom = range.from; reportTo = range.to; }
  function useThisMonth() { const range = monthRange(); reportFrom = range.from; reportTo = range.to; }

  function restorePendingAttempts() {
    if (typeof localStorage === 'undefined') return;
    const pending = listPlanningPending(localStorage, accountId());
    const requirement = pending.find((item) => item.kind === 'requirement')?.payload as RequirementPayload | undefined;
    if (requirement && !requirementPending) {
      const server = requirement.id ? requirements.find((row) => row.id === requirement.id) ?? null : null;
      if (!requirement.id || server) {
        requirementEditing = server;
        requirementOutletId = requirement.outletId; requirementWeekday = requirement.weekday; requirementStart = requirement.startsAt; requirementEnd = requirement.endsAt;
        requirementMinimum = requirement.minimum; requirementFrom = requirement.effectiveFrom; requirementUntil = requirement.effectiveUntil ?? ''; requirementReason = requirement.reason;
        requirementPending = requirement;
      }
    }
    const middle = pending.find((item) => item.kind === 'middle')?.payload as MiddlePlanPayload | undefined;
    const assignment = middle ? (($app.cashierAssignments ?? []) as PlannedCashierAssignment[]).find((row) => row.id === middle.assignmentId && row.status === 'active' && row.shift === 'middle') : null;
    if (middle && assignment && !middlePending) {
      middleOutletId = assignment.outletId; middleDate = assignment.workDate; middleAssignmentId = assignment.id;
      middleStart = middle.startsAt; middleEnd = middle.endsAt; middleReason = middle.reason; middleBaselineUpdatedAt = middle.expectedUpdatedAt; middlePending = middle;
    }
    if ((requirement || middle) && !message) message = 'Permintaan perencanaan sebelumnya belum memiliki hasil pasti. Payload dan key asli dipulihkan untuk ditinjau atau dicoba lagi.';
  }

  onMount(async () => {
    await loadCapabilities();
    if (canViewPlanning) { await refreshCoverageArea(); restorePendingAttempts(); }
  });
</script>

<PageHeading eyebrow="SUPERVISOR" title="Perencanaan & ringkasan" description="Pantau kebutuhan kasir per interval, tetapkan jam Middle, dan baca ringkasan periode dari sumber data yang sama.">
  <button class="btn btn-secondary" type="button" on:click={() => { void refreshCoverageArea(); if (report) void loadReport(); }} disabled={coverageLoading || requirementsLoading}>
    <Icon name="refresh" size={17}/>Perbarui data
  </button>
</PageHeading>

<div class="tabs" role="tablist" aria-label="Bagian perencanaan supervisor">
  <button type="button" role="tab" aria-selected={tab === 'coverage'} class:active={tab === 'coverage'} on:click={() => tab = 'coverage'}>Cakupan interval</button>
  <button type="button" role="tab" aria-selected={tab === 'middle'} class:active={tab === 'middle'} on:click={() => tab = 'middle'}>Jam Middle</button>
  {#if canViewReports}<button type="button" role="tab" aria-selected={tab === 'report'} class:active={tab === 'report'} on:click={() => tab = 'report'}>Laporan periode</button>{/if}
</div>
<Feedback {message} error={failed}/>

{#if !capabilitiesLoaded}
  <section class="panel access-loading" aria-busy="true"><Icon name="shield" size={20}/><div><strong>Memeriksa akses perencanaan…</strong><p>Hak tetap ditentukan server sebelum data jadwal atau kebutuhan outlet dimuat.</p></div></section>
{:else if !canViewPlanning}
  <section class="panel access-loading"><Icon name="shield" size={20}/><div><strong>Akses perencanaan belum diberikan</strong><p>Modul ini memerlukan capability Ringkasan atau Konfigurasi cakupan pada outlet yang relevan. Hubungi Admin HR bila Anda perlu meninjau atau mengatur data.</p></div></section>
{:else if tab === 'coverage'}
  <section class="panel controls">
    <label class="field">Outlet
      <select class="select" bind:value={coverageOutletId} on:change={() => { resetRequirement(); void refreshCoverageArea(); }}>
        {#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}
      </select>
    </label>
    <label class="field">Tanggal kerja (WIB)<input class="input" type="date" bind:value={coverageDate} on:change={() => { resetRequirement(); void refreshCoverageArea(); }}/></label>
    <button class="btn btn-primary" type="button" on:click={() => void refreshCoverageArea()} disabled={coverageLoading}> {coverageLoading ? 'Memuat…' : 'Tinjau cakupan'} </button>
  </section>

  {#if coverage}
    <div class="metrics">
      <MetricCard label="Interval kurang personel" value={shortageRows.length} detail={shortageRows.length ? 'Butuh tindak lanjut sesuai interval' : 'Tidak ada kekurangan pada interval yang dikonfigurasi'} icon="alert" accent={shortageRows.length > 0}/>
      <MetricCard label="Middle belum punya jam" value={coverage.unknownMiddleCount} detail={coverage.unknownMiddleCount ? 'Tidak dihitung sebagai cakupan sampai jam disimpan' : 'Semua Middle yang terlihat sudah memiliki jam'} icon="clock"/>
      <MetricCard label="Kebutuhan interval" value={coverageRows.length} detail={coverage.configured ? 'Dihitung dengan batas waktu eksplisit' : 'Belum dikonfigurasi untuk tanggal ini'} icon="calendar"/>
    </div>
    {#if !coverage.configured}
      <aside class="notice warning" role="status"><Icon name="alert" size={18}/><div><strong>Belum ada kebutuhan interval aktif</strong><p>Penugasan tetap terlihat di jadwal, tetapi sistem belum dapat menyatakan outlet cukup atau kurang personel. Tambahkan kebutuhan per jam di bawah.</p></div></aside>
    {:else}
      <section class="panel table-panel"><div class="panel-heading"><div><h2>Cakupan {outletName(coverage.outletId)}</h2><p>Dihitung untuk {dateLabel(coverage.workDate)}. Kehadiran aktual ditampilkan sebagai sinyal, bukan pengganti jadwal.</p></div><small>Data dihitung {localDateTime(coverage.asOf)}</small></div>
        <div class="table-wrap"><table><thead><tr><th>Interval WIB</th><th>Minimum</th><th>Direncanakan</th><th>Tersedia</th><th>Absensi tercatat</th><th>Status</th></tr></thead><tbody>
          {#each coverageRows as row}<tr class:shortage={row.shortage > 0}><td><strong>{localTime(row.startsAt)}–{localTime(row.endsAt)}</strong></td><td>{row.minimum}</td><td>{row.plannedCount}</td><td>{row.availableCount}<small>{row.employeeIds.length ? row.employeeIds.map(employeeName).join(', ') : 'Nama dibatasi oleh akses'}</small></td><td>{row.attendanceRecordedCount}</td><td>{#if row.shortage > 0}<StatusPill label={`Kurang ${row.shortage} orang`} tone="red"/>{:else}<StatusPill label="Memenuhi kebutuhan" tone="green"/>{/if}</td></tr>{/each}
        </tbody></table></div>
        <p class="legend"><strong>Direncanakan</strong> memakai jam penugasan. <strong>Tersedia</strong> mengecualikan cuti/izin yang menyentuh interval. <strong>Absensi tercatat</strong> hanya bukti clock in/out pada saat laporan dibuat.</p>
      </section>
    {/if}
    {#if coverage.unknownMiddleCount > 0}<aside class="notice" role="status"><Icon name="clock" size={18}/><div><strong>{coverage.unknownMiddleCount} penugasan Middle belum dapat dihitung</strong><p>{coverage.unknownMiddleEmployeeIds.length ? coverage.unknownMiddleEmployeeIds.map(employeeName).join(', ') : 'Nama tidak ditampilkan sesuai izin Anda'}. Tetapkan jam rencana 8 jam sebelum menyimpulkan cakupan.</p></div></aside>{/if}
    {#if coverage.legacyShiftRequirements.length}<aside class="notice muted" role="note"><Icon name="file" size={18}/><div><strong>Referensi kebutuhan shift lama</strong><p>{coverage.legacyShiftRequirements.map((row) => `${row.shift}: ${row.minimum}`).join(' · ')}. Referensi ini tidak dicampur sebagai angka cakupan interval agar kekurangan tidak disamarkan.</p></div></aside>{/if}
  {/if}

  {#if canConfigureCoverage}
    <section class="planning-grid">
      <section class="panel requirement-form"><div class="panel-heading"><div><h2>{requirementEditing ? 'Ubah kebutuhan interval' : 'Tambah kebutuhan interval'}</h2><p>Interval yang tanggal berlakunya bertumpang-tindih tidak dapat disimpan. Perubahan memakai revisi server.</p></div>{#if requirementEditing}<button class="btn btn-secondary" type="button" on:click={resetRequirement}>Buat baru</button>{/if}</div>
        {#if requirementConflict}<div class="conflict" role="alert"><strong>Kebutuhan interval berubah di sesi lain</strong><p>Isian lokal tetap ada. Periksa revisi terbaru sebelum membuat permintaan baru.</p><div><button class="btn btn-secondary" type="button" on:click={() => editRequirement(requirementConflict!)}>Gunakan data server</button><button class="btn btn-primary" type="button" on:click={reviewRequirementConflict}>Pertahankan isian & gunakan revisi terbaru</button></div></div>{/if}
        <form on:submit|preventDefault={() => void saveRequirement()}><fieldset class="form-fields" disabled={savingRequirement || !!requirementPending || !!requirementConflict}><div class="form-grid">
          <label class="field">Outlet<select class="select" bind:value={requirementOutletId} required>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label>
          <label class="field">Hari kerja<select class="select" bind:value={requirementWeekday}>{#each weekdayLabels as weekday, index}<option value={index}>{weekday}</option>{/each}</select></label>
          <label class="field">Mulai (WIB)<input class="input" type="time" bind:value={requirementStart} required/></label>
          <label class="field">Selesai (WIB)<input class="input" type="time" bind:value={requirementEnd} required/></label>
          <label class="field">Minimum kasir<input class="input" type="number" min="0" max="100" bind:value={requirementMinimum} required/></label>
          <label class="field">Mulai berlaku<input class="input" type="date" bind:value={requirementFrom} required/></label>
          <label class="field">Berakhir berlaku <span class="optional">opsional</span><input class="input" type="date" min={requirementFrom} bind:value={requirementUntil}/></label>
          <label class="field">Alasan perubahan <span class="optional">wajib saat ubah</span><input class="input" minlength="5" bind:value={requirementReason} placeholder="Contoh: penjualan akhir pekan naik"/></label>
        </div><div class="form-actions"><button class="btn btn-secondary" type="button" on:click={resetRequirement}>Bersihkan</button><button class="btn btn-primary" disabled={savingRequirement || !!requirementPending || !!requirementConflict}>{savingRequirement ? 'Menyimpan…' : requirementEditing ? 'Simpan perubahan' : 'Simpan kebutuhan'}</button></div></fieldset></form>
        {#if requirementPending}<div class="retry" role="alert"><strong>Permintaan belum memiliki hasil pasti.</strong><span>Key dan payload asli disimpan khusus untuk akun ini.</span><button class="btn btn-secondary" type="button" disabled={savingRequirement} on:click={() => void saveRequirement(true)}>Coba lagi permintaan yang sama</button></div>{/if}
      </section>
      <section class="panel"><div class="panel-heading"><div><h2>Interval yang tersimpan</h2><p>Daftar disaring menurut outlet di atas.</p></div><button class="btn btn-secondary" type="button" on:click={() => void refreshRequirements()} disabled={requirementsLoading}>{requirementsLoading ? 'Memuat…' : 'Muat ulang'}</button></div>
        {#if matchedRequirements.length}<div class="requirement-list">{#each matchedRequirements as row (row.id)}<button type="button" class="requirement-row" on:click={() => editRequirement(row)}><span><strong>{weekdayLabels[row.weekday]}</strong><small>{localTime(row.startsAt)}–{localTime(row.endsAt)} WIB · minimum {row.minimum} kasir</small></span><span><small>Berlaku {dateLabel(row.effectiveFrom)}{row.effectiveUntil ? `–${dateLabel(row.effectiveUntil)}` : ' seterusnya'}</small><small>Revisi {row.revision}</small></span></button>{/each}</div>{:else}<EmptyState icon="calendar" title="Belum ada interval" description="Tambahkan kebutuhan waktu agar cakupan tidak dinilai hanya dari jumlah shift."/>{/if}
      </section>
    </section>
  {:else}<aside class="notice muted" role="note"><Icon name="shield" size={18}/><div><strong>Konfigurasi belum diberikan</strong><p>Anda dapat meninjau cakupan sesuai izin. Penambahan atau perubahan kebutuhan interval memerlukan capability Konfigurasi cakupan pada outlet yang relevan.</p></div></aside>{/if}

{:else if tab === 'middle'}
  <section class="panel controls"><label class="field">Outlet<select class="select" bind:value={middleOutletId} on:change={() => { middleAssignmentId = ''; middlePending = null; }} >{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label><label class="field">Tanggal kerja (WIB)<input class="input" type="date" bind:value={middleDate} on:change={() => { middleAssignmentId = ''; middlePending = null; }}/></label></section>
  <section class="planning-grid middle-grid">
    <section class="panel"><div class="panel-heading"><div><h2>Penugasan Middle</h2><p>Middle tidak diasumsikan punya jam. Masukkan interval tepat 8 jam termasuk istirahat.</p></div></div>
      {#if activeMiddleAssignments.length}<div class="middle-list">{#each activeMiddleAssignments as assignment}<button class:selected={assignment.id === middleAssignmentId} type="button" on:click={() => { middleAssignmentId = assignment.id; chooseMiddle(); }}><span><strong>{employeeName(assignment.employeeId)}</strong><small>{assignment.workDate} · {outletName(assignment.outletId)}</small></span><span>{#if assignment.plannedStartsAt}<StatusPill label={planLabel(assignment)} tone="green"/>{:else}<StatusPill label="Belum ada jam" tone="amber"/>{/if}</span></button>{/each}</div>{:else}<EmptyState icon="clock" title="Tidak ada penugasan Middle aktif" description="Tambahkan penugasan Middle pada jadwal kasir terlebih dahulu."/>{/if}
    </section>
    <section class="panel middle-form"><h2>Jam rencana Middle</h2>{#if selectedMiddle}<p class="hint">{employeeName(selectedMiddle.employeeId)} · versi jadwal {localDateTime(selectedMiddle.updatedAt)}. Setelah ada absensi, perubahan waktu harus memakai jalur koreksi.</p>{#if middleConflict}<div class="conflict" role="alert"><strong>Jadwal Middle berubah di sesi lain</strong><p>Jam dan alasan yang Anda masukkan tetap tersimpan di halaman ini. Tinjau perubahan sebelum memakai revisi terbaru atau memilih data server.</p><div><button class="btn btn-secondary" type="button" on:click={chooseMiddle}>Gunakan jadwal server</button><button class="btn btn-primary" type="button" on:click={reviewMiddleConflict}>Pertahankan isian & gunakan revisi terbaru</button></div></div>{/if}<form on:submit|preventDefault={() => void saveMiddlePlan()}><fieldset class="form-fields" disabled={savingMiddle || !!middlePending || !!middleConflict}><div class="form-grid"><label class="field">Mulai (WIB)<input class="input" type="time" bind:value={middleStart} required/></label><label class="field">Selesai (WIB)<input class="input" type="time" bind:value={middleEnd} required/></label><label class="field wide">Alasan penetapan<input class="input" minlength="5" bind:value={middleReason} placeholder="Contoh: kebutuhan layanan outlet" required/></label></div><p class:invalid={middleDuration !== 480} class="duration"><strong>{middleDuration == null ? 'Masukkan jam' : `${Math.floor(middleDuration / 60)} jam ${middleDuration % 60 ? `${middleDuration % 60} menit` : ''}`}</strong> · harus tepat 8 jam termasuk istirahat.{#if middleEnd <= middleStart && middleDuration === 480} Berakhir pada hari berikutnya.{/if}</p><div class="form-actions"><button class="btn btn-primary" disabled={savingMiddle || !!middlePending || !!middleConflict}>{savingMiddle ? 'Menyimpan…' : 'Simpan jam Middle'}</button></div></fieldset></form>{#if middlePending}<div class="retry" role="alert"><strong>Permintaan belum memiliki hasil pasti.</strong><span>Key dan payload asli tetap terikat pada akun serta penugasan ini.</span><button class="btn btn-secondary" type="button" disabled={savingMiddle} on:click={() => void saveMiddlePlan(true)}>Coba lagi permintaan yang sama</button></div>{/if}{:else}<div class="empty-form"><Icon name="clock" size={28}/><p>Pilih penugasan Middle di sebelah kiri.</p></div>{/if}</section>
  </section>
  <aside class="notice muted" role="note"><Icon name="file" size={18}/><div><strong>Jejak keputusan tetap dipertahankan</strong><p>Server memeriksa versi jadwal, alasan, dan interval 8 jam dalam satu transaksi. Jika jadwal berubah di sesi lain, muat ulang lalu tinjau data terbaru sebelum membuat permintaan baru.</p></div></aside>

{:else if canViewReports}
  <section class="panel report-controls"><div class="period-presets" aria-label="Rentang laporan cepat"><span>Rentang cepat</span><button class="btn btn-secondary" type="button" on:click={useThisWeek}>Minggu ini (Senin–Minggu)</button><button class="btn btn-secondary" type="button" on:click={useThisMonth}>Bulan kalender ini</button></div><div class="form-grid"><label class="field">Dari tanggal (WIB)<input class="input" type="date" bind:value={reportFrom} max={reportTo}/></label><label class="field">Sampai tanggal (WIB)<input class="input" type="date" bind:value={reportTo} min={reportFrom}/></label><label class="field">Outlet<select class="select" bind:value={reportOutletId}><option value="">Semua outlet yang diizinkan</option>{#each activeOutlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label>{#if admin}<label class="field">Karyawan <span class="optional">opsional</span><select class="select" bind:value={reportEmployeeId}><option value="">Semua karyawan</option>{#each $app.employees.filter((employee) => employee.status === 'active') as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label>{/if}</div><div class="form-actions"><span class="hint">Maksimal 63 hari. Data mengikuti akses Anda saat laporan dimuat.</span><button class="btn btn-primary" type="button" on:click={() => void loadReport()} disabled={reportLoading}>{reportLoading ? 'Memuat…' : 'Buat laporan'}</button></div></section>
  {#if report}
    <div class="metrics report-metrics"><MetricCard label="Hari dijadwalkan" value={report.summary.scheduledDays} detail={`${report.summary.attendanceDays} hari memiliki absensi`} icon="calendar"/><MetricCard label="Keterlambatan" value={`${report.summary.lateMinutes} menit`} detail={`${report.summary.corrections} permintaan koreksi`} icon="clock"/><MetricCard label="Cakupan perlu perhatian" value={report.summary.coverageShortageIntervals + report.summary.coverageUnconfiguredDays} detail={`${report.summary.coverageShortageIntervals} kurang · ${report.summary.coverageUnconfiguredDays} belum dikonfigurasi`} icon="alert" accent={(report.summary.coverageShortageIntervals + report.summary.coverageUnconfiguredDays) > 0}/></div>
    <section class="panel table-panel"><div class="panel-heading"><div><h2>Ringkasan periode</h2><p>{report.basis}</p></div><button class="btn btn-secondary" type="button" on:click={exportReportCsv}><Icon name="download" size={16}/>Ekspor CSV</button></div><div class="summary-grid"><div><span>Cuti penuh disetujui</span><strong>{report.summary.approvedFullLeaveDays} hari</strong></div><div><span>Izin parsial disetujui</span><strong>{report.summary.approvedPartialLeaveDays} hari</strong></div><div><span>Middle tanpa jam</span><strong>{report.summary.coverageUnknownMiddleAssignments}</strong></div>{#if report.summary.followupsOpenNow != null}<div><span>Kasus terbuka saat ini</span><strong>{report.summary.followupsOpenNow}</strong><small>{report.summary.followupsOverdueNow ?? 0} lewat tenggat</small></div>{/if}</div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Outlet</th><th>Karyawan</th><th>Shift</th><th>Absensi</th><th>Cuti/izin</th><th>Terlambat</th><th>Koreksi</th></tr></thead><tbody>{#each reportDetails as row}<tr><td>{dateLabel(row.workDate)}</td><td>{outletName(row.outletId)}</td><td>{row.employeeId ? employeeName(row.employeeId) : 'Disamarkan oleh akses'}</td><td>{row.shift}</td><td><StatusPill label={row.attendanceRecorded ? 'Tercatat' : 'Belum tercatat'} tone={row.attendanceRecorded ? 'green' : 'amber'}/></td><td>{#if row.fullLeave}<StatusPill label="Cuti penuh" tone="blue"/>{:else if row.partialLeave}<StatusPill label="Izin parsial" tone="blue"/>{:else}—{/if}</td><td>{row.lateMinutes ? `${row.lateMinutes} menit` : '—'}</td><td>{row.corrections || '—'}</td></tr>{/each}</tbody></table></div><p class="legend">Dibuat {localDateTime(report.asOf)}. Backlog tindak lanjut menunjukkan status saat ini, bukan rekonstruksi status pada tanggal lampau.</p></section>
    <aside class="notice muted" role="note"><Icon name="shield" size={18}/><div><strong>Ekspor CSV aman untuk kebutuhan operasional</strong><p>File berisi hanya kolom ringkasan yang tampak pada laporan ini. Tidak menyertakan selfie, GPS, tautan dokumen, nomor telepon, atau bukti pribadi. Sel yang dapat dianggap rumus spreadsheet dilindungi saat diekspor.</p></div></aside>
  {:else}<EmptyState icon="file" title="Siapkan ringkasan periode" description="Pilih rentang maksimal 63 hari lalu buat laporan. Akses dan identitas karyawan tetap dibatasi oleh server."/>{/if}
{:else}
  <section class="panel access-loading"><Icon name="shield" size={20}/><div><strong>Hak laporan belum diberikan</strong><p>Anda masih dapat meninjau cakupan atau mengatur kebutuhan yang menjadi cakupan Anda. Ringkasan periode memerlukan capability Ringkasan agar data personel tidak terbuka melampaui kewenangan.</p></div></section>
{/if}

<style>
  .tabs{display:flex;gap:.5rem;overflow:auto;margin:0 0 1rem;padding:.55rem;border-radius:16px;background:var(--surface);box-shadow:var(--inset)}
  .tabs button{border:0;border-radius:12px;background:transparent;color:var(--muted);padding:.72rem .9rem;white-space:nowrap;font:inherit;font-size:.72rem;cursor:pointer;min-height:42px}
  .tabs button.active{background:var(--yellow-soft);color:var(--ink);box-shadow:var(--raised-sm);font-weight:700}
  .controls{display:flex;gap:.8rem;align-items:end;flex-wrap:wrap;margin-bottom:1.1rem}.controls .field{min-width:210px;flex:1}.controls .btn{min-height:44px}
  .field{display:grid;gap:.42rem;color:var(--muted);font-size:.68rem}.optional{font-weight:400;color:var(--muted);font-size:.61rem}.panel{margin:1.15rem 0}.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1rem}.panel-heading h2,.middle-form h2{font-size:.96rem;color:var(--ink);margin:0 0 .38rem}.panel-heading p,.hint{font-size:.68rem;line-height:1.65;color:var(--muted);margin:0}.panel-heading>small{font-size:.61rem;color:var(--muted);white-space:nowrap}
  .metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1rem 0}.table-panel{padding:0;overflow:hidden}.table-panel .panel-heading{padding:1.1rem 1.2rem 0}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:.92rem 1rem;border-bottom:1px solid var(--border);font-size:.74rem;white-space:nowrap}th{background:var(--yellow-soft);font-size:.61rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}td small{display:block;font-size:.61rem;color:var(--muted);margin-top:.3rem;max-width:230px;white-space:normal;line-height:1.45}tr.shortage td{background:#fff8e6}.legend{font-size:.64rem;line-height:1.65;color:var(--muted);padding:0 1.2rem 1.1rem;margin:1rem 0 0}
  .notice{display:flex;gap:.72rem;padding:.9rem 1rem;border:1px solid #dacb97;background:#f7f0d6;border-radius:14px;color:#62562d;margin:1rem 0}.notice :global(svg){flex:0 0 auto;margin-top:.15rem}.notice strong{display:block;font-size:.75rem;color:var(--ink)}.notice p{font-size:.67rem;line-height:1.65;margin:.3rem 0 0}.notice.warning{background:#fff0cc;border-color:#dbb768}.notice.muted{background:var(--surface);border-color:var(--panel-border);color:var(--muted)}
  .access-loading{display:flex;gap:.8rem;align-items:flex-start;padding:1.15rem}.access-loading :global(svg){color:var(--accent);flex:0 0 auto}.access-loading strong{display:block;font-size:.79rem;color:var(--ink)}.access-loading p{font-size:.67rem;line-height:1.6;color:var(--muted);margin:.35rem 0 0}.form-fields{border:0;padding:0;margin:0;min-width:0}.conflict{margin:0 0 1rem;padding:.85rem;border:1px solid #d6ae62;border-radius:13px;background:#fff3cf;color:#624918}.conflict strong{font-size:.73rem}.conflict p{font-size:.65rem;line-height:1.55;color:var(--muted);margin:.35rem 0 .7rem}.conflict div{display:flex;gap:.5rem;flex-wrap:wrap}.period-presets{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;margin-bottom:1rem}.period-presets>span{font-size:.66rem;color:var(--muted);margin-right:.15rem}.period-presets .btn{min-height:36px;font-size:.65rem}
  .planning-grid{display:grid;grid-template-columns:minmax(360px,1.05fr) minmax(310px,.95fr);gap:1.1rem;align-items:start}.planning-grid>.panel{margin:0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.85rem}.wide{grid-column:1/-1}.form-actions{display:flex;justify-content:flex-end;align-items:center;gap:.65rem;flex-wrap:wrap;margin-top:1rem}.requirement-form{padding:1.15rem}.requirement-list{display:grid;gap:.55rem}.requirement-row,.middle-list>button{display:flex;justify-content:space-between;gap:.8rem;text-align:left;width:100%;border:1px solid var(--panel-border);background:var(--surface);box-shadow:var(--raised-sm);border-radius:13px;padding:.8rem;color:var(--muted);font:inherit;cursor:pointer}.requirement-row:hover,.middle-list>button:hover{border-color:#d3b44e}.requirement-row strong,.middle-list strong{font-size:.74rem;color:var(--ink);display:block}.requirement-row small,.middle-list small{font-size:.62rem;line-height:1.55;display:block}.requirement-row>span:last-child{text-align:right}.retry{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-top:1rem;padding:.75rem;border-radius:12px;background:#fff0cc;border:1px solid #d9b363;font-size:.65rem;color:#684f21}.retry strong{font-size:.68rem}.retry .btn{margin-left:auto}
  .middle-grid{grid-template-columns:minmax(280px,.75fr) minmax(340px,1.25fr)}.middle-list{display:grid;gap:.55rem}.middle-list>button.selected{border-color:#be9a25;background:#fff7d8;box-shadow:var(--inset)}.middle-list>button>span:last-child{align-self:center}.middle-form{padding:1.15rem}.duration{margin:1rem 0 0;font-size:.68rem;color:var(--muted)}.duration.invalid{color:#9a482e}.empty-form{min-height:210px;display:grid;place-content:center;justify-items:center;gap:.6rem;color:var(--muted);font-size:.7rem;text-align:center}
  .report-controls{padding:1.15rem}.report-controls .form-actions{justify-content:space-between}.report-metrics{margin-top:1.1rem}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.summary-grid>div{background:var(--surface);padding:1rem}.summary-grid span,.summary-grid small{display:block;font-size:.62rem;color:var(--muted)}.summary-grid strong{display:block;color:var(--ink);font-size:.88rem;margin-top:.35rem}
  @media(max-width:900px){.planning-grid,.middle-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.summary-grid{grid-template-columns:1fr 1fr}.controls{display:grid;grid-template-columns:1fr 1fr}.controls .field{min-width:0}.controls .btn{grid-column:1/-1}.report-controls .form-actions{align-items:flex-start}.panel-heading{flex-wrap:wrap}}
  @media(max-width:600px){.metrics{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.wide{grid-column:auto}.controls{grid-template-columns:1fr}.controls .btn{grid-column:auto}.panel{padding:1rem}.table-panel{padding:0}.table-panel .panel-heading{padding:1rem 1rem 0}.tabs{padding:.4rem}.tabs button{font-size:.67rem;padding:.65rem .7rem}.summary-grid{grid-template-columns:1fr 1fr}.requirement-row,.middle-list>button{align-items:flex-start;flex-direction:column}.requirement-row>span:last-child{text-align:left}.retry .btn{margin-left:0;width:100%}.form-actions .hint{width:100%}th,td{padding:.8rem}}
</style>
