<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { app, actions } from '#lib/state/app';
  import type { AppNotification } from '#lib/types';
  import { attendanceSessionStatus } from '#lib/attendance-status';
  import { dateLabel, timeLabel } from './format';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import Feedback from './Feedback.svelte';
  import { devicePushStatus, enableDevicePush, disableDevicePush } from '../device-push';
  let open = false, saving = false, message = '', now = Date.now();
  let pushState='loading',pushBusy=false;
  $: inbox = ($app.notifications ?? []).filter(n => n.employeeId === $app.user?.id).slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  $: unread = inbox.filter(n => !n.readAt).length;
  $: overdue = $app.attendanceRecords.find(r => r.employeeId === $app.user?.id && ['due','stale'].includes(attendanceSessionStatus(r,now)));
  onMount(() => { void devicePushStatus().then(state=>pushState=state).catch(()=>pushState='disabled'); const interval = window.setInterval(() => now = Date.now(), 30000); return () => window.clearInterval(interval); });
  async function setPush(enable:boolean){pushBusy=true;message='';try{if(enable)await enableDevicePush();else await disableDevicePush();pushState=await devicePushStatus();}catch(error){message=error instanceof Error?error.message:'Pengaturan notifikasi perangkat belum tersimpan.';}finally{pushBusy=false;}}
  async function read(notification?: AppNotification) {
    if (saving) return;
    saving = true; message = '';
    try {
      await actions.readNotification(notification?.id);
      if (notification) { open = false; await goto(/^\/(leave|attendance|reports|assignments)\?/.test(notification.href)?notification.href:'/dashboard'); }
    } catch (error) { message = error instanceof Error ? error.message : 'Notifikasi belum berhasil diperbarui.'; }
    finally { saving = false; }
  }
</script>

<button class="notification-toggle" type="button" aria-label={`Notifikasi, ${unread} belum dibaca${overdue ? ', pengingat clock out' : ''}`} on:click={() => { now = Date.now(); message = ''; open = true; }}>
  <Icon name="bell" size={20}/>
  {#if unread || overdue}<span class="badge">{unread ? unread > 99 ? '99+' : unread : '!'}</span>{/if}
</button>
<Modal {open} title="Notifikasi" description="Pengajuan, keputusan, dan pengingat Anda." onclose={() => open = false}>
  <Feedback {message} error/>
  {#if overdue}
    <a class="reminder" href="/attendance" on:click={() => open = false}><Icon name="clock" size={21}/><span><strong>Sudah waktunya memeriksa clock out</strong><small>Durasi kerja telah mencapai 8 jam. Jika Anda sudah pulang dan lupa mencatat, hubungi HR untuk koreksi.</small></span><Icon name="chevron" size={17}/></a>
  {/if}
  {#if inbox.length}
    <div class="inbox-heading"><span>{unread} belum dibaca</span><button class="btn btn-secondary" type="button" disabled={saving || !unread} on:click={() => read()}>Tandai semua dibaca</button></div>
    <div class="inbox">
      {#each inbox as notification (notification.id)}
        <button class="notification" class:unread={!notification.readAt} type="button" disabled={saving} on:click={() => read(notification)}>
          <span class="notification-icon"><Icon name={notification.readAt ? 'file' : 'bell'} size={19}/></span>
          <span class="notification-copy"><strong>{notification.title}</strong><span>{notification.body}</span><small>{dateLabel(notification.createdAt)} · {timeLabel(notification.createdAt)} WIB{notification.readAt ? ' · Dibaca' : ' · Baru'}</small></span>
          <Icon name="chevron" size={16}/>
        </button>
      {/each}
    </div>
  {:else}<p class="empty">Belum ada notifikasi. Pengajuan dan keputusan berikutnya akan tercatat di sini.</p>{/if}
  <div class="device-push"><strong>Notifikasi di perangkat ini</strong><p>{pushState==='enabled'?'Aktif. Pemberitahuan umum dapat tampil saat aplikasi ditutup.':pushState==='denied'?'Izin diblokir browser. Ubah izin melalui pengaturan situs bila ingin mengaktifkannya.':pushState==='unsupported'?'Browser ini belum mendukung notifikasi perangkat. Di iPhone/iPad, pasang aplikasi ke Layar Utama terlebih dahulu.':'Aktifkan untuk menerima pemberitahuan ketika aplikasi ditutup.'}</p>{#if pushState==='enabled'}<button class="btn btn-secondary" disabled={pushBusy} on:click={()=>setPush(false)}>Nonaktifkan di perangkat ini</button>{:else if !['unsupported','denied'].includes(pushState)}<button class="btn btn-secondary" disabled={pushBusy||pushState==='loading'||$app.mode!=='live'} on:click={()=>setPush(true)}>{pushBusy?'Mengaktifkan…':'Aktifkan notifikasi perangkat'}</button>{/if}</div>
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
  .reminder { display: flex; align-items: center; gap: 11px; padding: 14px; margin-bottom: 16px; border: 1px solid var(--control-border); border-left: 4px solid var(--primary); border-radius: 14px; background: var(--surface-cream); }
  .reminder > span { flex: 1; }
  .reminder strong, .reminder small { display: block; font-size: 12px; line-height: 1.6; }
  .reminder small { font-size: 11px; color: var(--muted); margin-top: 4px; }
  .empty { padding: 22px 8px; text-align: center; font-size: 12px; line-height: 1.8; color: var(--muted); }
  .hint { margin: 18px 0 0; font-size: 10px; line-height: 1.7; color: var(--muted); }
  .device-push { margin-top:18px;padding:14px;border:1px solid var(--control-border);border-radius:14px;background:var(--surface-cream); }
  .device-push strong { font-size:12px; }.device-push p {font-size:11px;line-height:1.7;color:var(--muted)}.device-push .btn{font-size:11px;min-height:42px}
</style>
