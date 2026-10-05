<script lang="ts">
  import { app, actions, isApprover, canDecideLeave, leaveBalance, displayName } from '#lib/state/app';
  import type { LeaveInput, LeaveRequest, LeaveDecision } from '#lib/types';
  import { deductionByYear } from '#lib/domain';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import MetricCard from '#lib/components/MetricCard.svelte';
  import StatusPill from '#lib/components/StatusPill.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Modal from '#lib/components/Modal.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import { dateLabel, timeLabel, todayJakarta, leaveTypeLabel, leaveStatusLabel, leaveTone } from '#lib/components/format';
  let tab: 'mine' | 'review' = 'mine', filter = '';
  let newOpen = false, selected: LeaveRequest | null = null, saving = false, message = '', failed = false;
  let adjustMode: 'change' | 'cancel' | null = null, changeStart = '', changeEnd = '', changeReason = '';
  let partialDay = false;
  let extent: 'late_arrival' | 'temporary_exit' | 'early_departure' = 'temporary_exit';
  let attachment: File | undefined;
  let form: LeaveInput = { type: 'annual', startDate: todayJakarta(), endDate: todayJakarta(), reason: '', startTime: '', endTime: '' };
  let decision: LeaveDecision = { decision: 'approve', deductionDays: 0, note: '', externalApproverName: '' };
  $: reviewer = isApprover($app.user);
  $: mine = $app.leaveRequests.filter((request) => request.employeeId === $app.user?.id);
  $: review = $app.leaveRequests.filter((request) => canDecideLeave(request));
  $: rows = (tab === 'mine' ? mine : review).filter((request) => !filter || request.status === filter).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $: currentSelected = selected ? $app.leaveRequests.find((r) => r.id === selected?.id) ?? selected : null;
  $: external = currentSelected ? $app.employees.find((e) => e.id === currentSelected?.employeeId)?.approvalMode === 'external' : false;
  $: allocation = currentSelected ? previewAllocation(currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.startDate || currentSelected.startDate : currentSelected.startDate, currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.endDate || currentSelected.endDate : currentSelected.endDate, decision.deductionDays) : {};

  function previewAllocation(start: string, end: string, total: number) { try { return deductionByYear(start, end, total); } catch { return {}; } }
  function hasHours(request: LeaveRequest) { return (request.extent && request.extent !== 'full_day') || !!(request.startTime || request.endTime); }
  function begin() { form = { type: 'annual', startDate: todayJakarta(), endDate: todayJakarta(), reason: '', startTime: '', endTime: '' }; partialDay = false; extent = 'temporary_exit'; attachment = undefined; newOpen = true; message = ''; }
  function selectAttachment(event: Event) { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (file && file.size > 5 * 1024 * 1024) { message = 'Ukuran lampiran maksimal 5 MB.'; failed = true; (event.currentTarget as HTMLInputElement).value = ''; attachment = undefined; return; } if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { message = 'Gunakan lampiran PDF, JPG, PNG, atau WebP.'; failed = true; (event.currentTarget as HTMLInputElement).value = ''; attachment = undefined; return; } attachment = file; }
  function hourLabel(request: LeaveRequest) { if (!request.startTime && !request.endTime) return ''; if (request.extent === 'late_arrival') return `Datang ${request.startTime}`; if (request.extent === 'early_departure') return `Pulang ${request.startTime || request.endTime}`; return request.endTime ? `${request.startTime}–${request.endTime}` : request.startTime; }
  function open(request: LeaveRequest) { selected = request; adjustMode = null; message = ''; decision = { decision: 'approve', deductionDays: request.deductionDays || 0, note: '', externalApproverName: '' }; }
  function adjustment(mode: 'change' | 'cancel') { if (!currentSelected) return; adjustMode = mode; changeStart = currentSelected.startDate; changeEnd = currentSelected.endDate; changeReason = mode === 'change' && currentSelected.status === 'needs_info' ? currentSelected.reason : ''; message = ''; }
  async function run(action: () => Promise<unknown>, success: string, close = false) { saving = true; message = ''; try { await action(); failed = false; message = success; if (close) { newOpen = false; adjustMode = null; selected = null; } } catch (error) { failed = true; message = error instanceof Error ? error.message : 'Pengajuan belum berhasil diproses.'; } finally { saving = false; } }
  async function submit() { if (!partialDay && form.endDate < form.startDate) { failed = true; message = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'; return; } if (partialDay && (!form.startTime || (extent === 'temporary_exit' && (!form.endTime || form.endTime <= form.startTime)))) { failed = true; message = 'Isi jam mulai dan selesai izin dengan benar.'; return; } await run(() => actions.submitLeave({ ...form, endDate: partialDay ? form.startDate : form.endDate, startTime: partialDay ? form.startTime : '', endTime: partialDay && extent === 'temporary_exit' ? form.endTime : '', extent: partialDay ? extent : 'full_day', attachment }), 'Pengajuan terkirim. Anda akan menerima pembaruan saat keputusan diberikan.', true); }
  async function decide() { if (!currentSelected) return; if (decision.decision !== 'approve' && (decision.note?.trim().length ?? 0) < 3) { failed = true; message = 'Tuliskan alasan penolakan atau informasi yang perlu dilengkapi, minimal 3 karakter.'; return; } if (external && (decision.externalApproverName?.trim().length ?? 0) < 3) { failed = true; message = 'Isi nama Bos / Manager Pusat yang memberikan keputusan, minimal 3 karakter.'; return; } await run(() => actions.decideLeave(currentSelected!.id, decision), 'Keputusan berhasil dicatat.', true); }
  async function submitAdjustment() {
    if (!currentSelected) return;
    if (changeReason.trim().length < 3) { failed = true; message = 'Alasan perubahan atau pembatalan minimal 3 karakter.'; return; }
    const endDate = hasHours(currentSelected) ? changeStart : changeEnd;
    if (adjustMode === 'change' && endDate < changeStart) { failed = true; message = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'; return; }
    if (adjustMode === 'change') await run(() => actions.changeLeave(currentSelected!.id, { startDate: changeStart, endDate, reason: changeReason }), currentSelected.status === 'approved' ? 'Perubahan tanggal diajukan. Tanggal lama tetap berlaku sampai disetujui.' : currentSelected.status === 'needs_info' ? 'Pengajuan dilengkapi dan dikirim kembali kepada atasan.' : 'Tanggal pengajuan diperbarui.', true);
    else await run(() => actions.cancelLeave(currentSelected!.id, changeReason), currentSelected.status === 'approved' ? 'Pembatalan diajukan. Menunggu keputusan atasan.' : 'Pengajuan dibatalkan.', true);
  }
  async function decideAdjustment(approved: boolean) {
    if (!currentSelected) return;
    if (!approved && (decision.note?.trim().length ?? 0) < 3) { failed = true; message = 'Tuliskan alasan penolakan minimal 3 karakter.'; return; }
    if (external && (decision.externalApproverName?.trim().length ?? 0) < 3) { failed = true; message = 'Isi nama pemberi keputusan eksternal, minimal 3 karakter.'; return; }
    const cancelling = currentSelected.adjustment?.type === 'cancel';
    await run(() => actions.decideAdjustment(currentSelected!.id, { decision: approved ? 'approve' : 'reject', deductionDays: decision.deductionDays, note: decision.note, externalApproverName: decision.externalApproverName }), approved ? cancelling ? 'Pembatalan disetujui. Potongan dikembalikan ke tahun asal.' : 'Perubahan disetujui dan saldo disesuaikan.' : 'Permintaan ditolak. Pengajuan sebelumnya tetap berlaku.', true);
  }
</script>

<PageHeading eyebrow="WAKTU UNTUK DIRI SENDIRI" title="Cuti & izin" description="Ajukan kebutuhan Anda, pantau keputusan, dan lihat saldo cuti."><button class="btn btn-primary" on:click={begin}><Icon name="plus" size={18}/>Buat pengajuan</button></PageHeading>
<div class="metrics"><MetricCard label="Saldo cuti Anda" value={`${$app.user ? leaveBalance($app.user.id) : 0} hari`} detail="Saldo tahun kalender berjalan" icon="calendar" accent/><MetricCard label="Menunggu keputusan" value={mine.filter((r) => r.status === 'pending' || r.status === 'needs_info' || r.adjustment?.status === 'pending').length} detail="Pengajuan Anda yang masih diproses" icon="clock"/><MetricCard label={reviewer ? 'Perlu Anda tinjau' : 'Pengajuan disetujui'} value={reviewer ? review.filter((r) => r.status === 'pending' || r.adjustment?.status === 'pending').length : mine.filter((r) => r.status === 'approved').length} detail={reviewer ? 'Pengajuan dan perubahan tanggal' : 'Cuti dan izin yang sudah disetujui'} icon={reviewer ? 'file' : 'check'}/></div>
<Feedback {message} error={failed}/>
<section class="panel request-panel"><div class="list-heading"><div class="tabs" role="tablist" aria-label="Pengajuan cuti"><button role="tab" aria-selected={tab === 'mine'} class:active={tab === 'mine'} on:click={() => tab = 'mine'}>Pengajuan saya</button>{#if reviewer}<button role="tab" aria-selected={tab === 'review'} class:active={tab === 'review'} on:click={() => tab = 'review'}>Persetujuan tim <span>{review.filter((r) => r.status === 'pending' || r.adjustment?.status === 'pending').length}</span></button>{/if}</div><select class="select" aria-label="Filter status pengajuan" bind:value={filter}><option value="">Semua status</option><option value="pending">Menunggu</option><option value="approved">Disetujui</option><option value="rejected">Ditolak</option><option value="needs_info">Perlu dilengkapi</option><option value="cancelled">Dibatalkan</option></select></div>
  {#if rows.length}<div class="requests">{#each rows as request}<button class="request" on:click={() => open(request)}><span class="request-symbol"><Icon name={request.type === 'annual' ? 'calendar' : request.type === 'sick' ? 'heart' : 'clock'} size={22}/></span><div class="request-info"><div class="request-title"><h3>{leaveTypeLabel[request.type]}</h3>{#if tab === 'review'}<span>{displayName(request.employeeId)}</span>{/if}</div><p>{dateLabel(request.startDate)}{request.endDate !== request.startDate ? ` – ${dateLabel(request.endDate)}` : ''}{request.startTime ? ` · ${hourLabel(request)}` : ''}</p><small>{request.reason}</small>{#if request.adjustment?.status === 'pending'}<span class="adjustment-tag">{request.adjustment.type === 'change' ? 'Perubahan tanggal menunggu keputusan' : 'Pembatalan menunggu keputusan'}</span>{/if}</div><div class="request-status"><StatusPill label={leaveStatusLabel[request.status]} tone={leaveTone(request.status)}/>{#if request.status === 'approved'}<small>{request.deductionDays ? `Potong ${request.deductionDays} hari` : 'Tanpa potong cuti'}</small>{/if}</div><span class="arrow"><Icon name="chevron" size={16}/></span></button>{/each}</div>{:else}<EmptyState icon="calendar" title={tab === 'mine' ? 'Belum ada pengajuan' : 'Semua sudah tertangani'} description={tab === 'mine' ? 'Saat membutuhkan cuti atau izin, buat pengajuan dari sini.' : 'Pengajuan tim yang dapat Anda proses akan muncul di sini.'}/>{/if}
</section><p class="policy"><Icon name="info" size={16}/>Hak cuti setelah 3 bulan kerja. Tahun pertama prorata; sisa saldo hangus setiap 31 Desember. Pemotongan mengikuti keputusan atasan.</p>

<Modal open={newOpen} title="Buat pengajuan" description="Atasan akan meninjau pengajuan dan menentukan dampaknya pada saldo cuti." onclose={() => newOpen = false}>
  <form on:submit|preventDefault={submit}><label class="field">Jenis pengajuan<select class="select" bind:value={form.type} on:change={() => partialDay = false}><option value="annual">Cuti tahunan</option><option value="personal">Izin pribadi</option><option value="sick">Izin sakit</option></select></label>{#if form.type !== 'annual'}<label class="check"><input type="checkbox" bind:checked={partialDay}/>Izin sebagian hari / beberapa jam</label>{/if}{#if partialDay}<label class="field reason">Jenis izin sebagian hari<select class="select" bind:value={extent}><option value="late_arrival">Datang terlambat</option><option value="temporary_exit">Keluar sementara</option><option value="early_departure">Pulang lebih awal</option></select></label>{/if}<div class="form-grid"><label class="field">{partialDay ? 'Tanggal izin' : 'Tanggal mulai'}<input class="input" type="date" bind:value={form.startDate} min={todayJakarta()} required/></label>{#if !partialDay}<label class="field">Tanggal selesai<input class="input" type="date" bind:value={form.endDate} min={form.startDate} required/></label>{:else}<label class="field">{extent === 'late_arrival' ? 'Rencana jam datang' : extent === 'early_departure' ? 'Jam pulang yang diminta' : 'Jam keluar'}<input class="input" type="time" bind:value={form.startTime} required/></label>{#if extent === 'temporary_exit'}<label class="field">Jam kembali<input class="input" type="time" bind:value={form.endTime} required/></label>{/if}{/if}</div><label class="field reason">Alasan<textarea class="textarea" rows="4" bind:value={form.reason} required placeholder="Ceritakan kebutuhan cuti atau izin Anda…"></textarea></label><label class="field reason">Lampiran (opsional)<input class="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" on:change={selectAttachment}/></label><p class="hint">{attachment ? `${attachment.name} · ${(attachment.size / 1024).toFixed(0)} KB` : 'PDF atau foto, maksimal 5 MB.'}</p><div class="info-box"><Icon name="calendar" size={18}/><span>Saldo Anda saat ini <strong>{$app.user ? leaveBalance($app.user.id) : 0} hari</strong>. Saldo berubah setelah pengajuan disetujui.</span></div><Feedback {message} error={failed}/><div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => newOpen = false}>Batal</button><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Mengirim…' : 'Kirim pengajuan'}</button></div></form>
</Modal>

<Modal open={currentSelected !== null} title={currentSelected ? leaveTypeLabel[currentSelected.type] : ''} description={currentSelected ? `Pengajuan ${displayName(currentSelected.employeeId)}` : ''} onclose={() => { selected = null; adjustMode = null; }}>
  {#if currentSelected}<div class="detail-status"><StatusPill label={leaveStatusLabel[currentSelected.status]} tone={leaveTone(currentSelected.status)}/><span>Diajukan {dateLabel(currentSelected.createdAt)}</span></div><dl class="details"><div><dt>Tanggal</dt><dd>{dateLabel(currentSelected.startDate)}{currentSelected.endDate !== currentSelected.startDate ? ` – ${dateLabel(currentSelected.endDate)}` : ''}</dd></div>{#if currentSelected.startTime}<div><dt>Jam izin</dt><dd>{hourLabel(currentSelected)} WIB</dd></div>{/if}<div><dt>Potongan saldo</dt><dd>{currentSelected.status === 'approved' ? currentSelected.deductionDays ? `${currentSelected.deductionDays} hari` : 'Tanpa potong cuti' : 'Ditentukan saat persetujuan'}</dd></div><div><dt>Pemberi keputusan</dt><dd>{currentSelected.externalApproverName || (currentSelected.approverId ? displayName(currentSelected.approverId) : external ? 'Bos / Manager Pusat (di luar aplikasi)' : 'Atasan langsung')}</dd></div><div class="span"><dt>Alasan pengajuan</dt><dd>{currentSelected.reason}</dd></div>{#if currentSelected.note}<div class="span"><dt>Catatan keputusan</dt><dd>{currentSelected.note}</dd></div>{/if}</dl>
    {#if currentSelected.attachmentUrl}<a class="btn btn-secondary attachment-link" href={currentSelected.attachmentUrl} target="_blank" rel="noopener noreferrer"><Icon name="file" size={16}/>Lihat lampiran</a>{/if}
    {#if currentSelected.adjustment}
      <section class="adjustment-box" aria-label="Perubahan atau pembatalan terakhir">
        <strong>{currentSelected.adjustment.status === 'pending' ? 'Permintaan' : 'Keputusan'} {currentSelected.adjustment.type === 'change' ? 'perubahan tanggal' : 'pembatalan'}</strong>
        {#if currentSelected.adjustment.type === 'change'}<p>Tanggal diminta: {dateLabel(currentSelected.adjustment.startDate || '')}{currentSelected.adjustment.endDate !== currentSelected.adjustment.startDate ? ` – ${dateLabel(currentSelected.adjustment.endDate || '')}` : ''}</p>{/if}
        <p>Alasan permintaan: {currentSelected.adjustment.reason}</p>
        <StatusPill label={currentSelected.adjustment.status === 'pending' ? 'Menunggu keputusan' : currentSelected.adjustment.status === 'approved' ? 'Disetujui' : 'Ditolak'} tone={currentSelected.adjustment.status === 'pending' ? 'amber' : currentSelected.adjustment.status === 'approved' ? 'green' : 'red'}/>
        {#if currentSelected.adjustment.status !== 'pending'}
          <p>{currentSelected.adjustment.status === 'rejected' ? 'Tanggal dan potongan sebelumnya tetap berlaku.' : currentSelected.adjustment.type === 'cancel' ? 'Pengajuan dibatalkan. Potongan dikembalikan ke tahun asal.' : 'Tanggal baru dan potongan telah diterapkan.'}</p>
          {#if currentSelected.adjustment.deciderName}<p>Pemberi keputusan: {currentSelected.adjustment.deciderName}</p>{/if}
          {#if currentSelected.adjustment.decidedAt}<p>Diputuskan {dateLabel(currentSelected.adjustment.decidedAt)} · {timeLabel(currentSelected.adjustment.decidedAt)} WIB</p>{/if}
          {#if currentSelected.adjustment.note}<p class="adjustment-note"><strong>Catatan keputusan:</strong><br/>{currentSelected.adjustment.note}</p>{/if}
        {/if}
      </section>
    {/if}
    {#if adjustMode}
      <form class="review-form" on:submit|preventDefault={submitAdjustment}>
        <h3>{adjustMode === 'change' ? currentSelected.status === 'needs_info' ? 'Lengkapi pengajuan' : 'Ajukan tanggal baru' : 'Batalkan pengajuan'}</h3>
        {#if adjustMode === 'change'}
          <div class="form-grid">
            <label class="field">{hasHours(currentSelected) ? 'Tanggal izin' : 'Tanggal mulai'}<input class="input" type="date" bind:value={changeStart} min={todayJakarta()} required/></label>
            {#if !hasHours(currentSelected)}<label class="field">Tanggal selesai<input class="input" type="date" bind:value={changeEnd} min={changeStart} required/></label>{/if}
          </div>
          {#if hasHours(currentSelected)}<p class="hint">Jam izin tetap {hourLabel(currentSelected)} WIB pada tanggal baru.</p>{/if}
        {/if}
        <label class="field reason">{adjustMode === 'change' && currentSelected.status === 'needs_info' ? 'Alasan pengajuan' : `Alasan ${adjustMode === 'change' ? 'perubahan' : 'pembatalan'}`}<textarea class="textarea" rows="3" bind:value={changeReason} minlength="3" required></textarea></label>
        <p class="hint">{currentSelected.status === 'approved' ? 'Tanggal dan potongan sebelumnya tetap berlaku sampai permintaan disetujui.' : currentSelected.status === 'needs_info' ? 'Lengkapi alasan sesuai catatan atasan. Pengajuan akan dikirim kembali untuk ditinjau.' : 'Pengajuan yang belum disetujui dapat diperbarui atau dibatalkan langsung.'}</p>
        <div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => adjustMode = null}>Kembali</button><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Memproses…' : currentSelected.status === 'needs_info' && adjustMode === 'change' ? 'Kirim ulang' : 'Kirim'}</button></div>
      </form>
    {:else if currentSelected.employeeId === $app.user?.id && ['pending', 'approved', 'needs_info'].includes(currentSelected.status) && currentSelected.adjustment?.status !== 'pending'}
      {#if currentSelected.startDate >= todayJakarta() || currentSelected.status !== 'approved'}
        <div class="form-actions">
          {#if currentSelected.startDate >= todayJakarta()}<button class="btn btn-secondary" on:click={() => adjustment('change')}><Icon name="calendar" size={16}/>{currentSelected.status === 'needs_info' ? 'Lengkapi pengajuan' : 'Ubah tanggal'}</button>{/if}
          <button class="btn btn-secondary" on:click={() => adjustment('cancel')}>Batalkan pengajuan</button>
        </div>
      {:else}<p class="hint">Tanggal pengajuan sudah lewat. Hubungi HR untuk memeriksa catatan ini.</p>{/if}
    {/if}
    {#if !adjustMode && canDecideLeave(currentSelected) && (currentSelected.status === 'pending' || currentSelected.status === 'needs_info' || currentSelected.adjustment?.status === 'pending')}
      <form class="review-form" on:submit|preventDefault={decide}>
        <h3>{currentSelected.adjustment?.status === 'pending' ? currentSelected.adjustment.type === 'cancel' ? 'Tinjau pembatalan' : 'Tinjau perubahan' : 'Berikan keputusan'}</h3>
        {#if external}
          <div class="info-box"><Icon name="shield" size={18}/><span>Catat keputusan dari Bos / Manager Pusat. Anda bertindak sebagai pencatat.</span></div>
          <label class="field">Nama pemberi keputusan<input class="input" bind:value={decision.externalApproverName} minlength="3" required placeholder="Nama Bos / Manager Pusat"/></label>
        {/if}
        {#if currentSelected.adjustment?.status !== 'pending'}<label class="field">Keputusan<select class="select" bind:value={decision.decision}><option value="approve">Setujui</option><option value="reject">Tolak</option><option value="needs_info">Minta dilengkapi</option></select></label>{/if}
        {#if currentSelected.adjustment?.type === 'cancel' && currentSelected.adjustment.status === 'pending'}
          <div class="info-box"><Icon name="calendar" size={18}/><span>Saat disetujui, potongan {currentSelected.deductionDays} hari dikembalikan ke saldo tahun asal. Saldo tahun lampau tetap hangus.</span></div>
          <p class="allocation">{#each Object.entries(allocation) as [year, days]}<span>Saldo {year}: +{days} hari</span>{/each}</p>
        {:else if decision.decision === 'approve' || currentSelected.adjustment?.status === 'pending'}
          <label class="field reason">Jumlah potongan cuti (hari)<input class="input" type="number" min="0" step="0.5" bind:value={decision.deductionDays} required/></label>
          <p class="allocation">{#each Object.entries(allocation) as [year, days]}<span>Saldo {year}: −{days} hari</span>{/each}</p>
          <p class="hint">Isi 0 untuk tanpa potong cuti. Saldo pemohon: {leaveBalance(currentSelected.employeeId)} hari.{currentSelected.status === 'approved' ? ` Potongan sebelumnya: ${currentSelected.deductionDays} hari.` : ''}</p>
        {/if}
        <label class="field reason">Catatan keputusan<textarea class="textarea" rows="3" bind:value={decision.note} placeholder="Alasan atau penjelasan untuk karyawan"></textarea></label>
        <div class="form-actions">
          {#if currentSelected.adjustment?.status === 'pending'}
            <button class="btn btn-secondary" type="button" disabled={saving} on:click={() => decideAdjustment(false)}>{currentSelected.adjustment.type === 'cancel' ? 'Tolak pembatalan' : 'Tolak perubahan'}</button>
            <button class="btn btn-primary" type="button" disabled={saving} on:click={() => decideAdjustment(true)}>{currentSelected.adjustment.type === 'cancel' ? 'Setujui pembatalan' : 'Setujui perubahan'}</button>
          {:else}<button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan keputusan'}</button>{/if}
        </div>
      </form>
    {/if}
    <Feedback {message} error={failed}/>
  {/if}
</Modal>

<style>
.attachment-link{margin-top:1rem}.allocation{display:flex;gap:.6rem;flex-wrap:wrap;margin:.7rem 0}.allocation span{font-size:.7rem;background:#f6f2e4;color:var(--muted);border-radius:6px;padding:.4rem .6rem}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-bottom:1.6rem}.request-panel{padding:0;overflow:hidden}.list-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.6rem 1.3rem;border-bottom:1px solid var(--border)}.list-heading select{max-width:175px;font-size:.74rem}.tabs{display:flex;gap:.4rem}.tabs button{padding:1rem .6rem;border:0;background:transparent;color:var(--muted);font-size:.8rem;cursor:pointer;border-bottom:2px solid transparent}.tabs button.active{color:var(--muted);border-bottom-color:#8f8151}.tabs span{background:#f5f0e1;color:var(--muted);border-radius:5px;padding:.15rem .35rem;margin-left:.4rem;font-size:.67rem}.request{display:flex;align-items:center;text-align:left;gap:1rem;width:100%;border:0;border-bottom:1px solid var(--border);background:transparent;padding:1.35rem 1.3rem;cursor:pointer;color:inherit;transition:background .15s}.request:hover{background:#fcfbf6}.request:last-child{border-bottom:0}.request-symbol{display:grid;place-items:center;border:1px solid var(--border);border-radius:13px;width:44px;height:48px;color:var(--muted);background:#f9f6ec;flex-shrink:0}.request-info{flex:1;min-width:0}.request-title{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}.request-info h3{font-size:.85rem;color:var(--muted);font-weight:600;margin:0}.request-title>span{font-size:.7rem;color:var(--muted)}.request-info p{font-size:.75rem;color:var(--muted);margin:.5rem 0}.request-info small{display:block;font-size:.71rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:460px}.request-status{display:flex;align-items:flex-end;flex-direction:column;gap:.65rem}.request-status>small{font-size:.65rem;color:var(--muted)}.arrow{color:var(--muted)}.adjustment-tag{display:inline-block;background:#f9f1df;color:var(--muted);font-size:.63rem;margin-top:.6rem;padding:.35rem .5rem;border-radius:5px}.policy{display:flex;gap:.6rem;align-items:flex-start;font-size:.72rem;line-height:1.7;color:var(--muted);margin:1.2rem .2rem}.policy :global(svg){flex-shrink:0;margin-top:.15rem}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem}.reason{margin-top:1rem}.check{display:flex;align-items:center;gap:.6rem;font-size:.8rem;color:var(--muted);margin:1rem 0}.check input{accent-color:#837545}.info-box{display:flex;align-items:flex-start;gap:.65rem;background:#f8f5ea;color:var(--muted);font-size:.74rem;line-height:1.7;padding:1rem;border-radius:10px;margin:1.2rem 0}.info-box :global(svg){flex-shrink:0;margin-top:.15rem}.info-box strong{color:var(--muted)}.form-actions{display:flex;justify-content:flex-end;gap:.6rem;border-top:1px solid var(--border);padding-top:1.2rem;margin-top:1.2rem;flex-wrap:wrap}.detail-status{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1.5rem}.detail-status>span{font-size:.67rem;color:var(--muted)}.details{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin:0}.details dt{font-size:.66rem;color:var(--muted);margin-bottom:.4rem}.details dd{font-size:.8rem;color:var(--muted);margin:0;line-height:1.7;white-space:pre-wrap}.span{grid-column:1/-1}.review-form{margin-top:1.6rem;border-top:1px solid var(--border);padding-top:1.25rem}.review-form h3{font-size:.9rem;color:var(--muted);margin:0 0 1rem}.hint{font-size:.7rem;color:var(--muted);line-height:1.6}.adjustment-box{background:#faf6e9;border:1px solid var(--border);border-radius:11px;padding:1rem;margin-top:1.2rem}.adjustment-box strong{font-size:.8rem;color:var(--muted)}.adjustment-box p{font-size:.74rem;line-height:1.7;color:var(--muted);margin:.6rem 0}@media(max-width:750px){.metrics{gap:.6rem}.metrics :global(.metric){padding:1rem .85rem}.metrics :global(.top){font-size:.67rem}.metrics :global(.icon){display:none}.metrics :global(strong){font-size:1.6rem}.metrics :global(p){font-size:.61rem}}@media(max-width:600px){.list-heading{padding:.3rem .75rem;gap:.3rem}.list-heading select{max-width:120px;font-size:.67rem;padding:.5rem}.tabs{gap:.15rem}.tabs button{font-size:.7rem;padding:.9rem .2rem}.tabs span{margin-left:.15rem}.request{padding:1.1rem .9rem;gap:.7rem}.request-symbol{width:35px;height:40px;border-radius:10px}.request-status{gap:.5rem}.request-status :global(.pill){font-size:.6rem;padding:.3rem .4rem}.request-status>small{font-size:.58rem}.arrow{display:none}.request-info h3{font-size:.77rem}.request-info p{font-size:.66rem;line-height:1.7}.request-info small{font-size:.63rem;max-width:180px}.adjustment-tag{font-size:.57rem;line-height:1.6}.form-grid{gap:.8rem}.details{gap:1rem}.policy{font-size:.64rem}}
  .allocation span { background: #eee6cd; color: #594f2e; box-shadow: var(--inset); border-radius: 8px; }
  .tabs { padding: .4rem 0; gap: .65rem; }
  .tabs button { min-height: 44px; padding: .7rem .8rem; border-radius: 11px; color: var(--muted); border-bottom: 0; }
  .tabs button.active { color: var(--accent); background: var(--surface); border-bottom-color: transparent; box-shadow: var(--inset); font-weight: 600; }
  .tabs span { color: var(--accent); background: #ebe2c4; }
  .request:hover { background: #f1ead4; }
  .request-symbol { background: var(--surface); color: var(--accent); border-color: #ffffff9c; box-shadow: var(--raised-sm); border-radius: 14px; }
  .request-info h3, .details dd, .review-form h3, .info-box strong { color: var(--ink); }
  .adjustment-tag { background: #ede2c8; color: #79591f; border-radius: 7px; }
  .info-box { background: var(--surface); color: #6a5f3c; border: 1px solid #ffffff9c; box-shadow: var(--inset); border-radius: 14px; }
  .adjustment-box { background: var(--surface-cream); border-color: #d8ccae; border-radius: 14px; box-shadow: inset 3px 3px 7px #d6cfba80, inset -3px -3px 7px #ffffff; }
  .adjustment-box strong, .adjustment-box p { color: #765a23; }
  .adjustment-note { white-space: pre-wrap; }
  @media (max-width: 600px) { .tabs { gap: .15rem; } .tabs button { padding: .6rem .45rem; } .list-heading { padding: .4rem .65rem; } }
</style>
