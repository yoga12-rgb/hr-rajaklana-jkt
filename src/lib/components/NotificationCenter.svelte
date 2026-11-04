<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { app, actions } from '#lib/state/app';
  import type { AppNotification } from '#lib/types';
  import { attendanceSessionStatus } from '#lib/attendance-status';
  import { dateLabel, timeLabel } from './format';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import Feedback from './Feedback.svelte';
  import { devicePushStatus, enableDevicePush, disableDevicePush } from '../device-push';
  import type { DevicePushState } from '../device-push';
  import { notificationDestination } from '../notification-destination';
  let open = false, message = '', now = Date.now();
  let navigatingId = '', readingAll = false, pendingReads = new Set<string>(), readMessage = '';
  let readAccount = '', readGeneration = 0, navigationRevision = 0;
  let pushState:DevicePushState|'loading'='loading',pushBusy=false,mounted=false;
  let checkedAccount='',pushRevision=0;
  $: accountKey=`${$app.mode}:${$app.user?.id??''}:${$app.user?.authUserId??''}`;
  $: if(accountKey!==readAccount){readAccount=accountKey;readGeneration++;navigationRevision++;pendingReads=new Set();readingAll=false;navigatingId='';readMessage='';open=false;}
  $: if(mounted&&accountKey!==checkedAccount){checkedAccount=accountKey;message='';void checkPush();}
  $: inbox = ($app.notifications ?? []).filter(n => n.employeeId === $app.user?.id).slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  $: unread = inbox.filter(n => !n.readAt).length;
  $: overdue = $app.attendanceRecords.find(r => r.employeeId === $app.user?.id && ['due','stale'].includes(attendanceSessionStatus(r,now)));
  onMount(() => {
    mounted=true;
    const interval=window.setInterval(()=>now=Date.now(),30000);
    const focus=()=>{if(open&&document.visibilityState==='visible')void checkPush();};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{mounted=false;pushRevision++;readGeneration++;navigationRevision++;window.clearInterval(interval);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  });
  async function checkPush(){
    if(pushBusy)return;
    const revision=++pushRevision,account=accountKey;
    pushState='loading';
    if($app.mode!=='live'||!$app.user){pushState='disabled';return;}
    try{const state=await devicePushStatus();if(mounted&&revision===pushRevision&&account===accountKey)pushState=state;}
    catch{if(mounted&&revision===pushRevision&&account===accountKey)pushState='unavailable';}
  }
  function openInbox(){now=Date.now();message='';open=true;void checkPush();}
  async function setPush(enable:boolean){
    if(pushBusy)return;
    pushBusy=true;message='';const account=accountKey;pushRevision++;
    try{if(enable)await enableDevicePush();else await disableDevicePush();const state=await devicePushStatus();if(mounted&&account===accountKey)pushState=state;}
    catch(error){if(mounted&&account===accountKey){message=error instanceof Error?error.message:'Pengaturan notifikasi perangkat belum tersimpan.';try{pushState=await devicePushStatus();}catch{pushState='unavailable';}}}
    finally{pushBusy=false;if(mounted&&account!==accountKey)void checkPush();}
  }
  function currentReadScope() {
    const state = get(app);
    return `${state.mode}:${state.user?.id??''}:${state.user?.authUserId??''}`;
  }
  function sameReadScope(scope: string, generation: number) {
    return mounted && generation === readGeneration && scope === currentReadScope();
  }
  async function markRead(notification?: AppNotification) {
    if (notification ? notification.readAt || pendingReads.has(notification.id) : readingAll || pendingReads.size > 0) return;
    const scope = currentReadScope(), generation = readGeneration;
    if (notification) pendingReads = new Set([...pendingReads, notification.id]); else readingAll = true;
    try { await actions.readNotification(notification?.id); }
    catch (error) {
      if (sameReadScope(scope, generation)) readMessage = `Status dibaca belum dapat dikonfirmasi. ${error instanceof Error ? error.message : 'Buka notifikasi untuk mencoba lagi.'}`;
    } finally {
      if (sameReadScope(scope, generation)) {
        if (notification) { const remaining = new Set(pendingReads); remaining.delete(notification.id); pendingReads = remaining; }
        else readingAll = false;
      }
    }
  }
  async function read(notification?: AppNotification) {
    if (navigatingId) return;
    const actor = get(app).user;
    if (!actor || (notification && notification.employeeId !== actor.id)) return;
    readMessage = '';
    if (!notification) { await markRead(); return; }
    const destination = notificationDestination(notification);
    if (!destination) { readMessage = 'Tautan notifikasi belum dapat dibuka. Muat ulang data atau hubungi HR.'; return; }
    const scope = currentReadScope(), generation = readGeneration, navigation = ++navigationRevision;
    navigatingId = notification.id;
    // Opening the destination does not depend on the read marker. The marker
    // is confirmed separately and a failure stays visible after navigation.
    void markRead(notification);
    open = false;
    try { await goto(destination); }
    catch { if (sameReadScope(scope, generation) && navigation === navigationRevision) readMessage = 'Halaman notifikasi belum dapat dibuka. Buka notifikasi untuk mencoba lagi.'; }
    finally { if (sameReadScope(scope, generation) && navigation === navigationRevision) navigatingId = ''; }
  }
</script>

<button class="notification-toggle" type="button" disabled={$app.workspaceLoading} aria-label={`Notifikasi, ${unread} belum dibaca${overdue ? ', pengingat clock out' : ''}`} on:click={openInbox}>
  <Icon name="bell" size={20}/>
  {#if unread || overdue}<span class="badge">{unread ? unread > 99 ? '99+' : unread : '!'}</span>{/if}
</button>
{#if readMessage && !open}<aside class="notification-status" role="alert"><span>{readMessage}</span><button type="button" class="retry-read" on:click={openInbox}>Buka notifikasi</button><button type="button" class="dismiss-read" aria-label="Tutup pesan notifikasi" on:click={() => readMessage = ''}>×</button></aside>{/if}
<Modal {open} title="Notifikasi" description="Pengajuan, keputusan, dan pengingat Anda." onclose={() => open = false}>
  <Feedback {message} error/>
  <Feedback message={readMessage} error/>
  {#if overdue}
    <a class="reminder" href="/attendance" on:click={() => open = false}><Icon name="clock" size={21}/><span><strong>Sudah waktunya memeriksa clock out</strong><small>Durasi kerja telah mencapai 8 jam. Jika Anda sudah pulang dan lupa mencatat, hubungi HR untuk koreksi.</small></span><Icon name="chevron" size={17}/></a>
  {/if}
  {#if inbox.length}
    <div class="inbox-heading"><span>{unread} belum dibaca</span><button class="btn btn-secondary" type="button" disabled={readingAll || pendingReads.size > 0 || !unread} aria-busy={readingAll} on:click={() => read()}>{readingAll ? 'Menandai…' : 'Tandai semua dibaca'}</button></div>
    <div class="inbox">
      {#each inbox as notification (notification.id)}
        <button class="notification" class:unread={!notification.readAt} type="button" disabled={!!navigatingId} aria-busy={pendingReads.has(notification.id) || navigatingId === notification.id} on:click={() => read(notification)}>
          <span class="notification-icon"><Icon name={notification.readAt ? 'file' : 'bell'} size={19}/></span>
          <span class="notification-copy"><strong>{notification.title}</strong><span>{notification.body}</span><small>{dateLabel(notification.createdAt)} · {timeLabel(notification.createdAt)} WIB{notification.readAt ? ' · Dibaca' : ' · Baru'}</small></span>
          {#if navigatingId === notification.id}<span class="notification-opening" role="status">Membuka…</span>{:else if pendingReads.has(notification.id)}<span class="notification-opening" role="status">Menandai…</span>{:else}<Icon name="chevron" size={16}/>{/if}
        </button>
      {/each}
    </div>
  {:else}<p class="empty">Belum ada notifikasi. Pengajuan dan keputusan berikutnya akan tercatat di sini.</p>{/if}
  <section class="device-push" aria-labelledby="device-push-title" aria-busy={pushBusy||($app.mode==='live'&&pushState==='loading')}>
    <strong id="device-push-title">Notifikasi di perangkat ini</strong>
    <div role="status" aria-live="polite">
      {#if $app.mode!=='live'}<p>Mode demo tidak mengirim notifikasi perangkat. Gunakan aplikasi yang terhubung ke server untuk mengaktifkannya.</p>
      {:else if pushState==='loading'}<p>Memeriksa kesiapan notifikasi…</p>
      {:else if pushState==='install_required'}
        <p>Di iPhone/iPad, buka aplikasi dari ikon Layar Utama untuk menggunakan notifikasi. Memerlukan iOS/iPadOS 16.4 atau lebih baru.</p>
        <ol class="install-steps"><li>Buka aplikasi melalui Safari, lalu pilih Bagikan → Tambah ke Layar Utama.</li><li>Aktifkan Buka sebagai App Web jika pilihan itu muncul, lalu tekan Tambah.</li><li>Buka ikon yang baru dipasang, login, lalu buka lonceng ini kembali.</li></ol>
      {:else if pushState==='insecure'}<p>Notifikasi memerlukan sambungan aman. Buka aplikasi melalui alamat HTTPS, lalu periksa ulang.</p>
      {:else if pushState==='unsupported'}<p>Browser atau versi sistem ini belum mendukung notifikasi perangkat. Gunakan browser dan sistem yang mendukung; kotak notifikasi di aplikasi tetap tersedia.</p>
      {:else if pushState==='denied'}<p>Izin notifikasi diblokir. Aktifkan kembali melalui pengaturan notifikasi perangkat atau izin situs, lalu tekan Periksa ulang.</p>
      {:else if pushState==='enabled'}<p>Aktif untuk akun Anda di perangkat ini. Pemberitahuan umum dapat tampil saat aplikasi ditutup. Tetap login agar langganan aktif.</p>
      {:else if pushState==='unavailable'}<p>Kesiapan notifikasi belum dapat dipastikan. Pastikan koneksi internet tersedia, lalu tekan Periksa ulang. Jika tetap gagal, buka ulang aplikasi.</p>
      {:else}<p>Notifikasi belum aktif. Tekan Aktifkan, lalu izinkan pemberitahuan pada perangkat.</p>{/if}
    </div>
    {#if $app.mode==='live'}<div class="push-actions">
      {#if pushState==='enabled'}<button class="btn btn-secondary" disabled={pushBusy} aria-busy={pushBusy} on:click={()=>setPush(false)}>{pushBusy?'Menonaktifkan…':'Nonaktifkan di perangkat ini'}</button>
      {:else if pushState==='disabled'}<button class="btn btn-primary" disabled={pushBusy} aria-busy={pushBusy} on:click={()=>setPush(true)}>{pushBusy?'Mengaktifkan…':'Aktifkan notifikasi perangkat'}</button>{/if}
      <button class="btn btn-secondary" disabled={pushBusy||pushState==='loading'} aria-busy={!pushBusy && pushState==='loading'} on:click={()=>checkPush()}>{pushState==='loading'?'Memeriksa…':'Periksa ulang'}</button>
    </div>{/if}
  </section>
  <p class="hint">Isi pemberitahuan perangkat dibuat umum untuk menjaga privasi. Buka aplikasi untuk melihat rincian. Pengiriman memerlukan koneksi dan dukungan browser; jadwal pengingat dapat terlambat jika perangkat menunda pemberitahuan.</p>
</Modal>

<style>
  .notification-toggle { position: relative; width: 42px; height: 42px; flex: 0 0 42px; display: grid; place-items: center; border: 1px solid var(--panel-border); border-radius: 13px; color: var(--accent); background: var(--surface); box-shadow: var(--raised-sm); }
  .notification-toggle:active { box-shadow: var(--inset); }
  .badge { position: absolute; top: -5px; right: -5px; display: grid; place-items: center; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 10px; background: var(--primary); border: 1px solid var(--control-border); color: var(--ink); font-size: 9px; font-weight: 800; }
  .inbox-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 14px; font-size: 12px; color: var(--muted); }
  .inbox-heading .btn { min-height: 40px; font-size: 11px; padding: 9px 11px; }
  .inbox { display: grid; gap: 10px; }
  .notification { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px; text-align: left; border: 1px solid var(--panel-border); border-radius: 15px; background: var(--surface); color: var(--ink); }
  .notification.unread { background: var(--surface-cream); border-left: 4px solid var(--primary); }
  .notification-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px; color: var(--accent); }
  .notification-copy { display: grid; gap: 5px; flex: 1; min-width: 0; }
  .notification-copy strong { font-size: 12px; line-height: 1.5; }
  .notification-copy > span, .notification-copy small { font-size: 10px; color: var(--muted); line-height: 1.6; }
  .notification-copy small { font-size: 9px; }
  .notification-opening { font-size: 10px; color: var(--muted); }
  .notification-status { position: fixed; z-index: 80; right: 18px; bottom: calc(100px + env(safe-area-inset-bottom)); max-width: min(440px, calc(100vw - 36px)); display: flex; align-items: center; gap: 10px; padding: 14px; border: 1px solid var(--control-border); border-radius: 15px; background: var(--surface); color: var(--ink); box-shadow: var(--raised-sm); font-size: 12px; line-height: 1.6; }
  .notification-status span { flex: 1; }.retry-read { padding: 6px; font-size: 11px; font-weight: 600; color: var(--accent); background: transparent; border: 0; }.dismiss-read { border: 0; border-radius: 8px; background: transparent; color: var(--muted); min-width: 32px; min-height: 32px; font-size: 20px; }
  .reminder { display: flex; align-items: center; gap: 11px; padding: 14px; margin-bottom: 16px; border: 1px solid var(--control-border); border-left: 4px solid var(--primary); border-radius: 14px; background: var(--surface-cream); }
  .reminder > span { flex: 1; }
  .reminder strong, .reminder small { display: block; font-size: 12px; line-height: 1.6; }
  .reminder small { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .empty { padding: 22px 8px; text-align: center; font-size: 12px; line-height: 1.8; color: var(--muted); }
  .hint { margin: 18px 0 0; font-size: 10px; line-height: 1.7; color: var(--muted); }
  .device-push { margin-top:18px;padding:14px;border:1px solid var(--control-border);border-radius:14px;background:var(--surface-cream); }
  .device-push strong { font-size:12px; }.device-push p {font-size:11px;line-height:1.7;color:var(--muted)}.device-push .btn{font-size:11px;min-height:42px}
  .push-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.install-steps{padding-left:18px;font-size:11px;line-height:1.8;color:var(--muted)}.install-steps li+li{margin-top:6px}
</style>
