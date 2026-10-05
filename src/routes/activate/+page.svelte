<script lang="ts">
  import { onMount } from 'svelte';
  import { actions, app } from '#lib/state/app';
  let token='',purpose='activate',name='',number='',password='',confirm='',error='',busy=false,done=false,loaded=false;
  onMount(()=>{void load();});
  async function load(){await actions.init();const url=new URL(location.href);token=new URLSearchParams(url.hash.slice(1)).get('token')??url.searchParams.get('token')??'';try{if(!token)throw new Error('Tautan tidak lengkap. Minta tautan baru kepada HR.');const data=await actions.inspectToken(token);purpose=data.purpose;name=data.full_name;number=data.employee_number;loaded=true;}catch(e){error=e instanceof Error?e.message:'Tautan tidak dapat dibuka.';}}
  async function activate(){error='';busy=true;try{if(password!==confirm)throw new Error('Konfirmasi kata sandi belum sama.');await actions.activate(token,password,purpose);done=true;password='';confirm='';history.replaceState(null,'','/activate');}catch(e){error=e instanceof Error?e.message:'Aktivasi belum berhasil.';}finally{busy=false;}}
</script>
<svelte:head><title>{purpose==='reset'?'Pemulihan akun':'Aktivasi akun'} · Rajaklana HR</title><meta name="robots" content="noindex,nofollow"/><meta name="referrer" content="no-referrer"/></svelte:head>
<main><a class="brand" href="/login"><img src="/icon.svg" alt=""/>rajaklana HR</a><section class="panel"><span class="eyebrow">RUANG KERJA JABODETABEK</span>{#if done}<h1>Akun siap digunakan</h1><p>{purpose==='reset'?'Kata sandi telah diperbarui.':'Aktivasi berhasil.'} Masuk menggunakan nomor karyawan <strong>{number}</strong>.</p>{#if $app.mode==='demo'}<div class="notice">Ini demonstrasi lokal. Akun hanya tersedia pada browser ini.</div>{/if}<a class="btn btn-primary" href="/login">Masuk ke aplikasi</a>{:else}<h1>{purpose==='reset'?'Buat kata sandi baru':'Selamat bergabung'}</h1>{#if loaded}<p>Halo <strong>{name}</strong>, akun Anda menggunakan nomor karyawan <strong>{number}</strong>.</p><form on:submit|preventDefault={activate}><label class="field">Kata sandi baru<input class="input" type="password" bind:value={password} minlength="10" required autocomplete="new-password"/></label><label class="field">Konfirmasi kata sandi<input class="input" type="password" bind:value={confirm} minlength="10" required autocomplete="new-password"/></label><p class="hint">Minimal 10 karakter. Gunakan gabungan kata, angka, atau simbol yang sulit ditebak.</p>{#if error}<div class="error" role="alert">{error}</div>{/if}<button class="btn btn-primary" disabled={busy}>{busy?'Menyimpan…':purpose==='reset'?'Simpan kata sandi':'Aktifkan akun'}</button></form>{:else if error}<div class="error" role="alert">{error}</div><a href="/login" class="btn btn-secondary">Kembali ke halaman masuk</a>{:else}<p>Memeriksa tautan…</p>{/if}{/if}</section><p class="foot">Tautan pribadi · satu kali penggunaan · berlaku 24 jam</p></main>
<style>
main { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 20px; }
.brand { display: flex; align-items: center; gap: 12px; font-family: Manrope; font-weight: 800; font-size: 24px; letter-spacing: -1px; margin-bottom: 34px; }
.brand img { width: 43px; height: 43px; border-radius: 14px; box-shadow: var(--raised-sm); }
.panel { max-width: 440px; width: 100%; padding: 32px; border-radius: 26px; }
.eyebrow { font-size: 9px; letter-spacing: 1.7px; color: var(--muted); }
h1 { font-size: 25px; margin: 18px 0; }
p { font-size: 13px; line-height: 1.8; color: var(--muted); }
form { display: flex; flex-direction: column; gap: 18px; }
.foot { font-size: 10px; margin: 25px 0; }
.notice { background: var(--surface); box-shadow: var(--inset); border: 1px solid #ffffff8c; padding: 13px; border-radius: 12px; font-size: 11px; margin: 16px 0; }
@media (max-width: 600px) { .panel { padding: 24px; } }
</style>
