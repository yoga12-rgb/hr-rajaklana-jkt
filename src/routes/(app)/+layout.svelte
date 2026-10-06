<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  let pathname = '';
  afterNavigate(() => { pathname = window.location.pathname; });
  import { app, actions, isAdmin, isCashier } from '#lib/state/app';
  import Icon from '#lib/components/Icon.svelte';
  import { onMount } from 'svelte';
  let installEvent: (Event & { prompt(): Promise<void> }) | null = null;
  $: admin = isAdmin($app.user);
  $: cashier = isCashier($app.user);
  $: nav = [
    { href:'/dashboard',label:'Beranda',icon:'home' },
    ...((cashier || admin) ? [{ href:'/attendance',label:'Kehadiran',icon:'clock' }] : []),
    { href:'/leave',label:'Cuti & izin',icon:'calendar' },
    ...(admin ? [{ href:'/employees',label:'Karyawan',icon:'users' },{ href:'/organization',label:'Organisasi',icon:'building' },{ href:'/reports',label:'Rekap & riwayat',icon:'chart' }] : []),
    { href:'/profile',label:'Profil saya',icon:'user' },
    { href:'/guide',label:'Panduan',icon:'file' }
  ];
  $: mobileNav = nav.filter(n => !['/organization','/reports','/guide'].includes(n.href));
  $: if ($app.initialized && !$app.user) void goto('/login', { replaceState:true });
  onMount(() => {
    const handler = (event: Event) => { event.preventDefault(); installEvent = event as typeof installEvent; };
    window.addEventListener('beforeinstallprompt',handler); return () => window.removeEventListener('beforeinstallprompt',handler);
  });
  async function install() { await installEvent?.prompt(); installEvent = null; }
  async function logout() { await actions.logout(); await goto('/login'); }
</script>
<svelte:head><title>{pathname === '/guide' ? 'Panduan penggunaan & ketentuan · Rajaklana HR' : 'Rajaklana HR · Jabodetabek'}</title></svelte:head>
{#if !$app.initialized}<div class="loading"><img src="/icon.svg" alt=""/><p>Menyiapkan ruang kerja Anda…</p></div>{:else if $app.user}
<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="/dashboard"><img src="/icon.svg" alt=""/><span>rajaklana<span class="brand-sub">PEOPLE & WORK</span></span></a>
    <div class="workspace"><span class="workspace-dot"></span><div><strong>Jabodetabek</strong><small>Ruang kerja tim</small></div><span class="workspace-tag">HR</span></div>
    <span class="nav-caption">RUANG KERJA</span>
    <nav aria-label="Navigasi utama">{#each nav as item}<a class:active={pathname.startsWith(item.href)} href={item.href}><Icon name={item.icon} size={19}/><span>{item.label}</span>{#if item.href==='/leave' && admin && $app.leaveRequests.some(r=>r.status==='pending')}<i></i>{/if}</a>{/each}</nav>
    <div class="sidebar-bottom">{#if installEvent}<button class="install" on:click={install}><Icon name="download" size={17}/>Pasang aplikasi</button>{/if}<div class="help-card"><span>HARI YANG LEBIH TERATUR</span><p>Fokus pada tim.<br/>Administrasi jadi mudah.</p><div class="help-mark">rk.</div></div><button class="logout" on:click={logout}><Icon name="logout" size={17}/>Keluar akun</button><small>Rajaklana HR · v0.1</small></div>
  </aside>
  <div class="main-area">
    <header class="topbar"><div class="breadcrumb"><span>Rajaklana</span><Icon name="chevron" size={13}/><strong>Jabodetabek</strong></div><div class="topbar-right"><span class="connection" class:offline={!$app.connected}><span></span>{$app.connected?'Terhubung':'Offline'}</span><a class="account" href="/profile"><span class="avatar">{$app.user.fullName.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><span><strong>{$app.user.fullName}</strong><small>{admin?'Admin HR':$app.user.roles.includes('head_baker')?'Head Baker':'Karyawan'}</small></span></a></div></header>
    <main>
      {#if $app.mode==='demo'}<div class="demo-strip"><span><Icon name="info" size={15}/><strong>Mode demo</strong> · Data contoh tersimpan di browser ini.</span><a href="/profile">Ganti akun contoh <Icon name="arrow-right" size={13}/></a></div>{/if}
      {#if !$app.connected}<div class="error">Koneksi terputus. Absensi dan penyimpanan data memerlukan internet.</div>{/if}
      {#if $app.error}<div class="error" role="alert">{$app.error} <button class="retry" on:click={()=>actions.refresh()}>Coba lagi</button></div>{/if}
      <slot />
      <footer class="footer"><span>Rajaklana · Jabodetabek</span><span>Setiap orang, satu ruang kerja.</span></footer>
    </main>
  </div>
</div>
<nav class="bottom-nav" aria-label="Navigasi ponsel">{#each mobileNav as item}<a class:active={pathname.startsWith(item.href)} href={item.href}><Icon name={item.icon} size={21}/><span>{item.label==='Cuti & izin'?'Pengajuan':item.label==='Profil saya'?'Profil':item.label}</span></a>{/each}</nav>
{/if}
<style>
.shell { display: flex; min-height: 100dvh; }
.sidebar { width: 236px; padding: 32px 22px 20px; background: var(--surface); border-right: 1px solid var(--panel-border); box-shadow: 4px 0 12px #d9cca566; position: fixed; inset: 0 auto 0 0; display: flex; flex-direction: column; z-index: 20; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 11px; padding: 0 5px; font-family: Manrope, sans-serif; font-weight: 800; font-size: 23px; letter-spacing: -1.1px; }
.brand img { width: 38px; height: 38px; border-radius: 12px; box-shadow: var(--raised-sm); }
.brand-sub { display: block; font-family: 'DM Sans', sans-serif; font-size: 8px; letter-spacing: 2px; color: var(--muted); font-weight: 600; margin-top: 4px; }
.workspace { display: flex; gap: 11px; align-items: center; border: 1px solid var(--panel-border); padding: 14px 12px; border-radius: 15px; margin: 35px 0 28px; box-shadow: var(--inset); }
.workspace-dot { width: 8px; height: 8px; background: #796d44; border-radius: 50%; box-shadow: 0 0 0 4px #efe8d0; }
.workspace strong { font-size: 12px; }
.workspace small { display: block; font-size: 10px; color: var(--muted); margin-top: 4px; }
.workspace-tag { margin-left: auto; font-size: 9px; color: var(--accent); background: #eee6cc; padding: 5px 7px; border-radius: 6px; }
.nav-caption { font-size: 9px; letter-spacing: 1.5px; color: var(--muted); padding: 0 12px; margin-bottom: 13px; }
.sidebar nav { display: flex; flex-direction: column; gap: 9px; }
.sidebar nav a { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 12px 13px; border-radius: 12px; color: var(--muted); font-size: 12px; font-weight: 500; transition: background .18s, box-shadow .18s; }
.sidebar nav a.active { background: linear-gradient(145deg, #f8d55c, var(--primary)); color: var(--ink); box-shadow: var(--accent-shadow); font-weight: 700; }
.sidebar nav a:hover:not(.active) { background: var(--surface); box-shadow: var(--raised-sm); color: var(--accent); }
.sidebar nav i { width: 6px; height: 6px; border-radius: 50%; background: #e8ddba; margin-left: auto; }
.sidebar-bottom { margin-top: auto; padding-top: 30px; }
.help-card { border-radius: 17px; background: var(--surface-cream); border: 1px solid var(--panel-border); box-shadow: var(--raised); padding: 18px; position: relative; overflow: hidden; }
.help-card > span { font-size: 8px; letter-spacing: 1px; color: #887a4c; }
.help-card p { font-size: 13px; line-height: 1.7; margin: 10px 0 15px; }
.help-mark { font-family: Manrope; font-size: 46px; letter-spacing: -5px; color: #e7dbb6; position: absolute; right: 9px; bottom: 0; }
.logout, .install { display: flex; align-items: center; gap: 11px; min-height: 44px; border: 0; background: transparent; color: var(--muted); padding: 15px 12px; font-size: 11px; width: 100%; border-radius: 12px; }
.logout:hover, .install:hover { box-shadow: var(--inset); }
.install { color: var(--accent); margin-bottom: 12px; }
.sidebar-bottom > small { display: block; padding: 5px 12px; font-size: 9px; color: var(--muted); }
.main-area { margin-left: 236px; flex: 1; min-width: 0; }
.topbar { height: 88px; padding: 0 42px; display: flex; align-items: center; justify-content: space-between; background: var(--surface); border-bottom: 1px solid var(--panel-border); box-shadow: 0 3px 10px #d9cca54d; }
.breadcrumb { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--muted); }
.breadcrumb strong { color: var(--ink); font-weight: 600; }
.topbar-right { display: flex; align-items: center; gap: 26px; }
.connection { display: flex; align-items: center; gap: 6px; font-size: 10px; color: #685d3a; }
.connection > span { width: 6px; height: 6px; border-radius: 50%; background: #796d44; }
.connection.offline { color: #865525; }
.connection.offline > span { background: #ac7439; }
.account { display: flex; align-items: center; gap: 10px; }
.avatar { width: 38px; height: 38px; border-radius: 13px; background: var(--surface); box-shadow: var(--raised-sm); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.account strong { display: block; font-size: 11px; }
.account small { display: block; font-size: 9px; color: var(--muted); margin-top: 4px; }
main { max-width: 1320px; margin: auto; padding: 27px 42px 0; }
.demo-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 10px; color: #71653f; border: 1px solid var(--panel-border); background: var(--surface); box-shadow: var(--inset); border-radius: 12px; padding: 11px 14px; margin-bottom: 27px; }
.demo-strip > span, .demo-strip a { display: flex; align-items: center; gap: 6px; }
.demo-strip strong { font-weight: 600; }
.demo-strip a { font-weight: 600; color: var(--accent); flex-shrink: 0; }
.footer { display: flex; justify-content: space-between; font-size: 9px; color: var(--muted); margin: 36px 0 0; padding: 21px 0; border-top: 1px solid var(--border); }
.bottom-nav { display: none; }
.loading { display: grid; place-content: center; min-height: 100dvh; text-align: center; color: var(--muted); gap: 20px; font-size: 13px; }
.loading img { width: 60px; height: 60px; justify-self: center; border-radius: 18px; box-shadow: var(--raised); }
.retry { border: 0; background: transparent; text-decoration: underline; color: inherit; font-size: 12px; padding: 6px; }
@media (max-width: 1100px) { main { padding: 24px; } .topbar { padding: 0 24px; } .sidebar { width: 210px; padding: 26px 16px; } .main-area { margin-left: 210px; } }
@media (max-width: 760px) {
  .sidebar { display: none; } .main-area { margin-left: 0; } .topbar { height: 68px; padding: 0 20px; } .breadcrumb { font-size: 10px; gap: 8px; } .topbar-right { gap: 12px; } .account > span:not(.avatar) { display: none; } .connection { font-size: 9px; }
  main { padding: 22px 18px calc(110px + env(safe-area-inset-bottom)); }
  .demo-strip { font-size: 9px; padding: 10px 12px; margin-bottom: 24px; align-items: flex-start; } .demo-strip > span { flex-wrap: wrap; gap: 4px; } .demo-strip a { font-size: 0; } .demo-strip a :global(svg) { width: 16px; height: 16px; }
  .bottom-nav { display: flex; position: fixed; bottom: calc(10px + env(safe-area-inset-bottom)); left: 12px; right: 12px; z-index: 30; background: #f6f1e3f5; backdrop-filter: blur(14px); border: 1px solid var(--panel-border); box-shadow: 4px 4px 12px #c6bc9b80, -4px -4px 10px #ffffffb0; border-radius: 22px; padding: 9px 7px; justify-content: space-around; }
  .bottom-nav a { display: flex; align-items: center; flex-direction: column; gap: 5px; min-width: 48px; min-height: 48px; font-size: 9px; color: var(--muted); padding: 7px 6px; border-radius: 14px; }
  .bottom-nav a.active { color: var(--accent); background: var(--surface); box-shadow: var(--inset); font-weight: 700; }
  .footer > span:last-child { display: none; }
}
</style>
