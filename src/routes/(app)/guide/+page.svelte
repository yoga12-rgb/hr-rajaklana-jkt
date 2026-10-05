<script lang="ts">
  import { app } from '#lib/state/app';
  import PageHeading from '#lib/components/PageHeading.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const sections = [
    { id: 'akun', label: 'Akun & data' },
    { id: 'pengajuan', label: 'Cuti & izin' },
    { id: 'kehadiran', label: 'Absensi kasir' },
    { id: 'hr', label: 'Atasan & HR' },
    { id: 'ketentuan', label: 'Ketentuan cuti' },
    { id: 'bantuan', label: 'PWA & kendala' }
  ];
</script>

<svelte:head>
  <meta name="description" content="Panduan akun, absensi kasir, cuti, izin, persetujuan, dan ketentuan penggunaan Rajaklana HR Jabodetabek."/>
</svelte:head>

<PageHeading eyebrow="PUSAT BANTUAN" title="Panduan penggunaan & ketentuan" description="Langkah penggunaan dan aturan kerja Rajaklana HR untuk tim Jabodetabek.">
  <a class="btn btn-secondary" href="/profile"><Icon name="user" size={17}/>Profil saya</a>
</PageHeading>

<div class="guide-intro">
  <div class="intro-icon"><Icon name="file" size={24}/></div>
  <p>Mulai dari akun Anda, lalu ikuti bagian sesuai tugas. Menu dan tindakan yang tersedia mengikuti hak akses yang ditetapkan HR.</p>
</div>

{#if $app.mode === 'demo'}
  <aside class="demo-note" aria-label="Batas mode demo">
    <Icon name="info" size={20}/>
    <div>
      <strong>Saat ini: demo lokal</strong>
      <p>Gunakan data contoh pada browser dan alamat aplikasi yang sama. Data belum tersinkron antarperangkat; tautan aktivasi demo hanya bekerja pada browser tersebut. Pratinjau selfie dapat hilang setelah halaman dimuat ulang. Supabase belum terhubung untuk penggunaan operasional.</p>
    </div>
  </aside>
{/if}

<div class="guide-layout">
  <nav class="contents" aria-label="Daftar isi panduan">
    <span class="contents-title">DALAM PANDUAN INI</span>
    {#each sections as section, index}
      <a href={`#${section.id}`}><span class="contents-number">{index + 1}</span>{section.label}<Icon name="chevron" size={14}/></a>
    {/each}
  </nav>

  <article class="guide-sections" aria-label="Panduan penggunaan aplikasi">
    <section class="panel guide-section" id="akun">
      <div class="section-title"><span>01</span><h2>Mulai menggunakan akun</h2></div>
      <ol>
        <li>HR membuat data karyawan dan nomor seperti <strong>RK000001</strong>, kemudian mengirim tautan aktivasi secara manual melalui WhatsApp.</li>
        <li>Buka tautan dan buat kata sandi sendiri sepanjang <strong>10–128 karakter</strong>. Setelah berhasil, pilih <strong>Masuk dengan akun ini</strong>. Sesi sebelumnya diakhiri dan nomor karyawan terisi pada halaman masuk.</li>
        <li>Masuk dengan nomor karyawan dan kata sandi Anda. Pada <a href="/profile">Profil</a>, periksa penempatan serta lengkapi alamat, foto profil, dan kontak darurat.</li>
      </ol>
      <p class="rule">Tautan aktivasi/pemulihan berlaku <strong>24 jam, satu kali pakai</strong>. Tautan pengganti membatalkan yang lama. Hubungi HR jika tautan kedaluwarsa atau Anda lupa kata sandi. Jangan membagikan kata sandi atau tautan pribadi.</p>
      <p class="hint">Nama, WhatsApp, data kerja, tanggal masuk, dan status karyawan diubah oleh HR. Nomor karyawan tetap ketika penempatan berubah.</p>
    </section>

    <section class="panel guide-section" id="pengajuan">
      <div class="section-title"><span>02</span><h2>Mengajukan cuti dan izin</h2></div>
      <ol>
        <li>Buka <a href="/leave">Cuti & izin</a> (menu <strong>Pengajuan</strong> di ponsel), lalu pilih <strong>Buat pengajuan</strong>.</li>
        <li>Pilih cuti tahunan, izin pribadi, atau izin sakit. Isi tanggal, alasan, dan lampiran jika diperlukan. Lampiran dapat berupa PDF atau foto JPG/PNG/WebP, maksimal <strong>5 MB</strong>.</li>
        <li>Untuk izin sebagian hari, gunakan <strong>satu tanggal</strong>: datang terlambat, keluar sementara, atau pulang lebih awal. Isi jam yang diminta; keluar sementara memerlukan jam keluar dan jam kembali.</li>
        <li>Kirim dan pantau detail pengajuan. Jika status <strong>Perlu dilengkapi</strong>, baca catatan atasan, pilih <strong>Lengkapi pengajuan</strong>, lalu <strong>Kirim ulang</strong>.</li>
      </ol>
      <p class="rule">Status <strong>Menunggu</strong> belum berarti disetujui. Hasil keputusan, catatan atasan, dan potongan saldo terlihat pada detail pengajuan.</p>
    </section>

    <section class="panel guide-section" id="kehadiran">
      <div class="section-title"><span>03</span><h2>Kasir: masuk dan pulang</h2></div>
      <ol>
        <li>Buka <strong>Kehadiran</strong>, pilih shift, izinkan lokasi perangkat, dan ambil <strong>selfie baru langsung dari kamera</strong>. Konfirmasi clock in; pastikan pesan berhasil dan catatan masuk muncul.</li>
        <li>Saat selesai bekerja, lakukan <strong>clock out</strong> dan periksa hasilnya. Lokasi diperiksa kembali; selfie hanya wajib saat clock in.</li>
      </ol>
      <div class="shift-table">
        <table>
          <caption>Pengaturan awal shift · WIB</caption>
          <thead><tr><th scope="col">Shift</th><th scope="col">Mulai</th><th scope="col">Patokan durasi</th></tr></thead>
          <tbody>
            <tr><th scope="row">Pagi</th><td>07.00</td><td>8 jam</td></tr>
            <tr><th scope="row">Sore</th><td>15.00</td><td>8 jam</td></tr>
            <tr><th scope="row">Middle</th><td>Fleksibel</td><td>8 jam dari clock in</td></tr>
          </tbody>
        </table>
      </div>
      <p>Jam kerja <strong>8 jam sudah termasuk istirahat</strong>; tidak ada clock istirahat. Jam awal Pagi/Sore, jam operasional, radius GPS, dan toleransi keterlambatan mengikuti pengaturan masing-masing outlet. Middle memerlukan izin HR dan tidak menghitung keterlambatan.</p>
      <p class="rule">Clock in dan clock out wajib berada dalam radius outlet dengan akurasi GPS yang memadai. Selesaikan sesi terbuka sebelum masuk kembali; satu clock in per hari. Keterlambatan tetap tercatat untuk ditinjau, termasuk saat ada izin datang terlambat.</p>
      <p class="hint">Durasi kurang dari 8 jam tetap dicatat untuk ditinjau SPV. Selisih durasi tidak otomatis menjadi lembur atau potongan cuti.</p>
    </section>

    <section class="panel guide-section" id="hr">
      <div class="section-title"><span>04</span><h2>Atasan dan Admin HR</h2></div>
      <ul>
        <li><strong>Atasan:</strong> buka <strong>Cuti & izin → Persetujuan tim</strong>. Setujui, tolak, atau minta kelengkapan. Tentukan potongan saat menyetujui; isi alasan saat menolak atau meminta kelengkapan.</li>
        <li><strong>Koordinasi:</strong> tim Produksi ditinjau Head Baker; Head Baker dan jabatan lain ditinjau SPV Penjualan & SDM, sesuai atasan yang ditetapkan HR.</li>
        <li><strong>Admin HR:</strong> kelola outlet, departemen, dan jabatan melalui <strong>Organisasi</strong>. Tambah karyawan, tetapkan penempatan/atasan, lalu buat tautan undangan melalui <strong>Karyawan</strong>. Salin pesan untuk dikirim manual melalui WhatsApp.</li>
        <li><strong>Rekap:</strong> periksa kehadiran, pengajuan, dan riwayat. Cocokkan GPS serta selfie melalui detail <strong>Kehadiran</strong>. Koreksi atau pencatatan manual membutuhkan alasan serta sumber konfirmasi. Catatan manual ditandai sebagai catatan tanpa verifikasi GPS/selfie.</li>
      </ul>
      <p class="rule">Pengajuan SPV Penjualan & SDM diputuskan Bos/Manager Pusat di luar aplikasi, lalu dicatat Admin HR lain dengan nama pemberi keputusan. Pengguna tidak boleh menyetujui pengajuan, membuat catatan manual, atau mengoreksi absensi dirinya sendiri.</p>
    </section>

    <section class="panel guide-section" id="ketentuan">
      <div class="section-title"><span>05</span><h2>Ketentuan cuti dan perubahan</h2></div>
      <dl class="leave-rules">
        <div><dt>Hak tahunan</dt><dd><strong>12 hari</strong>, mulai setelah bekerja <strong>3 bulan kalender</strong>. Pada tahun hak mulai berlaku, jatah prorata 1 hari per sisa bulan, termasuk bulan hak dimulai. Contoh masuk 15 Juli → berhak 15 Oktober → jatah 3 hari. Tahun berikutnya 12 hari.</dd></div>
        <div><dt>Masa berlaku</dt><dd>Mengikuti tahun kalender. Sisa saldo <strong>hangus setiap 31 Desember</strong> dan tidak dibawa ke tahun berikutnya.</dd></div>
        <div><dt>Potongan</dt><dd>Ditentukan atasan saat persetujuan: <strong>0</strong> berarti tanpa potongan; pecahan seperti <strong>0,5 hari</strong> diperbolehkan. Saldo tidak boleh negatif. Hari libur tetap yang dicatat HR tidak otomatis menentukan potongan.</dd></div>
        <div><dt>Menunggu atau Perlu dilengkapi</dt><dd>Pengajuan dengan status ini dapat diubah atau dibatalkan langsung. Perubahan tanggal yang sudah lewat diarahkan ke HR.</dd></div>
        <div><dt>Sudah disetujui</dt><dd>Perubahan tanggal atau pembatalan memerlukan <strong>persetujuan ulang</strong>. Tanggal dan potongan lama tetap berlaku selama menunggu atau jika permintaan ditolak. Hasil dan alasan keputusan terakhir tetap terlihat.</dd></div>
        <div><dt>Pengembalian saldo</dt><dd>Perubahan disetujui mengganti potongan lama dengan total baru. Pembatalan disetujui mengembalikan potongan ke <strong>tahun asal</strong>; saldo tahun yang sudah berakhir tidak menjadi jatah tahun baru. Pembatalan cuti disetujui yang sudah dijalani harus melalui HR.</dd></div>
      </dl>
    </section>

    <section class="panel guide-section" id="bantuan">
      <div class="section-title"><span>06</span><h2>Pemasangan, pembaruan, dan kendala</h2></div>
      <ul>
        <li>Pasang sebagai PWA melalui tombol <strong>Pasang aplikasi</strong> jika tersedia, atau menu pemasangan pada browser yang mendukung.</li>
        <li>Jika muncul <strong>Versi baru sudah tersedia</strong>, selesaikan formulir atau selfie terlebih dahulu, kemudian pilih <strong>Gunakan versi terbaru</strong>.</li>
        <li>Absensi memerlukan koneksi internet. Jika lokasi/kamera ditolak, GPS belum akurat, outlet belum diatur, atau pencatatan gagal, periksa izin perangkat dan koneksi lalu coba kembali.</li>
        <li>Jika kendala berlanjut atau lupa clock out, hubungi <strong>SPV/Admin HR</strong>. Sertakan nomor karyawan, outlet, waktu kejadian, dan pesan kendala agar dapat diperiksa.</li>
      </ul>
      <p class="rule">Pesan gagal bukan bukti absensi berhasil. Pastikan hasil tersimpan pada Kehadiran. Gunakan akun sendiri dan keluar dari perangkat bersama setelah selesai.</p>
    </section>
  </article>
</div>

<style>
  .guide-intro { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .intro-icon { display: grid; place-items: center; width: 52px; height: 52px; flex-shrink: 0; border-radius: 17px; color: var(--accent); background: var(--surface); box-shadow: var(--raised-sm); }
  .guide-intro p { margin: 0; max-width: 740px; font-size: 14px; line-height: 1.8; color: var(--muted); }
  .demo-note { display: flex; gap: 12px; padding: 18px 20px; border: 1px solid #e0d1a1; border-radius: 17px; background: var(--yellow-soft); margin-bottom: 26px; }
  .demo-note :global(svg) { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
  .demo-note strong { font-size: 13px; }
  .demo-note p { font-size: 12px; line-height: 1.8; margin: 6px 0 0; }
  .guide-layout { display: grid; grid-template-columns: 205px minmax(0, 1fr); gap: 26px; align-items: start; }
  .contents { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 7px; }
  .contents-title { color: var(--muted); font-size: 9px; letter-spacing: 1.4px; font-weight: 600; padding: 0 10px 7px; }
  .contents a { display: flex; align-items: center; gap: 9px; min-height: 44px; padding: 9px 10px; border-radius: 12px; font-size: 12px; color: var(--accent); }
  .contents a:hover { box-shadow: var(--raised-sm); }
  .contents a :global(svg) { margin-left: auto; flex-shrink: 0; }
  .contents-number { display: grid; place-items: center; width: 25px; height: 25px; flex-shrink: 0; border-radius: 8px; box-shadow: var(--inset); font-size: 10px; font-weight: 700; }
  .guide-sections { display: flex; flex-direction: column; gap: 22px; min-width: 0; }
  .guide-section { scroll-margin-top: 24px; padding: 26px; }
  .section-title { display: flex; align-items: center; gap: 12px; margin-bottom: 19px; }
  .section-title > span { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; border-radius: 12px; background: var(--yellow-soft); font-size: 11px; font-weight: 700; color: var(--accent); }
  h2 { font-size: 18px; margin: 0; line-height: 1.5; }
  .guide-section p, .guide-section li, .guide-section dd { font-size: 13px; line-height: 1.85; }
  .guide-section ol, .guide-section ul { padding-left: 21px; margin: 0 0 17px; }
  .guide-section li { padding-left: 4px; margin-bottom: 10px; }
  .guide-section li:last-child { margin-bottom: 0; }
  .guide-section a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
  .guide-section p { margin-bottom: 14px; }
  .guide-section p:last-child { margin-bottom: 0; }
  .guide-section .rule { border: 1px solid #ffffff9c; box-shadow: var(--inset); padding: 15px 17px; border-radius: 14px; color: #655b39; }
  .guide-section .hint { font-size: 12px; color: var(--muted); }
  .shift-table { border: 1px solid var(--border); border-radius: 13px; overflow: hidden; margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; }
  caption { text-align: left; padding: 12px 14px; color: var(--muted); font-size: 11px; }
  th, td { padding: 11px 14px; border-top: 1px solid var(--border); }
  thead th { background: #eee6cd; font-size: 11px; color: var(--accent); }
  tbody th { font-weight: 600; }
  .leave-rules { margin: 0; }
  .leave-rules > div { padding: 16px 0; border-bottom: 1px solid var(--border); }
  .leave-rules > div:first-child { padding-top: 0; }
  .leave-rules > div:last-child { padding-bottom: 0; border-bottom: 0; }
  dt { font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 6px; }
  dd { margin: 0; }
  @media (max-width: 1000px) {
    .guide-layout { grid-template-columns: 1fr; gap: 22px; }
    .contents { position: static; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .contents-title { grid-column: 1 / -1; }
    .contents a { background: var(--surface); box-shadow: var(--raised-sm); }
    .contents a :global(svg) { display: none; }
  }
  @media (max-width: 600px) {
    .guide-intro { gap: 12px; align-items: flex-start; }
    .intro-icon { width: 42px; height: 42px; border-radius: 14px; }
    .guide-intro p { font-size: 12px; }
    .demo-note { padding: 15px; gap: 10px; }
    .contents { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .contents a { font-size: 11px; padding: 9px; gap: 7px; }
    .guide-section { padding: 20px 18px; }
    .section-title { gap: 10px; }
    h2 { font-size: 16px; }
    .guide-section .rule { padding: 13px; }
    th, td { padding: 10px; font-size: 11px; }
  }
</style>
