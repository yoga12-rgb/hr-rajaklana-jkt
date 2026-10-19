<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { app, actions, isAdmin, isCashier, displayName, shiftLabel } from '#lib/state/app';
  import type { CashierAssignment, Shift } from '#lib/types';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import MetricCard from '#lib/components/MetricCard.svelte';
  import StatusPill from '#lib/components/StatusPill.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import CashierWeeklyPlanner from '#lib/components/CashierWeeklyPlanner.svelte';
  import { todayJakarta, dateLabel, timeLabel } from '#lib/components/format';
  let date = todayJakarta(), employeeId = '', outletId = '', shift: Shift | 'off' = 'morning', view: 'daily' | 'weekly' = 'weekly';
  afterNavigate(() => { const query = new URLSearchParams(window.location.search), week = query.get('week'), linkedDate = query.get('date') ?? query.get('workDate'); if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) { view = 'weekly'; date = week; editId = undefined; } else if (linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate)) { view = 'daily'; date = linkedDate; editId = undefined; } });
  let editId: string | undefined, reason = '', message = '', failed = false, saving = false;
  $: admin = isAdmin($app.user);
  $: cashiers = $app.employees.filter(employee => employee.status === 'active' && isCashier(employee));
  $: editableCashiers = cashiers.filter(employee => employee.id !== $app.user?.id);
  $: historical = date < todayJakarta();
  $: employee = editableCashiers.find(employee => employee.id === employeeId);
  $: if (shift === 'middle' && !employee?.canMiddleShift) shift = 'morning';
  $: assignments = ($app.cashierAssignments ?? []).filter(assignment => assignment.workDate === date && (admin || assignment.employeeId === $app.user?.id));
  $: active = assignments.filter(assignment => assignment.status === 'active');
  $: coverage = $app.outlets.filter(outlet => outlet.active).map(outlet => ({ outlet,
    morning: active.filter(a => a.outletId === outlet.id && a.shift === 'morning').length,
    afternoon: active.filter(a => a.outletId === outlet.id && a.shift === 'afternoon').length,
    middle: active.filter(a => a.outletId === outlet.id && a.shift === 'middle').length }));
  $: crew = admin ? cashiers : cashiers.filter(employee => employee.id === $app.user?.id);
  $: crewRows = crew.map(employee => ({ employee, assignment: active.find(assignment => assignment.employeeId === employee.id), attendance: $app.attendanceRecords.find(record => record.employeeId === employee.id && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(record.clockIn)) === date) }));
  const assignmentFor = (id: string) => active.find(assignment => assignment.employeeId === id);
  const outletName = (id: string) => $app.outlets.find(outlet => outlet.id === id)?.name ?? '—';
  function chooseEmployee() { outletId = editableCashiers.find(item => item.id === employeeId)?.outletId ?? ''; editId = undefined; reason = ''; }
  function edit(assignment: CashierAssignment) { if (assignment.employeeId === $app.user?.id) return; editId = assignment.id; employeeId = assignment.employeeId; outletId = assignment.outletId; shift = assignment.shift; reason = ''; }
  async function save(cancel = false) {
    if (saving) return;
    saving = true; message = '';
    try {
      if (!employee || (!cancel && !outletId) || reason.trim().length < 5) throw new Error('Pilih kasir selain diri sendiri, outlet, dan alasan minimal 5 karakter.');
      if (date < employee.joinDate) throw new Error('Tanggal penugasan tidak boleh sebelum tanggal mulai bekerja.');
      if (historical && (reason.trim().length < 5 || $app.attendanceRecords.some(record => record.employeeId === employee.id && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(record.clockIn)) === date))) throw new Error('Penugasan lampau memerlukan alasan minimal 5 karakter dan belum memiliki absensi. Gunakan koreksi jika absensi sudah ada.');
      await actions.saveCashierAssignment({ id: editId, employeeId, workDate: date, outletId, shift, reason: reason.trim(), cancel });
      editId = undefined; employeeId = ''; outletId = ''; reason = ''; failed = false;
      message = cancel ? 'Penugasan dibatalkan. Riwayat tetap tersimpan.' : 'Penugasan harian tersimpan. Kasir mengikuti outlet dan shift ini saat clock in.';
    } catch(error) { failed = true; message = error instanceof Error ? error.message : 'Penugasan belum tersimpan.'; } finally { saving = false; }
  }
</script>

<PageHeading eyebrow="OPERASIONAL KASIR" title="Jadwal kasir" description="Atur penugasan harian atau susun jadwal satu minggu. Absensi aktual dicatat terpisah."/>
{#if admin}<nav class="view-toggle" aria-label="Tampilan jadwal"><button class:active={view === 'weekly'} class="btn btn-secondary" type="button" on:click={() => view = 'weekly'}>Mingguan</button><button class:active={view === 'daily'} class="btn btn-secondary" type="button" on:click={() => view = 'daily'}>Harian</button></nav>{/if}
{#if !admin || view === 'daily'}
<Feedback {message} error={failed}/>
<div class="date-filter"><label class="field">Tanggal kerja (WIB)<input class="input" type="date" bind:value={date} on:change={() => { editId = undefined; reason = ''; }} required/></label></div>
<div class="metrics"><MetricCard label="Ditugaskan bekerja" value={active.filter(a => a.shift !== 'off').length} detail={dateLabel(date)} icon="calendar"/><MetricCard label="Libur" value={active.filter(a => a.shift === 'off').length} detail="Tidak diwajibkan clock in" icon="sun"/><MetricCard label="Belum ditugaskan" value={crew.filter(employee => !assignmentFor(employee.id)).length} detail="Hubungi HR sebelum clock in" icon="alert"/></div>

{#if admin}
  <section class="panel assignment-form"><h2>{editId ? 'Ubah penugasan' : 'Tetapkan penugasan kasir'}</h2><p class="hint">Penugasan sendiri harus ditetapkan Admin HR lain. Penugasan lampau memerlukan alasan minimal 5 karakter, tanggal sesudah mulai bekerja, dan belum ada absensi pada tanggal tersebut. Catatan absensi yang sudah ada diperbaiki melalui koreksi HR.</p>
    <form on:submit|preventDefault={() => save()}><div class="form-grid"><label class="field">Kasir<select class="select" bind:value={employeeId} on:change={chooseEmployee} required><option value="">Pilih kasir selain diri sendiri</option>{#each editableCashiers as employee}<option value={employee.id}>{employee.fullName} · {employee.employeeNumber}</option>{/each}</select></label><label class="field">Outlet<select class="select" bind:value={outletId} required><option value="">Pilih outlet</option>{#each $app.outlets.filter(outlet => outlet.active || (editId && outlet.id === outletId)) as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label><label class="field">Shift / libur<select class="select" bind:value={shift}><option value="morning">Pagi</option><option value="afternoon">Sore</option>{#if employee?.canMiddleShift}<option value="middle">Middle</option>{/if}<option value="off">Libur</option></select></label><label class="field">Alasan / sumber penugasan<input class="input" bind:value={reason} minlength="5" required placeholder="Contoh: rotasi kasir dikonfirmasi SPV"/></label></div><div class="form-actions">{#if editId}<button type="button" class="btn btn-secondary" disabled={saving} on:click={() => save(true)}>Batalkan penugasan</button>{/if}<button class="btn btn-primary" disabled={saving || !employeeId}>{saving ? 'Menyimpan…' : 'Simpan penugasan'}</button></div></form>
  </section>
  <section class="panel"><h2>Cakupan outlet · {dateLabel(date)}</h2><p class="hint">Jumlah kasir yang ditugaskan per shift. Ini belum merupakan perhitungan kebutuhan minimum staf.</p><div class="table-wrap"><table><thead><tr><th>Outlet</th><th>Pagi</th><th>Sore</th><th>Middle</th></tr></thead><tbody>{#each coverage as item}<tr><td>{item.outlet.name}</td><td>{item.morning}</td><td>{item.afternoon}</td><td>{item.middle}</td></tr>{/each}</tbody></table></div></section>
{/if}

<section class="panel"><h2>{admin ? 'Kesiapan kasir' : 'Penugasan Anda'} · {dateLabel(date)}</h2>{#if crew.length}<div class="table-wrap"><table><thead><tr><th>Kasir</th><th>Penugasan</th><th>Status absensi</th>{#if admin}<th></th>{/if}</tr></thead><tbody>{#each crewRows as row}{@const employee = row.employee}{@const assignment = row.assignment}{@const attendance = row.attendance}<tr><td><strong>{displayName(employee.id)}</strong><small>{employee.employeeNumber}</small></td><td>{#if assignment}<strong>{assignment.shift === 'off' ? 'Libur' : shiftLabel(assignment.shift)}</strong><small>{outletName(assignment.outletId)}</small>{:else}<StatusPill label="Belum ditugaskan" tone="amber"/>{/if}</td><td><StatusPill label={attendance ? attendance.clockOut ? 'Sudah pulang' : 'Sedang bekerja' : assignment?.shift === 'off' ? 'Libur' : assignment ? 'Belum clock in' : 'Menunggu HR'} tone={attendance ? 'green' : assignment?.shift === 'off' ? 'blue' : 'amber'}/>{#if attendance}<small>Masuk {timeLabel(attendance.clockIn)} WIB</small>{/if}</td>{#if admin}<td>{#if assignment}<button class="btn btn-secondary" disabled={employee.id === $app.user?.id || date < employee.joinDate || (historical && !!attendance)} on:click={() => edit(assignment)}>Ubah</button>{:else}<button class="btn btn-secondary" disabled={employee.id === $app.user?.id || date < employee.joinDate || (historical && !!attendance)} on:click={() => { employeeId = employee.id; chooseEmployee(); }}>Tetapkan</button>{/if}</td>{/if}</tr>{/each}</tbody></table></div>{:else}<EmptyState icon="calendar" title="Belum ada penugasan untuk akun ini" description="Hubungi Admin HR untuk memastikan data kasir dan penugasan Anda."/>{/if}</section>
{/if}
{#if admin && view === 'weekly'}<section class="panel weekly-panel"><CashierWeeklyPlanner/></section>{/if}

<style>
  .view-toggle{display:flex;gap:.55rem;margin:.3rem 0 1rem}.view-toggle .btn{min-height:42px}.view-toggle .btn.active{background:var(--yellow-soft);box-shadow:var(--inset);color:var(--ink)}.weekly-panel{padding:0;overflow:hidden}
  .metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:1rem 0}.date-filter{max-width:260px}.panel{margin:1.2rem 0}.panel h2{font-size:.95rem;margin:0 0 1rem}.hint{font-size:.73rem;color:var(--muted);line-height:1.7}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.form-actions{display:flex;justify-content:flex-end;gap:.7rem;margin-top:1rem;flex-wrap:wrap}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:1rem;font-size:.76rem;border-bottom:1px solid var(--border);white-space:nowrap}th{background:var(--yellow-soft);font-size:.65rem}td small{display:block;font-size:.65rem;color:var(--muted);margin-top:.4rem}td .btn{font-size:.7rem}@media(max-width:650px){.metrics{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}th,td{padding:.8rem}.panel{padding:1rem}}
</style>
