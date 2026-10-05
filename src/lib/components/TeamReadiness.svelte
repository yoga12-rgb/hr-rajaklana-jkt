<script lang="ts">
  import type { Employee, Outlet } from '../types';
  import { teamReadiness } from '../team-readiness';
  import Icon from './Icon.svelte';

  export let employees: Employee[] = [];
  export let outlets: Outlet[] = [];

  $: summary = teamReadiness(employees, outlets);
  $: tasks = [
    { count: summary.outletsMissingLocation, title: 'Lokasi outlet belum lengkap', detail: 'Isi koordinat dan radius untuk validasi clock in dan clock out.', href: '/organization', action: 'Lengkapi lokasi', icon: 'pin' },
    { count: summary.employeesWithoutActiveAccount, title: 'Akun karyawan belum aktif', detail: 'Siapkan undangan aktivasi dan kirim melalui WhatsApp.', href: '/employees', action: 'Kelola akun', icon: 'users' },
    { count: summary.employeesWithoutActiveApprover, title: 'Atasan belum siap', detail: 'Tentukan atasan aktif agar pengajuan bisa diputuskan.', href: '/employees', action: 'Atur atasan', icon: 'user' }
  ].filter((task) => task.count > 0);
</script>

<section class="panel readiness" aria-labelledby="team-readiness-title">
  <div class="readiness-heading">
    <span class="heading-icon"><Icon name="briefcase" size={20}/></span>
    <div><h2 id="team-readiness-title">Persiapan tim</h2><p>Berdasarkan data outlet dan karyawan aktif saat ini.</p></div>
  </div>
  {#if tasks.length}
    <ul class="readiness-list">
      {#each tasks as task}
        <li>
          <span class="task-icon"><Icon name={task.icon} size={18}/></span>
          <div class="task-description"><h3>{task.title}<span class="count">{task.count}</span></h3><p>{task.detail}</p></div>
          <a href={task.href}>{task.action}<Icon name="arrow-right" size={16}/></a>
        </li>
      {/each}
    </ul>
  {:else if summary.activeOutlets || summary.activeEmployees}
    <p class="complete"><Icon name="check" size={18}/>Data lokasi, akun, dan atasan internal yang tercatat sudah lengkap.</p>
  {:else}
    <div class="first-step"><p>Tambahkan outlet dan karyawan untuk memulai persiapan tim.</p><div><a class="btn btn-secondary" href="/organization">Tambah outlet</a><a class="btn btn-primary" href="/employees">Tambah karyawan</a></div></div>
  {/if}
</section>

<style>
  .readiness{margin-bottom:1.5rem;padding:1.3rem 1.35rem}
  .readiness-heading{display:flex;align-items:center;gap:.8rem}
  .heading-icon{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;background:var(--yellow-soft);color:var(--accent);border:1px solid #ffffffa6;border-radius:13px;box-shadow:var(--raised-sm)}
  h2{margin:0;color:var(--ink);font-size:.92rem;font-weight:700}
  .readiness-heading p{margin:.4rem 0 0;color:var(--muted);font-size:.69rem;line-height:1.6}
  .readiness-list{margin:1rem 0 0;padding:0;list-style:none}
  li{display:flex;align-items:center;gap:.8rem;padding:1rem 0;border-top:1px solid var(--border)}
  li:last-child{padding-bottom:0}
  .task-icon{display:grid;place-items:center;flex-shrink:0;width:34px;height:34px;background:var(--surface);color:var(--accent);border-radius:11px;box-shadow:var(--inset)}
  .task-description{flex:1;min-width:0}
  h3{display:flex;align-items:center;gap:.55rem;margin:0;color:var(--ink);font-size:.77rem;font-weight:600;letter-spacing:0}
  .count{display:inline-flex;align-items:center;justify-content:center;min-width:23px;padding:.2rem .4rem;background:var(--yellow-soft);color:var(--ink);border-radius:7px;font-size:.65rem}
  .task-description p{margin:.4rem 0 0;color:var(--muted);font-size:.69rem;line-height:1.65}
  li a{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:44px;padding:.55rem .7rem;border:1px solid var(--border);border-radius:11px;font-size:.7rem;font-weight:600;color:var(--accent);white-space:nowrap;box-shadow:var(--raised-sm)}
  li a:hover{background:var(--yellow-soft)}
  li a:active{box-shadow:var(--inset)}
  .complete{display:flex;align-items:center;gap:.6rem;margin:1rem 0 0;color:var(--muted);font-size:.73rem;line-height:1.7}
  .complete :global(svg){flex-shrink:0;color:var(--accent)}
  .first-step{margin-top:1rem}
  .first-step p{color:var(--muted);font-size:.73rem;line-height:1.7}
  .first-step>div{display:flex;gap:.7rem;flex-wrap:wrap}
  @media(max-width:600px){
    .readiness{padding:1.1rem}
    li{flex-wrap:wrap;gap:.65rem}
    .task-description{width:calc(100% - 45px);flex:auto}
    h3{font-size:.73rem;line-height:1.5}
    li a{margin-left:calc(34px + .65rem);font-size:.68rem}
    .readiness-heading p{font-size:.65rem}
  }
</style>
