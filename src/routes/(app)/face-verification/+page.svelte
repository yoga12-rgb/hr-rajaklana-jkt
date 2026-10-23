<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { app } from '#lib/state/app';
  import { supabase } from '#lib/state/client';
  import Feedback from '#lib/components/Feedback.svelte';
  import SelfieGuide from '#lib/components/SelfieGuide.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { keepMediaStreamForRequest, stopMediaStream } from '#lib/media-stream-lease';
  import { dateLabel, timeLabel } from '#lib/components/format';
  type Reference={id:string;employee_id:string;status:string;created_at:string;review_note:string|null;name?:string;employeeNumber?:string;imageUrl?:string|null};
  let own:Reference[]=[],pending:Reference[]=[],message='',error=false,busy=false,consent=false,video:HTMLVideoElement,stream:MediaStream|null=null,preview='',capturedAt='',image='',cameraOpen=false,cameraOpening=false;
  let cameraRevision=0,cameraDestroyed=false;
  let notes:Record<string,string>={};
  const labels:Record<string,string>={pending:'Menunggu tinjauan HR',approved:'Disetujui',rejected:'Perlu foto baru',revoked:'Dicabut'};
  async function api(input:Record<string,unknown>){
    if(!supabase)throw new Error('Pendaftaran wajah tersedia di aplikasi yang terhubung ke server. Data contoh tidak merekam biometrik.');
    const{data:{session}}=await supabase.auth.getSession();
    if(!session)throw new Error('Silakan login kembali.');
    const response=await fetch('/api/biometric',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(input)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??'Layanan belum dapat dihubungi.');return result;
  }
  function stopTracks(value:MediaStream|null){stopMediaStream(value);}
  function stopCamera(){cameraRevision++;cameraOpening=false;const current=stream;stream=null;cameraOpen=false;if(video&&video.srcObject===current)video.srcObject=null;stopTracks(current);}
  async function refresh(){if($app.mode!=='live')return;try{const result=await api({action:'status'});own=result.own;pending=result.pending;}catch(e){error=true;message=e instanceof Error?e.message:'Data belum dapat dimuat.';}}
  async function startCamera(){
    if(cameraOpening||cameraOpen||cameraDestroyed)return;
    const revision=++cameraRevision;cameraOpening=true;message='';error=false;image='';preview='';
    let candidate:MediaStream|null=null;
    try{
      candidate=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:960}},audio:false});
      if(!keepMediaStreamForRequest(candidate,revision,cameraRevision,cameraDestroyed))return;
      stream=candidate;cameraOpening=false;cameraOpen=true;await tick();
      if(!keepMediaStreamForRequest(candidate,revision,cameraRevision,cameraDestroyed)||stream!==candidate||!video){if(stream===candidate)stopCamera();return;}
      video.srcObject=candidate;await video.play();
    }catch{
      if(candidate&&stream!==candidate)stopTracks(candidate);
      if(revision===cameraRevision&&!cameraDestroyed){error=true;message='Kamera belum dapat dibuka. Periksa izin kamera browser atau hubungi HR.';stopCamera();}
    }finally{if(revision===cameraRevision&&!cameraOpen)cameraOpening=false;}
  }
  function capture(){if(!video?.videoWidth)return;const canvas=document.createElement('canvas');const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);const context=canvas.getContext('2d');if(!context)return;context.drawImage(video,0,0,canvas.width,canvas.height);preview=canvas.toDataURL('image/jpeg',0.9);image=preview.split(',')[1];capturedAt=new Date().toISOString();stopCamera();}
  async function enroll(){busy=true;message='';error=false;try{await api({action:'enroll',consent,image,capturedAt});image='';preview='';consent=false;message='Foto dikirim. HR lain perlu memeriksa kecocokan identitas sebelum absensi wajah dapat digunakan.';await refresh();}catch(e){error=true;message=e instanceof Error?e.message:'Foto belum dapat dikirim.';}finally{busy=false;}}
  async function review(reference:Reference,decision:string){busy=true;message='';error=false;try{await api({action:'review',referenceId:reference.id,decision,reason:notes[reference.id]??''});message='Tinjauan referensi tersimpan.';await refresh();}catch(e){error=true;message=e instanceof Error?e.message:'Tinjauan belum tersimpan.';}finally{busy=false;}}
  async function withdraw(){busy=true;message='';error=false;try{await api({action:'withdraw'});stopCamera();preview='';image='';consent=false;message='Persetujuan dicabut dan ciri wajah dihapus. Penghapusan foto diproses segera dan dicoba ulang jika koneksi penyimpanan bermasalah. Hubungi HR untuk pencatatan manual bila diperlukan.';await refresh();}catch(e){error=true;message=e instanceof Error?e.message:'Pencabutan belum tersimpan.';}finally{busy=false;}}
  onMount(()=>{cameraDestroyed=false;void refresh();const channel=supabase?.channel(`biometric-reference-${$app.user?.id}`).on('postgres_changes',{event:'*',schema:'public',table:'biometric_references'},()=>{void refresh();}).subscribe();return()=>{if(channel&&supabase)void supabase.removeChannel(channel);};});onDestroy(()=>{cameraDestroyed=true;stopCamera();});
</script>

<svelte:head><title>Verifikasi wajah · HR Rajaklana</title></svelte:head>
<div class="page-heading"><div><p class="eyebrow">IDENTITAS ABSENSI</p><h1>Verifikasi wajah</h1><p>Daftarkan foto referensi untuk dicocokkan dengan selfie clock in.</p></div><button class="btn btn-secondary" disabled={busy} on:click={refresh}><Icon name="refresh" size={17}/> Muat ulang</button></div>
<Feedback {message} {error}/>
{#if $app.mode!=='live'}<p class="notice">Mode data contoh tidak menyimpan referensi wajah. Pendaftaran dan tinjauan tersedia pada aplikasi yang terhubung ke server.</p>{/if}
<div class="grid">
  <section class="panel">
    <h2>Referensi Anda</h2>
    {#if own.length}<div class="history">{#each own.slice(0,3) as row}<div class="status-row"><span><strong>{labels[row.status]??row.status}</strong><small>{dateLabel(row.created_at)} · {timeLabel(row.created_at)} WIB</small>{#if row.review_note}<small>{row.review_note}</small>{/if}</span></div>{/each}</div>{:else}<p>Belum ada foto referensi. HR perlu meninjau foto Anda sebelum clock in menggunakan verifikasi wajah.</p>{/if}
    <p class="notice">Foto dan ciri wajah disimpan privat untuk pencocokan 1:1 saat absensi. HR lain meninjau identitas Anda; Anda tidak dapat menyetujui referensi sendiri. Referensi aktif disimpan selama digunakan; referensi ditolak atau diganti dihapus setelah 30 hari. Persetujuan dapat dicabut untuk menonaktifkan dan menghapus referensi Anda. Jika verifikasi gagal, hubungi HR untuk pencatatan manual tanpa hukuman otomatis.</p>
    <p class="subtle">Pencocokan wajah belum membuktikan keaslian gerakan hidup dan tidak menjamin mampu menolak foto cetak atau layar. Pemeriksaan HR tetap diperlukan.</p>
    <label class="consent"><input type="checkbox" bind:checked={consent} disabled={busy||$app.mode!=='live'}/><span>Saya menyetujui penggunaan foto referensi dan ciri wajah untuk verifikasi absensi sesuai penjelasan di atas.</span></label>
    {#if cameraOpen}<div class="camera"><video bind:this={video} autoplay playsinline muted aria-label="Kamera foto referensi"></video><SelfieGuide/></div><p class="subtle">Hadapkan wajah ke kamera. Pastikan hanya satu wajah, cahaya cukup, dan kepala tegak.</p><div class="buttons"><button class="btn btn-primary" on:click={capture}>Ambil foto</button><button class="btn btn-secondary" on:click={stopCamera}>Tutup kamera</button></div>
    {:else if preview}<img class="preview" src={preview} alt="Pratinjau foto referensi Anda"/><div class="buttons"><button class="btn btn-primary" disabled={busy||!consent} on:click={enroll}>{busy?'Memeriksa foto…':'Kirim untuk ditinjau'}</button><button class="btn btn-secondary" disabled={busy} on:click={startCamera}>Foto ulang</button></div>
      {:else}<button class="btn btn-primary" disabled={busy||cameraOpening||!consent||own.some(r=>r.status==='pending')||$app.mode!=='live'} on:click={startCamera}><Icon name="camera" size={18}/> {cameraOpening?'Membuka kamera…':'Buka kamera depan'}</button>{/if}
    {#if own.some(r=>['pending','approved'].includes(r.status))}<button class="btn btn-secondary withdraw" disabled={busy} on:click={withdraw}>Cabut persetujuan dan hapus referensi</button>{/if}
  </section>
  <section class="panel"><h2>Cara menggunakan</h2><ol><li>Centang persetujuan dan ambil foto dari kamera depan.</li><li>HR lain memeriksa foto dengan identitas karyawan.</li><li>Setelah disetujui, selfie clock in dibandingkan dengan referensi di server.</li><li>Jika wajah tidak terdeteksi atau belum cocok, ambil ulang dengan pencahayaan cukup. Hubungi HR jika kendala berlanjut.</li></ol><p class="subtle">Jam hadir tetap dicatat oleh server saat clock in berhasil. Wajah, GPS, shift, dan selfie harus lolos pemeriksaan; tautan verifikasi berlaku singkat dan hanya dapat digunakan sekali.</p></section>
</div>
{#if pending.length}<section class="panel review"><h2>Tinjauan HR</h2><p>Periksa bahwa foto sesuai dengan karyawan sebenarnya sebelum menyetujui. Jangan menyetujui foto yang tidak dikenal.</p><div class="review-grid">{#each pending as row}<article><h3>{row.name}</h3><p>{row.employeeNumber} · {dateLabel(row.created_at)}</p>{#if row.imageUrl}<img src={row.imageUrl} alt={`Foto referensi ${row.name} untuk tinjauan identitas`} referrerpolicy="no-referrer"/>{:else}<p>Foto belum tersedia. Muat ulang sebelum memutuskan.</p>{/if}<label>Catatan tinjauan<textarea bind:value={notes[row.id]} minlength="5" maxlength="2000" placeholder="Tulis hasil pemeriksaan identitas" disabled={busy}></textarea></label><div class="buttons"><button class="btn btn-primary" disabled={busy||!row.imageUrl||(notes[row.id]??'').trim().length<5} on:click={()=>review(row,'approved')}>Setujui identitas</button><button class="btn btn-secondary" disabled={busy||(notes[row.id]??'').trim().length<5} on:click={()=>review(row,'rejected')}>Minta foto baru</button></div></article>{/each}</div></section>{/if}

<style>
  .page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1.5rem}.eyebrow{font-size:10px;letter-spacing:.16em;color:var(--accent)}h1{font-size:1.8rem;letter-spacing:-.04em;margin:.3rem 0}h2{font-size:1.1rem;margin:0 0 1rem}h3{font-size:1rem}p,li{font-size:.82rem;line-height:1.8;color:var(--muted)}.grid{display:grid;grid-template-columns:1.4fr 1fr;gap:1.5rem}.panel{padding:1.5rem;border-radius:24px;background:var(--surface);border:1px solid var(--panel-border);box-shadow:var(--raised)}.notice{padding:1rem;border:1px solid var(--control-border);border-radius:14px;background:var(--surface-cream)}.subtle{font-size:.74rem}.consent{display:flex;align-items:flex-start;gap:10px;font-size:.8rem;line-height:1.8;margin:1.3rem 0}.consent input{margin-top:5px;flex:0 0 auto}.camera{position:relative;width:min(100%,360px);aspect-ratio:3/4;overflow:hidden;border-radius:20px;background:#2c2923;margin:1rem auto}.camera video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}.preview{display:block;width:min(100%,360px);max-height:440px;object-fit:contain;border-radius:20px;margin:1rem auto}.buttons{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1rem}.withdraw{margin-top:1.5rem}.history{display:grid;gap:.7rem}.status-row{padding:.8rem 1rem;border-radius:12px;background:var(--surface-cream);border:1px solid var(--control-border)}.status-row strong,.status-row small{display:block;font-size:.8rem;line-height:1.7}.status-row small{font-size:.7rem;color:var(--muted)}ol{padding-left:1.3rem}li{padding:.4rem 0}.review{margin-top:1.5rem}.review-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem}.review article{border:1px solid var(--control-border);border-radius:18px;padding:1rem;min-width:0}.review img{display:block;width:100%;height:260px;object-fit:contain;border-radius:14px;margin:1rem 0;background:var(--surface-cream)}.review label{font-size:.75rem;display:grid;gap:.5rem}.review textarea{width:100%;min-height:90px}.btn{min-height:44px}@media(max-width:720px){.grid{grid-template-columns:1fr}.panel{padding:1.1rem}.page-heading{flex-wrap:wrap}.review-grid{grid-template-columns:1fr}}
</style>
