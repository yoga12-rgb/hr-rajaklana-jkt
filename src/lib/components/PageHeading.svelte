<script lang="ts">
  export let eyebrow = '';
  export let title = '';
  export let description = '';
</script>

<header class="page-heading">
  <div>
    {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
    <h1>{title}</h1>
    {#if description}<p class="description">{description}</p>{/if}
  </div>
  <div class="actions"><slot /></div>
</header>

<style>
  .page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 1.25rem; margin-bottom: 1.75rem; }
  .eyebrow { font-size: .68rem; text-transform: uppercase; letter-spacing: .15em; font-weight: 700; color: var(--muted); margin: 0 0 .7rem; }
  h1 { font-size: clamp(1.8rem, 3vw, 2.5rem); line-height: 1.12; letter-spacing: -.055em; color: var(--ink); margin: 0; font-weight: 700; }
  .description { margin: .75rem 0 0; font-size: .88rem; color: var(--muted); line-height: 1.7; max-width: 560px; }
  .actions { display: flex; gap: .6rem; flex-shrink: 0; }
  @media (max-width: 650px) { .page-heading { align-items: flex-start; flex-wrap: wrap; margin-bottom: 1.5rem; } .actions { width: 100%; flex-wrap: wrap; } }
</style>
