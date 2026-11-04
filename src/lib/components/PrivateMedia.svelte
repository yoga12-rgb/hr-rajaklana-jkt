<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { app, actions } from '#lib/state/app';
  import type { AppState } from '../types';
  import type { PrivateMediaBucket } from '../private-media';
  import Icon from './Icon.svelte';
  export let bucket: PrivateMediaBucket;
  export let path: string | undefined = undefined;
  export let src: string | undefined = undefined;
  export let alt = 'Foto privat';
  export let label = 'Lihat foto penuh';
  export let kind: 'image' | 'link' = 'image';
  export let compact = false;
  export let showLink = true;
  let host: HTMLSpanElement;
  let mounted = false, visible = false, loading = false, error = '', url = '';
  let generation = 0, seenKey = '', seenBlocked = true, failedImageUrl = '';
  let resolvedAt = 0;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  $: account = $app.user;
  const scopeFor = (state: AppState) => `${state.mode}:${state.user?.id ?? ''}:${state.user?.authUserId ?? ''}:${state.user?.roles.join(',') ?? ''}:${state.user?.status ?? ''}:${state.user?.accountStatus ?? ''}`;
  $: scope = scopeFor($app);
  $: blocked = !account || Boolean($app.sessionValidating || $app.workspaceLoading || $app.error);
  $: contextKey = `${scope}\n${bucket}\n${path ?? ''}\n${$app.mode === 'demo' ? src ?? '' : ''}`;
  $: if (mounted && (contextKey !== seenKey || blocked !== seenBlocked)) reset(contextKey, blocked);

  function demoUrl(value: string | undefined) {
    if (!value) return '';
    try { return ['blob:', 'https:', 'http:'].includes(new URL(value).protocol) ? value : ''; } catch { return ''; }
  }
  function accessReady(expectedScope: string) {
    // Read the store directly at async/click boundaries. A token or account
    // event can precede Svelte's next reactive flush by one microtask.
    const state = get(app);
    return scopeFor(state) === expectedScope && Boolean(state.user)
      && !state.sessionValidating && !state.workspaceLoading && !state.error;
  }
  function reset(key: string, unavailable: boolean) {
    seenKey = key; seenBlocked = unavailable; generation++;
    if (renewal) clearTimeout(renewal);
    renewal = undefined; loading = false; error = ''; url = ''; failedImageUrl = ''; resolvedAt = 0;
    if (!unavailable && visible) void load();
  }
  function scheduleRenewal() {
    if (renewal) clearTimeout(renewal);
    // The broker caches for at most two minutes, while Storage signs for five.
    // Refresh an open/visible preview before even a cached URL can expire.
    renewal = setTimeout(() => { renewal = undefined; if (mounted && visible && !blocked) void load(true); }, 120_000);
  }
  async function load(force = false) {
    if (!mounted || !visible || blocked || loading) return;
    const revision = generation, key = contextKey, expectedScope = scope;
    if (!accessReady(expectedScope)) return;
    if ($app.mode === 'demo') { url = demoUrl(src); return; }
    if (!path) return;
    loading = true; error = '';
    try {
      const result = await actions.signedMediaUrl(bucket, path, { force });
      if (!mounted || revision !== generation || key !== contextKey || blocked || !accessReady(expectedScope)) return;
      url = result; failedImageUrl = ''; resolvedAt = Date.now(); scheduleRenewal();
    } catch {
      if (mounted && revision === generation && key === contextKey && !blocked && accessReady(expectedScope)) {
        url = ''; error = 'Berkas belum dapat dibuka. Periksa koneksi atau coba lagi.';
      }
    } finally { if (mounted && revision === generation && key === contextKey) loading = false; }
  }
  function imageFailed(event: Event) {
    if (!url || loading || failedImageUrl === url || (event.currentTarget as HTMLImageElement).getAttribute('src') !== url) return;
    failedImageUrl = url; url = ''; error = 'Foto belum dapat ditampilkan. Muat ulang foto untuk mencoba kembali.';
  }
  function opening(event: MouseEvent) {
    if (blocked || !url || loading || !accessReady(scope)) event.preventDefault();
  }
  onMount(() => {
    mounted = true;
    if (typeof IntersectionObserver === 'undefined') { visible = true; reset(contextKey, blocked); }
    else {
      const observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible && !blocked && !loading && (!url || Date.now() - resolvedAt >= 120_000)) void load(Boolean(url));
        if (!visible && renewal) { clearTimeout(renewal); renewal = undefined; }
        else if (visible && url && $app.mode === 'live') scheduleRenewal();
      }, { rootMargin: '100px' });
      observer.observe(host);
      return () => observer.disconnect();
    }
  });
  onDestroy(() => { mounted = false; generation++; if (renewal) clearTimeout(renewal); });
</script>

<span class="private-media" class:compact class:link-only={kind === 'link'} bind:this={host} aria-busy={loading}>
  {#if url && !blocked}
    {#if kind === 'image'}<img {alt} src={url} on:error={imageFailed}/>{/if}
    {#if showLink && !compact}<a class:btn={kind === 'link'} class:btn-secondary={kind === 'link'} class="media-link" href={url} target="_blank" rel="noopener noreferrer" on:click={opening}><Icon name={kind === 'link' ? 'file' : 'arrow-right'} size={14}/>{label}</a>{/if}
    {#if loading && !compact}<span class="media-status" role="status">Memperbarui tautan berkas…</span>{/if}
  {:else if loading}
    <span class="media-status" role="status"><span class="loading-indicator">{compact ? '…' : kind === 'link' ? 'Menyiapkan lampiran…' : 'Memuat foto…'}</span></span>
  {:else if blocked}
    <span class="media-status" role="status">{compact ? '…' : 'Berkas tersedia setelah data akun terverifikasi.'}</span>
  {:else if $app.mode === 'demo' && !demoUrl(src)}
    <span class="media-status">Pratinjau berkas demo tidak tersimpan setelah halaman dimuat ulang.</span>
  {:else if error}
    <span class="media-status" role="status">{compact ? 'Foto belum tersedia' : error}</span><button type="button" class="btn btn-secondary retry-media" on:click={() => load(true)}>{compact ? 'Muat foto' : 'Coba lagi'}</button>
  {:else if !path && !src}
    <span class="media-status">{compact ? '—' : 'Tidak ada berkas pada catatan ini.'}</span>
  {:else}
    <span class="media-status" role="status">{compact ? '…' : 'Menyiapkan berkas…'}</span>
  {/if}
</span>

<style>
  .private-media { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 40px; }
  img { display: block; max-width: 100%; max-height: 430px; border-radius: 14px; object-fit: contain; }
  .media-status { color: var(--muted); font-size: .75rem; line-height: 1.6; text-align: center; }
  .media-link { display: inline-flex; gap: 7px; align-items: center; color: var(--accent); font-size: .75rem; }
  .compact { width: 100%; height: 100%; min-height: 0; border-radius: inherit; overflow: hidden; gap: 2px; }
  .compact img { width: 100%; height: 100%; max-height: none; object-fit: cover; border-radius: inherit; }
  .compact .media-status { font-size: 9px; padding: 2px; }
  .compact .retry-media { min-height: 22px; padding: 3px 5px; font-size: 8px; }
  .link-only { align-items: flex-start; }
  .retry-media { font-size: .75rem; }
</style>
