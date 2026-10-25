<script lang="ts">
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { app,actions,displayName } from '#lib/state/app';
  import type { SpvFollowup,SpvFollowupPage,SpvFollowupView } from '#lib/types';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Feedback from '#lib/components/Feedback.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { dateLabel } from '#lib/components/format';
  import { createSpvFollowupAttempt,draftFromSpvFollowup,markSpvFollowupConflict,parseSpvFollowupDraft,
    serializeSpvFollowupDraft,settleSpvFollowupAttempt,spvFollowupDraftStorageKey,type SpvFollowupDraft } from '#lib/spv-followup-recovery';

  const views:{id:SpvFollowupView;label:string}[]=[
    {id:'all_open',label:'Semua belum selesai'},{id:'mine',label:'Tugas saya'},{id:'unassigned',label:'Belum ada PIC'},
    {id:'overdue',label:'Lewat tenggat'},{id:'history',label:'Riwayat'}
  ];
  let view:SpvFollowupView='all_open',outletId='',from='',to='',rows:SpvFollowup[]=[],total=0,hasMore=false;
  let cursor:SpvFollowupPage['nextCursor']=null,asOf='',loading=true,loadingMore=false,busy='',message='',failed=false;
  let selectedId='',drafts:Record<string,SpvFollowupDraft>={};
  $: selected=rows.find(row=>row.id===selectedId) ?? null;
  $: draft=selected ? drafts[selected.id] ?? null : null;
  $: owners=$app.employees.filter(employee=>employee.status==='active'&&employee.accountStatus==='active'&&employee.roles.includes('admin_hr'));

  const statusLabel=(value:string)=>({new:'Belum ditangani',in_progress:'Diproses',completed:'Selesai'}[value]??value);
  const issueLabel=(value:string)=>({missing_clockin:'Konfirmasi clock in',unassigned:'Jadwal belum ditetapkan',open_session:'Sesi masih terbuka',
    unexcused_lateness:'Keterlambatan perlu ditinjau',correction_pending:'Koreksi menunggu',leave_conflict:'Konflik jadwal dan cuti',short_duration:'Durasi perlu dikonfirmasi'}[value]??value);
  const dueValue=(value:string|null)=>value?new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jakarta'}).format(new Date(value)).replace(', ','T'):'';
  const dueLabel=(value:string|null)=>value?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB':'Belum ditetapkan';
  const overdue=(row:SpvFollowup)=>row.status!=='completed'&&!!row.dueAt&&Date.parse(row.dueAt)<Date.now();
  const sourceHref=(row:SpvFollowup)=>{
    const id=encodeURIComponent(row.sourceId ?? '');
    if(row.sourceType==='correction'&&row.sourceId)return `/reports?tab=corrections&request=${id}`;
    if(row.sourceType==='attendance'&&row.sourceId)return `/attendance?record=${id}`;
    return `/assignments?date=${encodeURIComponent(row.workDate)}`;
  };
  function storageKey(id:string){return spvFollowupDraftStorageKey($app.user!.id,id)}
  function persist(id:string,next:SpvFollowupDraft){
    drafts={...drafts,[id]:next};
    localStorage.setItem(storageKey(id),serializeSpvFollowupDraft(next));
  }
  function clearPersisted(id:string){
    const next={...drafts}; delete next[id]; drafts=next; localStorage.removeItem(storageKey(id));
  }
  function selectCase(row:SpvFollowup){
    selectedId=row.id;
    const restored=parseSpvFollowupDraft(localStorage.getItem(storageKey(row.id)));
    if(restored){
      const next=restored.baselineRevision===row.revision?restored:markSpvFollowupConflict(restored,row,!!restored.pendingAttempt);
      persist(row.id,next);
    }else persist(row.id,draftFromSpvFollowup(row));
    const url=new URL(window.location.href); url.searchParams.set('case',row.id); void replaceState(`${url.pathname}${url.search}`,{});
  }
  function edit<K extends keyof SpvFollowupDraft>(field:K,value:SpvFollowupDraft[K]){
    if(!selected||!draft)return; persist(selected.id,{...draft,[field]:value});
  }
  function discard(){if(!selected)return; clearPersisted(selected.id); persist(selected.id,draftFromSpvFollowup(selected));}
  function reviewLatest(){if(!selected||!draft)return; persist(selected.id,{...draft,baselineRevision:selected.revision,pendingAttempt:null,conflict:null});}

  async function load(reset=true){
    if(reset){loading=true;cursor=null;}else loadingMore=true;
    message='';failed=false;
    try{
      const page=await actions.loadSpvFollowups({view,outletId:outletId||undefined,from:from||undefined,to:to||undefined,pageSize:25,cursor:reset?null:cursor});
      rows=reset?page.items:[...rows,...page.items.filter(item=>!rows.some(row=>row.id===item.id))];
      total=page.total;hasMore=page.hasMore;cursor=page.nextCursor;asOf=page.asOf;
      const requested=new URL(window.location.href).searchParams.get('case');
      const target=rows.find(row=>row.id===(requested||selectedId));
      if(target)selectCase(target); else if(reset){selectedId='';}
    }catch(error){failed=true;message=error instanceof Error?error.message:'Daftar tindak lanjut belum dapat dimuat.';}
    finally{loading=false;loadingMore=false;}
  }
  async function save(replay=false){
    if(!selected||!draft||busy)return;
    let attempt=draft.pendingAttempt;
    if(!replay||!attempt){
      const payload={id:selected.id,expectedRevision:draft.baselineRevision,status:draft.status,ownerId:draft.ownerId,note:draft.note,
        resolutionNote:draft.resolutionNote,dueAt:draft.dueAt,reason:draft.reason};
      attempt=createSpvFollowupAttempt(payload,attempt);
      persist(selected.id,{...draft,pendingAttempt:attempt});
    }
    busy=selected.id;message='';failed=false;
    try{
      const result=await actions.updateSpvFollowup(attempt.payload);
      const latest=parseSpvFollowupDraft(localStorage.getItem(storageKey(selected.id))) ?? drafts[selected.id];
      const settled=latest?settleSpvFollowupAttempt(latest,attempt,result):null;
      if(settled){persist(selected.id,settled);}
      await load(true); message='Tindak lanjut tersimpan. Revisi server dan riwayat telah diperbarui.';
    }catch(error){
      failed=true;message=error instanceof Error?error.message:'Tindak lanjut belum tersimpan; permintaan asli tetap dapat dicoba kembali.';
      if(/berubah sejak dibuka|40001/i.test(message)){
        try{await load(true);const current=rows.find(row=>row.id===selected.id);const local=parseSpvFollowupDraft(localStorage.getItem(storageKey(selected.id)));if(current&&local)persist(selected.id,markSpvFollowupConflict(local,current));}catch{/* draft tetap tersimpan */}
      }
    }finally{busy='';}
  }
  function changeView(next:SpvFollowupView){view=next;const url=new URL(window.location.href);url.searchParams.set('view',next);url.searchParams.delete('case');void replaceState(`${url.pathname}${url.search}`,{});void load(true);}
  onMount(()=>{
    const requested=new URL(window.location.href).searchParams.get('view');if(views.some(item=>item.id===requested))view=requested as SpvFollowupView;
    void load(true);
  });
</script>

<PageHeading eyebrow="SUPERVISOR" title="Tindak lanjut operasional" description="Kasus tersimpan lintas tanggal, pembagian PIC, tenggat, dan riwayat keputusan."/>
<section class="panel queue">
  <div class="tabs" role="tablist" aria-label="Tampilan tindak lanjut">{#each views as item}<button type="button" class:active={view===item.id} on:click={()=>changeView(item.id)}>{item.label}</button>{/each}</div>
  <div class="filters"><label>Outlet<select class="select" bind:value={outletId} on:change={()=>load(true)}><option value="">Semua outlet</option>{#each $app.outlets.filter(row=>row.active) as outlet}<option value={outlet.id}>{outlet.name}</option>{/each}</select></label><label>Dari tanggal<input class="input" type="date" bind:value={from} on:change={()=>load(true)}/></label><label>Sampai tanggal<input class="input" type="date" bind:value={to} on:change={()=>load(true)}/></label><button class="btn btn-secondary" type="button" on:click={()=>load(true)}><Icon name="refresh" size={16}/>Perbarui</button></div>
  <Feedback {message} error={failed}/>
  <div class="summary"><strong>{total} kasus</strong><span>{asOf?`Dihitung ${dueLabel(asOf)}`:'Memuat sumber resmi…'}</span><span>Kasus terbuka tetap ada meski sinyal sumber sudah berubah.</span></div>
  <div class="workspace">
    <div class="list" aria-busy={loading}>
      {#if loading}<p class="empty">Memuat tindak lanjut…</p>
      {:else if rows.length===0}<p class="empty">Belum ada kasus tersimpan pada filter ini.</p>
      {:else}{#each rows as row (row.id)}<button type="button" class="case" class:selected={selectedId===row.id} on:click={()=>selectCase(row)}>
        <span class="case-top"><strong>{issueLabel(row.issueType)}</strong><i class:late={overdue(row)}>{overdue(row)?'Lewat tenggat':statusLabel(row.status)}</i></span>
        <span>{displayName(row.employeeId??'')} · {$app.outlets.find(outlet=>outlet.id===row.outletId)?.name??'Outlet'}</span>
        <small>Tanggal kerja {dateLabel(row.workDate)} · dibuat {dateLabel(row.createdAt)}</small>
        <small>PIC {row.ownerId?displayName(row.ownerId):'belum ditetapkan'} · tenggat {dueLabel(row.dueAt)}</small>
      </button>{/each}{/if}
      {#if hasMore}<button class="btn btn-secondary more" type="button" disabled={loadingMore} on:click={()=>load(false)}>{loadingMore?'Memuat…':'Muat berikutnya'}</button>{/if}
    </div>
    <div class="detail">
      {#if selected&&draft}
        <div class="detail-head"><div><span class="eyebrow">KASUS {selected.caseKey}</span><h2>{issueLabel(selected.issueType)}</h2><p>Revisi server {selected.revision} · tanggal kerja {dateLabel(selected.workDate)}</p></div><a class="btn btn-secondary" href={sourceHref(selected)}>Buka sumber</a></div>
        {#if draft.conflict}<div class="conflict" role="alert"><strong>Data berubah di sesi lain</strong><p>Draft lokal tetap disimpan. Server sekarang pada revisi {draft.conflict.revision}; periksa PIC, tenggat, status, dan catatan sebelum mengajukan perubahan baru.</p><div><button class="btn btn-secondary" type="button" on:click={discard}>Gunakan data server</button><button class="btn btn-primary" type="button" on:click={reviewLatest}>Pertahankan draft & pakai revisi terbaru</button></div></div>{/if}
        {#if draft.pendingAttempt}<div class="pending"><strong>Permintaan belum mempunyai hasil pasti</strong><p>Key dan payload asli tersimpan. Muat ulang atau tekan coba lagi; server akan mengembalikan receipt yang sama jika commit sebelumnya berhasil.</p><button class="btn btn-secondary" type="button" disabled={!!busy} on:click={()=>save(true)}>Coba lagi permintaan yang sama</button></div>{/if}
        <fieldset class="form-fields" disabled={!!busy||!!draft.pendingAttempt||!!draft.conflict}><div class="form-grid">
          <label>Status<select class="select" value={draft.status} on:change={event=>edit('status',event.currentTarget.value as SpvFollowup['status'])}><option value="new">Belum ditangani</option><option value="in_progress">Diproses</option><option value="completed">Selesai</option></select></label>
          <label>Penanggung jawab<select class="select" value={draft.ownerId??''} on:change={event=>edit('ownerId',event.currentTarget.value||null)}><option value="">Belum ada PIC</option>{#each owners as owner}<option value={owner.id}>{owner.fullName}</option>{/each}</select></label>
          <label>Tenggat (WIB)<input class="input" type="datetime-local" value={dueValue(draft.dueAt)} on:change={event=>edit('dueAt',event.currentTarget.value?new Date(`${event.currentTarget.value}:00+07:00`).toISOString():null)}/></label>
          <label class="wide">Catatan tindak lanjut<textarea class="input" rows="3" value={draft.note} on:input={event=>edit('note',event.currentTarget.value)}></textarea></label>
          {#if draft.status==='completed'}<label class="wide">Catatan penyelesaian<textarea class="input" rows="3" value={draft.resolutionNote} on:input={event=>edit('resolutionNote',event.currentTarget.value)} placeholder="Minimal 5 karakter"></textarea></label>{/if}
          <label class="wide">Alasan perubahan PIC/tenggat<input class="input" value={draft.reason} on:input={event=>edit('reason',event.currentTarget.value)} placeholder="Wajib bila PIC atau tenggat berubah"/></label>
        </div></fieldset>
        <div class="buttons"><button class="btn btn-secondary" type="button" on:click={discard}>Batalkan draft</button><button class="btn btn-primary" type="button" disabled={!!busy||!!draft.pendingAttempt||!!draft.conflict} on:click={()=>save(false)}>{busy?'Menyimpan…':'Simpan dengan pemeriksaan revisi'}</button></div>
      {:else}<div class="empty detail-empty"><Icon name="file" size={28}/><strong>Pilih satu kasus</strong><span>Rincian, PIC, tenggat, dan catatan akan tampil di sini.</span></div>{/if}
    </div>
  </div>
</section>

<style>
  .queue{padding:0;overflow:hidden}.tabs{display:flex;gap:.45rem;padding:1rem 1.1rem;border-bottom:1px solid var(--border);overflow:auto}.tabs button{border:1px solid var(--panel-border);background:var(--surface);box-shadow:var(--raised-sm);border-radius:999px;padding:.65rem .85rem;white-space:nowrap;color:var(--muted);font-size:.68rem}.tabs button.active{background:var(--primary);color:var(--ink);font-weight:700}.filters{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;align-items:end;gap:.7rem;padding:1rem 1.1rem;border-bottom:1px solid var(--border)}.filters label,.form-grid label{display:grid;gap:.4rem;font-size:.66rem;color:var(--muted)}.filters .btn{height:43px}.summary{display:flex;gap:1rem;align-items:center;padding:.75rem 1.1rem;background:var(--surface-cream);font-size:.64rem;color:var(--muted)}.summary strong{color:var(--ink);font-size:.72rem}.summary span:last-child{margin-left:auto}.workspace{display:grid;grid-template-columns:minmax(290px,.8fr) minmax(420px,1.2fr);min-height:560px}.list{border-right:1px solid var(--border);padding:.75rem;display:flex;flex-direction:column;gap:.55rem}.case{text-align:left;border:1px solid var(--panel-border);border-radius:14px;background:var(--surface);box-shadow:var(--raised-sm);padding:.85rem;color:var(--muted)}.case.selected{border-color:#bea13b;background:#fff7d6}.case-top{display:flex;justify-content:space-between;gap:.5rem}.case strong{font-size:.73rem;color:var(--ink)}.case i{font-style:normal;font-size:.58rem;border-radius:99px;padding:.25rem .45rem;background:#efe8ce}.case i.late{background:#f7d8ae;color:#704714}.case>span:not(.case-top),.case small{display:block;font-size:.62rem;margin-top:.42rem;line-height:1.45}.case small{color:var(--muted)}.more{margin:.25rem auto}.detail{padding:1.15rem}.detail-head{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border);padding-bottom:1rem}.eyebrow{font-size:.57rem;letter-spacing:.08em;color:var(--muted)}.detail h2{font-size:1.05rem;margin:.35rem 0}.detail-head p{font-size:.65rem;color:var(--muted);margin:0}.conflict,.pending{margin:1rem 0;padding:.9rem;border:1px solid #d5ad62;border-radius:14px;background:#fff3cf}.conflict strong,.pending strong{font-size:.74rem}.conflict p,.pending p{font-size:.66rem;line-height:1.6;color:var(--muted)}.conflict div{display:flex;gap:.5rem;flex-wrap:wrap}.pending{background:#f4ead2}.form-fields{border:0;padding:0;margin:0;min-width:0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-top:1rem}.form-grid .wide{grid-column:1/-1}.form-grid textarea{resize:vertical}.buttons{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem}.empty{padding:1.5rem;text-align:center;color:var(--muted);font-size:.7rem}.detail-empty{min-height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.55rem}.detail-empty strong{color:var(--ink);font-size:.8rem}.detail-empty span{font-size:.66rem}@media(max-width:900px){.filters{grid-template-columns:1fr 1fr}.workspace{grid-template-columns:1fr}.list{border-right:0;border-bottom:1px solid var(--border);max-height:420px;overflow:auto}.summary{align-items:flex-start;flex-wrap:wrap}.summary span:last-child{margin-left:0}}@media(max-width:600px){.filters{grid-template-columns:1fr}.summary{display:grid}.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.detail{padding:.85rem}.detail-head{display:grid}.buttons{display:grid}.buttons .btn{width:100%}}
</style>
