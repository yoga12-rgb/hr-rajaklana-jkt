<script lang="ts">
  export let label = '';
  export let tone: 'green' | 'amber' | 'red' | 'muted' | 'blue' = 'muted';
</script>
<span class="pill {tone}"><span class="dot"></span>{label}</span>
<style>
  .pill { display: inline-flex; align-items: center; gap: .4rem; padding: .38rem .65rem; border-radius: 9px; font-size: .7rem; font-weight: 600; white-space: nowrap; line-height: 1.2; border: 1px solid #ffffff7a; box-shadow: inset 2px 2px 4px #d1c8ac2b, inset -2px -2px 4px #ffffffa1; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .green { color: #5d5334; background: #f0e9d2; }
  .amber { color: #765a1d; background: #efe5cc; }
  .red { color: #823f34; background: #efe0d9; }
  .muted { color: #756942; background: #f0e9d3; }
  .blue { color: #365c70; background: #e0e9eb; }
</style>
