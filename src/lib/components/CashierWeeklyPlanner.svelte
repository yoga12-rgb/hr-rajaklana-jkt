<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { app, actions, isCashier } from '#lib/state/app';
  import type { CashierRosterChange, Shift } from '#lib/types';
  import { addWorkDays, previewPreviousWeekCopy, startOfWorkWeek, validateRosterBatch, workWeekDates, workWeekLabel } from '#lib/cashier-spv';
  import { todayJakarta, dateLabel } from './format';
  import Feedback from './Feedback.svelte';
  import StaffingRequirementEditor from './StaffingRequirementEditor.svelte';

  type Draft = { shift: Shift | 'off' | ''; outletId: string };
  let weekStart = startOfWorkWeek(todayJakarta()), drafts: Record<string, Draft> = {}, reason = '', message = '', failed = false, saving = false;
  let copyPreview: ReturnType<typeof previewPreviousWeekCopy> | null = null, copySkippedDrafts = 0;
  let idempotencyFingerprint = '', idempotencyKey = '';
  afterNavigate(() => {
    const requested = new URLSearchParams(window.location.search).get('week');
    if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) { weekStart = startOfWorkWeek(requested); drafts = {}; copyPreview = null; }
  });
  $: days = workWeekDates(weekStart);
  $: cashiers = $app.employees.filter(employee => employee.status === 'active' && isCashier(employee));
  $: today = todayJakarta();
  const key = (employeeId: string, day: string) => `${employeeId}:${day}`;
  const existingFor = (employeeId: string, day: string) => ($app.cashierAssignments ?? []).find(row => row.employeeId === employeeId && row.workDate === day);
  function cell(employeeId: string, day: string, currentDrafts: Record<string, Draft> = drafts): Draft {
    const existing = existingFor(employeeId, day);
    const activeDraft = currentDrafts[key(employeeId, day)];
    if (activeDraft) return activeDraft;
    return { shift: existing?.status === 'active' ? existing.shift : '', outletId: existing?.outletId ?? $app.employees.find(employee => employee.id === employeeId)?.outletId ?? '' };
  }
  const dayName = (day: string) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const shiftName = (shift: string) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle', off: 'Libur' }[shift] ?? 'Belum diatur');
  function changeCell(employeeId: string, day: string, field: keyof Draft, value: string) {
    if (day < today) return;
    const current = cell(employeeId, day);
    drafts = { ...drafts, [key(employeeId, day)]: { ...current, [field]: value } };
    idempotencyFingerprint = ''; idempotencyKey = '';
  }
  function buildChanges(currentDrafts: Record<string, Draft> = drafts): CashierRosterChange[] {
    const changes: CashierRosterChange[] = [];
    for (const employee of cashiers) for (const day of days) {
      if (day < today) continue;
      const draft = currentDrafts[key(employee.id, day)]; if (!draft) continue;
      const current = existingFor(employee.id, day);
      if (draft.shift === '') {
        if (current?.status === 'active') changes.push({ id: current.id, employeeId: employee.id, workDate: day, outletId: current.outletId,
          shift: current.shift, reason, expectedUpdatedAt: current.updatedAt, cancel: true });
        continue;
      }
      if (current?.status === 'active' && current.shift === draft.shift && current.outletId === draft.outletId) continue;
      changes.push({ id: current?.id, employeeId: employee.id, workDate: day, outletId: draft.outletId,
        shift: draft.shift, reason, expectedUpdatedAt: current?.updatedAt ?? null });
    }
    return changes;
  }
  $: changes = buildChanges(drafts);
  $: conflicts = changes.flatMap(change => {
    try { validateRosterBatch($app, $app.user?.id ?? '', weekStart, [{ ...change, reason: 'Pratinjau jadwal' }]); return []; }
    catch (error) { const employee = cashiers.find(item => item.id === change.employeeId); return [`${employee?.fullName ?? 'Kasir'} · ${dateLabel(change.workDate)}: ${error instanceof Error ? error.message : 'Konflik jadwal'}`]; }
  });
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
      next[cellKey] = { shift: change.shift, outletId: change.outletId };
    }
    drafts = next; copySkippedDrafts = skipped; idempotencyFingerprint = ''; idempotencyKey = '';
  }
  async function save() {
    if (saving || !changes.length) return;
    saving = true; message = ''; failed = false;
    try {
      validateRosterBatch($app, $app.user?.id ?? '', weekStart, changes.map(change => ({ ...change, reason: reason.trim() })));
      const payload = JSON.stringify({ weekStart, changes: changes.map(change => ({ ...change, reason: reason.trim() })) });
      if (payload !== idempotencyFingerprint || !idempotencyKey) { idempotencyFingerprint = payload; idempotencyKey = crypto.randomUUID(); }
      const result = await actions.saveCashierRosterBatch(weekStart, changes.map(change => ({ ...change, reason: reason.trim() })), idempotencyKey);
      message = `${result.saved_count} perubahan jadwal tersimpan bersama.`; drafts = {}; reason = ''; copyPreview = null; idempotencyFingerprint = ''; idempotencyKey = '';
    } catch (error) { failed = true; message = error instanceof Error ? error.message : 'Batch jadwal belum tersimpan.'; }
    finally { saving = false; }
  }
  function moveWeek(offset: number) { weekStart = addWorkDays(weekStart, offset * 7); drafts = {}; copyPreview = null; idempotencyFingerprint = ''; idempotencyKey = ''; }
</script>

<section class="weekly-planner">
  <div class="planner-heading"><div><span class="eyebrow">PENUGASAN KASIR</span><h2>Jadwal mingguan</h2><p>{workWeekLabel(weekStart)} · waktu kerja WIB</p></div><div class="week-nav"><button class="btn btn-secondary" type="button" on:click={() => moveWeek(-1)}>Minggu sebelumnya</button><button class="btn btn-secondary" type="button" on:click={() => { weekStart = startOfWorkWeek(today); drafts = {}; copyPreview = null; }}>Minggu ini</button><button class="btn btn-secondary" type="button" on:click={() => moveWeek(1)}>Minggu berikutnya</button></div></div>
  <Feedback {message} error={failed}/>
  <p class="notice">Jadwal lampau hanya dapat dilihat. Libur tetap adalah saran; jadwal tidak dibuat otomatis. Perubahan berbenturan, jadwal usang, atau tanggal dengan absensi akan ditolak sebelum disimpan.</p>
  <div class="copy-tools"><button class="btn btn-secondary" type="button" on:click={showCopyPreview}>Pratinjau salin minggu sebelumnya</button>{#if copyPreview}<div class="copy-summary"><strong>Salin {copyPreview.sourceWeek} → {copyPreview.targetWeek}</strong><span>{copyPreview.changes.length} sel baru · {copyPreview.skipped} target sudah terisi{copyPreview.conflicts.length ? ` · ${copyPreview.conflicts.length} perlu diperiksa` : ''}{copySkippedDrafts ? ` · ${copySkippedDrafts} draft lokal dilewati` : ''}</span>{#if copyPreview.conflicts.length}<ul>{#each copyPreview.conflicts.slice(0,5) as conflict}<li>{conflict}</li>{/each}</ul>{/if}{#if copyPreview.changes.length}<button class="btn btn-primary" type="button" on:click={applyCopyPreview}>Terapkan sel kosong ke grid</button>{/if}</div>{/if}</div>
  {#if cashiers.length}
    <div class="table-scroll"><table class="week-grid"><thead><tr><th class="employee-col">Kasir</th>{#each days as day}<th><strong>{dayName(day)}</strong><small>{dateLabel(day)}</small></th>{/each}</tr></thead><tbody>
      {#each cashiers as employee (employee.id)}<tr><th class="employee-cell"><strong>{employee.fullName}</strong><small>{employee.employeeNumber}</small></th>{#each days as day (day)}{@const current = cell(employee.id, day, drafts)}{@const original = existingFor(employee.id, day)}{@const fixedOff = employee.weeklyOffDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())}<td class:readonly={day < today}>
        {#if day < today}<strong class="read-only-value">{shiftName(current.shift)}</strong><small>{current.shift ? ($app.outlets.find(outlet => outlet.id === current.outletId)?.name ?? '—') : fixedOff ? 'Libur tetap · belum dijadwalkan' : 'Belum dijadwalkan'}</small>
        {:else}<select class="select shift-select" aria-label={`Shift ${employee.fullName}, ${dateLabel(day)}`} value={current.shift} on:change={(event) => changeCell(employee.id, day, 'shift', event.currentTarget.value)}><option value="">Belum ditugaskan</option><option value="morning">Pagi</option><option value="afternoon">Sore</option>{#if employee.canMiddleShift}<option value="middle">Middle</option>{/if}<option value="off">Libur</option></select>
          {#if current.shift}<select class="select outlet-select" aria-label={`Outlet ${employee.fullName}, ${dateLabel(day)}`} value={current.outletId} on:change={(event) => changeCell(employee.id, day, 'outletId', event.currentTarget.value)}>{#each $app.outlets.filter(outlet => outlet.active || outlet.id === current.outletId) as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select>{:else if fixedOff}<small class="off-hint">Libur tetap · saran</small>{/if}
          {#if original?.status === 'cancelled' && current.shift}<small class="cancelled-hint">Aktifkan kembali jadwal batal</small>{/if}
        {/if}
      </td>{/each}</tr>{/each}
    </tbody></table></div>
  {:else}<p class="empty">Belum ada kasir aktif untuk dijadwalkan.</p>{/if}
  <div class="save-row"><label class="field">Alasan perubahan batch<input class="input" bind:value={reason} maxlength="2000" placeholder="Contoh: jadwal mingguan dikonfirmasi SPV"/></label><div class="save-info"><strong>{changes.length} perubahan</strong>{#if conflicts.length}<span class="conflicts">{conflicts.length} konflik harus diperbaiki</span>{:else}<span>Setiap baris akan disimpan dalam satu transaksi</span>{/if}<button class="btn btn-primary" type="button" disabled={saving || !changes.length || reason.trim().length < 5 || conflicts.length > 0} on:click={save}>{saving ? 'Menyimpan semua…' : 'Simpan jadwal mingguan'}</button></div></div>
  {#if reason.trim().length > 0 && reason.trim().length < 5}<p class="validation-hint">Alasan perubahan minimal 5 karakter.</p>{/if}
  {#if warnings.length}<ul class="warnings">{#each [...new Set(warnings)].slice(0,6) as warning}<li>{warning}</li>{/each}</ul>{/if}

  <StaffingRequirementEditor/>
</section>

<style>
  .weekly-planner{padding:0 0 1.1rem}.planner-heading{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1.3rem 1.4rem}.eyebrow{font-size:.62rem;letter-spacing:.12em;color:var(--accent);font-weight:700}.planner-heading h2{font-size:1rem;margin:.35rem 0}.planner-heading p{font-size:.7rem;color:var(--muted);margin:0}.week-nav{display:flex;flex-wrap:wrap;gap:.45rem}.week-nav .btn{font-size:.65rem;min-height:40px;padding:.55rem .7rem}.notice{margin:0 1.3rem .9rem;padding:.8rem;border:1px solid var(--panel-border);border-radius:13px;background:var(--yellow-soft);font-size:.68rem;line-height:1.6;color:var(--ink)}.copy-tools{display:grid;gap:.55rem;padding:0 1.3rem .9rem}.copy-summary{display:grid;gap:.45rem;padding:.8rem;border:1px solid var(--panel-border);border-radius:14px;background:var(--surface)}.copy-summary strong{font-size:.72rem}.copy-summary span,.copy-summary li{font-size:.66rem;color:var(--muted)}.copy-summary ul{margin:0;padding-left:1.1rem}.table-scroll{width:100%;overflow:auto;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.week-grid{min-width:1120px;width:100%;border-collapse:separate;border-spacing:0;text-align:left}.week-grid th,.week-grid td{padding:.6rem;vertical-align:top;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--surface)}.week-grid thead th{position:sticky;top:0;z-index:2;background:var(--yellow-soft);font-size:.67rem}.week-grid thead th strong,.week-grid thead th small{display:block}.week-grid thead th small{font-weight:400;color:var(--muted);margin-top:.25rem}.week-grid .employee-col{min-width:160px;left:0;z-index:3}.employee-cell{position:sticky;left:0;z-index:1;min-width:160px;background:var(--surface-cream)!important}.employee-cell strong,.employee-cell small{display:block}.employee-cell strong{font-size:.68rem}.employee-cell small{font-size:.61rem;color:var(--muted);margin-top:.25rem}.week-grid td{min-width:138px;max-width:172px}.week-grid td.readonly{background:#f5f0df}.shift-select,.outlet-select{width:100%;min-width:0;min-height:39px;padding:.45rem;margin:.08rem 0;font-size:.63rem}.read-only-value{font-size:.67rem}.week-grid td small{display:block;font-size:.58rem;color:var(--muted);line-height:1.4;margin-top:.2rem}.off-hint{color:var(--accent)!important}.cancelled-hint{color:#8c4c31!important}.save-row{display:grid;grid-template-columns:minmax(240px,1fr) 1.2fr;align-items:end;gap:1rem;padding:1rem 1.3rem}.save-row .field{font-size:.68rem}.save-info{display:flex;align-items:center;justify-content:flex-end;gap:.7rem;flex-wrap:wrap}.save-info strong,.save-info span{font-size:.66rem}.save-info span{color:var(--muted)}.save-info .conflicts{color:#7b3d28;font-weight:700}.save-info .btn{min-height:44px}.empty{padding:1rem 1.3rem;font-size:.72rem;color:var(--muted)}.validation-hint,.warnings{margin:0 1.3rem .6rem;font-size:.66rem;color:#805012;line-height:1.5}.warnings{padding:.6rem 1.7rem;background:#fff5da;border-radius:11px}.warnings li{margin:.2rem 0}@media(max-width:850px){.planner-heading{align-items:flex-start;flex-direction:column}.save-row{grid-template-columns:1fr}.save-info{justify-content:space-between}}@media(max-width:620px){.week-nav{width:100%}.week-nav .btn{flex:1;font-size:.58rem}.save-info .btn{width:100%}.table-scroll{touch-action:pan-x}.employee-cell,.week-grid .employee-col{min-width:130px}.week-grid td{min-width:130px}}
</style>
