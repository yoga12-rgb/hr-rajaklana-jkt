<script lang="ts">
  import { app, actions } from '#lib/state/app';
  import { goto } from '$app/navigation';
  import Icon from '#lib/components/Icon.svelte';
  let number = '', password = '', busy = false, error = '';
  $: if ($app.initialized && $app.user) void goto('/dashboard', { replaceState:true });
  async function login() { busy=true;error='';try{await actions.login(number,password);await goto('/dashboard');}catch(e){error=e instanceof Error?e.message:'Belum berhasil masuk.';}finally{busy=false;} }
  async function demo(employeeId:string) { busy=true;try{await actions.switchDemoUser(employeeId);await goto('/dashboard');}finally{busy=false;} }
</script>
<svelte:head><title>Masuk · Rajaklana HR</title></svelte:head>
<main class="login-page"><section class="story"><a class="brand" href="/"><img src="/icon.svg" alt=""/>rajaklana<span>HR</span></a><div class="story-copy"><span class="eyebrow">RUANG KERJA JABODETABEK</span><h1>Tim yang hebat.<br/>Hari yang<br/><span>lebih teratur.</span></h1><p>Kehadiran, pengajuan, dan informasi kerja.<br/>Semua dekat, dalam satu ruang.</p><div class="story-features"><span><Icon name="clock" size={17}/>Catat kehadiran</span><span><Icon name="calendar" size={17}/>Ajukan cuti & izin</span><span><Icon name="users" size={17}/>Terhubung dengan tim</span></div></div><small>RAJAKLANA · PEOPLE & WORK</small><div class="orb one"></div><div class="orb two"></div></section><section class="form-section"><div class="form-card"><span class="welcome">SELAMAT DATANG KEMBALI</span><h2>Masuk ke ruang kerja</h2><p>Gunakan nomor karyawan dan kata sandi Anda.</p><form on:submit|preventDefault={login}><label class="field">Nomor karyawan<input class="input" bind:value={number} placeholder="RK000001" required autocomplete="username" autocapitalize="characters"/></label><label class="field">Kata sandi<input class="input" type="password" bind:value={password} placeholder="Masukkan kata sandi" required autocomplete="current-password"/></label>{#if error}<div class="error" role="alert">{error}</div>{/if}<button class="btn btn-primary" disabled={busy||!$app.initialized}>{busy?'Memeriksa akun…':'Masuk'}<Icon name="arrow-right" size={17}/></button></form><div class="forgot"><Icon name="lock" size={13}/><span>Lupa kata sandi? Hubungi Admin HR untuk tautan pemulihan.</span></div>{#if $app.mode==='demo'}<div class="demo"><strong>Coba ruang kerja</strong><p>Data contoh, tanpa koneksi Supabase. Pilih peran untuk mencoba alurnya.</p><div class="demo-buttons"><button class="btn btn-secondary" on:click={()=>demo('employee-1')} disabled={busy}>Admin HR</button><button class="btn btn-secondary" on:click={()=>demo('employee-3')} disabled={busy}>Head Baker</button><button class="btn btn-secondary" on:click={()=>demo('employee-4')} disabled={busy}>Kasir</button></div><small>Login demo: RK000001 / DemoRajaklana123!</small></div>{/if}<div class="privacy"><Icon name="shield" size={14}/>Akses pribadi untuk karyawan Rajaklana</div></div></section></main>
<style>
.login-page { min-height: 100dvh; display: grid; grid-template-columns: 1fr 1fr; }
.story { position: relative; overflow: hidden; background: var(--primary); color: var(--ink); padding: 46px 58px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: inset -12px -12px 35px #ffde6b, inset 12px 12px 35px #d0aa35; }
.brand { display: flex; align-items: center; gap: 13px; font-family: Manrope; font-size: 27px; font-weight: 800; letter-spacing: -1.3px; z-index: 1; }
.brand img { width: 40px; height: 40px; border: 1px solid #ffffff55; border-radius: 13px; box-shadow: 4px 4px 10px #d0aa35, -4px -4px 10px #ffdf6c; }
.brand > span { font-family: 'DM Sans'; font-size: 9px; letter-spacing: 1px; font-weight: 600; border: 1px solid #80661f55; padding: 6px 8px; border-radius: 7px; margin-left: 6px; }
.story-copy { position: relative; z-index: 1; padding: 60px 0; }
.eyebrow { font-size: 9px; letter-spacing: 2.5px; color: #655018; }
.story h1 { font-size: clamp(40px, 4.6vw, 68px); line-height: 1.15; font-weight: 600; margin: 23px 0 26px; }
.story h1 > span { color: #70520d; }
.story p { font-size: 13px; color: #5d4a19; line-height: 1.9; }
.story-features { display: flex; flex-direction: column; gap: 17px; margin-top: 40px; }
.story-features span { display: flex; align-items: center; gap: 12px; font-size: 11px; color: #5d4a19; }
.story > small { font-size: 8px; letter-spacing: 2px; color: #655018; z-index: 1; }
.orb { position: absolute; border: 1px solid #ffffff33; border-radius: 50%; pointer-events: none; background: var(--primary); box-shadow: 14px 14px 30px #d0aa35, -14px -14px 30px #ffde6b; }
.one { width: 570px; height: 570px; right: -350px; bottom: -90px; }
.two { width: 420px; height: 420px; right: -270px; bottom: -15px; box-shadow: inset 10px 10px 25px #d0aa35, inset -10px -10px 25px #ffde6b; }
.form-section { display: flex; align-items: center; justify-content: center; padding: 60px 40px; background: var(--surface); }
.form-card { width: min(440px, 100%); background: var(--surface); border: 1px solid #ffffffb0; border-radius: 28px; padding: 34px; box-shadow: 12px 12px 28px #e7dbb6, -12px -12px 28px #ffffff; }
.welcome { font-size: 9px; letter-spacing: 1.7px; color: var(--muted); }
.form-card h2 { font-size: 27px; font-weight: 700; margin: 15px 0; }
.form-card > p { font-size: 12px; color: var(--muted); line-height: 1.7; margin-bottom: 30px; }
.form-card form { display: flex; flex-direction: column; gap: 20px; }
.form-card form > .btn { margin-top: 5px; justify-content: space-between; padding: 14px 17px; }
.forgot { display: flex; align-items: flex-start; gap: 7px; color: var(--muted); font-size: 11px; line-height: 1.7; margin: 18px 0 28px; }
.forgot :global(svg) { flex-shrink: 0; margin-top: 2px; }
.demo { border: 1px solid #ffffff8c; background: var(--surface); padding: 18px; border-radius: 17px; box-shadow: var(--inset); }
.demo strong { font-size: 12px; }
.demo p { font-size: 11px; line-height: 1.7; color: var(--muted); margin: 7px 0 13px; }
.demo-buttons { display: flex; gap: 9px; flex-wrap: wrap; }
.demo-buttons .btn { font-size: 11px; padding: 9px 12px; min-height: 44px; }
.demo small { display: block; font-size: 10px; margin-top: 15px; color: var(--muted); }
.privacy { display: flex; justify-content: center; align-items: center; gap: 7px; margin-top: 26px; font-size: 10px; color: var(--muted); }
@media (max-width: 1050px) { .story { padding: 40px; } .form-section { padding: 40px 24px; } .form-card { padding: 27px; } }
@media (max-width: 760px) {
  .login-page { grid-template-columns: 1fr; } .story { padding: 26px 26px 32px; min-height: 290px; border-radius: 0 0 32px 32px; } .story-copy { padding: 26px 0 0; } .story h1 { font-size: 34px; line-height: 1.15; margin: 14px 0 0; } .story-copy > p, .story-features, .story > small { display: none; }
  .brand { font-size: 23px; } .brand img { width: 35px; height: 35px; } .eyebrow { font-size: 8px; }
  .form-section { padding: 28px 20px 36px; } .form-card { width: min(440px, 100%); padding: 25px 22px; border-radius: 25px; } .form-card h2 { font-size: 24px; } .privacy { font-size: 9px; }
}
</style>
