<script lang="ts">
  import { app, actions } from '#lib/state/app';
  import { todayJakarta } from './format';
  import Feedback from './Feedback.svelte';
  const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  let outletId = '', weekday = new Date(`${todayJakarta()}T12:00:00Z`).getUTCDay(), shift: 'morning' | 'afternoon' | 'middle' = 'morning';
  let minimum = 1, effectiveFrom = todayJakarta(), saving = false, message = '', failed = false;
  $: outlets = $app.outlets.filter(outlet => outlet.active);
  $: if (!outletId && outlets.length) outletId = outlets[0].id;
  $: rows = ($app.staffingRequirements ?? []).filter(row => row.outletId === outletId).slice().sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.weekday - b.weekday || a.shift.localeCompare(b.shift));
  const shiftName = (value: string) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle' }[value] ?? value);
  async function save() {
    if (saving) return;
    saving = true; message = ''; failed = false;
    try { await actions.saveStaffingRequirement({ outletId, weekday: Number(weekday), shift, minimum: Number(minimum), effectiveFrom }); message = 'Kebutuhan minimum tersimpan untuk tanggal berlaku.'; }
    catch(error) { failed = true; message = error instanceof Error ? error.message : 'Kebutuhan minimum belum tersimpan.'; }
    finally { saving = false; }
  }
</script>

<section class="requirement-editor" aria-labelledby="requirement-title">
  <div class="requirement-heading"><div><h3 id="requirement-title">Kebutuhan minimum kasir</h3><p>Diatur per outlet, hari, shift, dan tanggal mulai berlaku. Belum diatur berbeda dari angka nol.</p></div></div>
  <Feedback {message} error={failed}/>
  <form class="requirement-form" on:submit|preventDefault={save}>
    <label class="field">Outlet<select class="select" bind:value={outletId} required>{#each outlets as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label>
    <label class="field">Hari<select class="select" bind:value={weekday}>{#each weekdays as label, index}<option value={index}>{label}</option>{/each}</select></label>
    <label class="field">Shift<select class="select" bind:value={shift}><option value="morning">Pagi</option><option value="afternoon">Sore</option><option value="middle">Middle</option></select></label>
    <label class="field">Minimum kasir<input class="input" type="number" min="0" max="100" step="1" bind:value={minimum} required/></label>
    <label class="field">Berlaku mulai<input class="input" type="date" min={todayJakarta()} bind:value={effectiveFrom} required/></label>
    <button class="btn btn-primary" type="submit" disabled={saving || !outletId}>{saving ? 'Menyimpan…' : 'Simpan minimum'}</button>
  </form>
  <p class="zero-note"><strong>0</strong> berarti outlet tidak membutuhkan kasir pada slot tersebut. Slot tanpa konfigurasi tampil “Belum diatur” dan tidak dinilai cukup atau kurang.</p>
  {#if rows.length}<div class="requirement-list"><strong>Riwayat konfigurasi · {$app.outlets.find(outlet => outlet.id === outletId)?.name}</strong><div class="table-scroll"><table><thead><tr><th>Hari</th><th>Shift</th><th>Minimum</th><th>Berlaku mulai</th></tr></thead><tbody>{#each rows as row (row.id)}<tr><td>{weekdays[row.weekday]}</td><td>{shiftName(row.shift)}</td><td>{row.minimum}</td><td>{row.effectiveFrom}</td></tr>{/each}</tbody></table></div></div>{:else}<p class="empty">Belum ada kebutuhan minimum yang tersimpan untuk outlet ini.</p>{/if}
</section>

<style>
  .requirement-editor{margin:1rem 1.2rem 0;padding:1rem;border:1px solid var(--panel-border);border-radius:17px;background:var(--surface);box-shadow:var(--raised-sm)}.requirement-heading h3{font-size:.83rem;margin:0 0 .35rem}.requirement-heading p,.zero-note,.empty{font-size:.66rem;line-height:1.55;color:var(--muted);margin:0}.requirement-form{display:grid;grid-template-columns:1.3fr 1fr 1fr .9fr 1.1fr auto;align-items:end;gap:.65rem;margin:.9rem 0}.requirement-form .field{font-size:.64rem}.requirement-form .select,.requirement-form .input{min-height:43px;padding:.6rem;font-size:.67rem}.requirement-form .btn{min-height:43px;padding:.6rem .75rem;font-size:.65rem}.zero-note{padding:.6rem .7rem;border:1px solid var(--border);border-radius:11px;background:var(--yellow-soft)}.zero-note strong{color:var(--ink)}.requirement-list{display:grid;gap:.5rem;margin-top:.9rem}.requirement-list>strong{font-size:.68rem}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:.55rem;font-size:.64rem;border-bottom:1px solid var(--border)}th{color:var(--muted);font-weight:600}.empty{margin-top:.7rem}@media(max-width:1000px){.requirement-form{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:600px){.requirement-editor{margin:.8rem;padding:.8rem}.requirement-form{grid-template-columns:1fr 1fr}.requirement-form .field:first-child,.requirement-form .btn{grid-column:span 2}}
</style>
