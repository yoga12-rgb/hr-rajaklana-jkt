<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { app, actions } from '#lib/state/app';

  let error = '';
  onMount(async () => {
    try {
      await actions.refresh();
      if ($app.user) await goto('/dashboard', { replace: true });
      else await goto('/login', { replace: true });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Sesi belum dapat diperiksa.';
    }
  });
</script>

<svelte:head><title>Memeriksa sesi · Rajaklana HR</title></svelte:head>
<main class="shim" aria-live="polite">
  {#if error}<p role="alert">{error}</p>{:else}<p>Memeriksa sesi akun…</p>{/if}
  <a class="btn btn-secondary" href="/login">Kembali ke login</a>
</main>

<style>
  .shim{min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:14px;background:var(--surface);color:var(--muted);font-size:13px}
  .shim p{margin:0}
</style>
