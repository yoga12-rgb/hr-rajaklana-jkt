<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  onMount(() => { void goto('/dashboard', { replaceState: true }); });
</script>
<p style="padding:32px;color:var(--muted)">Membuka ruang kerja…</p>
