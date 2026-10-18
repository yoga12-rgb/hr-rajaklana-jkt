<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { app, actions, isApprover, isAdmin, canDecideLeave, leaveBalance, displayName, leaveConflicts, isDuplicateLeave } from '#lib/state/app';
  import type { LeaveInput, LeaveRequest, LeaveDecision, RetrospectiveLeaveInput } from '#lib/types';
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
  let changeStartTime = '', changeEndTime = '', changeAttachment: File | undefined, removeAttachment = false;
  let correctionOpen = false, correctionCancel = false, correctionStart = '', correctionEnd = '', correctionDays = 0, correctionReason = '', correctionExternalName = '';
  let correctionStartTime = '', correctionEndTime = '';
  let retroOpen = false;
  let retro: RetrospectiveLeaveInput = { employeeId: '', type: 'sick', startDate: '', endDate: '', extent: 'full_day', startTime: '', endTime: '', reason: '', note: '', deductionDays: 0, externalApproverName: '' };
  $: retroLatestDate = new Date(Date.parse(`${todayJakarta()}T12:00:00+07:00`) - 86400000).toISOString().slice(0,10);
  $: retroEmployees = $app.employees.filter(employee => employee.status === 'active' && employee.id !== $app.user?.id);
  $: retroEmployee = retroEmployees.find(employee => employee.id === retro.employeeId);
  function beginRetro() { retro = { employeeId: '', type: 'sick', startDate: '', endDate: '', extent: 'full_day', startTime: '', endTime: '', reason: '', note: '', deductionDays: 0, externalApproverName: '' }; message = ''; failed = false; retroOpen = true; }
  async function submitRetro() {
    if (!retroEmployee) { failed = true; message = 'Pilih karyawan selain diri sendiri.'; return; }
    const endDate = retro.extent === 'full_day' ? retro.endDate : retro.startDate;
    if (!retro.startDate || !endDate || retro.startDate >= todayJakarta() || endDate >= todayJakarta() || endDate < retro.startDate) { failed = true; message = 'Pencatatan ini khusus tanggal lampau yang telah dikonfirmasi.'; return; }
    if (retro.extent !== 'full_day' && (!retro.startTime || (retro.extent === 'temporary_exit' && (!retro.endTime || retro.endTime <= retro.startTime)))) { failed = true; message = 'Isi jam izin dengan benar.'; return; }
    if (retro.reason.trim().length < 3 || retro.note.trim().length < 3 || !Number.isFinite(retro.deductionDays) || retro.deductionDays < 0 || retro.deductionDays % 0.5 !== 0) { failed = true; message = 'Isi alasan, sumber keputusan, dan potongan kelipatan 0,5 dengan benar.'; return; }
    if (retroEmployee.approvalMode === 'external' && (retro.externalApproverName?.trim().length ?? 0) < 3) { failed = true; message = 'Isi nama pemberi keputusan eksternal.'; return; }
    saving = true; message = ''; try { await actions.recordRetrospectiveLeave({ ...retro, endDate, startTime: retro.extent === 'full_day' ? '' : retro.startTime, endTime: retro.extent === 'temporary_exit' ? retro.endTime : '' }); retroOpen = false; failed = false; message = 'Izin lampau tercatat sebagai pencatatan HR dengan sumber konfirmasi dan riwayat.'; } catch(error) { failed = true; message = error instanceof Error ? error.message : 'Izin lampau belum tersimpan.'; } finally { saving = false; }
  }
  let linkedRequestId = '', handledRequestId = '';
  let partialDay = false;
  let extent: 'late_arrival' | 'temporary_exit' | 'early_departure' = 'temporary_exit';
  let attachment: File | undefined;
  let form: LeaveInput = { type: 'annual', startDate: todayJakarta(), endDate: todayJakarta(), reason: '', startTime: '', endTime: '' };
  let decision: LeaveDecision = { decision: 'approve', deductionDays: 0, note: '', externalApproverName: '' };
  $: admin = isAdmin($app.user);
  $: reviewer = isApprover($app.user) || admin;
  $: mine = $app.leaveRequests.filter((request) => request.employeeId === $app.user?.id);
  $: review = $app.leaveRequests.filter((request) => admin || canDecideLeave(request));
  $: reviewWaiting = review.filter((request) => canDecideLeave(request) && (request.status === 'pending' || request.status === 'needs_info' || request.adjustment?.status === 'pending')).length;
  $: rows = (tab === 'mine' ? mine : review).filter((request) => !filter || request.status === filter).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $: currentSelected = selected ? $app.leaveRequests.find((r) => r.id === selected?.id) ?? selected : null;
  $: external = currentSelected ? $app.employees.find((e) => e.id === currentSelected?.employeeId)?.approvalMode === 'external' : false;
  $: allocation = currentSelected ? previewAllocation(currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.startDate || currentSelected.startDate : currentSelected.startDate, currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.endDate || currentSelected.endDate : currentSelected.endDate, decision.deductionDays) : {};
  $: submitInput = { ...form, endDate: partialDay ? form.startDate : form.endDate, startTime: partialDay ? form.startTime : '', endTime: partialDay && extent === 'temporary_exit' ? form.endTime : '', extent: partialDay ? extent : 'full_day' } satisfies LeaveInput;
  $: newConflicts = $app.user ? leaveConflicts($app.user.id, submitInput.startDate, submitInput.endDate) : [];
  $: duplicate = !!$app.user && isDuplicateLeave(submitInput);
  $: selectedConflicts = currentSelected ? leaveConflicts(currentSelected.employeeId, currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.startDate || currentSelected.startDate : currentSelected.startDate, currentSelected.adjustment?.status === 'pending' && currentSelected.adjustment.type === 'change' ? currentSelected.adjustment.endDate || currentSelected.endDate : currentSelected.endDate, currentSelected.id) : [];
  $: changeConflicts = currentSelected && adjustMode === 'change' ? leaveConflicts(currentSelected.employeeId, changeStart, hasHours(currentSelected) ? changeStart : changeEnd, currentSelected.id) : [];
  $: correctionConflicts = currentSelected && correctionOpen && !correctionCancel ? leaveConflicts(currentSelected.employeeId, correctionStart, hasHours(currentSelected) ? correctionStart : correctionEnd, currentSelected.id) : [];
  $: correctionAllocation = correctionCancel ? {} : previewAllocation(correctionStart, currentSelected && hasHours(currentSelected) ? correctionStart : correctionEnd, correctionDays);
  $: originalAllocation = currentSelected ? previewAllocation(currentSelected.startDate, currentSelected.endDate, currentSelected.deductionDays) : {};
  $: canCorrect = admin && !!currentSelected && currentSelected.employeeId !== $app.user?.id && currentSelected.status === 'approved' && currentSelected.adjustment?.status !== 'pending';
  afterNavigate(({ to }) => { linkedRequestId = to?.url.searchParams.get('request') ?? ''; handledRequestId = ''; });
  $: if (linkedRequestId && linkedRequestId !== handledRequestId && $app.initialized && !$app.loading && $app.user) openLinkedRequest(linkedRequestId);

  function openLinkedRequest(requestId: string) {
    handledRequestId = requestId;
    const request = $app.leaveRequests.find((item) => item.id === requestId && (item.employeeId === $app.user?.id || isAdmin($app.user) || canDecideLeave(item)));
    if (!request) { selected = null; failed = true; message = 'Pengajuan ini tidak tersedia atau tidak dapat dibuka dengan akun Anda.'; return; }
    tab = request.employeeId === $app.user?.id ? 'mine' : 'review'; filter = ''; open(request);
  }

  function previewAllocation(start: string, end: string, total: number) { try { return deductionByYear(start, end, total); } catch { return {}; } }
  function hasHours(request: LeaveRequest) { return (request.extent && request.extent !== 'full_day') || !!(request.startTime || request.endTime); }
  function hasInterval(request: LeaveRequest) { return request.extent === 'temporary_exit' || (!request.extent && !!request.startTime && !!request.endTime); }
  function deductionLabel(request: LeaveRequest) {
    if (request.status === 'approved') return request.deductionDays ? `${request.deductionDays} hari` : 'Tanpa potong cuti';
    return ['cancelled', 'rejected'].includes(request.status) ? 'Tidak ada potongan aktif' : 'Ditentukan saat persetujuan';
  }
  function begin() { form = { type: 'annual', startDate: todayJakarta(), endDate: todayJakarta(), reason: '', startTime: '', endTime: '' }; partialDay = false; extent = 'temporary_exit'; attachment = undefined; newOpen = true; message = ''; failed = false; }
  function selectAttachment(event: Event, editing = false) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    const error = file && file.size > 5 * 1024 * 1024 ? 'Ukuran lampiran maksimal 5 MB.' : file && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? 'Gunakan lampiran PDF, JPG, PNG, atau WebP.' : '';
    if (error) { message = error; failed = true; input.value = ''; if (editing) changeAttachment = undefined; else attachment = undefined; return; }
    if (editing) { changeAttachment = file; if (file) removeAttachment = false; } else attachment = file;
    message = ''; failed = false;
  }
  function hourLabel(request: LeaveRequest) { const time = request.startTime || request.endTime; if (!time) return ''; if (request.extent === 'late_arrival') return `Datang ${time}`; if (request.extent === 'early_departure') return `Pulang ${time}`; return request.startTime && request.endTime ? `${request.startTime}–${request.endTime}` : time; }
  function open(request: LeaveRequest) { selected = request; adjustMode = null; correctionOpen = false; message = ''; failed = false; decision = { decision: 'approve', deductionDays: request.deductionDays || 0, note: '', externalApproverName: '' }; }
  function adjustment(mode: 'change' | 'cancel') { if (!currentSelected) return; adjustMode = mode; correctionOpen = false; changeStart = currentSelected.startDate; changeEnd = currentSelected.endDate; changeStartTime = currentSelected.startTime || currentSelected.endTime; changeEndTime = hasInterval(currentSelected) ? currentSelected.endTime : ''; changeAttachment = undefined; removeAttachment = false; changeReason = mode === 'change' && currentSelected.status !== 'approved' ? currentSelected.reason : ''; message = ''; failed = false; }
  function beginCorrection() { if (!currentSelected || !canCorrect) return; correctionOpen = true; adjustMode = null; correctionCancel = false; correctionStart = currentSelected.startDate; correctionEnd = currentSelected.endDate; correctionDays = currentSelected.deductionDays; correctionStartTime = currentSelected.startTime || currentSelected.endTime; correctionEndTime = hasInterval(currentSelected) ? currentSelected.endTime : ''; correctionReason = ''; correctionExternalName = ''; message = ''; failed = false; }
  async function run(action: () => Promise<unknown>, success: string, close = false) { saving = true; message = ''; try { await action(); failed = false; message = success; if (close) { newOpen = false; adjustMode = null; correctionOpen = false; selected = null; } } catch (error) { failed = true; message = error instanceof Error ? error.message : 'Pengajuan belum berhasil diproses.'; } finally { saving = false; } }
  async function submit() { if (!partialDay && form.endDate < form.startDate) { failed = true; message = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'; return; } if (partialDay && (!form.startTime || (extent === 'temporary_exit' && (!form.endTime || form.endTime <= form.startTime)))) { failed = true; message = 'Isi jam mulai dan selesai izin dengan benar.'; return; } if (duplicate) { failed = true; message = 'Pengajuan yang sama sudah ada. Buka pengajuan tersebut untuk melihat status atau memperbaruinya.'; return; } await run(() => actions.submitLeave({ ...submitInput, attachment }), 'Pengajuan terkirim. Anda akan menerima pembaruan saat keputusan diberikan.', true); }
  async function decide() { if (!currentSelected) return; if (decision.decision !== 'approve' && (decision.note?.trim().length ?? 0) < 3) { failed = true; message = 'Tuliskan alasan penolakan atau informasi yang perlu dilengkapi, minimal 3 karakter.'; return; } if (external && (decision.externalApproverName?.trim().length ?? 0) < 3) { failed = true; message = 'Isi nama Bos / Manager Pusat yang memberikan keputusan, minimal 3 karakter.'; return; } await run(() => actions.decideLeave(currentSelected!.id, decision), 'Keputusan berhasil dicatat.', true); }
  async function submitAdjustment() {
    if (!currentSelected) return;
    if (changeReason.trim().length < 3) { failed = true; message = 'Alasan perubahan atau pembatalan minimal 3 karakter.'; return; }
    const endDate = hasHours(currentSelected) ? changeStart : changeEnd;
    if (adjustMode === 'change' && endDate < changeStart) { failed = true; message = 'Tanggal selesai tidak boleh sebelum tanggal mulai.'; return; }
    const editingHours = adjustMode === 'change' && currentSelected.status !== 'approved' && hasHours(currentSelected);
    if (editingHours && (!changeStartTime || (hasInterval(currentSelected) && (!changeEndTime || changeEndTime <= changeStartTime)))) { failed = true; message = 'Isi jam mulai dan selesai izin dengan benar.'; return; }
    if (adjustMode === 'change') await run(() => actions.changeLeave(currentSelected!.id, { startDate: changeStart, endDate, reason: changeReason, ...(currentSelected!.status !== 'approved' ? { startTime: editingHours ? changeStartTime : '', endTime: editingHours ? changeEndTime : '', attachment: changeAttachment, removeAttachment } : {}) }), currentSelected.status === 'approved' ? 'Perubahan tanggal diajukan. Tanggal dan potongan lama tetap berlaku sampai disetujui.' : 'Pengajuan diperbarui dan dikirim kembali untuk ditinjau atasan.', true);
    else await run(() => actions.cancelLeave(currentSelected!.id, changeReason), currentSelected.status === 'approved' ? 'Pembatalan diajukan. Menunggu keputusan atasan.' : 'Pengajuan dibatalkan.', true);
  }
  async function submitCorrection() {
    if (!currentSelected || !canCorrect) return;
    const endDate = hasHours(currentSelected) ? correctionStart : correctionEnd;
    if (correctionReason.trim().length < 3) { failed = true; message = 'Isi alasan koreksi minimal 3 karakter.'; return; }
    if (!correctionCancel && (!correctionStart || !endDate || endDate < correctionStart)) { failed = true; message = 'Isi rentang tanggal koreksi dengan benar.'; return; }
    if (!correctionCancel && (!Number.isFinite(correctionDays) || correctionDays < 0 || correctionDays % 0.5 !== 0)) { failed = true; message = 'Potongan harus nol atau kelipatan 0,5 hari.'; return; }
    if (!correctionCancel && hasHours(currentSelected) && (!correctionStartTime || (hasInterval(currentSelected) && (!correctionEndTime || correctionEndTime <= correctionStartTime)))) { failed = true; message = 'Isi jam izin setelah koreksi dengan benar.'; return; }
    if (external && correctionExternalName.trim().length < 3) { failed = true; message = 'Isi nama Bos / Manager Pusat pemberi keputusan, minimal 3 karakter.'; return; }
    await run(() => actions.correctLeave(currentSelected!.id, { startDate: correctionStart, endDate, deductionDays: correctionDays, reason: correctionReason, cancel: correctionCancel, externalApproverName: correctionExternalName, ...(!correctionCancel && hasHours(currentSelected!) ? { startTime: correctionStartTime, endTime: hasInterval(currentSelected!) ? correctionEndTime : '' } : {}) }), correctionCancel ? 'Koreksi HR tersimpan. Pengajuan dibatalkan dan potongan dikembalikan ke tahun asal.' : 'Koreksi HR tersimpan. Tanggal, jam, dan potongan saldo telah disesuaikan.', true);
  }
  async function decideAdjustment(approved: boolean) {
    if (!currentSelected) return;
    if (!approved && (decision.note?.trim().length ?? 0) < 3) { failed = true; message = 'Tuliskan alasan penolakan minimal 3 karakter.'; return; }
    if (external && (decision.externalApproverName?.trim().length ?? 0) < 3) { failed = true; message = 'Isi nama pemberi keputusan eksternal, minimal 3 karakter.'; return; }
    const cancelling = currentSelected.adjustment?.type === 'cancel';
    await run(() => actions.decideAdjustment(currentSelected!.id, { decision: approved ? 'approve' : 'reject', deductionDays: decision.deductionDays, note: decision.note, externalApproverName: decision.externalApproverName }), approved ? cancelling ? 'Pembatalan disetujui. Potongan dikembalikan ke tahun asal.' : 'Perubahan disetujui dan saldo disesuaikan.' : 'Permintaan ditolak. Pengajuan sebelumnya tetap berlaku.', true);
  }
</script>

<PageHeading eyebrow="WAKTU UNTUK DIRI SENDIRI" title="Cuti & izin" description="Ajukan kebutuhan Anda, pantau keputusan, dan lihat saldo cuti.">{#if admin}<button class="btn btn-secondary" on:click={beginRetro}>Catat sakit / izin lampau</button>{/if}<button class="btn btn-primary" on:click={begin}><Icon name="plus" size={18}/>Buat pengajuan</button></PageHeading>
<div class="metrics"><MetricCard label="Saldo cuti Anda" value={`${$app.user ? leaveBalance($app.user.id) : 0} hari`} detail="Saldo tahun kalender berjalan" icon="calendar" accent/><MetricCard label="Menunggu keputusan" value={mine.filter((r) => r.status === 'pending' || r.status === 'needs_info' || r.adjustment?.status === 'pending').length} detail="Pengajuan Anda yang masih diproses" icon="clock"/><MetricCard label={reviewer ? 'Perlu Anda tinjau' : 'Pengajuan disetujui'} value={reviewer ? reviewWaiting : mine.filter((r) => r.status === 'approved').length} detail={reviewer ? 'Pengajuan yang dapat Anda putuskan' : 'Cuti dan izin yang sudah disetujui'} icon={reviewer ? 'file' : 'check'}/></div>
<Feedback {message} error={failed}/>
<section class="panel request-panel"><div class="list-heading"><div class="tabs" role="tablist" aria-label="Pengajuan cuti"><button role="tab" aria-selected={tab === 'mine'} class:active={tab === 'mine'} on:click={() => tab = 'mine'}>Pengajuan saya</button>{#if reviewer}<button role="tab" aria-selected={tab === 'review'} class:active={tab === 'review'} on:click={() => tab = 'review'}>{admin ? 'Pengajuan karyawan' : 'Persetujuan tim'} <span>{reviewWaiting}</span></button>{/if}</div><select class="select" aria-label="Filter status pengajuan" bind:value={filter}><option value="">Semua status</option><option value="pending">Menunggu</option><option value="approved">Disetujui</option><option value="rejected">Ditolak</option><option value="needs_info">Perlu dilengkapi</option><option value="cancelled">Dibatalkan</option></select></div>
  {#if rows.length}<div class="requests">{#each rows as request}<button class="request" on:click={() => open(request)}><span class="request-symbol"><Icon name={request.type === 'annual' ? 'calendar' : request.type === 'sick' ? 'heart' : 'clock'} size={22}/></span><div class="request-info"><div class="request-title"><h3>{leaveTypeLabel[request.type]}</h3>{#if tab === 'review'}<span>{displayName(request.employeeId)}</span>{/if}</div><p>{dateLabel(request.startDate)}{request.endDate !== request.startDate ? ` – ${dateLabel(request.endDate)}` : ''}{hasHours(request) ? ` · ${hourLabel(request)}` : ''}</p><small>{request.reason}</small>{#if request.adjustment?.status === 'pending'}<span class="adjustment-tag">{request.adjustment.type === 'change' ? 'Perubahan tanggal menunggu keputusan' : 'Pembatalan menunggu keputusan'}</span>{/if}</div><div class="request-status"><StatusPill label={leaveStatusLabel[request.status]} tone={leaveTone(request.status)}/>{#if request.status === 'approved'}<small>{request.deductionDays ? `Potong ${request.deductionDays} hari` : 'Tanpa potong cuti'}</small>{/if}</div><span class="arrow"><Icon name="chevron" size={16}/></span></button>{/each}</div>{:else}<EmptyState icon="calendar" title={tab === 'mine' ? 'Belum ada pengajuan' : 'Semua sudah tertangani'} description={tab === 'mine' ? 'Saat membutuhkan cuti atau izin, buat pengajuan dari sini.' : admin ? 'Pengajuan karyawan akan muncul di sini untuk ditinjau atau dikoreksi.' : 'Pengajuan tim yang dapat Anda proses akan muncul di sini.'}/>{/if}
</section><p class="policy"><Icon name="info" size={16}/>Hak cuti setelah 3 bulan kerja. Tahun pertama prorata; sisa saldo hangus setiap 31 Desember. Pemotongan mengikuti keputusan atasan.</p>

<Modal open={admin && retroOpen} title="Catat sakit / izin lampau" description="Pencatatan Admin HR setelah kejadian dikonfirmasi. Dilarang mencatat keputusan sendiri." onclose={() => retroOpen = false}>
<form on:submit|preventDefault={submitRetro}><div class="info-box"><Icon name="info" size={18}/><span>Ini catatan HR untuk kejadian lampau. Waktu absensi tidak diubah. Sumber konfirmasi, keputusan, dan perubahan saldo tersimpan di riwayat.</span></div><label class="field">Karyawan<select class="select" bind:value={retro.employeeId} required><option value="">Pilih karyawan selain diri sendiri</option>{#each retroEmployees as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label><div class="form-grid"><label class="field">Jenis<select class="select" bind:value={retro.type}><option value="sick">Sakit</option><option value="personal">Izin pribadi</option></select></label><label class="field">Cakupan<select class="select" bind:value={retro.extent}><option value="full_day">Sehari / beberapa hari</option><option value="late_arrival">Datang terlambat</option><option value="temporary_exit">Keluar sementara</option><option value="early_departure">Pulang lebih awal</option></select></label><label class="field">Tanggal mulai (lampau)<input class="input" type="date" bind:value={retro.startDate} max={retroLatestDate} required/></label>{#if retro.extent === 'full_day'}<label class="field">Tanggal selesai (lampau)<input class="input" type="date" bind:value={retro.endDate} min={retro.startDate} max={retroLatestDate} required/></label>{:else}<label class="field">{retro.extent === 'late_arrival' ? 'Jam datang' : retro.extent === 'early_departure' ? 'Jam pulang' : 'Jam keluar'}<input class="input" type="time" bind:value={retro.startTime} required/></label>{#if retro.extent === 'temporary_exit'}<label class="field">Jam kembali<input class="input" type="time" bind:value={retro.endTime} required/></label>{/if}{/if}</div><label class="field reason">Alasan / kejadian<textarea class="textarea" bind:value={retro.reason} minlength="3" required rows="3"></textarea></label><label class="field reason">Keputusan dan sumber konfirmasi<textarea class="textarea" bind:value={retro.note} minlength="3" required rows="3" placeholder="Siapa yang mengonfirmasi dan kapan; keputusan yang dicatat…"></textarea></label>{#if retroEmployee?.approvalMode === 'external'}<label class="field">Nama pemberi keputusan eksternal<input class="input" bind:value={retro.externalApproverName} minlength="3" required/></label>{/if}<label class="field reason">Potongan cuti (hari)<input class="input" type="number" min="0" step="0.5" bind:value={retro.deductionDays} required/></label><p class="hint">Isi 0 untuk tanpa potongan. Potongan tahun lampau yang hangus tidak dapat ditambahkan. Periksa sumber keputusan sebelum menyimpan.</p><Feedback {message} error={failed}/><div class="form-actions"><button type="button" class="btn btn-secondary" on:click={() => retroOpen = false}>Batal</button><button class="btn btn-primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Catat keputusan HR'}</button></div></form>
</Modal>

<Modal open={newOpen} title="Buat pengajuan" description="Atasan akan meninjau pengajuan dan menentukan dampaknya pada saldo cuti." onclose={() => newOpen = false}>
  {#if duplicate}<div class="conflict-box" role="status"><strong>Pengajuan yang sama sudah ada.</strong><p>Buka pengajuan tersebut untuk melihat status atau memperbaruinya.</p></div>{/if}
  {#if newConflicts.length}<div class="conflict-box" role="status"><strong>Ada catatan lain pada tanggal ini.</strong><ul>{#each newConflicts as conflict}<li>{conflict.label}</li>{/each}</ul><p>Periksa tanggal dan jam sebelum mengirim. Kehadiran pada hari izin beberapa jam tetap diperbolehkan.</p></div>{/if}
  <form on:submit|preventDefault={submit}><label class="field">Jenis pengajuan<select class="select" bind:value={form.type} on:change={() => partialDay = false}><option value="annual">Cuti tahunan</option><option value="personal">Izin pribadi</option><option value="sick">Izin sakit</option></select></label>{#if form.type !== 'annual'}<label class="check"><input type="checkbox" bind:checked={partialDay}/>Izin sebagian hari / beberapa jam</label>{/if}{#if partialDay}<label class="field reason">Jenis izin sebagian hari<select class="select" bind:value={extent}><option value="late_arrival">Datang terlambat</option><option value="temporary_exit">Keluar sementara</option><option value="early_departure">Pulang lebih awal</option></select></label>{/if}<div class="form-grid"><label class="field">{partialDay ? 'Tanggal izin' : 'Tanggal mulai'}<input class="input" type="date" bind:value={form.startDate} min={todayJakarta()} required/></label>{#if !partialDay}<label class="field">Tanggal selesai<input class="input" type="date" bind:value={form.endDate} min={form.startDate} required/></label>{:else}<label class="field">{extent === 'late_arrival' ? 'Rencana jam datang' : extent === 'early_departure' ? 'Jam pulang yang diminta' : 'Jam keluar'}<input class="input" type="time" bind:value={form.startTime} required/></label>{#if extent === 'temporary_exit'}<label class="field">Jam kembali<input class="input" type="time" bind:value={form.endTime} required/></label>{/if}{/if}</div><label class="field reason">Alasan<textarea class="textarea" rows="4" bind:value={form.reason} required placeholder="Ceritakan kebutuhan cuti atau izin Anda…"></textarea></label><label class="field reason">Lampiran (opsional)<input class="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" on:change={(event) => selectAttachment(event)}/></label><p class="hint">{attachment ? `${attachment.name} · ${(attachment.size / 1024).toFixed(0)} KB` : 'PDF atau foto, maksimal 5 MB.'}</p><div class="info-box"><Icon name="calendar" size={18}/><span>Saldo Anda saat ini <strong>{$app.user ? leaveBalance($app.user.id) : 0} hari</strong>. Saldo berubah setelah pengajuan disetujui.</span></div><Feedback {message} error={failed}/><div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => newOpen = false}>Batal</button><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Mengirim…' : 'Kirim pengajuan'}</button></div></form>
</Modal>

<Modal open={currentSelected !== null} title={currentSelected ? leaveTypeLabel[currentSelected.type] : ''} description={currentSelected ? `Pengajuan ${displayName(currentSelected.employeeId)}` : ''} onclose={() => { selected = null; adjustMode = null; correctionOpen = false; }}>
  {#if currentSelected}<div class="detail-status"><StatusPill label={leaveStatusLabel[currentSelected.status]} tone={leaveTone(currentSelected.status)}/><span>Diajukan {dateLabel(currentSelected.createdAt)}</span></div><dl class="details"><div><dt>Tanggal</dt><dd>{dateLabel(currentSelected.startDate)}{currentSelected.endDate !== currentSelected.startDate ? ` – ${dateLabel(currentSelected.endDate)}` : ''}</dd></div>{#if hasHours(currentSelected)}<div><dt>Jam izin</dt><dd>{hourLabel(currentSelected)} WIB</dd></div>{/if}<div><dt>Potongan saldo</dt><dd>{deductionLabel(currentSelected)}</dd></div><div><dt>Pemberi keputusan</dt><dd>{currentSelected.externalApproverName || (currentSelected.approverId ? displayName(currentSelected.approverId) : external ? 'Bos / Manager Pusat (di luar aplikasi)' : 'Atasan langsung')}</dd></div><div class="span"><dt>Alasan pengajuan</dt><dd>{currentSelected.reason}</dd></div>{#if currentSelected.note}<div class="span"><dt>Catatan keputusan</dt><dd>{currentSelected.note}</dd></div>{/if}</dl>
    {#if currentSelected.attachmentUrl}<a class="btn btn-secondary attachment-link" href={currentSelected.attachmentUrl} target="_blank" rel="noopener noreferrer"><Icon name="file" size={16}/>Lihat lampiran</a>{/if}
    {#if selectedConflicts.length && !adjustMode && !correctionOpen}<div class="conflict-box" role="status"><strong>Ada catatan lain pada tanggal yang ditinjau.</strong><ul>{#each selectedConflicts as conflict}<li>{conflict.label}</li>{/each}</ul><p>Periksa kemungkinan tumpang tindih sebelum memberi keputusan. Izin beberapa jam dapat berdampingan dengan kehadiran.</p></div>{/if}
    {#if admin}<p class="hint"><a href={`/reports?tab=audit&entity=${encodeURIComponent(currentSelected.id)}`}>Lihat riwayat perubahan pengajuan ini</a></p>{/if}
    {#if currentSelected.adjustment}
      <section class="adjustment-box" aria-label="Perubahan atau pembatalan terakhir">
        <strong>{currentSelected.adjustment.status === 'pending' ? 'Permintaan' : 'Keputusan'} {currentSelected.adjustment.type === 'change' ? 'perubahan tanggal' : 'pembatalan'}</strong>
        {#if currentSelected.adjustment.type === 'change'}<p>Tanggal diminta: {dateLabel(currentSelected.adjustment.startDate || '')}{currentSelected.adjustment.endDate !== currentSelected.adjustment.startDate ? ` – ${dateLabel(currentSelected.adjustment.endDate || '')}` : ''}</p>{/if}
        <p>Alasan permintaan: {currentSelected.adjustment.reason}</p>
        {#if currentSelected.adjustment.status === 'pending'}<p>Tanggal dan potongan yang tercantum di atas tetap berlaku sampai permintaan ini disetujui.</p>{/if}
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
        <h3>{adjustMode === 'change' ? currentSelected.status === 'needs_info' ? 'Lengkapi pengajuan' : currentSelected.status === 'approved' ? 'Ajukan tanggal baru' : 'Ubah pengajuan' : 'Batalkan pengajuan'}</h3>
        {#if adjustMode === 'change'}
          <div class="form-grid">
            <label class="field">{hasHours(currentSelected) ? 'Tanggal izin' : 'Tanggal mulai'}<input class="input" type="date" bind:value={changeStart} min={todayJakarta()} required/></label>
            {#if !hasHours(currentSelected)}<label class="field">Tanggal selesai<input class="input" type="date" bind:value={changeEnd} min={changeStart} required/></label>{/if}
            {#if hasHours(currentSelected) && currentSelected.status !== 'approved'}
              <label class="field">{currentSelected.extent === 'late_arrival' ? 'Rencana jam datang' : currentSelected.extent === 'early_departure' ? 'Jam pulang yang diminta' : 'Jam keluar'}<input class="input" type="time" bind:value={changeStartTime} required/></label>
              {#if hasInterval(currentSelected)}<label class="field">Jam kembali<input class="input" type="time" bind:value={changeEndTime} required/></label>{/if}
            {/if}
          </div>
          {#if hasHours(currentSelected) && currentSelected.status === 'approved'}<p class="hint">Jam izin tetap {hourLabel(currentSelected)} WIB pada tanggal baru.</p>{/if}
          {#if changeConflicts.length}<div class="conflict-box" role="status"><strong>Ada catatan lain pada tanggal baru.</strong><ul>{#each changeConflicts as conflict}<li>{conflict.label}</li>{/each}</ul><p>Periksa tanggal dan jam. Kehadiran pada hari izin beberapa jam tetap diperbolehkan.</p></div>{/if}
        {/if}
        <label class="field reason">{adjustMode === 'change' && currentSelected.status !== 'approved' ? 'Alasan pengajuan' : `Alasan ${adjustMode === 'change' ? 'perubahan' : 'pembatalan'}`}<textarea class="textarea" rows="3" bind:value={changeReason} minlength="3" required></textarea></label>
        {#if adjustMode === 'change' && currentSelected.status !== 'approved'}
          {#if currentSelected.attachmentUrl}<label class="check"><input type="checkbox" bind:checked={removeAttachment} on:change={() => { if (removeAttachment) changeAttachment = undefined; }}/>Hapus lampiran saat ini</label>{/if}
          {#key removeAttachment}<label class="field reason">{currentSelected.attachmentUrl ? 'Ganti lampiran (opsional)' : 'Lampiran (opsional)'}<input class="input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" on:change={(event) => selectAttachment(event, true)}/></label>{/key}
          <p class="hint">{changeAttachment ? `${changeAttachment.name} · ${(changeAttachment.size / 1024).toFixed(0)} KB` : removeAttachment ? 'Lampiran saat ini akan dihapus saat pengajuan dikirim ulang.' : currentSelected.attachmentUrl ? 'Lampiran saat ini tetap disimpan jika tidak diganti atau dihapus. PDF atau foto, maksimal 5 MB.' : 'PDF atau foto, maksimal 5 MB.'}</p>
        {/if}
        <p class="hint">{currentSelected.status === 'approved' ? 'Tanggal dan potongan sebelumnya tetap berlaku sampai permintaan disetujui.' : currentSelected.status === 'needs_info' ? 'Lengkapi alasan sesuai catatan atasan. Pengajuan akan dikirim kembali untuk ditinjau.' : 'Pengajuan yang belum disetujui dapat diperbarui atau dibatalkan langsung.'}</p>
        <div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => adjustMode = null}>Kembali</button><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Memproses…' : currentSelected.status !== 'approved' && adjustMode === 'change' ? 'Kirim untuk ditinjau' : 'Kirim'}</button></div>
      </form>
    {:else if correctionOpen && canCorrect}
      <form class="review-form" on:submit|preventDefault={submitCorrection}>
        <h3>Koreksi catatan oleh HR</h3>
        <div class="info-box"><Icon name="shield" size={18}/><span>Koreksi langsung menyesuaikan catatan dan saldo. Alasan serta nilai sebelum dan sesudah koreksi tersimpan dalam riwayat perubahan.</span></div>
        <label class="field">Jenis koreksi<select class="select" bind:value={correctionCancel}><option value={false}>Ubah tanggal, jam, dan potongan cuti</option><option value={true}>Batalkan pengajuan yang disetujui</option></select></label>
        {#if !correctionCancel}
          <div class="form-grid"><label class="field">{hasHours(currentSelected) ? 'Tanggal izin' : 'Tanggal mulai'}<input class="input" type="date" bind:value={correctionStart} required/></label>{#if !hasHours(currentSelected)}<label class="field">Tanggal selesai<input class="input" type="date" bind:value={correctionEnd} min={correctionStart} required/></label>{/if}</div>
          {#if hasHours(currentSelected)}<div class="form-grid"><label class="field">{currentSelected.extent === 'late_arrival' ? 'Jam datang setelah koreksi' : currentSelected.extent === 'early_departure' ? 'Jam pulang setelah koreksi' : 'Jam keluar setelah koreksi'}<input class="input" type="time" bind:value={correctionStartTime} required/></label>{#if hasInterval(currentSelected)}<label class="field">Jam kembali setelah koreksi<input class="input" type="time" bind:value={correctionEndTime} required/></label>{/if}</div>{/if}
          <label class="field reason">Jumlah potongan cuti setelah koreksi (hari)<input class="input" type="number" min="0" step="0.5" bind:value={correctionDays} required/></label>
          {#if correctionConflicts.length}<div class="conflict-box" role="status"><strong>Ada catatan lain pada tanggal koreksi.</strong><ul>{#each correctionConflicts as conflict}<li>{conflict.label}</li>{/each}</ul><p>Periksa tanggal dan jam sebelum menyimpan. Izin beberapa jam dapat berdampingan dengan kehadiran.</p></div>{/if}
        {/if}
        <p class="hint">Potongan lama yang dikembalikan ke tahun asal:</p><p class="allocation">{#each Object.entries(originalAllocation) as [year, days]}<span>Saldo {year}: +{days} hari</span>{/each}</p>
        {#if !correctionCancel}<p class="hint">Potongan setelah koreksi:</p><p class="allocation">{#each Object.entries(correctionAllocation) as [year, days]}<span>Saldo {year}: −{days} hari</span>{/each}</p>{/if}
        <p class="hint">Saldo tahun lampau tetap hangus. Isi 0 untuk tanpa potong cuti.</p>
        {#if external}<label class="field reason">Nama pemberi keputusan eksternal<input class="input" bind:value={correctionExternalName} minlength="3" required placeholder="Nama Bos / Manager Pusat"/></label>{/if}
        <label class="field reason">Alasan koreksi HR<textarea class="textarea" rows="3" bind:value={correctionReason} minlength="3" required placeholder="Jelaskan alasan perubahan catatan ini"></textarea></label>
        <div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => correctionOpen = false}>Kembali</button><button class="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Menyimpan…' : correctionCancel ? 'Simpan pembatalan HR' : 'Simpan koreksi HR'}</button></div>
      </form>
    {:else if currentSelected.employeeId === $app.user?.id && ['pending', 'approved', 'needs_info'].includes(currentSelected.status) && currentSelected.adjustment?.status !== 'pending'}
      {#if currentSelected.startDate >= todayJakarta() || currentSelected.status !== 'approved'}
        <div class="form-actions">
          <button class="btn btn-secondary" on:click={() => adjustment('change')}><Icon name="calendar" size={16}/>{currentSelected.status === 'needs_info' ? 'Lengkapi pengajuan' : currentSelected.status === 'approved' ? 'Ubah tanggal' : 'Ubah pengajuan'}</button>
          <button class="btn btn-secondary" on:click={() => adjustment('cancel')}>Batalkan pengajuan</button>
        </div>
      {:else}<p class="hint">Tanggal pengajuan sudah lewat. Hubungi HR untuk memeriksa catatan ini.</p>{/if}
    {/if}
    {#if canCorrect && !adjustMode && !correctionOpen}<div class="form-actions"><button class="btn btn-secondary" on:click={beginCorrection}><Icon name="edit" size={16}/>Koreksi catatan HR</button></div>{/if}
    {#if !adjustMode && !correctionOpen && canDecideLeave(currentSelected) && (currentSelected.status === 'pending' || currentSelected.status === 'needs_info' || currentSelected.adjustment?.status === 'pending')}
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
  .request-symbol { background: var(--surface); color: var(--accent); border-color: var(--panel-border); box-shadow: var(--raised-sm); border-radius: 14px; }
  .request-info h3, .details dd, .review-form h3, .info-box strong { color: var(--ink); }
  .adjustment-tag { background: #ede2c8; color: #79591f; border-radius: 7px; }
  .info-box { background: var(--surface); color: #6a5f3c; border: 1px solid var(--panel-border); box-shadow: var(--inset); border-radius: 14px; }
  .adjustment-box { background: var(--surface-cream); border-color: var(--panel-border); border-radius: 14px; box-shadow: var(--inset); }
  .adjustment-box strong, .adjustment-box p { color: #765a23; }
  .adjustment-note { white-space: pre-wrap; }
  .conflict-box { margin: 1rem 0; padding: .9rem 1rem; color: #79591f; background: #f2e7c8; border: 1px solid var(--panel-border); border-radius: 12px; box-shadow: var(--inset); font-size: .74rem; line-height: 1.7; }
  .conflict-box strong { font-size: .77rem; }
  .conflict-box ul { margin: .5rem 0; padding-left: 1.2rem; }
  .conflict-box p { margin: .45rem 0 0; }
  .hint a { color: var(--accent); text-underline-offset: .2em; }
  .check input { flex-shrink: 0; min-width: 18px; min-height: 18px; }
  @media (max-width: 420px) { .form-grid { grid-template-columns: 1fr; } .form-actions > .btn { flex: 1 1 auto; } }
  @media (max-width: 600px) { .tabs { gap: .15rem; } .tabs button { padding: .6rem .45rem; } .list-heading { padding: .4rem .65rem; } }
</style>
