<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { createClient } from '@supabase/supabase-js';
  import { app, actions } from '#lib/state/app';
  import { supabase, installMfaSession } from '#lib/state/client';
  import { validatePublicSupabaseConfiguration } from '../../lib/configuration';
  import { MfaAccountChanged, MfaFlow, type MfaFactor } from '../../lib/auth-mfa';
  import { acquireMfaScope, type MfaScopeLease } from '../../lib/auth-mfa-scope';
  import Icon from '#lib/components/Icon.svelte';

  let flow: MfaFlow | null = null;
  let scopeLease: MfaScopeLease | null = null;
  let flowUserId: string | null = null;
  let factors: MfaFactor[] = [];
  let selectedFactor = '', code = '', error = '', message = '';
  let enrollment: { factorId: string; qrCode: string; secret: string } | null = null;
  let ready = false, busy = false, destroyed = false, generation = 0;

  function clearSecrets() { code = ''; enrollment = null; }
  function invalidate() { generation += 1; flow?.dispose(); flow = null; flowUserId = null; ready = false; busy = false; factors = []; selectedFactor = ''; clearSecrets(); }
  async function prepare() {
    invalidate(); error = ''; message = ''; busy = true;
    const current = generation;
    try {
      if (!supabase) { await goto('/profile', { replace: true }); return; }
      await actions.refresh();
      if (destroyed || current !== generation) return;
      if (!$app.user && !$app.mfaRequired) throw new Error($app.error ?? 'Silakan login kembali sebelum melanjutkan verifikasi.');
      if (!scopeLease) scopeLease = await acquireMfaScope(sessionStorage, navigator.locks);
      if (destroyed) { scopeLease.release(); scopeLease = null; return; }
      if (current !== generation) return;
      const configuration = validatePublicSupabaseConfiguration(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
      if (configuration.mode !== 'live') throw new Error('Keamanan akun memerlukan koneksi aplikasi.');
      const isolated = createClient(configuration.url, configuration.key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `rk-mfa-${crypto.randomUUID()}` }
      });
      const prepared = new MfaFlow(supabase, isolated, installMfaSession, scopeLease.id);
      flow = prepared;
      const result = await prepared.open();
      if (destroyed || current !== generation) return;
      flowUserId = result.userId; factors = result.factors; selectedFactor = factors[0]?.id ?? ''; ready = true;
    } catch (e) {
      if (!destroyed && current === generation) error = e instanceof Error ? e.message : 'Verifikasi belum dapat disiapkan.';
    } finally { if (!destroyed && current === generation) busy = false; }
  }
  async function enroll() {
    if (!flow || !ready || busy) return;
    const current = generation; clearSecrets(); busy = true; error = ''; message = '';
    try {
      const result = await flow.enroll(factors.length > 0);
      if (destroyed || current !== generation) return;
      enrollment = result;
    } catch (e) { if (!destroyed && current === generation) error = e instanceof Error ? e.message : 'Pendaftaran belum berhasil.'; }
    finally { if (!destroyed && current === generation) busy = false; }
  }
  async function verify() {
    if (!flow || busy || !ready) return;
    const current = generation, submittedCode = code; code = ''; busy = true; error = ''; message = '';
    const wasRequired = $app.mfaRequired;
    try {
      await flow.verify(enrollment?.factorId ?? selectedFactor, submittedCode);
      if (destroyed || current !== generation) return;
      clearSecrets();
      await actions.refresh();
      if (destroyed || current !== generation) return;
      if (!$app.user) throw new Error($app.error ?? 'Verifikasi akun belum selesai. Coba periksa kembali.');
      if (wasRequired) { await goto('/dashboard', { replace: true }); return; }
      await prepare(); message = 'Autentikator berhasil diverifikasi. Simpan perangkat cadangan di tempat yang aman.';
    } catch (e) {
      if (!destroyed && current === generation) {
        if (e instanceof MfaAccountChanged) { invalidate(); error = e.message; }
        else error = e instanceof Error ? e.message : 'Kode belum dapat diverifikasi.';
      }
    } finally { if (!destroyed && current === generation) busy = false; }
  }
  async function cancelEnrollment() {
    if (!flow || busy) return;
    const current = generation; busy = true; error = ''; clearSecrets();
    try { await flow.cancelEnrollment(); }
    catch (e) { if (!destroyed && current === generation) error = e instanceof Error ? e.message : 'Pendaftaran belum dapat dibatalkan.'; }
    finally { if (!destroyed && current === generation) busy = false; }
  }
  async function logout() { invalidate(); busy = true; try { await actions.logout(); await goto('/login', { replace: true }); } catch { error = 'Belum berhasil keluar. Coba kembali.'; busy = false; } }
  onMount(() => {
    void prepare();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (flowUserId && session?.user.id !== flowUserId)) {
        invalidate(); error = 'Akun telah berubah. Masuk kembali atau periksa ulang keamanan akun.';
      }
    });
    return () => { destroyed = true; invalidate(); scopeLease?.release(); scopeLease = null; subscription?.data.subscription.unsubscribe(); };
  });
</script>

<svelte:head><title>Verifikasi keamanan · Rajaklana HR</title><meta name="referrer" content="no-referrer"/></svelte:head>
<main class="security-page">
  <section class="security-card">
    <a class="brand" href="/login"><img src="/icon.svg" alt=""/>rajaklana HR</a>
    <div class="security-icon"><Icon name="shield" size={28}/></div>
    <h1>Keamanan akun</h1>
    <p>Akun dengan akses persetujuan atau pengelolaan tim memerlukan kode autentikator setelah kata sandi.</p>
    {#if !ready}<p role="status">{busy ? 'Menyiapkan verifikasi…' : 'Periksa kembali untuk melanjutkan.'}</p>{/if}
    {#if error}<div class="error" role="alert">{error}</div>{/if}
    {#if message}<div class="success" role="status">{message}</div>{/if}
    {#if ready}
      {#if enrollment}
        <h2>Hubungkan aplikasi autentikator</h2>
        <p>Pindai QR dengan aplikasi autentikator pada perangkat Anda, atau masukkan kunci ini secara manual. QR dan kunci hanya ditampilkan selama halaman ini terbuka.</p>
        <img class="qr" src={enrollment.qrCode} alt="QR pendaftaran autentikator pribadi"/>
        <div class="field">Kunci penyiapan<code class="setup-key">{enrollment.secret}</code></div>
      {:else if factors.length}
        <label class="field">Autentikator<select class="select" bind:value={selectedFactor} disabled={busy}>{#each factors as factor}<option value={factor.id}>{factor.friendly_name?.replace(/\s*\[tab:[^\]]+\]$/, '') || 'Autentikator'}</option>{/each}</select></label>
      {:else}
        <h2>Daftarkan autentikator pertama</h2>
        <p>Siapkan aplikasi autentikator, lalu hubungkan akun Anda. Setelah berhasil, tambahkan autentikator cadangan pada perangkat berbeda.</p>
        <button class="btn btn-primary" on:click={enroll} disabled={busy}>Mulai pendaftaran</button>
      {/if}
      {#if enrollment || (factors.length && $app.mfaRequired)}
        <form on:submit|preventDefault={verify}>
          <label class="field">Kode autentikator<input class="input otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern={'[0-9]{6}'} maxlength="6" bind:value={code} required disabled={busy}/></label>
          <button class="btn btn-primary" disabled={busy || !/^\d{6}$/.test(code)}>{busy ? 'Memverifikasi…' : 'Verifikasi kode'}</button>
        </form>
      {/if}
      {#if enrollment}<button class="btn btn-secondary" on:click={cancelEnrollment} disabled={busy}>Batalkan pendaftaran</button>{/if}
      {#if $app.user && !enrollment}
        <p class="hint">{factors.length} autentikator terverifikasi. Gunakan perangkat cadangan agar tetap bisa masuk jika perangkat utama hilang.</p>
        <button class="btn btn-secondary" on:click={enroll} disabled={busy}>Tambahkan autentikator cadangan</button>
        <a class="btn btn-primary" href="/dashboard">Kembali ke ruang kerja</a>
      {/if}
    {/if}
    <p class="recovery">Tidak bisa mengakses seluruh autentikator? Hubungi Admin HR lain untuk verifikasi identitas dan pemulihan yang dicatat dalam riwayat. Kata sandi saja tidak membuka akses pengelolaan tim.</p>
    <div class="actions"><button class="btn btn-secondary" on:click={prepare} disabled={busy}>Periksa ulang</button><button class="btn btn-secondary" on:click={logout} disabled={busy}>Keluar akun</button></div>
  </section>
</main>
<style>
  .security-page{min-height:100dvh;display:grid;place-items:center;padding:32px 20px;background:var(--surface)}
  .security-card{width:min(520px,100%);padding:30px;border:1px solid var(--panel-border);border-radius:26px;box-shadow:var(--raised);display:flex;flex-direction:column;gap:18px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px}.brand img{width:36px;height:36px}
  .security-icon{display:grid;place-items:center;width:62px;height:62px;border-radius:18px;background:var(--primary);box-shadow:var(--accent-shadow);margin-top:8px}
  h1{font-size:27px;margin:0}h2{font-size:18px;margin:8px 0 0}p{font-size:12px;line-height:1.8;color:var(--muted);margin:0}form{display:flex;flex-direction:column;gap:16px}.qr{width:220px;height:220px;align-self:center;background:white;border-radius:12px;padding:8px}.setup-key{display:block;font-size:14px;line-height:1.8;word-break:break-all;padding:12px;border:1px solid var(--panel-border);border-radius:10px;background:var(--surface-cream)}.otp{letter-spacing:8px;font-size:20px}.actions{display:flex;gap:10px;flex-wrap:wrap}.recovery{border-top:1px solid var(--panel-border);padding-top:16px}.success{font-size:12px;padding:12px;border:1px solid var(--control-border);border-radius:10px;background:var(--yellow-soft)}
  @media(max-width:560px){.security-card{padding:24px 20px}.qr{width:200px;height:200px}}
</style>
