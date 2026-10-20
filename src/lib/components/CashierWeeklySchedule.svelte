<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { app } from '#lib/state/app';
  import { addWorkDays, workWeekDates, workWeekLabel } from '#lib/cashier-spv';
  import PageHeading from './PageHeading.svelte';
  import StatusPill from './StatusPill.svelte';
  import { dateLabel } from './format';

  export let weekStart = '';
  $: weekDates = workWeekDates(weekStart);
  $: employeeId = $app.user?.id ?? '';
  $: assignments = ($app.cashierAssignments ?? []).filter(row => row.employeeId === employeeId && weekDates.includes(row.workDate));
  const shiftName = (shift: string) => ({ morning: 'Pagi', afternoon: 'Sore', middle: 'Middle', off: 'Libur' }[shift] ?? 'Belum ditugaskan');
  const assignmentFor = (day: string) => assignments.find(row => row.workDate === day);
  const outletName = (outletId: string) => $app.outlets.find(outlet => outlet.id === outletId)?.name ?? 'Outlet';
  function moveWeek(amount: number) {
    const next = addWorkDays(weekStart, amount * 7);
    const url = new URL(window.location.href);
    url.searchParams.set('week', next);
    url.searchParams.delete('date');
    url.searchParams.delete('workDate');
    void goto(url, { state: page.state, shallow: true, replace: true });
  }
</script>

<PageHeading eyebrow="JADWAL KERJA" title="Jadwal mingguan Anda" description="Jadwal tujuh hari milik akun ini. Tampilan ini hanya dapat dibaca." />
<section class="weekly-schedule" aria-label="Jadwal kerja mingguan Anda">
  <div class="week-heading"><strong>{workWeekLabel(weekStart)} · WIB</strong><div class="week-nav"><button class="btn btn-secondary" type="button" aria-label="Minggu sebelumnya" on:click={() => moveWeek(-1)}>‹ Sebelumnya</button><button class="btn btn-secondary" type="button" on:click={() => moveWeek(1)}>Berikutnya ›</button></div></div>
  <div class="day-list">
    {#each weekDates as day (day)}
      {@const assignment = assignmentFor(day)}
      <article class="day-card" data-status={assignment?.status ?? 'empty'}>
        <div class="day-date"><strong>{new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</strong><span>{dateLabel(day)}</span></div>
        {#if assignment?.status === 'cancelled'}
          <StatusPill label="Jadwal dibatalkan" tone="amber" />
          <p>{shiftName(assignment.shift)} · {outletName(assignment.outletId)}</p>
        {:else if assignment}
          <StatusPill label={shiftName(assignment.shift)} tone={assignment.shift === 'off' ? 'blue' : 'green'} />
          <p>{outletName(assignment.outletId)}</p>
        {:else}
          <StatusPill label="Belum ditugaskan" tone="muted" />
          <p>Hubungi Admin HR bila Anda mengharapkan jadwal pada tanggal ini.</p>
        {/if}
      </article>
    {/each}
  </div>
  <p class="privacy-note">Jadwal ini hanya menampilkan penugasan akun Anda. Untuk mengubah jadwal, hubungi Admin HR.</p>
</section>

<style>
  .weekly-schedule{display:grid;gap:.8rem;margin:1rem 0 1.2rem}.week-heading{display:flex;align-items:center;justify-content:space-between;gap:.7rem;padding:.9rem 1rem;border:1px solid var(--panel-border);border-radius:14px;background:var(--surface);box-shadow:var(--raised-sm)}.week-heading>strong{font-size:.76rem}.week-nav{display:flex;gap:.45rem}.week-nav .btn{min-height:40px;font-size:.65rem}.day-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}.day-card{display:grid;grid-template-columns:1fr auto;gap:.35rem .6rem;padding:.85rem;border:1px solid var(--panel-border);border-radius:15px;background:var(--surface);box-shadow:var(--raised-sm)}.day-date{display:grid;gap:.17rem}.day-date strong{font-size:.72rem}.day-date span{font-size:.62rem;color:var(--muted)}.day-card p{grid-column:1/-1;font-size:.65rem;line-height:1.45;color:var(--muted);margin:.15rem 0 0}.privacy-note{font-size:.66rem;line-height:1.55;color:var(--muted);margin:0;padding:.7rem .85rem;border:1px solid var(--border);border-radius:12px;background:var(--yellow-soft)}@media(max-width:620px){.week-heading{align-items:flex-start;flex-direction:column}.week-nav{width:100%}.week-nav .btn{flex:1}.day-list{grid-template-columns:1fr}}
</style>
