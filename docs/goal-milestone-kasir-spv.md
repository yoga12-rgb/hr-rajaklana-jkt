# Goal dan Milestone Pengembangan Kasir untuk SPV

Tanggal penyusunan: **19 Oktober 2026**
Status: **Tahap A: M0–M3 selesai; M4 Realtime dua tab dengan akun Admin yang sama, pemulihan sesi setelah reload Preview, retry RPC idempoten di Supabase Preview, serta PWA offline-shell pada build produksi lokal terverifikasi. Reconnect jaringan nyata, app resume, retry UI setelah respons jaringan ambigu, dan uji iPhone manual masih tertunda; M5 dirilis ke Preview. Tahap B belum dimulai.**
Baseline source: `94cd99326a2d34c836a8ef1a385eeebff5c126cb`
Status pelaksanaan diperbarui: **19 Oktober 2026**

## 1. Instruksi dan tujuan dokumen

Dokumen ini awalnya dibuat sebagai handoff untuk agent pelaksana. Pengguna kemudian meminta Tahap A dieksekusi dengan teliti; implementasi dan verifikasi lokal berjalan mengikuti cakupan M0–M5 di bawah.

Pengguna menunda uji coba manual cuti/izin dan meminta pengembangan fitur yang memudahkan SPV. Jangan meminta pengguna mengulang uji manual setiap menyelesaikan milestone. Agent tetap melakukan verifikasi otomatis dan pemeriksaan browser yang relevan, lalu mencatat uji perangkat/pengguna yang masih ditunda.

**Urutan pelaksanaan:** selesaikan **Tahap A / M0–M5** lebih dahulu. **Tahap B / M6–M10** adalah roadmap lanjutan. Tugas awal agent penerima handoff adalah Tahap A; jangan memperluas perubahan ke semua modul Tahap B sekaligus.

**Batas environment:** rilis yang termasuk tugas ini hanya Preview pada branch `codex/preview` dan Supabase Preview `lypsqrwjzrmuyqtdcegr`. Production, data HR Production, dan branch `main` tidak termasuk tindakan rilis.

## 2. Goal produk

> SPV dapat memantau kesiapan kasir setiap outlet, mengenali masalah yang perlu dikonfirmasi, membagi tindak lanjut, dan menyusun jadwal satu minggu dengan cepat melalui aplikasi yang sama.

Hasil utama yang diinginkan:

1. SPV mengetahui outlet/shift yang kekurangan kasir tanpa membuka catatan satu per satu.
2. SPV mengetahui siapa yang perlu dihubungi dan apakah masalahnya sudah ditangani.
3. Penyusunan jadwal beberapa kasir dan beberapa hari dilakukan dalam satu alur, dengan pratinjau sebelum simpan.
4. Perubahan jadwal tetap mempunyai pelaku, alasan, waktu, dan riwayat yang bisa diperiksa.
5. Kasir menerima jadwal dan perubahan yang sudah resmi melalui aplikasi dan notifikasi yang tersedia.
6. Tahap lanjutan membantu pertukaran shift, serah terima, pelaporan kendala, dan rekap berkala.

### Ukuran keberhasilan Tahap A

- Satu tampilan SPV menampilkan ringkasan outlet serta daftar masalah hari yang dipilih.
- Cakupan terencana, kehadiran aktual, dan kebutuhan minimum ditampilkan sebagai hal yang berbeda.
- SPV dapat menyusun tujuh tanggal sekaligus dan menyalin jadwal minggu sebelumnya.
- Simpan jadwal berhasil seluruhnya atau gagal seluruhnya; tidak ada perubahan sebagian yang tersembunyi.
- Konflik, data usang, dan kegagalan jaringan mempunyai pesan yang jelas.
- Kasir tidak mendapat akses ke daftar masalah atau data pribadi kasir lain.
- Pembaruan dari akun/perangkat lain muncul tanpa refresh manual, dengan pemulihan saat aplikasi kembali aktif.

## 3. Konteks bisnis yang harus dipertahankan

| Pokok | Ketentuan yang sudah disepakati |
| --- | --- |
| Wilayah | Fokus Rajaklana Jabodetabek; outlet dikelola dinamis melalui aplikasi. |
| Produksi | Tim produksi menyatu dengan salah satu outlet. Fitur dalam roadmap ini berfokus pada kasir. |
| Koordinasi | Seluruh jabatan berada di bawah koordinasi SPV Penjualan dan SDM. |
| SPV 1 | Penjualan dan SDM, termasuk fungsi Admin HR sesuai akses yang diberikan. |
| SPV 2 | Sarana/prasarana dan keuangan. |
| SPV 3 | Stok produk outlet. |
| Hak akses | Jabatan dan izin aplikasi berbeda. Gelar SPV tidak otomatis memberi hak Admin HR. |
| Shift | Pagi, Sore, dan Middle. Jam Pagi/Sore mengikuti pengaturan outlet; kebiasaan saat ini 07.00 dan 15.00 WIB. |
| Jam kerja | Delapan jam sudah termasuk istirahat. Middle fleksibel dan tidak memiliki jam masuk terjadwal pada model saat ini. |
| Hari libur | Masing-masing karyawan mempunyai hari libur tetap yang dapat berbeda. |
| Penempatan | Kasir dapat mendapat penugasan sementara di outlet berbeda tanpa mengubah penempatan utamanya. |
| Kehadiran | GPS, selfie/verifikasi yang sudah ada, clock in/out, dan koreksi tetap mengikuti aturan aplikasi. |
| Cuti | Tahunan 12 hari, mulai berhak setelah bekerja tiga bulan, prorata, mengikuti tahun kalender, dan hangus pada akhir tahun. |
| Izin | Dapat sehari atau sebagian jam; keputusan/potongan mengikuti kewenangan atasan dan alur yang sudah ada. |
| Persetujuan | Atasan eksternal tetap dapat dicatat oleh HR yang berwenang, dengan nama pemberi keputusan. Tidak boleh memutus pengajuan sendiri. |
| Platform | SvelteKit + TypeScript, SPA/PWA, Supabase dan Vercel pada konfigurasi uji gratis yang sudah tersedia. |
| Tampilan | Tema Neumorphism kuning, nyaman untuk ponsel, kontras dan fokus keyboard tetap jelas. |

## 4. Kondisi aplikasi saat handoff

### Sudah tersedia — perlu dikembangkan, bukan dibuat ulang

- Data karyawan, outlet, departemen, jabatan, dan pengelolaan akun.
- Penugasan kasir per hari: outlet, Pagi/Sore/Middle/Libur, perubahan, pembatalan, dan outlet sementara.
- Tabel jumlah penugasan per outlet/shift, **belum menghitung kebutuhan minimum kasir**.
- Clock in/out, keterlambatan, konteks izin, sesi panjang, koreksi kasir/HR, dan ekspor CSV.
- Cuti/izin, persetujuan, perubahan tanggal, pembatalan, serta ledger potongan/refund.
- Beranda HR dengan metrik umum dan beberapa catatan kehadiran terbaru.
- Inbox, push opt-in, notifikasi penugasan, dan pengingat server.
- Realtime/refetch saat aplikasi kembali aktif dan mode demo lokal terpisah dari live.

### Batas bukti yang diketahui

- Snapshot `94cd993`: 308 unit test, pemeriksaan komponen/tipe, build, dan suite database 12 migrasi telah lulus. Ini riwayat, bukan pengganti pemeriksaan source saat agent mulai bekerja.
- Commit tersebut sudah dipush ke `main` dan `codex/preview`; keduanya pernah diverifikasi READY dengan CI sukses.
- Pengguna sudah mengonfirmasi clock in/out dan alur notifikasi iPhone pada pilot Preview. Bukti pengguna tidak berarti seluruh skenario perangkat/izin/liveness sudah diuji.
- Uji manual cuti/izin oleh pengguna **ditunda**. Pada pemeriksaan 19 Oktober, Preview belum mempunyai pengajuan cuti/izin; satu langganan perangkat aktif terdaftar.
- Tidak ada klaim bahwa enam fitur roadmap di bawah sudah berjalan.

## 5. Peta ruang lingkup

| Tahap | Fitur | Hasil yang harus terlihat |
| --- | --- | --- |
| A — prioritas pertama | Panel pemantauan outlet dan tindak lanjut SPV | Ringkasan outlet, status kasir, daftar kasus, penanggung jawab, dan catatan penanganan. |
| A — prioritas pertama | Jadwal mingguan dan kebutuhan kasir | Grid satu minggu, salin jadwal, minimum per outlet/shift, pratinjau konflik, dan simpan utuh. |
| B — lanjutan | Tukar shift/pengganti | Kasir mengajukan, rekan mengonfirmasi, SPV memutuskan, jadwal resmi diperbarui. |
| B — lanjutan | Serah terima shift | Catatan operasional dari kasir keluar dan konfirmasi penerima. |
| B — lanjutan | Laporan kendala outlet | Kategori dinamis, foto opsional, penanggung jawab, status, dan riwayat penanganan. |
| B — lanjutan | Ringkasan mingguan/bulanan | Agregat per kasir/outlet dan ekspor yang sesuai dengan detail sumber. |

Di luar cakupan: POS/transaksi penjualan, payroll, pemotongan gaji otomatis, keputusan disiplin otomatis, absensi seluruh jabatan, ekspansi seluruh cabang, WhatsApp otomatis, dan pengadaan layanan berbayar.

## 6. Keputusan rancangan awal Tahap A

Keputusan berikut menjadi default kerja agar agent dapat maju tanpa menanyakan pilihan rutin kepada pengguna. Jika source terbaru membuktikan ada pertentangan mendasar, jelaskan masalahnya dan minta hanya informasi yang benar-benar diperlukan.

### 6.1 Panel dan status operasional

- Perluas Beranda SPV/Admin HR dan gunakan halaman Penugasan yang sudah ada untuk rincian jadwal. Hindari membuat beranda paralel dengan angka yang berbeda.
- Filter dasar: tanggal kerja WIB, outlet, shift, dan status yang perlu perhatian.
- Tampilkan terpisah: **minimum dibutuhkan**, **tersedia pada jadwal**, dan **kehadiran aktual**. Kehadiran aktual pada tanggal lampau tidak boleh diberi label “sedang bekerja”.
- Bedakan minimal: belum ditugaskan, libur, cuti/izin disetujui, belum waktunya masuk, perlu konfirmasi karena belum clock in, sedang bekerja, sudah pulang, dan sesi perlu diperiksa.
- Kasir yang belum clock in setelah batas masuk/toleransi diberi status **Perlu konfirmasi**, bukan otomatis alpa. Izin terlambat yang disetujui diperhitungkan sebelum menandai keterlambatan tanpa izin.
- Middle tidak memperoleh keterlambatan fiktif; jam masuknya memang belum terjadwal. Kekurangan informasi tampil jelas.
- Daftar kasus dapat difilter dan ditindaklanjuti tanpa mengubah bukti absensi. Catatan tindak lanjut bukan pengganti koreksi absensi atau keputusan cuti.
- Kartu kasus memuat tautan langsung ke data sumber. Jika tidak mempunyai izin, akses rincian tetap ditolak server.

### 6.2 Kebutuhan minimum dan kecukupan kasir

- Minimum dapat diatur per outlet, hari dalam minggu, dan shift, dengan tanggal mulai berlaku. Nama outlet/kasir/petugas tidak hardcode.
- Nilai **belum diatur** berbeda dari **0**. Nol berarti tidak membutuhkan kasir pada slot tersebut; belum diatur berarti kecukupan belum dapat dinilai.
- Hitung karyawan unik dari penugasan aktif yang bekerja. Jangan memasukkan penugasan batal, Libur, karyawan tidak aktif, atau penugasan yang tidak berlaku pada tanggalnya.
- Cuti/izin sehari penuh yang sudah disetujui membuat kasir tidak tersedia, walaupun potongan cutinya nol. Jangan memakai jumlah potongan sebagai ukuran ketersediaan.
- Pengajuan menunggu dan usulan perubahan/pembatalan cuti adalah peringatan. Tanggal/keputusan lama tetap berlaku sampai keputusan baru disetujui.
- Izin sebagian jam diberi penanda cakupan parsial. Jangan menyebut slot sepenuhnya tercukupi hanya dari jumlah nama; jangan pula mengurangi satu kasir untuk seluruh hari karena izin satu jam.
- Untuk Tahap A, tandai slot dengan cakupan parsial sebagai **Perlu tinjauan jam** jika kecukupan sepanjang shift belum dapat dipastikan. Penghitungan per interval dapat ditambahkan dengan fungsi yang teruji; label harus sesuai kemampuan aktual.
- Middle ditampilkan sebagai slot sendiri. Jangan menganggap Middle otomatis menutup kebutuhan Pagi/Sore tanpa rentang waktu terencana yang eksplisit.
- Bedakan kekurangan pada jadwal dengan orang yang belum hadir. Slot yang sudah terjadwal lengkap dapat tetap mempunyai masalah kehadiran.
- Kekurangan staf memberi informasi kepada SPV; tidak otomatis menolak cuti, mengubah saldo, memindahkan kasir, atau mengubah hari libur.

### 6.3 Jadwal mingguan dan salin jadwal

- Tampilan awal: minggu Senin–Minggu dalam WIB, dengan navigasi minggu sebelumnya/berikutnya.
- Kasir melihat jadwal dirinya. Admin HR yang berwenang menyusun jadwal beberapa kasir/tanggal dalam satu alur.
- Penugasan harian tetap menjadi sumber data resmi; grid mingguan adalah cara menyusun dan melihat sumber yang sama.
- Sediakan salin minggu sebelumnya → pratinjau hasil → perbaiki konflik → simpan. Tanggal sumber dan target selalu terlihat.
- Default salin hanya mengisi target kosong. Target yang sudah mempunyai data tidak ditimpa diam-diam; penugasan batal harus dikenali sebagai data yang pernah ada.
- Constraint saat ini adalah `unique(employee_id, work_date)` untuk seluruh status, termasuk batal. Mengaktifkan kembali slot yang dibatalkan memakai identitas baris yang sudah ada beserta auditnya; jangan mengubahnya menjadi beberapa baris pada pasangan yang sama hanya untuk mendukung salin.
- Libur tetap tampil sebagai saran pada sel kosong. Jangan menulis penugasan secara otomatis saat hanya membuka halaman. Perubahan terhadap hari libur memerlukan alasan yang tersimpan dan terlihat pada pratinjau.
- Penugasan baru yang berbenturan dengan cuti penuh disetujui ditolak. Cuti yang disetujui setelah jadwal dibuat menimbulkan peringatan konflik, tanpa menghapus jadwal lama diam-diam.
- Izin sebagian jam, pengajuan cuti menunggu, dan kekurangan minimum diberi peringatan yang jelas pada pratinjau.
- Pertahankan larangan self-assignment, satu penugasan aktif per karyawan/tanggal lintas outlet, batas mulai bekerja, izin Middle, outlet/karyawan aktif, dan pembatasan perubahan jika sudah ada absensi.
- Editor mingguan berfokus pada tanggal hari ini dan mendatang. Jadwal lampau dapat dilihat; kebutuhan penugasan/koreksi lampau tetap memakai jalur harian/HR yang sudah memiliki aturan khusus.
- Jangan membuat batch dengan perulangan RPC simpan satu baris dari browser. Gunakan transaksi server: seluruh baris, audit, dan notifikasi berhasil bersama atau dibatalkan bersama.
- Deteksi perubahan oleh SPV lain sejak pratinjau melalui version/updated_at atau mekanisme setara. Jangan menimpa perubahan terbaru dengan snapshot lama.
- Mencegah klik ganda/retry jaringan menghasilkan penugasan atau pemberitahuan ganda. Gunakan idempotency key yang diperiksa di server untuk batch.
- Tidak perlu menambahkan draft/publikasi jadwal terpisah pada Tahap A. Tombol simpan yang berhasil menjadikan perubahan resmi dan mengirim pemberitahuan yang relevan.

### 6.4 Tindak lanjut SPV

- Simpan kasus dengan referensi ke penugasan, absensi, atau pengajuan yang memicunya; satu kasus aktif untuk kejadian yang sama.
- Field minimum: jenis kasus, tanggal kerja, outlet, karyawan terkait, data sumber, penanggung jawab, status, catatan, pelaku dan waktu perubahan.
- Status minimum: **Belum ditangani → Diproses → Selesai**, dengan alasan penyelesaian. Pembukaan ulang dicatat jika masalah muncul kembali setelah sumber berubah.
- Menandai selesai hanya menutup tindak lanjut. Absensi, keterlambatan, saldo, dan riwayat asli tetap mengikuti transaksi masing-masing.
- Jangan menghasilkan ulang kasus selesai tanpa perubahan sumber yang relevan. Jangan menutup kasus secara diam-diam akibat refetch.
- Tahap A tidak memerlukan scheduler baru untuk semua kasus. Gabungkan sinyal dari data yang ada dan rekam tindak lanjut saat digunakan; notifikasi terjadwal tambahan hanya jika diperlukan dan didesain idempoten.
- Membaca panel tidak perlu membuat baris kasus untuk setiap indikator. Indikator dapat diturunkan secara read-only; simpan tindak lanjut ketika petugas mulai menugaskan, mencatat, atau menangani kasus.

## 7. Milestone Tahap A — prioritas agent pelaksana

Checklist berikut mencatat bukti implementasi aktual. M4 baru selesai setelah pembaruan antar dua sesi terverifikasi; M5 baru selesai setelah deployment Preview yang berisi versi sama diperiksa.

### M0 — Baseline dan rancangan implementasi

**Tujuan:** memastikan implementasi bertumpu pada source terbaru dan aturan yang benar.

- [x] Periksa Git status, branch, instruksi repository, dan keberadaan `.codegraph/`. Tidak ada `.codegraph/`; perubahan lokal diinventarisasi.
- [x] Baca source utama, migration terbaru, kontrak backend, dan dokumen lingkungan. Migration/source aktual menjadi acuan implementasi.
- [x] Catat baseline pengujian dan perubahan lokal. Implementasi dimulai dari source `94cd993`; tidak ada perubahan pihak lain yang tertimpa.
- [x] Tetapkan sumber status/cakupan, transaksi batch, otorisasi, dan identitas tindak lanjut sesuai keputusan desain pada bagian 6.
- [x] Tidak memakai subagent pada sesi ini; satu alur dimiliki langsung agar state dan migration konsisten.

**Kriteria selesai:** rancangan ringkas tercatat, dependensi dikenali, tidak ada asumsi diam-diam tentang peran SPV, Middle, atau tanggal kerja.

### M1 — Fondasi data, domain, dan akses

**Dependensi:** M0.

- [x] Tambahkan tabel kebutuhan minimum, tindak lanjut, dan tanda terima idempotensi melalui migration baru.
- [x] Tambahkan RPC batch, validasi ulang, version check, idempotensi, audit, dan notifikasi dalam satu transaksi.
- [x] Batasi baca ke Admin HR lewat RLS dan tulis lewat RPC; akses langsung kasir/anon ditolak.
- [x] Pusatkan fungsi domain klasifikasi status dan cakupan.
- [x] Tambahkan model, state, Realtime, dan perilaku demo yang terpisah dari Supabase.
- [x] Harness database memverifikasi penambahan non-destruktif, rollback, retry, akses, dan nilai minimum belum diatur.

**Kriteria selesai:** tes transaksi, akses lintas akun, rollback, idempotensi, dan fungsi domain lulus. Belum harus ada UI lengkap.

### M2 — Panel outlet dan tindak lanjut SPV

**Dependensi:** M1.

- [x] Perluas Beranda dengan ringkasan outlet dan daftar kasus pada tanggal kerja.
- [x] Pisahkan kebutuhan minimum, jadwal, ketersediaan setelah cuti sehari penuh, absensi aktual, dan status perhatian.
- [x] Tambahkan filter outlet/tanggal, tautan data sumber, Admin HR penanggung jawab, catatan, penyelesaian, dan pembukaan ulang.
- [x] Status koneksi dan kesalahan dimunculkan melalui panel/layout bersama; kondisi kosong ditampilkan tanpa menyatakan cukup atau kurang.
- [x] Fungsi domain memakai tanggal kerja WIB, absensi/outlet historis, izin, cuti, Middle, dan tanggal lampau.

**Kriteria selesai:** SPV dapat menemukan kasus, membuka sumber, memberi catatan, dan menyelesaikan tindak lanjut; data kehadiran asli tidak ikut berubah.

### M3 — Grid mingguan, salin, dan kecukupan kasir

**Dependensi:** M1; dapat dikerjakan paralel dengan M2 jika kepemilikan file terpisah.

- [x] Tambahkan tampilan minggu Senin–Minggu dan pertahankan editor harian.
- [x] Tambahkan editor per kasir/tanggal untuk shift, outlet sementara, dan libur.
- [x] Tambahkan kebutuhan minimum dinamis dengan tanggal efektif dan indikator status.
- [x] Tambahkan pratinjau salin minggu sebelumnya, target yang dilewati, konflik, dan ringkasan sebelum simpan.
- [x] Validasi cuti, libur, Middle, tanggal mulai, outlet, absensi, self-assignment, dan versi snapshot.
- [x] Batch melalui RPC atomik dengan key idempotensi; kegagalan satu baris menggagalkan seluruh batch.

**Kriteria selesai:** satu alur menyimpan beberapa penugasan; satu baris tidak valid membatalkan seluruh batch. Perubahan oleh SPV lain tidak tertimpa diam-diam.

### M4 — Integrasi realtime, notifikasi, dan pengalaman ponsel

**Dependensi:** M2 dan M3.

- [x] Tambahkan tabel baru pada langganan Realtime tunggal yang dipakai aplikasi.
- [x] Perubahan jadwal, absensi, cuti, minimum, dan kasus memicu refetch state.
- [x] Status koneksi mengikuti status kanal Realtime; kanal yang kembali berlangganan melakukan refetch untuk menyelaraskan state.
- [x] Kelompokkan pemberitahuan live per penerima/batch dan demo per penerima/minggu.
- [x] Isi pemberitahuan bersifat umum dan halaman rincian tetap memerlukan autentikasi.
- [x] Simpan draft jadwal lokal per akun/minggu, alasan batch, minggu terpilih, dan kunci retry; tes browser membuktikan pemulihan setelah reload dan pemisahan minggu.
- [x] Verifikasi pembaruan lintas dua tab Preview tanpa refresh manual; perubahan uji sementara dipulihkan setelah verifikasi.
- [x] Simulasikan offline/online di browser demo dan pastikan indikator koneksi serta peringatan kembali normal.
- [x] Hapus entri draft lokal saat shift/outlet dikembalikan ke nilai jadwal awal; regresi browser memastikan status draft kosong hilang.
- [x] Uji PWA pada build produksi lokal: manifest, ikon, service worker, batas cache, dan shell saat offline.
- [x] Uji retry RPC idempoten pada Supabase Preview dengan kunci dan payload identik; hasil serta ID batch sama.
- [ ] Uji reconnect kanal saat jaringan nyata terputus dan pemulihan setelah aplikasi kembali aktif.
- [ ] Uji retry dari UI setelah respons jaringan ambigu di Preview.
- [ ] Uji manual di iPhone/iPad untuk memastikan pemasangan dan pemulihan setelah aplikasi ditutup OS.
- [x] Pertahankan tema kuning, status teks, tombol sentuh, dan fokus kontrol.
- [x] Uji grid horizontal pada viewport ponsel tanpa memperlebar halaman.

**Kriteria selesai:** perubahan terlihat antar dua sesi browser tanpa refresh manual; tidak ada kebocoran data antar akun atau regresi opt-in/logout push.

### M5 — Validasi, dokumentasi, dan rilis Tahap A

**Dependensi:** M4.

- [x] Jalankan check, unit, database, legacy, build, dan tes browser; kegagalan selector fixture lama diperbaiki dan tes ulangnya lulus.
- [x] Perbarui kontrak backend, panduan pengguna, dan laporan progres dengan hasil aktual.
- [x] Dokumentasikan cara mengatur minimum, menyalin minggu, membaca indikator, dan menangani konflik.
- [x] Tinjau migration/RLS serta verifikasi target Preview; satu migration telah diterapkan hanya ke Supabase Preview.
- [x] Push branch Preview; deployment Vercel READY, halaman login merespons HTTP 200, dan 13 migration lokal cocok dengan Supabase Preview.
- [x] Production tetap di luar ruang lingkup dan tidak menerima perubahan atau deployment.
- [x] Catat uji pengguna/iPhone yang ditunda sebagai **belum diuji**; jangan melaporkannya lulus dari hasil unit test.

**Kriteria selesai:** hasil Tahap A dapat ditinjau, sumber dan bukti tersimpan, status rilis jelas, dan sisa uji manual dicatat terpisah. Jika deployment belum termasuk tugas, nyatakan kesiapan lokal/Preview sebenarnya.

#### Catatan pelaksanaan — 19 Oktober 2026

- Implementasi domain, panel SPV, grid mingguan, kebutuhan minimum, transaksi database, RLS, audit, dan pemberitahuan selesai pada source lokal.
- Lulus pada source sebelum pemulihan draft: `npm.cmd run check` (0 error/0 warning), `npm.cmd test -- --maxWorkers=1` (316 test), `npm.cmd run test:database` (migration dan pemeriksaan keamanan), `npm.cmd run test:database:legacy` (seluruh fixture), `npm.cmd run build`, serta Playwright demo lokal (12 lulus, 1 dilewati).
- Setelah audit M4: `npm.cmd run check` (0 error/0 warning), `npm.cmd test -- --maxWorkers=1` (322 test), `npm.cmd run test:database`, `npm.cmd run test:database:legacy`, `npm.cmd run build`, dan Playwright demo lokal (13 lulus, 1 dilewati). Tes tambahan memuat ulang editor mingguan dan memeriksa pemulihan draft/alasan serta isolasi minggu.
- Setelah perbaikan deep link, koneksi, dan pembersihan draft: check (0 error/0 warning), unit (322 lulus), build, serta Playwright demo lokal (16 lulus, 1 dilewati). Tes regresi memastikan query minggu dipakai setelah reload, perpindahan minggu tidak mencampur draft, indikator offline pulih saat browser kembali online, dan draft yang dibatalkan sepenuhnya dihapus.
- Tes PWA khusus pada build produksi lokal lulus: manifest `standalone`, ikon 192/512, service worker aktif, hanya shell statis yang dicache, dan halaman cuti tampil saat browser disimulasikan offline. Tes khusus ini dijalankan terpisah dari suite demo.
- Harness database bersifat lokal/PGlite; Playwright memakai demo lokal. Keduanya bukan bukti autentikasi atau perilaku perangkat hosted.
- Migration `20261019061522_cashier_spv_weekly_roster.sql` sudah diterapkan ke Supabase Preview `lypsqrwjzrmuyqtdcegr`. Riwayat lokal dan remote cocok pada seluruh 13 migration; metadata Preview mengonfirmasi RLS pada tabel baru, empat RPC aman hanya untuk `authenticated`, dan dua tabel terbit di publikasi Realtime.
- Uji hosted Realtime pada 19 Oktober 2026: Admin HR membuka Preview di dua tab, menetapkan shift Pagi sementara untuk RK000003 pada 26 Oktober, dan perubahan tampil di tab kedua tanpa refresh. Penugasan kemudian dikosongkan kembali dan kedua tab menunjukkan nol perubahan tersimpan. Dua catatan audit dari aksi uji tetap tercatat. Ini membuktikan sinkronisasi dua tab untuk akun yang sama; belum membuktikan dua akun berbeda atau perilaku reconnect.
- Smoke test hosted pada 19 Oktober 2026: tab Preview baru dan reload mempertahankan sesi Admin HR serta kembali ke status **Terhubung**. Ini membuktikan pemulihan sesi/data setelah reload; tidak membuktikan app resume dari latar belakang iPhone.
- Uji retry hosted pada 19 Oktober 2026: RPC `cashier_roster_batch_save` dipanggil sebagai `authenticated` dua kali dengan kunci dan payload yang sama; respons identik, ID batch sama, dan `saved_count=1`. Seluruh panggilan ada dalam transaksi yang di-rollback, sehingga tidak meninggalkan jadwal, audit, atau notifikasi uji. Ini membuktikan perilaku retry RPC di Supabase Preview; retry UI setelah respons jaringan ambigu belum diuji.
- Pembersihan draft hosted pada 19 Oktober 2026: draft kosong dari uji sebelumnya dipulihkan pada versi baru, lalu shift uji dipilih dan dikembalikan melalui UI. Status draft tersimpan hilang, indikator tetap `0 perubahan`, dan tidak ada batch yang dikirim ke server.
- Perbaikan tambahan: tautan `?week=YYYY-MM-DD` kini dipakai saat planner pertama kali dimuat, termasuk sesudah reload dengan sesi login; navigasi minggu tetap membaca URL browser terbaru agar draft terpisah per minggu. Tes browser regresi mencakup tautan langsung, reload, isolasi draft, dan simulasi status jaringan lokal. Reconnect kanal Realtime saat jaringan nyata putus, app resume, retry UI setelah respons ambigu, serta uji manual iPhone masih belum terverifikasi. Tes browser lokal memakai demo dan tidak menggantikan uji hosted.
- Rilis Preview aplikasi: commit `4881a4adca586fafb157323b20e9f62cc189bc31` (`fix: clear reverted weekly roster drafts`), Vercel deployment `dpl_9tSiGgxyXjtc15sR89ANfwT7Fv3Z`, status **Ready**, URL deployment `https://hr-rajaklana-od6ck0sxa-hr-rajaklana.vercel.app`, alias [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app/). Halaman `/assignments?week=2026-10-26` terautentikasi menampilkan rentang `2026-10-26 – 2026-11-01`. Build Vercel menjalankan `npm run check && npm run build`. Production tidak diubah.

## 8. Milestone Tahap B — roadmap sesudah Tahap A

Tahap ini tidak menjadi syarat untuk menyatakan implementasi Tahap A selesai. Mulai setelah Tahap A stabil dan cakupan sesi berikutnya memang mencakup modul terkait.

### M6 — Permintaan tukar shift atau pengganti

**Dependensi:** M3, M4, M5.

- Kasir memilih penugasan mendatang dan mengajukan tukar dengan rekan atau meminta pengganti.
- Alur: menunggu rekan → menunggu SPV → disetujui/ditolak/dibatalkan/kedaluwarsa.
- Jadwal resmi tetap berlaku selama permintaan belum selesai disetujui. Persetujuan rekan tidak sama dengan persetujuan SPV.
- Server memeriksa kembali kedua jadwal saat keputusan, termasuk izin Middle, cuti, outlet, konflik tanggal, dan absensi yang sudah ada.
- Perubahan kedua pihak berlangsung atomik, memiliki audit, serta membatalkan permintaan lain yang sudah tidak relevan secara jelas.
- Penggantian satu arah dan pertukaran dua arah diberi label berbeda. Jangan membuat kasir mempunyai dua penugasan kerja pada tanggal yang sama.
- Pembatalan atau penolakan tidak mengubah jadwal asli. SPV tidak boleh memutus permintaan yang melibatkan dirinya sendiri.

**Kriteria selesai:** tes persetujuan rekan/SPV, penolakan, pembatalan, data usang, keputusan ganda, dan konflik antar permintaan lulus; kedua kasir melihat jadwal akhir yang konsisten.

### M7 — Serah terima shift

**Dependensi:** M3 dan M5.

- Kaitkan serah terima dengan outlet, tanggal/shift, penugasan pengirim, dan penerima; jangan hanya mengandalkan outlet utama karyawan.
- Isi minimum: pekerjaan/pesanan yang masih perlu ditindaklanjuti, kondisi outlet/perlengkapan, catatan, pengirim, dan waktu.
- Checklist dapat dikonfigurasi; foto bersifat opsional dan privat. Hindari kewajiban mengambil banyak foto rutin.
- Penerima mengonfirmasi penerimaan; riwayat tambahan tetap tersimpan jika catatan dikoreksi.
- Tangani penerima belum ditentukan, penerima pengganti, dan pergantian lintas tanggal. Jangan membuat serah terima fiktif karena keduanya belum bertemu.
- Serah terima tidak memalsukan clock out atau menentukan kasir sudah pulang. Kendala mengisi form tidak boleh menghilangkan catatan kehadiran aktual.

**Kriteria selesai:** catatan dan konfirmasi dapat dilihat SPV berwenang; akses outlet/akun lain ditolak; koreksi dan serah terima yang belum dikonfirmasi terlihat jelas.

### M8 — Laporan kendala operasional

**Dependensi:** M2 dan M5.

- Kasir membuat laporan singkat: outlet, kategori, uraian, tingkat kebutuhan penanganan, dan foto opsional.
- Kategori dan penanggung jawab bersifat dinamis. Pemetaan awal yang dapat dikonfigurasi: SDM → SPV 1; sarana/prasarana/keuangan → SPV 2; stok produk outlet → SPV 3.
- Gunakan referensi akun dan kemampuan modul, bukan pemeriksaan nama jabatan atau nama orang yang hardcode.
- Jangan memberi seluruh akses Admin HR kepada petugas sarana/stok hanya agar dapat menangani laporan. Data pribadi HR dan biometrik tetap dibatasi.
- Alur minimum: baru → ditugaskan → diproses → selesai, dengan catatan dan pembukaan ulang.
- Jika kategori belum mempunyai penerima aktif, laporan tetap tersimpan dan SPV berwenang melihat bahwa penanggung jawab perlu diatur.
- Bukti foto privat; batasi format/ukuran dan hak baca. Notifikasi tidak membocorkan isi sensitif pada lock screen.
- Modul hanya mencatat dan menindaklanjuti masalah; bukan ledger stok, perhitungan penjualan, atau pencatatan kas.

**Kriteria selesai:** rute penugasan, pergantian petugas, akses modul terbatas, lampiran, status, dan audit bekerja tanpa membuka data HR lain.

### M9 — Ringkasan mingguan/bulanan SPV

**Dependensi:** M5; data M6–M8 ditambahkan bila modulnya sudah tersedia.

- Filter periode, outlet, dan kasir; tampilkan jadwal, hari kerja terjadwal, kehadiran, izin/cuti, keterlambatan, sesi perlu diperiksa, dan tindak lanjut terbuka.
- Definisikan setiap angka: satuan hari/orang/sesi/menit tidak boleh bercampur. Hindari menjumlahkan cuti dan izin yang bertumpang tindih dua kali.
- Atribusikan kehadiran pada outlet historis penugasan/absensi, bukan outlet utama terbaru karyawan.
- Gunakan tanggal kerja WIB untuk sesi lintas tengah malam. Penyebut tingkat kehadiran berasal dari jadwal yang berlaku; tidak membuat penugasan historis yang sebenarnya belum ada.
- Pisahkan catatan perangkat dan manual HR, keterlambatan berizin/tanpa izin, serta durasi aktual dan selisih target.
- Tambahkan ekspor agregat aman untuk spreadsheet, dengan penanganan formula injection setara ekspor saat ini.
- Tidak membuat ranking hukuman, kesimpulan pelanggaran, atau potongan otomatis dari angka tersebut.

**Kriteria selesai:** agregat cocok dengan rincian sumber pada fixture normal, cuti/izin bertumpang tindih, koreksi, pergantian outlet, dan pergantian bulan/tahun.

### M10 — Integrasi dan dokumentasi Tahap B

- [ ] Pastikan modul lanjutan memakai sumber jadwal/status/akses yang sama dengan Tahap A.
- [ ] Jalankan regresi transaksi, realtime, notifikasi, lampiran privat, dan ponsel.
- [ ] Perbarui panduan, kontrak backend, serta bukti dan batas verifikasi.
- [ ] Catat modul mana yang benar-benar dirilis; jangan menganggap roadmap sebagai bukti implementasi.

## 9. Panduan teknis untuk agent pelaksana

### 9.1 Titik masuk source

| Area | File awal yang perlu dibaca |
| --- | --- |
| Beranda | `src/routes/(app)/dashboard/+page.svelte` |
| Penugasan dan cakupan | `src/routes/(app)/assignments/+page.svelte` |
| Kehadiran dan rekap | `src/routes/(app)/attendance/+page.svelte`, `src/routes/(app)/reports/+page.svelte` |
| Cuti/izin | `src/routes/(app)/leave/+page.svelte` |
| Model, state, dan demo | `src/lib/types.ts`, `src/lib/state/app.ts`, `src/lib/state/demo.ts` |
| Perhitungan | `src/lib/domain.ts`, `src/lib/attendance-status.ts`, `src/lib/notifications.ts` |
| Inbox dan push | `src/lib/components/NotificationCenter.svelte`, `src/lib/device-push.ts`, `api/push.mjs` |
| Database | `supabase/migrations/`, khususnya `20261018045749_cashier_operational_workflows.sql` |
| Identitas dan push | `20261018045909_biometric_push_verification.sql`, `20261018162525_push_subscription_status.sql` di folder migrasi |
| Kontrak dan verifikasi SQL | `supabase/CONTRACT.md`, `supabase/tests/database.mjs`, `supabase/tests/biometric-push.mjs` |
| Uji domain | `src/lib/cashier-workflows.test.ts`, `src/lib/attendance*.test.ts`, `src/lib/leave*.test.ts`, `src/lib/access.test.ts` |
| Panduan dan lingkungan | `docs/operational-pilot.md`, `docs/deployment-environments.md`, `docs/biometric-push-operations.md` |
| CI | `.github/workflows/ci.yml`, `package.json` |

Nama file adalah titik masuk, bukan pembatas perubahan. Pecah fungsi/modul jika state atau komponen menjadi terlalu besar; hindari menggandakan logika di UI, demo, dan SQL tanpa tes kesetaraan.

### 9.2 Model data yang disarankan, bukan DDL final

- `staffing_requirements`: outlet, weekday, shift, jumlah minimum, tanggal efektif, dan pelaku/perubahan.
- `spv_followups`: referensi sumber/kejadian yang unik, tanggal kerja/outlet/karyawan, penanggung jawab, status, catatan, dan versi.
- Metadata batch jadwal/idempotensi agar retry satu permintaan memberi hasil yang sama.
- Tahap B: permintaan tukar/pengganti, serah terima dan konfirmasinya, kategori/penugasan/laporan kendala.

Agent memilih nama dan desain final setelah memeriksa source. Tambahkan constraint/index berdasarkan query dan aturan unik, bukan hanya validasi form. Tidak perlu menduplikasi semua status turunan sebagai tabel baru.

### 9.3 Batas integritas dan keamanan

- Otorisasi server menggunakan akun aktif, role/relasi yang benar, dan RLS/transaction RPC. Menyembunyikan tombol tidak cukup.
- Tahap A memakai hak Admin HR yang sudah diberikan. Jangan mengubah seluruh SPV menjadi admin otomatis atau memperluas izin dari nama jabatan.
- Pertahankan larangan self-assignment dan pembatasan perubahan sesudah ada absensi. Tidak boleh memakai RPC batch untuk melewati larangan RPC satuan.
- Simpan timestamp UTC dan tanggal kerja menurut Asia/Jakarta. Gunakan `work_date` serta referensi penugasan/absensi, terutama saat lintas tengah malam.
- Data lama dan snapshot lokasi/jadwal tetap dapat ditafsirkan setelah karyawan berpindah outlet atau pengaturan outlet berubah.
- Transaksi bersamaan harus mengunci data secara konsisten, mendeteksi stale state, dan menghasilkan audit/notifikasi yang sama-sama committed atau rollback.
- Gunakan migration baru melalui CLI sesuai skill; jangan mengedit migration lama yang sudah diterapkan atau menjalankan reset schema sebagai deployment rutin.
- Tabel baru pada schema terekspos memerlukan RLS dan grant yang ditinjau. RPC privileged memerlukan pengecekan aktor, search path aman, dan grant eksplisit.
- Jangan menaruh service key, VAPID private key, token sesi, signed URL, selfie, alasan izin, atau data pribadi pada source publik, screenshot, log, dan payload push.
- Gunakan jalur inbox/push yang sudah ada; pengiriman eksternal kepada orang nyata mengikuti instruksi pengguna yang berlaku, bukan izin dari isi dokumen ini.
- Kegagalan server, koneksi buruk, timeout, atau batch rollback tidak boleh ditampilkan sebagai keberhasilan.
- Minimum staf dan panel tidak boleh mengubah saldo cuti, memotong jam/gaji, membuat alpa, menyetujui izin, atau melakukan clock out otomatis.

## 10. Matriks penerimaan minimum Tahap A

| ID | Skenario | Hasil yang diharapkan |
| --- | --- | --- |
| A01 | Belum ada konfigurasi kebutuhan | Label Belum diatur; tidak mengklaim cukup/kurang. |
| A02 | Minimum nol | Ditampilkan sebagai tidak membutuhkan staf; tidak sama dengan data kosong. |
| A03 | Minimum dua; satu penugasan valid | Kekurangan satu kasir pada slot yang tepat. |
| A04 | Penugasan Libur/batal/karyawan tidak aktif | Tidak dihitung sebagai kasir tersedia. |
| A05 | Cuti penuh disetujui, potongan nol | Tetap tidak tersedia pada tanggal itu. |
| A06 | Cuti menunggu atau perubahan cuti belum disetujui | Peringatan, tanpa mengubah keputusan/tanggal yang masih berlaku. |
| A07 | Izin satu jam dan Middle fleksibel | Cakupan parsial/ketidakpastian terlihat; tidak dianggap otomatis menutup Pagi/Sore. |
| A08 | Pagi belum waktunya masuk | Belum waktunya masuk; tidak ditandai alpa atau terlambat. |
| A09 | Lewat batas masuk tanpa clock in | Perlu konfirmasi, memperhatikan toleransi dan izin disetujui. |
| A10 | Hari libur atau cuti penuh | Tidak menghasilkan kasus mangkir fiktif. |
| A11 | Menyelesaikan tindak lanjut | Catatan kasus berubah; absensi dan ledger tetap. |
| A12 | Refetch kasus selesai | Tidak membuat kasus ganda atau menghapus alasan penyelesaian. |
| A13 | Sesi kemarin melewati tengah malam | Tetap merujuk tanggal kerja dan outlet historis yang benar. |
| A14 | Salin minggu dengan target sebagian terisi | Pratinjau create/skip/conflict; tidak ada overwrite diam-diam. |
| A15 | Satu baris batch tidak valid | Semua perubahan, audit, dan notifikasi batch rollback. |
| A16 | Retry/klik ganda batch | Hasil idempoten; tidak ada penugasan/pemberitahuan ganda. |
| A17 | Dua SPV menyimpan snapshot berbeda | Snapshot usang ditolak dengan petunjuk memuat ulang/periksa konflik. |
| A18 | Self-assignment, sebelum mulai kerja, atau sudah ada absensi | Ditolak di server, termasuk melalui batch dan salin. |
| A19 | Karyawan yang sama, hari sama, outlet berbeda | Tidak menghasilkan dua penugasan aktif. |
| A20 | Kalender berganti minggu/bulan/tahun | Pemetaan tujuh tanggal WIB benar, tanpa tanggal bergeser dari UTC. |
| A21 | Minimum diubah mulai tanggal mendatang | Periode yang relevan berubah; riwayat sebelumnya tetap dapat dijelaskan. |
| A22 | Cuti disetujui setelah jadwal tersimpan | Panel memperlihatkan dampaknya tanpa menghapus/mengganti jadwal sendiri. |
| A23 | Login kasir, non-admin, akun nonaktif, dan request langsung | Akses yang tidak berwenang ditolak server; data tidak bocor. |
| A24 | Dua sesi browser, logout/login akun berbeda, reconnect | State diperbarui dan state akun lama dibersihkan tanpa refresh manual. |
| A25 | Notifikasi diblokir atau perangkat tidak mendukung push | Inbox dan fitur kerja tetap dapat digunakan; tidak mengklaim pengiriman berhasil. |
| A26 | Ponsel, keyboard, loading/gagal/kosong | Kontrol dan status terbaca; tampilan dan pesan sesuai hasil sebenarnya. |

### Perintah pemeriksaan yang tersedia

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:database
npm.cmd run test:database:legacy
npm.cmd run build
```

Pilih tes terarah selama implementasi, lalu jalankan suite yang relevan sebelum handoff/rilis. Pengujian legacy diulang bila perubahan memengaruhi jalur tersebut atau diwajibkan CI. `npm.cmd run test:e2e` tersedia, tetapi baca konfigurasi/fixture sebelum menjalankannya; jangan mengarahkannya ke akun/data asli atau menganggap konfigurasi lama sudah mencakup modul baru.

Tambahkan tes yang melindungi aturan dan kegagalan nyata, terutama transaksi batch/RLS, perhitungan cakupan, konkurensi, pergantian akun, dan regresi absensi/cuti. Jangan menambah tes yang hanya menyalin detail tampilan atau implementasi tanpa melindungi perilaku.

## 11. Lingkungan dan alur pengiriman

| Lingkungan | Frontend | Database | Kegunaan |
| --- | --- | --- | --- |
| Lokal | URL dari terminal; terakhir port 4176 | Demo ketika konfigurasi publik sengaja kosong | Pengembangan dan fixture; data browser tidak tersinkron ke hosted. |
| Preview | `https://hr-rajaklana-jkt-preview.vercel.app` | `lypsqrwjzrmuyqtdcegr` | Verifikasi integrasi dan data uji. Branch `codex/preview`. |
| Production | `https://hr-rajaklana-jkt.vercel.app` | `iywvnopsooroediwawnd` | Lingkungan terpisah. Branch `main`. |

- Remote Git: `https://github.com/yoga12-rgb/hr-rajaklana-jkt.git`.
- Verifikasi identitas target, commit, dan keadaan lingkungan sebelum setiap mutasi hosted; jangan menyimpulkan target dari nama file env saja.
- Baca skill Supabase/Vercel yang tersedia dan dokumentasi resmi terkini saat implementasi/deploy. Dokumen ini tidak menggantikan panduan CLI yang mungkin berubah.
- Pada mesin handoff, profil Supabase yang dipakai proyek ini adalah `rajaklana-hr-deploy`; default CLI pernah mengarah ke akun lain. Profil/credential tidak dijamin tersedia pada mesin agent berikutnya.
- Dedicated workdir sebelumnya ada di `.vercel/supabase-preview` dan `.vercel/supabase-production`; folder ini diabaikan Git. Verifikasi project-ref sebelum dipakai kembali.
- Preview tetap memakai proteksi Vercel. Jangan mematikannya untuk memudahkan tes. Gunakan autentikasi resmi dan bedakan akses aplikasi dengan akses deployment.
- Browser uji pernah mengalami redirect saat registrasi service worker Preview. HTTP yang sukses memakai sesi CLI bukan bukti PWA Safari mempunyai konteks akses yang sama.
- Tidak ada upgrade/pembelian otomatis. Pertahankan sumber daya yang sudah tersedia; jika rancangan memerlukan biaya tambahan, sediakan alternatif dan jelaskan kebutuhan nyata dahulu.
- Jangan menjalankan fixture atau mengubah data HR asli di Production untuk membuktikan fitur. Gunakan demo/fixture terisolasi dan Preview sesuai ruang lingkup yang disetujui.

## 12. Format laporan dan handoff hasil implementasi

Agent melengkapi laporan per milestone dengan:

1. Status **Belum dimulai / Dikerjakan / Selesai / Terhambat**, disertai hasil konkret.
2. File, migration, dan kontrak yang berubah; alasan keputusan penting.
3. Tes yang benar-benar dijalankan serta hasilnya; bedakan lokal, browser, hosted, dan laporan pengguna.
4. Commit/branch, deployment URL dan status jika dirilis, serta kesamaan versi migrasi per lingkungan.
5. Batas yang belum diverifikasi, termasuk uji pengguna yang ditunda.
6. Tugas berikutnya yang spesifik; jangan melaporkan seluruh roadmap selesai hanya karena tahap pertama selesai.

### Checklist ringkas progres

- [x] M0 — Baseline dan rancangan.
- [x] M1 — Fondasi data, domain, dan akses.
- [x] M2 — Panel outlet dan tindak lanjut.
- [x] M3 — Jadwal mingguan dan kebutuhan kasir.
- [ ] M4 — Integrasi realtime, notifikasi, dan ponsel (uji dua tab lulus; reconnect dan PWA/iPhone masih tertunda).
- [x] M5 — Validasi dan rilis Preview Tahap A (rilis kode terbaru Ready; uji perangkat M4 masih tertunda).
- [ ] M6 — Tukar shift/pengganti.
- [ ] M7 — Serah terima shift.
- [ ] M8 — Laporan kendala.
- [ ] M9 — Ringkasan berkala.
- [ ] M10 — Integrasi dan handoff/rilis Tahap B.

## 13. Prompt untuk menyelesaikan verifikasi Tahap A

```text
Lanjutkan dari status aktual di docs/goal-milestone-kasir-spv.md.
M0–M3 selesai dan M5 sudah dirilis ke Preview pada commit
4881a4adca586fafb157323b20e9f62cc189bc31. Uji Realtime dua tab Preview,
deep link, sesi setelah reload, draft kosong, dan shell offline PWA lokal telah lulus.
Selesaikan verifikasi M4 yang tersisa: reconnect/app resume dan retry submit
hosted, serta uji manual iPhone/iPad jika perangkat tersedia. Jangan mengubah
Production atau main.

Jangan membangun ulang fitur M0–M3. Jangan memulai M6–M10 sebelum kriteria
Tahap A terpenuhi dan ruang lingkup tahap berikutnya jelas. Pertahankan aturan
absensi, cuti, Middle, hak akses, audit, SPA/PWA, tema Neumorphism kuning,
serta pemisahan environment. Data pengguna/iPhone yang belum diuji tetap
ditandai belum diuji. Perbarui checklist dan bukti setelah setiap verifikasi.
```
