<script lang="ts">
  import Icon from './Icon.svelte';
  export let label = '';
  export let value: string | number = '';
  export let detail = '';
  export let icon = 'chart';
  export let accent = false;
</script>
<div class:accent class="metric"><div class="top"><span>{label}</span><span class="icon"><Icon name={icon} size={18}/></span></div><strong>{value}</strong><p>{detail}</p></div>
<style>
  .metric { background: var(--surface); border: 1px solid var(--panel-border); border-radius: 20px; padding: 1.25rem 1.3rem; min-width: 0; box-shadow: var(--raised); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: .6rem; font-size: .78rem; color: var(--muted); }
  .icon { width: 36px; height: 36px; border-radius: 12px; background: var(--surface); color: var(--accent); display: grid; place-items: center; box-shadow: var(--inset); }
  strong { display: block; margin: .7rem 0 .5rem; font-size: 2rem; line-height: 1; font-weight: 700; letter-spacing: -.065em; color: var(--ink); }
  p { font-size: .71rem; line-height: 1.6; color: var(--muted); margin: 0; }
  .accent { background: var(--yellow-soft); border-color: var(--control-border); }
  .accent .icon { background: var(--yellow-soft); box-shadow: inset 3px 3px 7px #daca96, inset -3px -3px 7px #fff8d1; }
</style>
