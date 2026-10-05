<script lang="ts">
  import Icon from './Icon.svelte';
  export let message = '';
  export let error = false;
</script>
{#if message}<div class:error class="feedback" role={error ? 'alert' : 'status'}><Icon name={error ? 'alert' : 'check'} size={17}/><span>{message}</span></div>{/if}
<style>
  .feedback { display: flex; align-items: flex-start; gap: .6rem; border-radius: 13px; padding: .9rem 1rem; font-size: .81rem; line-height: 1.6; background: #f0e9d2; color: #5c512e; border: 1px solid #cbc2a3; margin: 0 0 1rem; box-shadow: inset 2px 2px 5px #e2d4a847, inset -2px -2px 5px #ffffff73; }
  .feedback :global(svg) { flex-shrink: 0; margin-top: 3px; }
  .error { background: #f0e2d9; color: #843d32; border-color: #d2b4a6; }
</style>
