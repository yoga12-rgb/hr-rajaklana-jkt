<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { app, actions, isAdmin, isCashier, displayName, shiftLabel, attendancePermission, attendanceOutlet, attendanceLateStatus } from '#lib/state/app';
  import { attendanceSessionStatus, attendanceLatenessLabel, attendanceDurationReview } from '#lib/attendance-status';
  import { isFreshAttendanceLocation, type AttendanceLocation } from '#lib/attendance-geo';
  import type { Shift, AttendanceRecord, AttendanceCorrectionRequest } from '#lib/types';
  import { createStampedSelfie, selfieTimestampLabel, type SelfieStamp } from '#lib/selfie';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import MetricCard from '#lib/components/MetricCard.svelte';
  import StatusPill from '#lib/components/StatusPill.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Modal from '#lib/components/Modal.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import SelfieGuide from '#lib/components/SelfieGuide.svelte';
  import { dateLabel, timeLabel, durationLabel } from '#lib/components/format';
  let mode: 'in' | 'out' | null = null, selectedRecord: AttendanceRecord | null = null;
  let outletId = '', shift: Shift = 'morning', saving = false, locating = false, cameraLoading = false;
  let message = '', failed = false, cameraError = '', geoError = '';
  let location: AttendanceLocation | null = null;
  let video: HTMLVideoElement, stream: MediaStream | null = null, selfie: Blob | null = null, preview = '';
  let videoAspectRatio = 1;
  let selfieContext: (SelfieStamp & { outletId: string; geoCapturedAt: string }) | null = null, capturing = false;
  let captureRevision = 0, cameraRevision = 0, geoRevision = 0, modalRevision = 0;
  let filterDate = '', outletFilter = '', openedRecordId = '';
  let now = Date.now();
  let correctionOpen = false, correctionRecordId = '', correctionKind = 'forgot_clock_out', correctionDate = '', correctionIn = '', correctionOut = '', correctionReason = '', correctionShift: Shift = 'morning';
  $: admin = isAdmin($app.user ?? undefined);
  $: cashier = isCashier($app.user ?? undefined);
  $: activeSession = $app.attendanceRecords.find((record) => record.employeeId === $app.user?.id && !record.clockOut);
  $: activeStatus = activeSession ? attendanceSessionStatus(activeSession, now) : null;
  $: reviewSessions = $app.attendanceRecords.filter(record => ['stale','review'].includes(attendanceSessionStatus(record, now)));
  $: currentOutlet = $app.outlets.find((outlet) => outlet.id === outletId);
  $: selectedOutlet = mode === 'out' && activeSession && currentOutlet ? attendanceOutlet(activeSession,currentOutlet) : currentOutlet;
  $: myRecords = $app.attendanceRecords.filter((record) => record.employeeId === $app.user?.id);
  $: rows = (admin ? $app.attendanceRecords : myRecords).filter((record) => (!filterDate || jakartaDate(record.clockIn) === filterDate) && (!outletFilter || record.outletId === outletFilter)).slice().sort((a, b) => b.clockIn.localeCompare(a.clockIn));
  $: distance = location && selectedOutlet && typeof selectedOutlet.latitude === 'number' && typeof selectedOutlet.longitude === 'number' ? meters(location.latitude, location.longitude, selectedOutlet.latitude, selectedOutlet.longitude) : null;
  $: locationFresh = isFreshAttendanceLocation(location, now);
  $: validLocation = locationFresh && distance !== null && Number.isFinite(distance) && !!selectedOutlet && distance <= selectedOutlet.radiusMeters && !!location && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 && Number.isFinite(location.accuracy) && location.accuracy > 0 && location.accuracy <= (selectedOutlet.maxAccuracyMeters ?? 100);
  $: today = jakartaDate(new Date(now).toISOString());
  $: todayRecords = myRecords.filter((record) => jakartaDate(record.clockIn) === today);
  $: completedToday = todayRecords.find(record => record.clockOut);
  $: todayAssignment = ($app.cashierAssignments ?? []).find(assignment => assignment.employeeId === $app.user?.id && assignment.workDate === today && assignment.status === 'active');
  $: canStart = !activeSession && !completedToday && !!todayAssignment && todayAssignment.shift !== 'off';
  $: correctionRequests = ($app.attendanceCorrectionRequests ?? []).filter(request => request.employeeId === $app.user?.id).slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  $: plannedStart = shift === 'middle' ? new Date(now).toISOString() : new Date(`${today}T${shift === 'morning' ? selectedOutlet?.morningStart || '07:00' : selectedOutlet?.afternoonStart || '15:00'}:00+07:00`).toISOString();
  $: plannedEnd = addEightHours(plannedStart);
  let requestedRecordId = '', linkedCorrectionId = '', handledCorrectionId = '';
  let selectedCorrection: AttendanceCorrectionRequest | null = null;
  afterNavigate(() => { const query = new URLSearchParams(window.location.search); requestedRecordId = query.get('record') ?? ''; linkedCorrectionId = query.get('request') ?? ''; });
  $: if ($app.initialized && linkedCorrectionId && handledCorrectionId !== linkedCorrectionId) { const request = correctionRequests.find(request => request.id === linkedCorrectionId); if (request) { selectedCorrection = request; handledCorrectionId = linkedCorrectionId; } }
  $: selectedCorrectionCurrent = selectedCorrection ? correctionRequests.find(request => request.id === selectedCorrection?.id) ?? selectedCorrection : null;
  $: if ($app.initialized && requestedRecordId && openedRecordId !== requestedRecordId) {
    const record = $app.attendanceRecords.find(record => record.id === requestedRecordId && (admin || record.employeeId === $app.user?.id));
    if (record) { selectedRecord = record; openedRecordId = requestedRecordId; }
  }
  $: if (!requestedRecordId) openedRecordId = '';
  const addEightHours = (value: string) => new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString();
  const lateText = (record: AttendanceRecord) => attendanceLatenessLabel(attendanceLateStatus(record));
  const lateTone = (record: AttendanceRecord): 'amber' | 'blue' | 'green' => attendanceLateStatus(record).unexcusedMinutes > 0 ? 'amber' : attendanceLateStatus(record).permittedMinutes > 0 ? 'blue' : 'green';
  const outletName = (id: string) => $app.outlets.find((outlet) => outlet.id === id)?.name ?? '—';
  const jakartaDate = (value: string) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value));
  function meters(lat1: number, lon1: number, lat2: number, lon2: number) { const rad = Math.PI / 180; const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  function stopCamera() { stream?.getTracks().forEach((track) => track.stop()); stream = null; videoAspectRatio = 1; }
  function updateVideoRatio() { if (video?.videoWidth && video.videoHeight) videoAspectRatio = video.videoWidth / video.videoHeight; }
  function resetSelfie() { captureRevision++; capturing = false; selfie = null; selfieContext = null; if (preview) URL.revokeObjectURL(preview); preview = ''; }
  function close() { modalRevision++; mode = null; cameraRevision++; geoRevision++; cameraLoading = false; locating = false; stopCamera(); resetSelfie(); location = null; }
  function begin(value: 'in' | 'out') {
    if (value === 'in' && !canStart) { failed = true; message = completedToday ? 'Kehadiran hari ini sudah selesai. Gunakan pengajuan koreksi jika ada kekeliruan.' : 'Penugasan kerja hari ini belum tersedia atau Anda dijadwalkan libur. Hubungi Admin HR.'; return; }
    mode = value; outletId = value === 'out' ? activeSession?.outletId ?? '' : todayAssignment?.outletId ?? '';
    shift = value === 'out' ? activeSession?.shift ?? 'morning' : todayAssignment?.shift !== 'off' ? todayAssignment?.shift ?? 'morning' : 'morning';
    message = ''; cameraError = ''; geoError = ''; location = null; now = Date.now(); resetSelfie(); void getLocation();
  }
  function getLocation(): Promise<boolean> {
    if (mode === 'in') resetSelfie();
    const revision = ++geoRevision; location = null; geoError = '';
    if (!navigator.geolocation) { locating = false; geoError = 'Perangkat ini tidak mendukung lokasi.'; return Promise.resolve(false); }
    locating = true;
    return new Promise(resolve => navigator.geolocation.getCurrentPosition(position => {
      if (revision !== geoRevision || mode === null) { resolve(false); return; }
      const timestamp = position.timestamp;
      if (!Number.isFinite(timestamp)) { locating = false; geoError = 'Waktu GPS tidak valid. Periksa ulang lokasi.'; resolve(false); return; }
      location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, geoCapturedAt: new Date(timestamp).toISOString() };
      now = Date.now(); locating = false; resolve(isFreshAttendanceLocation(location, now));
    }, error => {
      if (revision !== geoRevision || mode === null) { resolve(false); return; }
      locating = false; geoError = error.code === 1 ? 'Akses lokasi ditolak. Izinkan lokasi pada pengaturan browser atau perangkat.' : error.code === 3 ? 'Pencarian lokasi terlalu lama. Coba kembali di area terbuka.' : 'Lokasi belum tersedia. Aktifkan GPS lalu coba kembali.'; resolve(false);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
  }
  async function requireFreshLocation() {
    now = Date.now();
    if (isFreshAttendanceLocation(location, now) && (mode !== 'in' || !selfieContext || now - Date.parse(selfieContext.capturedAt) <= 60_000)) return true;
    resetSelfie(); await getLocation(); await tick();
    failed = true; message = mode === 'in' ? 'Lokasi diperbarui. Ambil selfie baru agar foto dan GPS tetap sesuai, lalu konfirmasi kembali.' : 'Lokasi diperbarui. Periksa hasil GPS lalu konfirmasi pulang kembali.';
    return false;
  }
  function localInput(value: string | null) { return value ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0,16) : ''; }
  function beginCorrection() {
    correctionKind = activeSession ? 'forgot_clock_out' : todayRecords.length ? 'wrong_time' : 'missing_clock_in';
    correctionRecordId = activeSession?.id ?? todayRecords[0]?.id ?? ''; correctionReason = ''; correctionOpen = true; loadCorrectionRecord();
  }
  function loadCorrectionRecord() {
    const record = myRecords.find(record => record.id === correctionRecordId);
    correctionDate = record ? jakartaDate(record.clockIn) : today; correctionIn = localInput(record?.clockIn ?? null); correctionOut = localInput(record?.clockOut ?? null); correctionShift = record?.shift ?? (todayAssignment?.shift !== 'off' ? todayAssignment?.shift ?? 'morning' : 'morning');
  }
  async function submitCorrection() {
    if (saving) return;
    saving = true; message = '';
    try {
      const clockIn = new Date(`${correctionIn}:00+07:00`).toISOString(), clockOut = correctionOut ? new Date(`${correctionOut}:00+07:00`).toISOString() : null;
      if (jakartaDate(clockIn) !== correctionDate || Date.parse(clockIn) > Date.now() || (clockOut && (clockOut < clockIn || Date.parse(clockOut) > Date.now()))) throw new Error('Isi tanggal kerja dan waktu aktual yang sudah terjadi dengan benar.');
      if (correctionReason.trim().length < 3) throw new Error('Jelaskan alasan dan sumber konfirmasi, minimal 3 karakter.');
      await actions.submitAttendanceCorrection({ attendanceId: correctionRecordId || null, workDate: correctionDate, clockIn, clockOut, shift: correctionShift, reason: `${correctionKind === 'missing_clock_in' ? 'Lupa masuk' : correctionKind === 'forgot_clock_out' ? 'Lupa pulang' : correctionKind === 'wrong_shift' ? 'Salah shift' : 'Salah jam'}: ${correctionReason.trim()}` });
      correctionOpen = false; failed = false; message = 'Koreksi diajukan. Waktu asli tetap berlaku sampai Admin HR menyetujui.';
    } catch(error) { failed = true; message = error instanceof Error ? error.message : 'Pengajuan koreksi belum tersimpan.'; } finally { saving = false; }
  }
  async function cancelCorrection(id: string) { if (saving) return; saving = true; try { await actions.cancelAttendanceCorrection(id); failed = false; message = 'Pengajuan koreksi dibatalkan.'; } catch(error) { failed = true; message = error instanceof Error ? error.message : 'Belum dapat dibatalkan.'; } finally { saving = false; } }
  async function startCamera() {
    const revision = ++cameraRevision;
    cameraError = ''; cameraLoading = true; resetSelfie(); stopCamera();
    let opened: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera memerlukan HTTPS dan browser yang mendukung akses kamera.');
      opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      if (revision !== cameraRevision || mode !== 'in') { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened; await tick();
      if (revision !== cameraRevision || mode !== 'in') { opened.getTracks().forEach(track => track.stop()); if (stream === opened) stream = null; return; }
      if (video) { video.srcObject = opened; await video.play(); }
    } catch (error) {
      if (revision !== cameraRevision) { opened?.getTracks().forEach(track => track.stop()); return; }
      stopCamera(); cameraError = error instanceof Error && error.name === 'NotAllowedError' ? 'Akses kamera ditolak. Izinkan kamera di pengaturan browser lalu coba lagi.' : error instanceof Error ? error.message : 'Kamera tidak dapat dibuka.';
    } finally { if (revision === cameraRevision) cameraLoading = false; }
  }
  async function capture() {
    if (capturing || locating) return;
    if (!(await requireFreshLocation())) return;
    if (mode !== 'in' || locating || !validLocation || !location || !selectedOutlet) { cameraError = 'Pastikan lokasi sesuai sebelum mengambil selfie.'; return; }
    if (!video?.videoWidth) { cameraError = 'Kamera belum siap. Tunggu sebentar lalu coba kembali.'; return; }
    const revision = ++captureRevision;
    const snapshot = { outletId, outletName: selectedOutlet.name, ...location, capturedAt: new Date().toISOString() };
    capturing = true; cameraError = '';
    try {
      const blob = await createStampedSelfie(video, snapshot);
      if (revision !== captureRevision || mode !== 'in') return;
      selfie = blob; selfieContext = snapshot; preview = URL.createObjectURL(blob); stopCamera();
    } catch (error) { if (revision === captureRevision) cameraError = error instanceof Error ? error.message : 'Selfie belum berhasil diproses.'; }
    finally { if (revision === captureRevision) capturing = false; }
  }
  async function submit() {
    if (saving || mode === null) return;
    if (!(await requireFreshLocation())) return;
    const submittingMode = mode, revision = modalRevision;
    if (!location || !validLocation) { failed = true; message = 'Lokasi harus berada dalam radius outlet dengan akurasi GPS yang memadai.'; return; }
    if (mode === 'in' && (!selfie || !selfieContext || selfieContext.outletId !== outletId)) { failed = true; message = 'Ambil selfie langsung dari kamera terlebih dahulu.'; return; }
    saving = true; message = '';
    try {
      if (submittingMode === 'in' && selfieContext) await actions.clockIn({ outletId, shift, latitude: selfieContext.latitude, longitude: selfieContext.longitude, accuracy: selfieContext.accuracy, geoCapturedAt: selfieContext.geoCapturedAt, selfie: selfie!, selfieCapturedAt: selfieContext.capturedAt, selfieOutletName: selfieContext.outletName });
      else await actions.clockOut(location);
      if (revision !== modalRevision) return;
      const text = submittingMode === 'in' ? 'Clock in berhasil dicatat. Selamat bekerja!' : 'Clock out berhasil dicatat. Terima kasih untuk hari ini.';
      close(); failed = false; message = text;
    } catch (error) { if (revision === modalRevision) { failed = true; message = error instanceof Error ? error.message : 'Absensi belum berhasil dicatat. Coba kembali.'; } }
    finally { saving = false; }
  }
  $: if (selfieContext && selfieContext.outletId !== outletId) resetSelfie();
  onMount(() => {
    const updateNow = () => { now = Date.now(); };
    const interval = window.setInterval(updateNow, 30_000);
    window.addEventListener('focus', updateNow);
    document.addEventListener('visibilitychange', updateNow);
    updateNow();
    return () => { window.clearInterval(interval); window.removeEventListener('focus', updateNow); document.removeEventListener('visibilitychange', updateNow); };
  });
  onDestroy(close);
</script>

<PageHeading eyebrow="KEHADIRAN KASIR" title="Masuk & pulang" description="Catat kehadiran dengan lokasi outlet dan selfie. Delapan jam, termasuk istirahat."/>
<Feedback {message} error={failed}/>
{#if cashier && activeSession}
  <section class="session-notice" class:needs-review={activeStatus === 'stale'} aria-live="polite">
    <Icon name={activeStatus === 'stale' ? 'alert' : 'clock'} size={21}/><div>
      <strong>{activeStatus === 'stale' ? 'Perlu diperiksa · sesi terbuka 12 jam atau lebih' : activeStatus === 'due' ? 'Pengingat · sudah 8 jam sejak masuk' : 'Sesi kerja masih berjalan'}</strong>
      <p>Masuk {dateLabel(activeSession.clockIn)} pukul {timeLabel(activeSession.clockIn)} WIB. Target 8 jam termasuk istirahat: {dateLabel(addEightHours(activeSession.clockIn))} pukul {timeLabel(addEightHours(activeSession.clockIn))} WIB.</p>
      <p>{activeStatus === 'stale' ? 'Jika lupa clock out, hubungi Admin HR untuk koreksi waktu pulang yang sebenarnya. Sesi ini perlu diselesaikan sebelum clock in berikutnya.' : activeStatus === 'due' ? 'Catat clock out jika pekerjaan sudah selesai. Sesi ini tetap terbuka sampai Anda mencatat pulang.' : 'Clock in berikutnya tersedia setelah sesi ini selesai. Jika catatan sebelumnya belum benar, hubungi Admin HR.'}</p>
    </div>
  </section>
{/if}
{#if admin && reviewSessions.length}<section class="session-notice needs-review"><Icon name="alert" size={21}/><div><strong>{reviewSessions.length} sesi perlu diperiksa</strong><p>Sesi terbuka atau selesai dengan durasi 12 jam atau lebih. Konfirmasi waktu aktual dengan kasir sebelum melakukan koreksi.</p><a href="/reports">Tinjau dan koreksi di Rekap HR</a></div></section>{/if}
{#if cashier}<section class="clock-card"><div class="clock-copy"><span class="clock-date">{dateLabel(today, true)} · WIB</span><h2>{activeSession ? 'Semangat untuk hari ini.' : completedToday ? 'Sudah pulang.' : todayAssignment?.shift === 'off' ? 'Hari libur Anda.' : 'Penugasan hari ini'}</h2><p>{activeSession ? `Anda masuk pukul ${timeLabel(activeSession.clockIn)} · ${shiftLabel(activeSession.shift)} di ${outletName(activeSession.outletId)}.` : completedToday ? 'Kehadiran hari ini sudah selesai. Ajukan koreksi jika waktu atau shift belum benar.' : todayAssignment ? todayAssignment.shift === 'off' ? 'Tidak ada kewajiban clock in. Hubungi HR jika penugasan berubah.' : `${shiftLabel(todayAssignment.shift)} di ${outletName(todayAssignment.outletId)}. Shift dan outlet mengikuti penugasan Admin HR.` : 'Belum ada penugasan. Hubungi Admin HR untuk menetapkan outlet dan shift sebelum clock in.'}</p><div class="clock-tags"><span><Icon name="pin" size={14}/>Lokasi tervalidasi</span><span><Icon name="camera" size={14}/>Selfie saat masuk</span></div></div><div class="clock-action"><span class="clock-circle"><Icon name={activeSession ? 'logout' : 'clock'} size={36} stroke={1.4}/></span>{#if activeSession || canStart}<button class="btn" on:click={() => begin(activeSession ? 'out' : 'in')}><Icon name={activeSession ? 'logout' : 'plus'} size={18}/>{activeSession ? 'Clock out · Pulang' : 'Clock in · Masuk'}</button>{:else}<strong>{completedToday ? 'Sudah pulang' : todayAssignment?.shift === 'off' ? 'Libur' : 'Hubungi Admin HR'}</strong>{/if}<button class="btn btn-secondary" on:click={beginCorrection}>Ajukan koreksi absensi</button><a href="/assignments">Lihat penugasan</a><small>{activeSession ? 'Lokasi diperiksa kembali saat pulang' : 'Catatan tersimpan setelah berhasil'}</small></div></section>{/if}
<div class="metrics">
  <MetricCard label={admin ? 'Sedang bekerja' : 'Clock in hari ini'} value={admin ? $app.attendanceRecords.filter((r) => !r.clockOut).length : todayRecords.length ? timeLabel(todayRecords[0].clockIn) : '—'} detail={admin ? 'Catatan yang belum clock out' : activeSession ? shiftLabel(activeSession.shift) : 'Waktu masuk aktual'} icon="clock"/>
  {#if admin}<MetricCard label="Terlambat berizin" value={$app.attendanceRecords.filter(record => attendanceLateStatus(record).permittedMinutes > 0).length} detail="Catatan memiliki menit yang disetujui" icon="calendar"/><MetricCard label="Terlambat tanpa izin" value={$app.attendanceRecords.filter(record => attendanceLateStatus(record).unexcusedMinutes > 0).length} detail="Termasuk menit melewati batas izin" icon="alert"/>{:else}<MetricCard label="Durasi hari ini" value={todayRecords[0]?.durationMinutes != null ? durationLabel(todayRecords[0].durationMinutes) : activeSession ? durationLabel(Math.max(0, Math.floor((now - Date.parse(activeSession.clockIn)) / 60000))) : '—'} detail="Target 8 jam termasuk istirahat" icon="calendar"/><MetricCard label="Target kerja" value="8 jam" detail="Shift Middle mengikuti waktu masuk" icon="sun" accent/>{/if}
</div>
<section class="panel history-panel"><div class="history-heading"><h2>{admin ? 'Catatan kehadiran tim' : 'Riwayat kehadiran Anda'}</h2><div class="filters"><input class="input" type="date" aria-label="Filter tanggal kehadiran" bind:value={filterDate}/>{#if admin}<select class="select" aria-label="Filter outlet kehadiran" bind:value={outletFilter}><option value="">Semua outlet</option>{#each $app.outlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select>{/if}{#if filterDate || outletFilter}<button class="btn btn-secondary" on:click={() => { filterDate = ''; outletFilter = ''; }}>Reset</button>{/if}</div></div>
  {#if rows.length}<div class="table-wrap"><table><thead><tr>{#if admin}<th>Karyawan</th>{/if}<th>Tanggal & shift</th><th>Masuk</th><th>Pulang</th><th>Durasi</th><th>Status</th><th></th></tr></thead><tbody>{#each rows as record}<tr>{#if admin}<td><strong>{displayName(record.employeeId)}</strong><small>{outletName(record.outletId)}</small></td>{/if}<td>{dateLabel(record.clockIn)}<small>{shiftLabel(record.shift)}</small></td><td>{timeLabel(record.clockIn)}</td><td>{timeLabel(record.clockOut)}</td><td>{durationLabel(record.durationMinutes)}</td><td><StatusPill label={['stale','review'].includes(attendanceSessionStatus(record, now)) ? 'Perlu diperiksa' : lateText(record)} tone={['stale','review'].includes(attendanceSessionStatus(record, now)) ? 'amber' : lateTone(record)}/>{#if !record.clockOut}<small>{['stale','review'].includes(attendanceSessionStatus(record, now)) ? 'Sesi terbuka ≥12 jam · hubungi HR' : attendanceSessionStatus(record, now) === 'due' ? 'Sudah 8 jam · belum clock out' : 'Masih bekerja'}</small>{/if}{#if record.lateMinutes > 0}<small>Aktual: {record.lateMinutes} mnt · {lateText(record)}</small>{/if}{#if attendancePermission(record)}<small>{attendancePermission(record)}</small>{/if}{#if record.source === 'manual'}<small class="corrected">Dicatat manual HR · tanpa validasi GPS/selfie</small>{:else if record.corrected}<small class="corrected">Dikoreksi HR</small>{/if}</td><td><button class="detail-btn" aria-label={`Lihat catatan ${displayName(record.employeeId)} ${dateLabel(record.clockIn)}`} on:click={() => selectedRecord = record}><Icon name="chevron" size={16}/></button></td></tr>{/each}</tbody></table></div>{:else}<EmptyState icon="clock" title="Belum ada catatan kehadiran" description={cashier ? 'Catatan Anda akan muncul setelah clock in berhasil.' : 'Kehadiran kasir akan muncul di sini setelah mereka clock in.'}/>{/if}
</section><p class="footnote"><Icon name="info" size={15}/>Selisih durasi merupakan informasi untuk ditinjau SPV. Tidak otomatis menjadi lembur atau potongan.</p>

<Modal open={mode !== null} title={mode === 'in' ? 'Catat masuk kerja' : 'Catat pulang kerja'} description={mode === 'in' ? 'Lokasi dan selfie wajib agar SPV dapat melakukan pengecekan.' : 'Pastikan Anda masih berada di lokasi outlet.'} onclose={close}>
  {#if mode}<form on:submit|preventDefault={submit}>{#if mode === 'in'}<div class="outlet-summary"><Icon name="building" size={19}/>{selectedOutlet?.name} · {shiftLabel(shift)}<small>Ditetapkan Admin HR</small></div><div class="shift-summary" aria-live="polite"><strong>Shift dipilih: {shiftLabel(shift)}</strong><div><span>{shift === 'middle' ? 'Perkiraan masuk' : 'Jadwal masuk'}</span><b>{dateLabel(plannedStart)} · {timeLabel(plannedStart)} WIB</b></div><div><span>{shift === 'middle' ? 'Perkiraan selesai' : 'Target selesai shift'}</span><b>{dateLabel(plannedEnd)} · {timeLabel(plannedEnd)} WIB</b></div><p>8 jam termasuk istirahat. {shift === 'middle' ? 'Middle mengikuti waktu clock in saat konfirmasi.' : 'Pengingat 8 jam dihitung dari waktu clock in aktual.'}</p></div>{:else}<div class="outlet-summary"><Icon name="building" size={19}/>{selectedOutlet?.name} · {activeSession ? shiftLabel(activeSession.shift) : ''}</div>{/if}
    <div class="geo-card"><div class="geo-top"><span class="geo-icon"><Icon name="pin" size={21}/></span><div><strong>{locating ? 'Memeriksa lokasi Anda…' : validLocation ? 'Lokasi sesuai' : location && !locationFresh ? 'GPS sudah lebih dari 60 detik · perbarui lokasi' : location ? 'Lokasi belum memenuhi syarat' : 'Lokasi belum tersedia'}</strong><p>{location && distance !== null ? `${Math.round(distance)} m dari outlet · Radius ${selectedOutlet?.radiusMeters} m · Akurasi ±${Math.round(location.accuracy)} m` : 'Aktifkan GPS dan izinkan akses lokasi perangkat.'}</p></div></div>{#if geoError}<p class="geo-error">{geoError}</p>{/if}{#if location && location.accuracy > (selectedOutlet?.maxAccuracyMeters ?? 100)}<p class="geo-error">GPS belum cukup akurat. Coba di area terbuka dan periksa kembali.</p>{/if}{#if selectedOutlet && (selectedOutlet.latitude === null || selectedOutlet.longitude === null)}<p class="geo-error">Lokasi outlet belum diatur. Hubungi Admin HR.</p>{/if}<button class="btn btn-secondary" type="button" on:click={getLocation} disabled={locating}><Icon name="refresh" size={14}/>{locating ? 'Mencari…' : 'Periksa ulang lokasi'}</button></div>
    {#if mode === 'in'}
      <div class="camera-section">
        <div class="camera-heading"><h3>Selfie saat masuk</h3><span>Wajib</span></div><p class="hint">Daftarkan wajah dan tunggu persetujuan HR melalui <a href="/face-verification">Verifikasi wajah</a> sebelum mencatat masuk.</p>
        <p class="hint">Foto mencantumkan outlet, GPS, tanggal dan jam pengambilan (WIB).</p>
        <div class="camera-preview" class:has-photo={!!preview}>
          {#if preview}
            <img src={preview} alt="Selfie dengan cap outlet, lokasi dan waktu yang akan dikirim"/>
          {:else}
            <div class="camera-live" style:--camera-ratio={videoAspectRatio}>
              <video bind:this={video} on:loadedmetadata={updateVideoRatio} on:resize={updateVideoRatio} autoplay muted playsinline aria-label="Pratinjau kamera selfie" aria-describedby={stream && !cameraLoading ? 'selfie-guide-instructions' : undefined}></video>
              {#if stream && !cameraLoading}<SelfieGuide/>{/if}
            </div>
            {#if !stream}
              <div class="camera-placeholder"><Icon name="camera" size={34} stroke={1.4}/><p>Ambil foto langsung dari kamera</p><small>Pastikan wajah terlihat dengan jelas</small></div>
            {/if}
          {/if}
        </div>
        {#if stream && !cameraLoading && !preview}
          <p class="camera-guide-copy" id="selfie-guide-instructions"><strong>Posisikan wajah di dalam bingkai.</strong> Sejajarkan mata dengan garis putus-putus, lihat ke kamera, dan pastikan pencahayaan cukup.</p>
        {/if}
        <div class="camera-actions">
          {#if selfie}
            <button class="btn btn-secondary" type="button" on:click={startCamera} disabled={saving}>Ambil ulang</button><span><Icon name="check" size={15}/>Selfie bertag siap</span>
          {:else if stream}
            <button class="btn btn-primary" type="button" on:click={capture} disabled={cameraLoading || capturing || locating || !validLocation}><Icon name="camera" size={17}/>{capturing ? 'Memproses selfie…' : 'Ambil selfie'}</button>
          {:else}
            <button class="btn btn-secondary" type="button" on:click={startCamera} disabled={cameraLoading || saving}><Icon name="camera" size={17}/>{cameraLoading ? 'Membuka kamera…' : 'Buka kamera'}</button>
          {/if}
        </div>
        {#if selfieContext}<p class="hint">Foto diambil {selfieTimestampLabel(selfieContext.capturedAt)}. Waktu foto mengikuti jam perangkat; clock in dicatat saat konfirmasi.</p>{/if}
        {#if cameraError}<Feedback message={cameraError} error/>{/if}
      </div>
    {/if}
    <Feedback {message} error={failed}/><div class="form-actions"><button class="btn btn-secondary" type="button" on:click={close}>Batal</button><button class="btn btn-primary" type="submit" disabled={saving || locating || !validLocation || (mode === 'in' && !selfie)}>{saving ? 'Mencatat…' : mode === 'in' ? 'Konfirmasi clock in' : 'Konfirmasi clock out'}</button></div>
  </form>{/if}
</Modal>


{#if cashier}<section class="panel correction-history"><div class="history-heading"><h2>Pengajuan koreksi absensi</h2><button class="btn btn-secondary" on:click={beginCorrection}>Ajukan koreksi</button></div>{#if correctionRequests.length}{#each correctionRequests as request}<article><div><strong>{dateLabel(request.workDate)} · {shiftLabel(request.shift)}</strong><p>Usulan {dateLabel(request.proposedClockIn)} {timeLabel(request.proposedClockIn)} – {request.proposedClockOut ? `${dateLabel(request.proposedClockOut)} ${timeLabel(request.proposedClockOut)}` : 'masih bekerja'} WIB</p><p>{request.reason}</p>{#if request.decisionNote}<p>Catatan HR: {request.decisionNote}</p>{/if}</div><StatusPill label={request.status === 'pending' ? 'Menunggu HR' : request.status === 'approved' ? 'Disetujui' : request.status === 'rejected' ? 'Ditolak' : 'Dibatalkan'} tone={request.status === 'approved' ? 'green' : request.status === 'rejected' ? 'red' : 'amber'}/>{#if request.status === 'pending'}<button class="btn btn-secondary" disabled={saving} on:click={() => cancelCorrection(request.id)}>Batalkan</button>{/if}</article>{/each}{:else}<p class="hint">Untuk lupa masuk/pulang, salah shift, atau jam yang belum benar. HR meninjau sebelum mengubah catatan.</p>{/if}</section>{/if}
<Modal open={selectedCorrectionCurrent !== null} title="Status koreksi absensi" description="Usulan waktu aktual dan keputusan Admin HR." onclose={() => selectedCorrection = null}>{#if selectedCorrectionCurrent}<dl class="correction-detail"><dt>Tanggal kerja dan shift</dt><dd>{dateLabel(selectedCorrectionCurrent.workDate)} · {shiftLabel(selectedCorrectionCurrent.shift)}</dd><dt>Usulan masuk</dt><dd>{dateLabel(selectedCorrectionCurrent.proposedClockIn)} {timeLabel(selectedCorrectionCurrent.proposedClockIn)} WIB</dd><dt>Usulan pulang</dt><dd>{selectedCorrectionCurrent.proposedClockOut ? `${dateLabel(selectedCorrectionCurrent.proposedClockOut)} ${timeLabel(selectedCorrectionCurrent.proposedClockOut)} WIB` : 'Masih bekerja'}</dd><dt>Alasan</dt><dd>{selectedCorrectionCurrent.reason}</dd><dt>Status</dt><dd>{selectedCorrectionCurrent.status === 'pending' ? 'Menunggu HR' : selectedCorrectionCurrent.status === 'approved' ? 'Disetujui' : selectedCorrectionCurrent.status === 'rejected' ? 'Ditolak' : 'Dibatalkan'}</dd><dt>Catatan HR</dt><dd>{selectedCorrectionCurrent.decisionNote || 'Belum ada keputusan'}</dd></dl>{#if selectedCorrectionCurrent.status === 'pending'}<button class="btn btn-secondary" disabled={saving} on:click={() => cancelCorrection(selectedCorrectionCurrent!.id)}>Batalkan pengajuan</button>{/if}<Feedback {message} error={failed}/>{/if}</Modal>
<Modal open={correctionOpen} title="Ajukan koreksi absensi" description="Masukkan waktu yang benar-benar terjadi. Catatan asli tetap berlaku sampai HR menyetujui." onclose={() => correctionOpen = false}>
<form on:submit|preventDefault={submitCorrection}><label class="field">Kendala<select class="select" bind:value={correctionKind}><option value="missing_clock_in">Lupa / gagal clock in</option><option value="forgot_clock_out">Lupa clock out</option><option value="wrong_shift">Salah shift</option><option value="wrong_time">Jam belum benar</option></select></label><label class="field">Catatan yang diperbaiki<select class="select" bind:value={correctionRecordId} on:change={loadCorrectionRecord}><option value="">Belum ada catatan masuk</option>{#each myRecords as record}<option value={record.id}>{dateLabel(record.clockIn)} · {timeLabel(record.clockIn)} · {shiftLabel(record.shift)}</option>{/each}</select></label><div class="form-grid"><label class="field">Tanggal kerja (WIB)<input class="input" type="date" bind:value={correctionDate} max={today} required/></label><label class="field">Shift aktual<select class="select" bind:value={correctionShift}><option value="morning">Pagi</option><option value="afternoon">Sore</option>{#if $app.user?.canMiddleShift}<option value="middle">Middle</option>{/if}</select></label><label class="field">Masuk aktual (WIB)<input class="input" type="datetime-local" bind:value={correctionIn} required/></label><label class="field">Pulang aktual (WIB)<input class="input" type="datetime-local" bind:value={correctionOut} min={correctionIn}/></label></div><p class="hint">Biarkan pulang kosong hanya jika masih bekerja. Koreksi tidak menggantikan verifikasi GPS dan selfie yang hilang.</p><label class="field">Alasan dan sumber konfirmasi<textarea class="textarea" bind:value={correctionReason} minlength="3" required rows="3" placeholder="Jelaskan kejadian, waktu aktual, dan siapa yang dapat mengonfirmasi…"></textarea></label><Feedback {message} error={failed}/><div class="form-actions"><button class="btn btn-secondary" type="button" on:click={() => correctionOpen = false}>Batal</button><button class="btn btn-primary" disabled={saving}>{saving ? 'Mengirim…' : 'Kirim untuk ditinjau HR'}</button></div></form>
</Modal>

<Modal open={selectedRecord !== null} title="Detail kehadiran" description={selectedRecord ? `${displayName(selectedRecord.employeeId)} · ${dateLabel(selectedRecord.clockIn)}` : ''} onclose={() => selectedRecord = null}>
  {#if selectedRecord}<div class="attendance-detail"><div class="selfie-view">{#if selectedRecord.selfieUrl}<img src={selectedRecord.selfieUrl} alt={`Selfie masuk ${displayName(selectedRecord.employeeId)}`}/><a class="photo-link" href={selectedRecord.selfieUrl} target="_blank" rel="noopener noreferrer">Lihat foto penuh <Icon name="arrow-right" size={14}/></a>{:else}<Icon name="camera" size={30}/><p>{selectedRecord.selfiePath ? 'Selfie tersimpan privat. Pratinjau belum tersedia.' : 'Tidak ada selfie pada catatan ini.'}</p>{/if}</div><dl><div><dt>Outlet & shift</dt><dd>{outletName(selectedRecord.outletId)} · {shiftLabel(selectedRecord.shift)}</dd></div><div><dt>Masuk / pulang</dt><dd>{timeLabel(selectedRecord.clockIn)} / {timeLabel(selectedRecord.clockOut)} WIB</dd></div>{#if selectedRecord.selfieCapturedAt}<div><dt>Foto diambil (waktu perangkat)</dt><dd>{selfieTimestampLabel(selectedRecord.selfieCapturedAt)}</dd></div>{/if}{#if selectedRecord.selfieOutletName}<div><dt>Outlet pada foto</dt><dd>{selectedRecord.selfieOutletName}</dd></div>{/if}{#if selectedRecord.inLatitude != null && selectedRecord.inLongitude != null}<div><dt>Koordinat GPS masuk</dt><dd>{selectedRecord.inLatitude.toFixed(6)}, {selectedRecord.inLongitude.toFixed(6)}</dd></div>{/if}<div><dt>Durasi aktual</dt><dd>{durationLabel(selectedRecord.durationMinutes)}{#if attendanceSessionStatus(selectedRecord,now) === 'review'} · Perlu diperiksa (≥12 jam){/if}</dd></div>{#if selectedRecord.clockOut && attendanceDurationReview(selectedRecord,$app.leaveRequests).shortfallMinutes > 0}<div><dt>Perbandingan target 480 menit</dt><dd>Selisih {attendanceDurationReview(selectedRecord,$app.leaveRequests).shortfallMinutes} menit · {attendanceDurationReview(selectedRecord,$app.leaveRequests).permittedMinutes} menit berizin · {attendanceDurationReview(selectedRecord,$app.leaveRequests).unexplainedMinutes} menit perlu penjelasan. Tidak ada potongan otomatis.</dd></div>{/if}{#if attendanceDurationReview(selectedRecord,$app.leaveRequests).temporaryExit.length}<div><dt>Izin keluar sementara</dt><dd>{attendanceDurationReview(selectedRecord,$app.leaveRequests).temporaryExit.join(', ')} · Jam keluar/kembali aktual belum dilacak terpisah.</dd></div>{/if}<div><dt>Keterlambatan aktual</dt><dd>{selectedRecord.shift === 'middle' ? 'Tidak dihitung untuk Middle' : `${selectedRecord.lateMinutes} menit`}</dd></div>{#if selectedRecord.lateMinutes > 0}<div><dt>Pemisahan keterlambatan</dt><dd>{attendanceLateStatus(selectedRecord).permittedMinutes} menit berizin · {attendanceLateStatus(selectedRecord).unexcusedMinutes} menit tanpa izin</dd></div>{/if}{#if !selectedRecord.clockOut}<div><dt>Status sesi</dt><dd>{attendanceSessionStatus(selectedRecord, now) === 'stale' ? 'Perlu diperiksa · sesi terbuka 12 jam atau lebih. Hubungi Admin HR jika lupa clock out.' : attendanceSessionStatus(selectedRecord, now) === 'due' ? 'Sudah 8 jam · belum clock out' : 'Sedang bekerja'}</dd></div>{/if}{#if attendancePermission(selectedRecord)}<div><dt>Izin terlambat</dt><dd>{attendancePermission(selectedRecord)}</dd></div>{/if}{#if selectedRecord.source === 'manual'}<div><dt>Sumber pencatatan</dt><dd>Manual oleh HR · GPS dan selfie tidak diverifikasi</dd></div>{/if}<div><dt>Jarak clock in / out</dt><dd>{selectedRecord.inDistance === null ? '—' : `${Math.round(selectedRecord.inDistance)} m`} / {selectedRecord.outDistance == null ? '—' : `${Math.round(selectedRecord.outDistance)} m`}</dd></div><div><dt>Akurasi GPS masuk / pulang</dt><dd>{selectedRecord.inAccuracy == null ? '—' : `±${Math.round(selectedRecord.inAccuracy)} m`} / {selectedRecord.outAccuracy == null ? '—' : `±${Math.round(selectedRecord.outAccuracy)} m`}</dd></div>{#if selectedRecord.corrected}<div><dt>Koreksi HR</dt><dd>{selectedRecord.correctionReason}</dd></div>{/if}</dl></div>{#if admin}<a class="btn btn-secondary" href="/reports"><Icon name="edit" size={16}/>Koreksi melalui rekap HR</a>{/if}{/if}
</Modal>

<style>
.session-notice{display:flex;gap:.8rem;padding:1rem 1.2rem;border:1px solid var(--control-border);border-radius:16px;background:var(--surface);color:var(--ink);margin-bottom:1.2rem}.session-notice :global(svg){flex-shrink:0;margin-top:.1rem}.session-notice strong{font-size:.82rem}.session-notice p{font-size:.73rem;line-height:1.7;margin:.4rem 0 0;color:var(--muted)}.session-notice a{display:inline-block;margin-top:.65rem;font-size:.74rem;color:var(--accent)}.session-notice.needs-review{background:#fff2d3;border-color:#d9b76e}.shift-summary{padding:1rem;border:1px solid var(--control-border);background:var(--yellow-soft);border-radius:14px;margin-bottom:1.2rem}.shift-summary>strong{display:block;font-size:.84rem;margin-bottom:.8rem;color:var(--ink)}.shift-summary>div{display:flex;justify-content:space-between;gap:.7rem;font-size:.72rem;line-height:1.8;color:var(--muted)}.shift-summary b{color:var(--ink);font-weight:600;text-align:right}.shift-summary p{font-size:.69rem;color:var(--muted);line-height:1.6;margin:.7rem 0 0}

.clock-card{display:flex;align-items:center;justify-content:space-between;gap:2rem;background:#f2ecd7;border:1px solid var(--border);border-radius:22px;padding:2.1rem 2.4rem;margin-bottom:1.5rem}.clock-date{font-size:.66rem;letter-spacing:.06em;color:var(--muted)}.clock-copy h2{font-size:1.6rem;letter-spacing:-.05em;color:var(--muted);font-weight:600;margin:.8rem 0}.clock-copy p{font-size:.84rem;line-height:1.8;color:var(--muted);max-width:430px;margin:0}.clock-tags{display:flex;gap:1rem;margin-top:1.1rem;flex-wrap:wrap}.clock-tags>span{display:flex;align-items:center;gap:.4rem;font-size:.66rem;color:var(--muted)}.clock-action{display:flex;flex-direction:column;align-items:center;gap:.85rem;flex-shrink:0}.clock-circle{display:grid;place-items:center;width:76px;height:76px;background:#ebe2c4;border:1px solid var(--border);color:var(--muted);border-radius:50%}.clock-action .btn{background:#70633a;border:1px solid var(--border);color:var(--muted);padding:.8rem 1.35rem}.clock-action small{font-size:.61rem;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin-bottom:1.5rem}.history-panel{padding:0;overflow:hidden}.history-heading{padding:1.3rem;display:flex;justify-content:space-between;gap:1rem;align-items:center;border-bottom:1px solid var(--border)}.history-heading h2{font-size:.94rem;font-weight:600;margin:0;color:var(--muted)}.filters{display:flex;align-items:center;gap:.5rem}.filters input,.filters select{font-size:.73rem;padding:.55rem .65rem;max-width:175px}.filters .btn{padding:.55rem;font-size:.65rem}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;white-space:nowrap}th{font-size:.64rem;text-transform:uppercase;letter-spacing:.055em;color:var(--muted);font-weight:600;padding:1rem;background:#fcfbf7}td{font-size:.77rem;color:var(--muted);padding:1rem;border-bottom:1px solid var(--border)}td strong{font-weight:600;font-size:.79rem}td small{display:block;color:var(--muted);font-size:.64rem;margin-top:.4rem}.detail-btn{border:0;padding:.5rem;background:transparent;color:var(--muted);cursor:pointer}.footnote{display:flex;gap:.55rem;align-items:flex-start;font-size:.71rem;line-height:1.7;color:var(--muted);margin:1.2rem .2rem}.footnote :global(svg){flex-shrink:0;margin-top:.1rem}.geo-card{padding:1rem;border:1px solid var(--border);background:#faf8f0;border-radius:12px}.geo-top{display:flex;gap:.75rem;align-items:center}.geo-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:#f3eddb;color:var(--muted);flex-shrink:0}.geo-top strong{font-size:.81rem;color:var(--muted)}.geo-top p{font-size:.66rem;line-height:1.7;color:var(--muted);margin:.4rem 0}.geo-card .btn{margin-top:.75rem;font-size:.67rem;padding:.5rem .75rem}.geo-error{font-size:.71rem;color:var(--muted);line-height:1.7;margin:.75rem 0}.camera-section{margin-top:1.5rem}.camera-heading{display:flex;justify-content:space-between;align-items:center}.camera-heading h3{font-size:.82rem;font-weight:600;color:var(--muted);margin:0 0 .9rem}.camera-heading span{font-size:.6rem;color:var(--muted);margin-bottom:.9rem}.camera-preview{height:270px;position:relative;border-radius:14px;overflow:hidden;background:#f6f2e4;border:1px solid var(--border)}.camera-preview video,.camera-preview img{height:100%;width:100%;object-fit:cover}.camera-preview video{transform:scaleX(-1)}.camera-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted)}.camera-placeholder p{font-size:.79rem;margin:.85rem 0 .4rem}.camera-placeholder small{font-size:.65rem;color:var(--muted)}.camera-actions{display:flex;justify-content:center;align-items:center;gap:1rem;margin:1rem 0}.camera-actions span{display:flex;align-items:center;gap:.4rem;font-size:.71rem;color:var(--muted)}.form-actions{display:flex;justify-content:flex-end;gap:.6rem;border-top:1px solid var(--border);margin-top:1.3rem;padding-top:1.2rem}.outlet-summary{display:flex;align-items:center;gap:.6rem;padding:1rem 0;font-size:.85rem;color:var(--muted)}.attendance-detail{display:grid;grid-template-columns:170px 1fr;gap:1.3rem;margin-bottom:1.5rem}.selfie-view{background:#f8f5ea;border:1px solid var(--border);border-radius:12px;min-height:190px;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);text-align:center;overflow:hidden}.selfie-view img{width:100%;height:100%;object-fit:cover}.selfie-view p{font-size:.67rem;padding:0 1rem;line-height:1.7}.attendance-detail dl{margin:0;display:grid;gap:1rem}.attendance-detail dt{font-size:.64rem;color:var(--muted);margin:0 0 .35rem}.attendance-detail dd{font-size:.77rem;color:var(--muted);margin:0;line-height:1.5}@media(max-width:900px){.history-heading{align-items:flex-start;flex-direction:column}.clock-card{padding:1.6rem;gap:1rem}.clock-copy h2{font-size:1.4rem}.clock-copy p{font-size:.77rem}}@media(max-width:600px){.clock-card{padding:1.4rem;flex-direction:column;align-items:stretch}.clock-action{align-items:stretch;margin-top:.3rem}.clock-circle{display:none}.clock-action small{text-align:center}.clock-copy h2{font-size:1.4rem}.metrics{gap:.5rem}.metrics :global(.metric){padding:1rem .8rem}.metrics :global(.top){font-size:.65rem}.metrics :global(.icon){display:none}.metrics :global(strong){font-size:1.4rem;line-height:1.2}.metrics :global(p){font-size:.6rem}.filters{flex-wrap:wrap;width:100%}.filters input,.filters select{flex:1;max-width:none;min-width:110px}.history-heading{padding:1rem}.attendance-detail{grid-template-columns:1fr}.selfie-view{height:210px;max-width:250px;min-height:unset}.attendance-detail dl{grid-template-columns:1fr 1fr}.camera-preview{height:250px}.footnote{font-size:.65rem}}
  .clock-card { background: var(--yellow-soft); border-color: var(--control-border); box-shadow: var(--raised); border-radius: 25px; }
  .clock-copy h2 { color: #4f472d; font-weight: 700; }
  .clock-copy p, .clock-date, .clock-tags > span, .clock-action small { color: #6f633e; }
  .clock-circle { background: var(--yellow-soft); color: var(--accent); border-color: #ffffff8c; box-shadow: inset 5px 5px 10px #daca96, inset -5px -5px 10px #fff8d1; }
  .clock-action .btn { background: linear-gradient(145deg, #f8d55c, var(--primary)); color: var(--ink); border-color: var(--primary-border); }
  .clock-action .btn:hover { background: var(--primary-hover); }
  .history-heading h2, td strong, .geo-top strong, .camera-heading h3, .attendance-detail dd { color: var(--ink); }
  th { background: #f1ebd6; color: var(--muted); }
  td { color: #5f5535; }
  .detail-btn { min-width: 44px; min-height: 44px; border-radius: 11px; color: var(--accent); }
  .detail-btn:hover { box-shadow: var(--raised-sm); }



  .geo-card { background: var(--surface); border-color: var(--panel-border); border-radius: 16px; box-shadow: var(--inset); }
  .geo-icon { background: var(--surface); color: var(--accent); box-shadow: var(--raised-sm); border-radius: 12px; }
  .geo-error { color: #82582b; }
  .camera-preview { background: var(--surface); border-color: var(--control-border); border-radius: 18px; box-shadow: var(--inset); }
  .camera-actions span { color: #5c512e; }
  .selfie-view { background: var(--surface); border-color: var(--panel-border); box-shadow: var(--inset); border-radius: 16px; color: var(--muted); }
  .camera-preview.has-photo { height: auto; }
  .camera-preview img, .selfie-view img { display: block; width: 100%; height: auto; object-fit: contain; }
  .camera-preview { --camera-height: 270px; display: grid; place-items: center; height: var(--camera-height); }
  .camera-live { position: relative; width: min(100%, calc(var(--camera-height) * var(--camera-ratio))); aspect-ratio: var(--camera-ratio); }
  .camera-live video { display: block; width: 100%; height: 100%; object-fit: contain; }
  .camera-guide-copy { margin: .8rem 0 0; font-size: .72rem; line-height: 1.7; color: var(--muted); }
  .camera-guide-copy strong { display: block; color: var(--ink); font-weight: 600; }
  @media (max-width: 600px) { .camera-preview { --camera-height: 250px; } }
  .selfie-view:has(img) { height: auto; min-height: 0; align-self: start; }
  .photo-link { display: flex; justify-content: center; align-items: center; gap: 7px; min-height: 44px; width: 100%; padding: 10px; border-top: 1px solid var(--panel-border); color: var(--accent); font-size: 11px; }
  .attendance-detail dd { overflow-wrap: anywhere; }
  .outlet-summary { color: var(--ink); }
.correction-history{margin-top:1.2rem;padding:1rem}.correction-history article{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding:1rem 0}.correction-history article>div{flex:1;min-width:200px}.correction-history strong{font-size:.8rem}.correction-history p{font-size:.73rem;line-height:1.7;margin:.4rem 0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:1rem 0}@media(max-width:600px){.form-grid{grid-template-columns:1fr}}
.correction-detail{font-size:.78rem;line-height:1.7}.correction-detail dt{font-weight:600;margin-top:.7rem}.correction-detail dd{margin-left:0;overflow-wrap:anywhere}
</style>
