<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { actions } from '#lib/state/app';
  let updateReady = false;
  let registration: ServiceWorkerRegistration | undefined;
  let installing = false;
  onMount(() => {
    void actions.init();
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then((reg) => {
        registration = reg; updateReady = !!reg.waiting;
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) updateReady = true; });
        });
        const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) void reg.update(); };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('online', check);
        check();
      });
    }
  });
  function updateApp() {
    if (!registration?.waiting) return;
    installing = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
</script>
<svelte:head><title>Rajaklana HR · Jabodetabek</title><meta name="description" content="Ruang kerja HR Rajaklana Jabodetabek: karyawan, cuti, izin, dan kehadiran."/></svelte:head>
<slot />
{#if updateReady}<div class="update-banner" role="status"><div><strong>Versi baru sudah tersedia</strong><span>Selesaikan formulir atau selfie Anda, lalu gunakan versi terbaru.</span></div><button class="btn btn-primary" disabled={installing} on:click={updateApp}>{installing ? 'Memperbarui…' : 'Gunakan versi terbaru'}</button></div>{/if}
<style>.update-banner{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 32px));z-index:100;background:white;border:1px solid var(--border);box-shadow:0 12px 40px #3f36171a;border-radius:16px;padding:18px;display:flex;align-items:center;gap:16px}.update-banner strong,.update-banner span{display:block}.update-banner strong{font-size:13px}.update-banner span{font-size:11px;color:var(--muted);line-height:1.5;margin-top:4px}.update-banner .btn{flex-shrink:0}@media(max-width:500px){.update-banner{flex-direction:column;align-items:stretch}}</style>
