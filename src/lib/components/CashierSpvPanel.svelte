<script lang="ts">
  import { onMount } from 'svelte';
  import { app, actions, displayName, shiftLabel } from '#lib/state/app';
  import { cashierDayStatuses, operationalSignals, staffingCoverage } from '#lib/cashier-spv';
  import { todayJakarta, dateLabel } from './format';
  import { clearSavedFollowupDraft } from '#lib/spv-followup-drafts';
  import Feedback from './Feedback.svelte';
  let date = todayJakarta(), outletFilter = '', busy = '', message = '', failed = false, now = Date.now();
  let ownerDraft: Record<string, string> = {}, noteDraft: Record<string, string> = {}, resolutionDraft: Record<string, string> = {};
  $: coverage = staffingCoverage($app, date).filter(row => !outletFilter || row.outletId === outletFilter);
  $: dayStatuses = cashierDayStatuses($app, date, now).filter(row => !outletFilter || row.outletId === outletFilter);
  $: allSignals = operationalSignals($app, date);
  $: signals = allSignals.filter(item => !outletFilter || item.input.outletId === outletFilter);
  $: activeCaseKeys = new Set(allSignals.map(item => item.key));
  $: storedCases = ($app.spvFollowups ?? []).filter(row => row.workDate === date);
  $: openResolvedCases = storedCases.filter(row => row.status !== 'completed' && !activeCaseKeys.has(row.caseKey) && (!outletFilter || row.outletId === outletFilter));
  $: resolvedHistory = storedCases.filter(row => row.status === 'completed' && !activeCaseKeys.has(row.caseKey) && (!outletFilter || row.outletId === outletFilter));
  $: owners = $app.employees.filter(employee => employee.status === 'active' && employee.accountStatus === 'active' && employee.roles.includes('admin_hr'));
  const statusLabel = (status: string) => ({ new: 'Belum ditangani', in_progress: 'Diproses', completed: 'Selesai' }[status] ?? status);
  const shiftName = (shift: 'morning' | 'afternoon' | 'middle' | 'off') => shift === 'off' ? 'Libur' : shiftLabel(shift);
  const coverageLabel = (status: string) => ({ not_configured: 'Belum diatur', not_needed: 'Tidak membutuhkan kasir', shortage: 'Kurang kasir', needs_time_review: 'Perlu tinjauan jam', covered: 'Sesuai minimum' }[status] ?? status);
  const dayStatusLabel = (status: string) => ({ unassigned: 'Belum ditugaskan', off: 'Libur', leave: 'Cuti/izin disetujui', not_due: 'Belum waktunya masuk', flexible: 'Middle fleksibel', needs_confirmation: 'Perlu konfirmasi', working: 'Sedang bekerja', completed: 'Sudah pulang', needs_review: 'Perlu diperiksa' }[status] ?? status);
  onMount(() => { const timer = window.setInterval(() => now = Date.now(), 30_000); return () => window.clearInterval(timer); });
  async function start(key: string) {
    const item = signals.find(signal => signal.key === key); if (!item || busy) return;
    busy = key; message = ''; failed = false;
    try { await actions.startSpvFollowup(item.input); message = 'Tindak lanjut tersimpan dan siap ditangani.'; }
    catch (error) { failed = true; message = error instanceof Error ? error.message : 'Tindak lanjut belum tersimpan.'; }
    finally { busy = ''; }
  }
  async function update(id: string, status: 'new' | 'in_progress' | 'completed') {
    const item = storedCases.find(row => row.id === id); if (!item || busy) return;
    const submitted = { ownerId: ownerDraft[id] ?? item.ownerId, note: noteDraft[id] ?? item.note,
      resolutionNote: resolutionDraft[id] ?? item.resolutionNote };
    busy = id; message = ''; failed = false;
    try {
      await actions.updateSpvFollowup({ id, expectedRevision: item.revision, idempotencyKey: crypto.randomUUID(), status, ...submitted,
        dueAt: item.dueAt, reason: submitted.ownerId !== item.ownerId ? 'Penetapan PIC melalui panel harian' : '' });
      // A later Realtime row becomes the source of truth after this save. Clear
      // only the values we sent, so edits typed while the request was pending survive.
      ownerDraft = clearSavedFollowupDraft(ownerDraft, id, submitted.ownerId);
      noteDraft = clearSavedFollowupDraft(noteDraft, id, submitted.note);
      // In-progress updates intentionally keep resolution_note empty on the
      // server. Keep that unfinished resolution until completion saves it.
      resolutionDraft = clearSavedFollowupDraft(resolutionDraft, id, submitted.resolutionNote, status === 'completed');
      message = status === 'completed' ? 'Tindak lanjut selesai. Riwayat kehadiran tetap utuh.' : 'Tindak lanjut diperbarui.';
    } catch (error) { failed = true; message = error instanceof Error ? error.message : 'Tindak lanjut belum tersimpan.'; }
    finally { busy = ''; }
  }
  const issueLabel = (issue: string) => issue.replaceAll('_', ' ');
</script>

<section class="panel spv-panel" aria-labelledby="spv-panel-title">
  <div class="panel-heading"><div><span class="eyebrow">PEMANTAUAN KASIR</span><h2 id="spv-panel-title">Kesiapan outlet dan tindak lanjut</h2><p>Jadwal, kehadiran, dan kebutuhan minimum ditampilkan terpisah.</p></div>
    <div class="filters"><label class="field">Tanggal kerja (WIB)<input class="input" type="date" bind:value={date}/></label><label class="field">Outlet<select class="select" bind:value={outletFilter}><option value="">Semua outlet</option>{#each $app.outlets.filter(outlet => outlet.active) as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label></div>
  </div>
  <Feedback {message} error={failed}/>

  <div class="coverage-grid">
    {#each coverage as row (`${row.outletId}:${row.shift}`)}
      <article class="coverage-card">
        <div class="coverage-title"><strong>{row.outletName}</strong><span>{shiftName(row.shift)}</span></div>
        <span class="coverage-status" data-state={row.status}>{coverageLabel(row.status)}</span>
        <dl><div><dt>Minimum</dt><dd>{row.minimum === null ? '—' : row.minimum}</dd></div><div><dt>Terjadwal</dt><dd>{row.scheduled}</dd></div><div><dt>Tersedia</dt><dd>{row.available}</dd></div><div><dt>Tercatat hadir</dt><dd>{row.actual}</dd></div></dl>
        {#if row.absentOnApprovedFullDay}<p class="coverage-note">{row.absentOnApprovedFullDay} kasir cuti sehari penuh yang disetujui.</p>{/if}
        {#if row.pendingLeave}<p class="coverage-note">Ada {row.pendingLeave} izin atau perubahan yang masih menunggu.</p>{/if}
        {#if row.needsHourReview}<p class="coverage-note">{row.needsHourReview} izin sebagian jam perlu diperiksa sepanjang shift.</p>{/if}
      </article>
    {/each}
  </div>

  <details class="status-list"><summary>Status kasir pada tanggal ini ({dayStatuses.length})</summary><div class="status-rows">{#each dayStatuses as row (row.employee.id)}<div class="status-row"><strong>{row.employee.fullName}</strong><span>{$app.outlets.find(outlet => outlet.id === row.outletId)?.name ?? 'Outlet belum diatur'} · {row.shift === 'off' ? 'Libur' : row.shift ? shiftName(row.shift) : 'Belum ada shift'}</span><span class="status-label" data-state={row.status}>{dayStatusLabel(row.status)}</span><small>{row.detail}</small></div>{/each}</div></details>

  <div class="case-heading"><div><h3>Perlu perhatian · {dateLabel(date)}</h3><p>Kasus baru tidak mengubah absensi, cuti, atau status disiplin.</p></div><a class="btn btn-secondary" href={`/assignments?week=${date}`}>Buka jadwal mingguan</a></div>
  {#if signals.length || openResolvedCases.length}
    <div class="case-list">
      {#each signals as item (item.key)}
        {@const existing = storedCases.find(row => row.caseKey === item.key)}
        <article class="case-card" data-tone={item.tone}>
          <div class="case-main"><div><a href={item.href} class="case-title">{item.title}</a><p>{displayName(item.input.employeeId ?? '')} · {$app.outlets.find(outlet => outlet.id === item.input.outletId)?.name ?? 'Outlet'}{item.input.shift ? ` · ${shiftName(item.input.shift)}` : ''}</p><small>{item.detail}</small></div><span class="case-status">{existing ? statusLabel(existing.status) : 'Belum ditangani'}</span></div>
          {#if existing}
            <div class="case-actions">
              {#if existing.status === 'completed'}
                <p class="saved-note">Selesai · {existing.resolutionNote}</p><button class="btn btn-secondary" type="button" disabled={busy === item.key} on:click={() => start(item.key)}>Buka lagi</button>
              {:else}
                <label class="field">Penanggung jawab<select class="select" value={ownerDraft[existing.id] ?? existing.ownerId ?? ''} on:change={(event) => ownerDraft = { ...ownerDraft, [existing.id]: event.currentTarget.value }}><option value="">Pilih Admin HR</option>{#each owners as owner}<option value={owner.id}>{owner.fullName}</option>{/each}</select></label>
                <label class="field">Catatan tindak lanjut<textarea class="input" rows="2" value={noteDraft[existing.id] ?? existing.note} on:input={(event) => noteDraft = { ...noteDraft, [existing.id]: event.currentTarget.value }} placeholder="Opsional, tanpa mengubah data sumber"></textarea></label>
                {#if existing.status === 'in_progress'}<label class="field">Catatan penyelesaian<textarea class="input" rows="2" value={resolutionDraft[existing.id] ?? ''} on:input={(event) => resolutionDraft = { ...resolutionDraft, [existing.id]: event.currentTarget.value }} placeholder="Jelaskan tindakan yang sudah dilakukan"></textarea></label>{/if}
                <div class="case-buttons">
                  {#if existing.status === 'new'}<button class="btn btn-secondary" type="button" disabled={busy === existing.id || !(ownerDraft[existing.id] ?? existing.ownerId)} on:click={() => update(existing.id, 'in_progress')}>{busy === existing.id ? 'Menyimpan…' : 'Tetapkan & proses'}</button>
                  {:else}<button class="btn btn-secondary" type="button" disabled={busy === existing.id} on:click={() => update(existing.id, 'in_progress')}>Simpan catatan</button><button class="btn btn-primary" type="button" disabled={busy === existing.id} on:click={() => update(existing.id, 'completed')}>Selesaikan</button>{/if}
                </div>
              {/if}
            </div>
          {:else}<button class="btn btn-secondary" type="button" disabled={busy === item.key} on:click={() => start(item.key)}>{busy === item.key ? 'Menyimpan…' : 'Mulai tindak lanjut'}</button>{/if}
        </article>
      {/each}
      {#each openResolvedCases as item (item.id)}
        <article class="case-card" data-tone="amber" data-case-id={item.id}>
          <div class="case-main"><div><strong class="case-title">{issueLabel(item.issueType)}</strong><p>{displayName(item.employeeId ?? '')} · {$app.outlets.find(outlet => outlet.id === item.outletId)?.name ?? 'Outlet'}{item.shift ? ` · ${shiftName(item.shift)}` : ''}</p><small class="resolved-source">Kondisi sumber sudah teratasi atau tidak lagi aktif. Tindak lanjut tetap menunggu penyelesaian eksplisit.</small></div><span class="case-status">{statusLabel(item.status)}</span></div>
          <div class="case-actions">
            <label class="field">Penanggung jawab<select class="select" value={ownerDraft[item.id] ?? item.ownerId ?? ''} on:change={(event) => ownerDraft = { ...ownerDraft, [item.id]: event.currentTarget.value }}><option value="">Pilih Admin HR</option>{#each owners as owner}<option value={owner.id}>{owner.fullName}</option>{/each}</select></label>
            <label class="field">Catatan tindak lanjut<textarea class="input" rows="2" value={noteDraft[item.id] ?? item.note} on:input={(event) => noteDraft = { ...noteDraft, [item.id]: event.currentTarget.value }} placeholder="Opsional, tanpa mengubah data sumber"></textarea></label>
            {#if item.status === 'in_progress'}<label class="field">Catatan penyelesaian<textarea class="input" rows="2" value={resolutionDraft[item.id] ?? ''} on:input={(event) => resolutionDraft = { ...resolutionDraft, [item.id]: event.currentTarget.value }} placeholder="Jelaskan tindakan yang sudah dilakukan"></textarea></label>{/if}
            <div class="case-buttons">
              {#if item.status === 'new'}<button class="btn btn-secondary" type="button" disabled={busy === item.id || !(ownerDraft[item.id] ?? item.ownerId)} on:click={() => update(item.id, 'in_progress')}>{busy === item.id ? 'Menyimpan…' : 'Tetapkan & proses'}</button>
              {:else}<button class="btn btn-secondary" type="button" disabled={busy === item.id} on:click={() => update(item.id, 'in_progress')}>Simpan catatan</button><button class="btn btn-primary" type="button" disabled={busy === item.id} on:click={() => update(item.id, 'completed')}>Selesaikan</button>{/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  {:else}<p class="empty">Tidak ada indikator atau tindak lanjut terbuka pada tanggal ini.</p>{/if}

  {#if resolvedHistory.length}
    <details class="history"><summary>Riwayat tindak lanjut ({resolvedHistory.length})</summary>{#each resolvedHistory as item (item.id)}<div class="history-row"><strong>{statusLabel(item.status)} · {issueLabel(item.issueType)}</strong><span>{displayName(item.employeeId ?? '')} · {item.resolutionNote || item.note || 'Belum ada catatan'}</span></div>{/each}</details>
  {/if}
</section>

<style>
  .spv-panel{margin:0 0 1.2rem;padding:0;overflow:hidden}.panel-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;padding:1.3rem 1.4rem;border-bottom:1px solid var(--border)}.eyebrow{font-size:.62rem;letter-spacing:.12em;color:var(--accent);font-weight:700}.panel-heading h2{font-size:1rem;margin:.35rem 0}.panel-heading p,.case-heading p{font-size:.7rem;line-height:1.6;color:var(--muted);margin:0}.filters{display:flex;gap:.7rem}.field{display:grid;gap:.4rem;color:var(--muted);font-size:.68rem}.filters .field:first-child{width:170px}.filters .field:last-child{width:190px}.coverage-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;padding:1rem 1.2rem}.coverage-card{padding:.9rem;border:1px solid var(--panel-border);border-radius:16px;background:var(--surface);box-shadow:var(--raised-sm)}.coverage-title{display:flex;justify-content:space-between;gap:.5rem;font-size:.74rem}.coverage-title span{color:var(--muted)}.coverage-status,.case-status{display:inline-flex;margin-top:.55rem;padding:.28rem .55rem;border:1px solid var(--panel-border);border-radius:99px;background:#f5efd9;color:var(--ink);font-size:.63rem;font-weight:650}.coverage-status[data-state=shortage],.case-card[data-tone=red] .case-status{background:#ffeed9;border-color:#dfbc78}.coverage-status[data-state=covered]{background:#f0efd9}.coverage-card dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.35rem;margin:.7rem 0 0}.coverage-card dl div{min-width:0}.coverage-card dt{font-size:.58rem;color:var(--muted)}.coverage-card dd{font-size:.84rem;font-weight:700;margin:.18rem 0}.coverage-note{font-size:.62rem;line-height:1.5;color:var(--muted);margin:.45rem 0 0}.case-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.4rem;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.case-heading h3{font-size:.88rem;margin:0 0 .3rem}.case-heading .btn{white-space:nowrap}.case-list{display:grid;gap:.65rem;padding:1rem 1.2rem}.case-card{padding:.9rem 1rem;border:1px solid var(--panel-border);border-radius:15px;background:var(--surface);box-shadow:var(--raised-sm)}.case-main{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem}.case-title{font-size:.78rem;font-weight:700;color:var(--ink)}.case-main p{font-size:.66rem;color:var(--muted);margin:.35rem 0}.case-main small{display:block;font-size:.64rem;line-height:1.5;color:var(--muted);max-width:690px}.case-status{white-space:nowrap;margin-top:0}.case-actions{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:.65rem;margin-top:.8rem;padding-top:.75rem;border-top:1px solid var(--border)}.case-actions .field:nth-child(2),.case-actions .field:nth-child(3){grid-column:span 2}.case-actions .input{min-height:48px}.case-actions textarea{resize:vertical}.case-buttons{display:flex;justify-content:flex-end;gap:.5rem;grid-column:span 2}.saved-note{font-size:.67rem;color:var(--muted);line-height:1.5;margin:0;flex:1}.history{padding:0 1.3rem 1rem}.history summary{cursor:pointer;font-size:.7rem;color:var(--accent);padding:.55rem 0}.history-row{display:flex;justify-content:space-between;gap:.8rem;padding:.5rem 0;border-top:1px solid var(--border);font-size:.66rem}.history-row span{color:var(--muted);text-align:right}.empty{padding:1.1rem 1.3rem;color:var(--muted);font-size:.73rem}@media(max-width:900px){.coverage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.panel-heading{align-items:stretch;flex-direction:column}.filters{display:grid;grid-template-columns:1fr 1fr}.filters .field:first-child,.filters .field:last-child{width:auto}.coverage-grid{grid-template-columns:1fr;padding:.75rem}.case-heading{align-items:flex-start;flex-direction:column;padding:.9rem}.case-list{padding:.75rem}.case-actions{grid-template-columns:1fr}.case-actions .field:nth-child(2),.case-actions .field:nth-child(3),.case-buttons{grid-column:span 1}.case-buttons{justify-content:stretch}.case-buttons .btn{flex:1}.history-row{flex-direction:column}.history-row span{text-align:left}}
  .status-list{margin:0 1.2rem .2rem;border:1px solid var(--border);border-radius:13px;background:var(--surface)}.status-list summary{cursor:pointer;padding:.7rem .8rem;color:var(--accent);font-size:.68rem;font-weight:650}.status-rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;padding:.1rem .7rem .7rem}.status-row{display:grid;grid-template-columns:1fr auto;gap:.2rem .5rem;padding:.55rem;border-top:1px solid var(--border)}.status-row strong{font-size:.66rem}.status-row>span:not(.status-label),.status-row small{grid-column:1/-1;font-size:.61rem;color:var(--muted)}.status-label{font-size:.59rem;font-weight:650;color:var(--ink);text-align:right}.status-label[data-state=needs_review],.status-label[data-state=needs_confirmation],.status-label[data-state=unassigned]{color:#805012}.status-label[data-state=working],.status-label[data-state=completed]{color:#43532c}@media(max-width:650px){.status-list{margin:0 .75rem .2rem}.status-rows{grid-template-columns:1fr}}
</style>
