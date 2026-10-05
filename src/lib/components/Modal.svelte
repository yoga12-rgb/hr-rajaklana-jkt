<script lang="ts">
  import Icon from './Icon.svelte';
  export let open = false;
  export let title = '';
  export let description = '';
  export let onclose: () => void = () => {};
  let dialog: HTMLDialogElement;
  $: if (dialog) { if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }
</script>

<dialog bind:this={dialog} on:cancel={(event) => { event.preventDefault(); onclose(); }}>
  <div class="modal-heading"><div><h2>{title}</h2>{#if description}<p>{description}</p>{/if}</div><button class="close" type="button" aria-label="Tutup" on:click={onclose}><Icon name="close"/></button></div>
  <div class="body"><slot/></div>
</dialog>

<style>
  dialog { width: min(640px, calc(100% - 2rem)); max-height: 88dvh; border: 1px solid #ffffffc2; border-radius: 26px; padding: 0; background: var(--surface); color: var(--ink); box-shadow: 18px 18px 60px #2d281840, -5px -5px 20px #ffffff26; }
  dialog::backdrop { background: #3b35215c; backdrop-filter: blur(5px); }
  .modal-heading { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; padding: 1.5rem 1.5rem 1.1rem; border-bottom: 1px solid var(--border); }
  h2 { font-size: 1.25rem; letter-spacing: -.035em; margin: 0; font-weight: 700; }
  p { font-size: .8rem; line-height: 1.6; color: var(--muted); margin: .5rem 0 0; }
  .close { background: var(--surface); border: 1px solid #e2d4a6; border-radius: 50%; width: 44px; height: 44px; display: grid; place-items: center; color: var(--accent); flex-shrink: 0; box-shadow: var(--raised-sm); }
  .close:active { box-shadow: var(--inset); }
  .body { padding: 1.5rem; }
  @media (max-width: 600px) { dialog { width: calc(100% - 1rem); max-height: 92dvh; border-radius: 22px; } .body { padding: 1.1rem; } .modal-heading { padding: 1.1rem; } }
</style>
