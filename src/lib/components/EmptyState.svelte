<script lang="ts">
  import Icon from './Icon.svelte';
  export let icon = 'file';
  export let title = 'Belum ada data';
  export let description = '';
</script>
<div class="empty"><div class="symbol"><Icon name={icon} size={27}/></div><h3>{title}</h3>{#if description}<p>{description}</p>{/if}<slot/></div>
<style>
  .empty { padding: 3.5rem 1.5rem; text-align: center; color: var(--muted); }
  .symbol { display: grid; place-items: center; width: 62px; height: 62px; border: 1px solid #ffffff7a; background: var(--surface); border-radius: 20px; margin: 0 auto 1.3rem; color: var(--accent); box-shadow: var(--raised-sm); }
  h3 { font-size: 1rem; color: var(--ink); margin: 0 0 .5rem; }
  p { font-size: .84rem; line-height: 1.7; max-width: 380px; margin: .5rem auto 1.25rem; }
</style>
