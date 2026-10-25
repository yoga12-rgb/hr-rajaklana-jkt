# Guide, goal, dan milestone peningkatan supervisor

Tanggal: **23 Oktober 2026** · Status: **rencana handoff; implementasi milestone baru belum dimulai**.

Dokumen ini disiapkan atas permintaan pengguna untuk dikerjakan oleh model/agent lain. Permintaan penyusunan dokumen ini tidak menjalankan fitur, migration, atau deployment baru.

## 1. Cara menggunakan dokumen

Ketika pengguna meminta dokumen ini dieksekusi, kerjakan SPV-00 sampai SPV-11 secara bertahap sesuai dependensi. Selesaikan pemeriksaan mandiri, catat bukti, kemudian lanjutkan milestone berikutnya. Jangan berhenti hanya pada rencana atau UI contoh. Jangan mengerjakan seluruh modul besar dalam satu perubahan yang sulit ditinjau.

Dokumen ini adalah acuan **urutan pengembangan supervisor terbaru**. Ia memperbarui urutan roadmap pada [goal-milestone-kasir-spv.md](goal-milestone-kasir-spv.md), tetapi tetap mempertahankan aturan bisnis dan perbaikan audit yang sudah berlaku. Source aktual menentukan apa yang sudah tersedia. Laporan audit/rilis menentukan batas bukti, bukan daftar fitur baru yang perlu dibuat ulang.

Pengguna telah menunda uji offline/perangkat. Kerjakan pengembangan lokal dan verifikasi otomatis yang tidak bergantung pada pengguna. PVR-02 dan uji perangkat tetap terbuka; kondisi itu tidak menghalangi seluruh pengembangan baru atau Preview untuk pengujian terbatas. Jangan mengubah statusnya menjadi lulus atau menyatakan siap operasional penuh tanpa bukti.

Aturan kerja:

- Mulai dengan Git status/HEAD, instruksi repository, dan keberadaan `.codegraph/`. Jika ada index, gunakan CodeGraph sebelum pencarian source; jika tidak ada, jangan membuat index sendiri.
- Jangan menimpa perubahan pengguna/model lain. Tetapkan pemilik file jika mendelegasikan pekerjaan paralel; migration dan kontrak RPC harus dikoordinasikan.
- Gunakan keputusan default di dokumen ini untuk pilihan implementasi rutin. Klarifikasi hanya jika ada aturan lapangan yang benar-benar belum dapat ditentukan atau perubahan cakupan yang material.
- Pelajari skill Supabase/Vercel yang tersedia dan dokumentasi resminya saat mengimplementasikan layanan tersebut. Jangan menyalin perintah CLI yang belum diverifikasi dengan versi aktual.
- Jangan meminta kata sandi, access token, service-role key, kode bootstrap, cookie, atau secrets melalui chat.
- Laporkan implementasi lokal, deployment Preview, alur hosted, dan perangkat nyata secara terpisah. Tes skipped, HTTP 200, CI hijau, dan deployment Ready bukan bukti seluruh alur lulus.

## 2. Goal produk dan ukuran selesai

> Supervisor dapat menemukan masalah operasional kasir, menentukan tindakan serta penanggung jawab, dan memantau penyelesaian lintas outlet tanpa kehilangan konteks jadwal, kehadiran, dan riwayat keputusan.

| Goal | Hasil yang harus bisa ditunjukkan |
| --- | --- |
| G1 — cepat mengetahui prioritas | Masalah mendesak tampil di bagian awal Beranda; sumber dan tindakan terkait dapat dibuka maksimal dua navigasi dari kartu masalah. |
| G2 — kasus tidak terlewat | Semua tindak lanjut tersimpan yang belum selesai dapat ditemukan lintas tanggal, termasuk kasus kemarin; tersedia Tugas saya, belum memiliki PIC, dan lewat tenggat. |
| G3 — pekerjaan terbagi dengan jelas | PIC, tenggat, catatan, pergantian penanggung jawab dan hasil penyelesaian mempunyai riwayat; pembaruan dua petugas tidak menimpa diam-diam. |
| G4 — bermanfaat bagi tiga fungsi SPV | Laporan SDM, sarana/peralatan, dan stok produk dapat diarahkan ke petugas sesuai konfigurasi dan hak akses. |
| G5 — pergantian kasir lebih tertib | Serah terima dapat dikonfirmasi penerima; usulan tukar/pengganti baru mengubah jadwal setelah keputusan resmi yang sah. |
| G6 — cakupan waktu dapat dijelaskan | SPV dapat melihat interval yang kurang personel, lengkap, atau belum dapat dinilai, tanpa mengarang jam Middle atau mengurangi izin dua kali. |
| G7 — rekap siap digunakan | Ringkasan mingguan/bulanan cocok dengan rincian sumber dan ekspor, dengan definisi orang/hari/sesi/menit yang jelas. |
| G8 — alur tahan gangguan yang diuji | Realtime, edit bersamaan, persist/reload/retry, pergantian akun, dan rollback telah diuji pada lapisan yang sesuai. |

Ukuran navigasi di atas adalah target desain, bukan klaim penghematan waktu yang sudah diukur. Catat hasil skenario tugas nyata; jangan mengarang persentase peningkatan produktivitas.

## 3. Baseline yang harus dibaca

Baseline lokal saat dokumen dibuat:

- Branch `codex/preview`; HEAD `2eb741b678c0fb36b998873f8b879fdb99eaf8f8`.
- Source perbaikan terakhir `359d5f91dc8f5cd73e6f9fb9e9b0e5f57ad9ca4f`; HEAD berikutnya berisi dokumentasi bukti.
- Supabase Preview terakhir terverifikasi mempunyai **18 migration**, terakhir `20261022170000_close_readiness_audit_findings.sql`.
- Bukti historis: check 0 error/0 warning, **418 unit**, **11 live-mock**, **22 browser/PWA lokal**, database/upgrade dan guard legacy lulus. Angka tersebut bukan hasil pengujian milestone baru.
- PVR-01: kehilangan path/query saat validasi sesi setelah reload sudah diperbaiki dan diverifikasi hosted.
- PVR-02: service worker ditolak karena redirect pada browser uji IAB masih terbuka. Pengguna kemudian mengonfirmasi aplikasi terbuka pada browser biasa, tetapi belum dapat melakukan uji offline. Ini belum membuktikan worker aktif, controller, offline, atau update PWA.
- Hosted yang sudah diuji: simpan/reload data karyawan, roster dua tab pada **akun Admin HR yang sama**, simpan/pembatalan jadwal sintetis dengan audit dipertahankan. Dua akun SPV berbeda, reset password, dan perangkat iPhone/PWA belum dibuktikan lengkap.

Rujukan utama:

- [Audit kesiapan 22 Oktober](audit-kesiapan-aplikasi-2026-10-22.md).
- [Bukti rilis Preview 23 Oktober](rilis-preview-kesiapan-2026-10-23.md).
- [Roadmap awal kasir/SPV](goal-milestone-kasir-spv.md) untuk aturan bisnis yang masih berlaku.
- [Lingkungan deployment](deployment-environments.md).

Verifikasi kembali baseline saat mulai bekerja. Perbedaan HEAD atau migration tidak otomatis kesalahan; inventarisasi perubahan dan sesuaikan rencana upgrade dengan keadaan aktual.

## 4. Fitur yang sudah ada dan ruang peningkatannya

| Sudah tersedia | Peningkatan dalam dokumen ini |
| --- | --- |
| Panel minimum/terjadwal/tersedia/tercatat hadir, status kasir, Perlu perhatian | Susunan berdasarkan urgensi, akses tindakan, dan daftar kasus lintas tanggal. |
| PIC, catatan, Diproses/Selesai/Buka lagi, riwayat kasus | Tenggat, filter petugas, pengingat, dan optimistic concurrency eksplisit. |
| Jadwal harian/mingguan, salin minggu sebelumnya, Libur, outlet sementara | Permintaan tukar/pengganti; interval rencana kerja sebagai tambahan yang kompatibel. |
| Minimum per outlet/hari/shift dengan tanggal efektif | Kebutuhan per interval waktu yang ditinjau secara eksplisit. |
| Cuti/izin, perubahan/pembatalan, koreksi absensi | Dipakai sebagai sumber keputusan/cakupan; tidak dibuat ulang. |
| Rekap rinci, filter dan CSV, audit | Ringkasan periodik dengan rincian pembentuk angka. |
| Inbox, push opt-in, outbox/worker, Realtime | Pemberitahuan tugas yang relevan, deduplikasi, dan pemulihan state modul baru. |
| Role `employee`, `admin_hr`, `head_baker` | Kemampuan modul operasional dan cakupan outlet/kategori; nama SPV 1/2/3 bukan role teknis yang sudah ada. |

Fitur baru: laporan kendala outlet, serah terima, dan permintaan tukar/pengganti. Belum ada modul POS, ledger stok, pembukuan kas, payroll, atau pengadaan dalam cakupan ini.

## 5. Batas bisnis, akses, dan data

1. Fokus Jabodetabek; outlet, kategori, petugas dan checklist dikelola dinamis. Tidak hardcode nama outlet, nama orang, atau nomor SPV sebagai pemeriksaan izin.
2. SPV Penjualan/SDM mengoordinasikan kasir. Sarana/perlengkapan/keuangan dan stok produk mempunyai penanggung jawab sesuai konfigurasi. Hak aplikasi dipisahkan dari nama jabatan.
3. Jam kerja tetap 8 jam termasuk istirahat; tanggal kerja menggunakan WIB. Pagi/Sore mengikuti konfigurasi yang berlaku; Middle tetap fleksibel. Penambahan jam rencana Middle tidak otomatis mengubah aturan keterlambatan.
4. Libur tetap, cuti penuh, izin sebagian jam, status karyawan, tanggal bergabung, dan outlet sementara tetap dihormati. Penugasan `off` adalah nilai sah di seluruh konsumen kasus/jadwal.
5. Keputusan cuti yang sudah berlaku tetap menjadi sumber selama usulan perubahan/pembatalan masih menunggu. Besar potongan saldo tidak menentukan apakah orang tersedia bekerja.
6. Belum clock in diberi status perlu konfirmasi, bukan otomatis alpa. Kekurangan staf tidak otomatis menolak cuti, memotong gaji, atau menjatuhkan tindakan disiplin.
7. Tindak lanjut dan laporan kendala tidak mengubah absensi/cuti secara diam-diam. Koreksi sumber tetap memakai alur berwenang yang sudah ada.
8. Pertahankan audit, ID kasus, hubungan sumber, dan riwayat buka kembali. Sinyal yang hilang tidak otomatis menyelesaikan tindak lanjut tersimpan.
9. Kasus HR yang terbuka mengikuti perubahan konteks sumber menurut kontrak saat ini; kasus selesai mempertahankan snapshot historis hingga pembukaan ulang yang sah. Hak baca tidak boleh meluas karena perpindahan konteks.
10. Tidak ada perubahan ke Production atau `main`; tidak ada reset database, penghapusan audit/data operasional, auto-upgrade berbayar, pesan WhatsApp otomatis, atau penambahan cabang lain.

## 6. Kontrak teknis lintas milestone

### 6.1 Transaksi, konflik, dan recovery

- Transaksi jadwal baru tetap membawa baseline ID/revisi dan divalidasi server. Replay membawa **key dan payload asli** sampai server; perubahan state saat ini tidak boleh diam-diam mengganti payload replay.
- Respons hilang/time-out bukan bukti transaksi gagal. Pertahankan pending sampai hasil pasti atau rekonsiliasi lengkap. Hanya penolakan yang pasti non-commit boleh membuka transaksi baru.
- Draft dan pending terisolasi per akun dan konteks/minggu. Perubahan storage dari tab lain tidak boleh diakui sebagai versi yang sudah diterapkan sebelum benar-benar diterapkan. Pertahankan perlindungan snapshot yang sudah ada; jangan mengklaim localStorage menyediakan CAS lintas renderer.
- Konflik harus terlihat ketika sumber berubah, tanpa menunggu pengguna mengedit field lain. Review satu baris tidak merebase baris lain secara massal.
- RPC pembaruan tindak lanjut saat baseline belum menerima expected version. SPV-02 harus menambahkan kontrak revisi server yang eksplisit, pemeriksaan stale write, dan UI review. Jangan menganggap pembersihan draft yang sudah ada menyelesaikan semua lost update.
- Gunakan row lock dan revisi monoton/kontrak setara yang teruji. Mutasi sumber yang mengubah konteks kasus harus ikut memperbarui revisi yang relevan. Transaksi gagal tidak meninggalkan audit atau outbox sebagian.
- Untuk mutasi baru yang dapat diulang, simpan hasil/idempotency receipt secara atomik. Key sama/body berbeda ditolak; replay sah setelah commit mengembalikan hasil awal tanpa menggandakan perubahan. Otorisasi tetap diperiksa.
- Draft lokal tetap ada ketika konflik ditampilkan. Keputusan memakai data terbaru atau mengajukan perubahan lagi harus eksplisit; edit baru selama request tidak ikut dihapus oleh callback lama.

### 6.2 Otorisasi dan isolasi akun

- Server/RPC/RLS adalah otoritas. Menyembunyikan tombol tidak cukup. Kasir hanya mengakses data sendiri dan konteks operasional yang secara eksplisit diizinkan.
- Tabel terekspos baru wajib RLS dan grants minimum. Fungsi privileged memeriksa aktor aktif, hak modul/cakupan, mempunyai search_path aman, dan EXECUTE terbatas. Jangan melemahkan RPC yang sudah ada untuk menghilangkan warning advisor.
- Jangan memakai metadata yang dapat diedit pengguna untuk otorisasi atau memasukkan service-role key ke frontend.
- Pergantian akun/logout segera membersihkan data, kanal, timer, cache memori dan callback akun sebelumnya. Semua respons tertunda menggunakan revision/generation akun. Draft lama tetap terikat akun lama.
- Petugas sarana/stok yang hanya mendapat akses modul kendala tidak boleh memperoleh daftar HR lengkap, alasan cuti, dokumen pribadi, selfie, biometrik, atau hak mengubah karyawan.
- Sediakan fetch/RPC dan tipe data minimum untuk modul operasional. Jangan memberikan seluruh bootstrap HR kepada role baru demi menampilkan nama PIC.
- Perubahan hak akses, penanggung jawab, dan cakupan outlet diaudit. Penanggung jawab nonaktif/dicabut aksesnya ditandai perlu pengganti; pekerjaan dan riwayatnya tidak hilang.

### 6.3 Realtime, notifikasi, dan waktu

- Realtime menyelaraskan sumber resmi dan tidak menimpa draft yang sedang diedit. Refetch saat reconnect/resume tetap memakai pemeriksaan akun dan konteks.
- Pengingat tenggat menggunakan server/outbox yang sudah ada atau perluasan setara; jangan mengandalkan timer tab sebagai satu-satunya mekanisme.
- Jam server menentukan overdue dan pengiriman; simpan timestamp yang tidak ambigu, tampilkan WIB. Umur kasus tersimpan dihitung dari createdAt, bukan waktu pertama kali seseorang membuka dashboard.
- Notifikasi in-app dan push ditujukan hanya ke penerima berwenang. Push tetap umum; rincian berada di aplikasi. Jangan mengirim pesan nyata kepada orang lain hanya untuk pengujian tanpa otorisasi yang sesuai.
- Gunakan dedupe menurut kejadian/revisi/penerima. Satu kali melewati tenggat tidak menghasilkan pesan baru setiap menit. Perubahan PIC/tenggat atau penyelesaian harus membatalkan pengiriman usang yang masih tertunda.
- Jika scheduler/push tertunda, daftar tugas dan label lewat tenggat tetap berfungsi. Jangan menyatakan push diterima hanya karena outbox berhasil dikirim.

## 7. Peta milestone dan urutan eksekusi

| Tahap | ID | Hasil utama | Dependensi |
| --- | --- | --- | --- |
| A — pekerjaan harian SPV | SPV-00 | Baseline, matriks akses, rancangan dan reproduksi batas saat ini | — |
| A | SPV-01 | Beranda yang menonjolkan tindakan | SPV-00 |
| A | SPV-02 | Kasus lintas tanggal, tugas saya, tenggat, konflik dua SPV | SPV-00; integrasi SPV-01 |
| A | SPV-03 | Pengingat terarah dan checkpoint verifikasi Tahap A | SPV-02 |
| B — koordinasi operasional | SPV-04 | Hak modul dan konfigurasi penerima laporan | SPV-03 |
| B | SPV-05 | Laporan kendala outlet | SPV-04 |
| B | SPV-06 | Serah terima shift | SPV-05, jadwal existing |
| B | SPV-07 | Permintaan tukar shift/pengganti | SPV-04, jadwal existing |
| C — perencanaan dan rekap | SPV-08 | Cakupan kasir berdasarkan interval | SPV-07 |
| C | SPV-09 | Ringkasan mingguan/bulanan | SPV-02, SPV-05–08 |
| D — bukti rilis | SPV-10 | Regresi integrasi dan upgrade penuh | Semua milestone implementasi |
| D | SPV-11 | Preview, hosted, dokumentasi pengguna dan handoff perangkat | SPV-10 |

Urutan utama mengikuti tabel. Pekerjaan read-only, rancangan atau unit domain yang independen boleh diparalelkan. Berikan checkpoint Preview untuk satu tahap yang utuh bila berguna; setiap checkpoint wajib menjalani gate yang sama untuk bagian yang berubah. Jangan menunggu semua modul besar selesai sebelum meninjau risiko regresi.

### SPV-00 — baseline dan rancangan

**Goal:** model pelaksana memahami source dan batas bukti sebelum mengubah perilaku.

- Inventarisasi branch/HEAD/perubahan lokal, migration, suite, serta kontrak akses dan state.
- Konfirmasi panel tanggal sekarang memang menyaring kasus tersimpan pada workDate terpilih; jangan mengasumsikan seluruh histori sudah dimuat dan aman ditampilkan.
- Catat model data yang akan diperluas: revisi/tenggat kasus, akses modul, kategori/routing, laporan, serah terima, usulan tukar, interval rencana/kebutuhan, agregat.
- Buat matriks aktor × aksi × cakupan, desain kompatibilitas frontend/database saat deployment bertahap, dan daftar migration forward-only yang diperlukan.
- Reproduksi celah yang akan ditutup: kasus kemarin tak tampak pada tanggal hari ini, stale update dua SPV, serta jam Middle yang belum tersedia. Bedakan keterbatasan produk dari bug yang benar-benar direproduksi.

**Selesai bila:** baseline, peta perubahan, dependensi dan acceptance cases tercatat; pekerjaan baru tidak menghapus perbaikan audit.

### SPV-01 — Beranda yang menonjolkan tindakan

**Goal:** SPV membuka Beranda dan langsung menemukan tindakan berikutnya.

- Dahulukan ringkasan tindakan di atas dekorasi/sambutan. Gunakan data dan fungsi domain existing sebagai sumber, bukan hitungan paralel yang berbeda.
- Tampilkan kategori yang relevan: perlu konfirmasi kehadiran, kekurangan kasir, konflik jadwal/cuti, koreksi/pengajuan menunggu, dan tindak lanjut.
- Bedakan masalah hari terpilih, kasus tersimpan lintas tanggal, serta pengajuan persetujuan. Satu kejadian yang muncul dalam beberapa indikator tidak boleh disajikan sebagai beberapa orang unik tanpa penjelasan.
- Urutan default: kasus tersimpan lewat tenggat, sinyal mendesak, kemudian waktu tertua; tie-break stabil. Beri alasan prioritas, bukan warna saja.
- Tautan membawa ID kasus/sumber serta tanggal/outlet/minggu yang tepat. Navigasi kembali dan reload mempertahankan konteks. Pengguna tanpa hak tidak memperoleh rincian melalui deep link.
- Tampilan ponsel menampilkan ringkasan singkat, label jelas dan tombol sentuh yang layak. Jadwal terencana dan kehadiran aktual tetap dibedakan.

**Selesai bila:** fixture dengan beberapa outlet memperlihatkan prioritas yang benar, tautan menuju konteks yang tepat, dan kondisi kosong/loading/data usang tidak mengklaim semuanya aman.

### SPV-02 — semua kasus terbuka, tugas saya, dan tenggat

**Goal:** masalah yang belum selesai tetap dapat ditangani lintas hari dengan pembaruan yang aman.

- Sediakan view **Semua belum selesai**, **Tugas saya**, **Belum ada PIC**, **Lewat tenggat**, dan **Riwayat**. Filter outlet/status/tanggal tetap tersedia. Default backlog tidak dibatasi hanya hari ini.
- Ambil kasus tersimpan lintas tanggal melalui query terotorisasi dengan pagination, urutan stabil dan total yang sesuai filter. Jangan memuat semua histori/PII tanpa batas ke app store.
- Sinyal yang belum menjadi kasus tetap hasil read-only untuk konteks hari yang dinilai. Jangan membuat ribuan kasus historis otomatis ketika dashboard dibuka. Bila backlog hanya mencakup kasus tersimpan, label UI harus menjelaskannya.
- Tambahkan dueAt opsional. Kasus lama tetap tanpa tenggat sampai petugas menetapkan; tidak ada backfill tenggat buatan. Perubahan tenggat/PIC memerlukan alasan singkat dan audit.
- Tambahkan expected revision ke pembaruan kasus, termasuk perubahan status, PIC, catatan dan tenggat. Saat konflik, tampilkan nilai server terbaru dan edit lokal; jangan auto-overwrite atau mereset draft.
- Pertahankan case key, source consistency, `off`, status selesai dan reopen. Catatan penyelesaian wajib ketika menyelesaikan; lewat tenggat hanya indikator, bukan status selesai otomatis.
- Tampilkan tanggal kerja, waktu dibuat dan tenggat agar kasus lintas tanggal tidak disalahartikan sebagai masalah hari ini.

**Selesai bila:** kasus kemarin terlihat hari ini, filter/page bekerja, kasus dengan sumber sudah teratasi tetap menunggu penyelesaian eksplisit, dan dua SPV yang menyimpan versi sama menghasilkan satu sukses serta satu konflik tanpa kehilangan catatan.

### SPV-03 — pengingat PIC dan checkpoint Tahap A

**Goal:** petugas mendapat pemberitahuan yang relevan tanpa pengiriman berulang.

- Notifikasi saat penugasan PIC, perubahan penting tugas, dan satu kali melewati tenggat; ikuti opt-in untuk push. Sebelum konfigurasi pengingat server siap, UI tidak boleh mengklaim pengingat otomatis aktif.
- Kasus tanpa PIC muncul pada antrian petugas HR berwenang. Eskalasi hanya menuju penerima aktif yang ditetapkan konfigurasi; jangan mengirim ke seluruh karyawan.
- Gunakan outbox/worker existing setelah memeriksa kompatibilitas dan batas paket aktual. Tidak perlu membuat layanan berbayar atau scheduler duplikat.
- Uji pergantian PIC, deadline diperpanjang, selesai sebelum dikirim, request berulang, worker ganda, penerima nonaktif, izin push ditolak, dan scheduler terlambat.
- Verifikasi integrasi SPV-01–03: kasus tanggal lampau → tetapkan PIC/tenggat → pembaruan sesi lain → simpan konflik → review → selesai. Perbarui panduan aplikasi untuk alur ini.

**Selesai bila:** event/notifikasi tidak ganda, akses/detail benar, mutasi+audit+outbox atomik, dan alur kasus lulus pada lokal serta live-mock. Catat hasil hosted dua identitas secara terpisah; pekerjaan mandiri tidak menunggu perangkat.

### SPV-04 — akses modul operasional dan penerima dinamis

**Goal:** SPV sarana/stok dapat menangani tugas sesuai fungsi tanpa otomatis memperoleh seluruh akses HR.

- Definisikan kemampuan minimum: membuat laporan, membaca laporan dalam cakupan, menangani/menetapkan petugas, mengelola kategori/routing, dan melihat ringkasan. Implementasi dapat memakai grants per modul/outlet/kategori; nama role/field final diputuskan setelah meninjau arsitektur.
- Admin HR tetap dapat mengelola konfigurasi dan alur HR. Hak head_baker yang sudah ada tidak berubah otomatis. Kasir melihat/mengikuti laporan yang berhak ia akses.
- Default hak baca: kasir hanya laporan kendala miliknya; petugas operasional memakai irisan kemampuan modul, outlet dan kategori yang diberikan admin. Akses outlet tidak otomatis membuka seluruh laporan personal di outlet tersebut. Penerima serah terima mendapat dokumen yang ditujukan kepadanya, bukan seluruh dokumen rekan satu outlet.
- Routing awal berupa kategori SDM, sarana/peralatan, dan stok produk. Petugas dihubungkan melalui ID akun aktif yang dipilih admin; nomor SPV hanya istilah operasional.
- Akses ke laporan bukan akses ke kasus HR, dokumen cuti atau biometrik. Jangan memperluas owners kasus HR existing kepada role operasional semata-mata agar satu dropdown dapat dipakai bersama.
- Validasi akses baca/tulis/lampiran/notifikasi di server. Uji role dicabut ketika tab masih terbuka dan ketika request masih berlangsung.

**Selesai bila:** petugas operasional terbatas dapat bekerja pada scope-nya dan ditolak pada HR/outlet/kategori lain; admin tidak perlu memberikan `admin_hr` hanya untuk menangani laporan.

### SPV-05 — laporan kendala outlet

**Goal:** kasir melaporkan masalah singkat dan SPV mengetahui siapa yang menanganinya.

- Form minimum: outlet/konteks penugasan, kategori aktif, uraian, urgensi, dan foto opsional. Outlet berasal dari penugasan/absensi yang sah, termasuk penempatan sementara; bukan hanya outlet utama terbaru.
- Untuk pelapor tanpa penugasan yang cocok, tampilkan jalur bantuan kepada petugas berwenang. Pembuatan atas nama orang lain hanya melalui kemampuan khusus dengan pelaku/pelapor dicatat terpisah.
- Panduan dan UI bantuan harus menjelaskan alur cepat Admin membuat laporan atas nama kasir ketika justru jadwalnya belum tercatat. Jangan mengharuskan kasir membuat jadwal fiktif atau membebaskan pilihan semua outlet untuk melewati batas akses.
- Alur: **Baru → Ditugaskan → Diproses → Selesai**, dengan catatan penyelesaian dan pembukaan ulang. PIC/tenggat mengikuti pola yang sudah diuji pada Tahap A.
- Jika kategori belum mempunyai penerima aktif, laporan tetap tersimpan sebagai belum ditugaskan dan terlihat pada antrian pengelola yang berwenang; jangan membuang laporan atau mengirim ke orang acak.
- Simpan kategori/routing yang digunakan saat laporan dibuat. Perubahan konfigurasi penerima berlaku bagi laporan berikutnya; laporan lama berpindah PIC hanya lewat penugasan ulang yang tercatat, tanpa mengubah riwayat penerima awal.
- Foto disimpan privat dengan batas tipe/ukuran yang diuji; URL sementara dan hak baca diperiksa. Tangani upload gagal, retry, dan file yang tidak berhasil direferensikan tanpa menghapus bukti laporan lain.
- Pisahkan kontrak laporan operasional dari kasus HR sensitif. Tautan antarmodul tidak boleh membocorkan rincian yang tidak berhak dilihat.
- Nomor/ID laporan stabil, klik ganda tidak membuat dua laporan, riwayat perubahan dan notifikasi tersimpan konsisten. Kategori dinonaktifkan tetap terbaca pada riwayat.

**Selesai bila:** laporan dari kasir outlet sementara sampai ke PIC yang benar, petugas menyelesaikan/reopen, reporter melihat hasil, dan pengujian silang akun/outlet/lampiran ditolak sesuai matriks.

### SPV-06 — serah terima shift

**Goal:** pekerjaan tertunda dan kondisi outlet diterima secara jelas oleh kasir berikutnya.

- Kaitkan dengan outlet, tanggal kerja, penugasan pengirim, penugasan penerima bila tersedia, dan versi catatan. Tangani pergantian lintas tengah malam.
- Isi minimum: pekerjaan tertunda, kondisi perlengkapan/outlet dan catatan penting. Checklist tambahan opsional; jika disediakan, item dapat dikelola admin. Foto opsional. Field minimum, versi dan konfirmasi cukup untuk rilis awal modul ini.
- Alur: **Draft → Dikirim → Diterima**; penerima dapat **Meminta perbaikan** dengan alasan. Bila penerima belum tersedia, catatan tetap menunggu penetapan yang sah dan terlihat oleh SPV.
- Penerima harus cocok dengan konteks outlet/penugasan dan tidak dapat mengonfirmasi serah terimanya sendiri. Jika terjadi pengganti kasir, perubahan penerima diaudit dan tidak mengklaim penerima lama telah menerima.
- Konfirmasi mengacu ke versi catatan tertentu. Perubahan setelah dikirim/diterima disimpan sebagai revisi/amendemen yang terlihat dan memerlukan konfirmasi baru bila isi serah terima berubah; konfirmasi lama tetap ada dalam riwayat.
- Form serah terima tidak mengubah clock in/out dan tidak menghalangi pencatatan waktu pulang aktual. Bedakan menerima catatan dengan membuktikan dua kasir bertemu fisik.

**Selesai bila:** pengirim/penerima/SPV melihat versi serta status sama, double submit/confirm tidak menggandakan riwayat, penerima diganti dan lintas tanggal tertangani, dan absensi tetap independen.

### SPV-07 — permintaan tukar shift atau pengganti

**Goal:** kasir mengusulkan pergantian dan SPV memutuskan perubahan jadwal yang konsisten.

- Bedakan **tukar dua arah** dan **pengganti satu arah**. Scope awal memakai penugasan mendatang yang belum mempunyai absensi; jangan mengubah catatan kerja yang sudah berjalan melalui alur tukar.
- Scope minimum: kedua pihak berada pada **tanggal kerja yang sama**. Tukar lintas tanggal menjadi pengembangan terpisah. Untuk tanggal hari ini, Pagi/Sore hanya dapat diputuskan sebelum waktu mulai paling awal yang terdampak; untuk Middle tanpa jam rencana, pengajuan awal dibatasi pada tanggal sesudah hari ini. Waktu kedaluwarsa harus dihitung server dari batas tersebut; jika jadwal berubah sehingga tidak lagi memenuhi batas, keputusan ditolak secara jelas.
- Alur minimum: **Menunggu rekan → Menunggu SPV → Disetujui/Ditolak/Dibatalkan/Kedaluwarsa**. Jadwal resmi tetap berlaku sampai persetujuan final.
- Hanya pengusul/pihak terkait melihat rincian permintaannya; kandidat diberikan sebagai data minimum yang terotorisasi. Kelayakan kandidat bukan bukti persetujuan rekan.
- Rancangan harus menunjukkan perubahan setiap sel sebelum konfirmasi. Pengganti satu arah hanya boleh jika target tidak mempunyai penugasan kerja yang bentrok; tentukan hasil sel pengusul/pengganti secara eksplisit dalam preview. Jangan otomatis memberi Libur tetap atau mengubah saldo cuti.
- Hasil tukar dua arah: pertahankan identitas baris milik masing-masing karyawan/tanggal, lalu tukar konteks outlet/shift yang disetujui dalam satu transaksi. Hasil pengganti satu arah: penugasan kerja pengusul menjadi batal, dan penugasan penerima dibuat/diaktifkan kembali dengan konteks yang disetujui. Jika penerima mempunyai Libur eksplisit atau hari libur tetap, perubahan harus ditinjau beserta alasan sesuai aturan roster; jangan melewati konflik Libur secara diam-diam. Identitas baris batal/Libur existing dan auditnya tetap dipertahankan.
- Server mengunci/memeriksa kedua penugasan, revisi, tanggal bergabung, status akun/outlet, cuti/izin, izin Middle, dan satu penugasan per karyawan/tanggal. Pertahankan identitas baris batal yang dapat diaktifkan kembali beserta audit.
- Keputusan final hanya oleh **Admin HR aktif yang bukan peserta permintaan**. Kemampuan menangani laporan sarana/stok tidak memberi hak keputusan roster. Tidak ada bypass larangan self-assignment melalui RPC biasa; endpoint persetujuan menerapkan aturan pihak/penilai yang jelas.
- Keputusan final mengubah seluruh penugasan, audit, status permintaan terkait dan outbox secara atomik. Konflik dengan perubahan jadwal sesudah pengajuan memerlukan review/pengajuan ulang, tidak overwrite.
- Pembatalan/penolakan sebelum final tidak mengubah jadwal. Perubahan sesudah final menggunakan transaksi resmi baru dengan riwayat, bukan menghapus keputusan lama.

**Selesai bila:** dua permintaan bersaing untuk jadwal sama tidak sama-sama menang, dua keputusan bersamaan hanya berefek sekali, retry respons hilang menghasilkan hasil awal, dan kedua kasir melihat jadwal final yang sama.

### SPV-08 — kecukupan personel per interval waktu

**Goal:** SPV mengetahui jam yang kurang penjagaan tanpa menyamakan semua nama terjadwal dengan orang yang tersedia sepanjang hari.

- Pertahankan ringkasan minimum per shift existing. Tambahkan kebutuhan interval yang ditinjau admin, bertanggal efektif, dengan rentang tidak tumpang tindih dalam konteks outlet/hari yang sama.
- **Jangan otomatis menjumlahkan atau mengambil maksimum minimum Pagi/Sore/Middle lama.** Arti kebutuhan pada jam yang tumpang tindih belum ditetapkan oleh model lama. Boleh menyediakan usulan konversi, tetapi harus ditinjau dan disimpan secara eksplisit; interval belum diatur tetap berlabel Belum diatur.
- Tambahkan jam rencana penugasan sebagai kontrak yang eksplisit. Pagi/Sore dapat mengambil konfigurasi yang berlaku dengan snapshot; Middle membutuhkan jam rencana yang diisi/dikonfirmasi. Middle tanpa jam tidak dihitung sebagai cakupan jam pasti dan ditandai Perlu konfirmasi jam.
- Jam rencana Middle adalah perkiraan cakupan, bukan perubahan aturan keterlambatan atau clock in aktual. Durasi rencana mengikuti 8 jam termasuk istirahat. Perubahan jam yang sudah menjadi sumber absensi/histori harus mengikuti jalur koreksi, bukan menghitung ulang masa lalu dari konfigurasi terbaru.
- Gunakan interval setengah terbuka `[mulai, selesai)`, tanggal kerja WIB, dan penanganan akhir hari berikutnya. Hitung karyawan unik; gabungkan interval izin tumpang tindih sebelum mengurangi ketersediaan.
- Cuti penuh disetujui menghapus ketersediaan hari terkait; izin sebagian jam disetujui mengurangi rentang yang berlaku. Pengajuan menunggu hanya peringatan. Adjustment pending tidak menggantikan keputusan lama.
- Pisahkan **cakupan rencana**, **kehadiran tercatat**, dan **kebutuhan**. Clock in tanpa catatan keluar/kembali izin bukan bukti berada di outlet sepanjang rentang; jam kembali aktual belum dilacak. Pencatatan keluar/kembali aktual adalah perluasan terpisah bila kemudian diminta pengguna.
- Bila ada jam/konfigurasi yang belum diketahui, tampilkan ketidaklengkapan; jangan mengklaim pasti cukup. Detail interval harus menjelaskan nama yang dihitung dan alasan pengecualian tanpa membuka alasan cuti kepada petugas yang tidak berhak.
- Fixture numerik wajib: kebutuhan 2 orang pukul 14.00–16.00; A tersedia sepanjang rentang; B tersedia kecuali izin 14.30–15.00; C Middle mulai 15.00. Hasil kurang 1 orang hanya pukul 14.30–15.00. C tidak dihitung sebelum 15.00 dan batas 15.00 tidak dihitung ganda.

**Selesai bila:** fixture Middle/izin sebagian jam menunjukkan rentang kurang yang benar, batas jam tidak terhitung dua kali, jadwal lintas tengah malam benar, dan perubahan konfigurasi masa depan tidak mengubah laporan historis.

### SPV-09 — ringkasan mingguan dan bulanan

**Goal:** SPV memperoleh ringkasan yang dapat ditelusuri ke data pembentuknya.

- Filter periode, outlet dan kasir; default minggu Senin–Minggu WIB dan bulan kalender. Label rentang tanggal selalu terlihat.
- Tampilkan hari kerja terjadwal, hari tercatat hadir, cuti/izin, menit keterlambatan berizin/tanpa izin, koreksi, cakupan kurang/belum diatur, dan kasus belum selesai/selesai/lewat tenggat.
- Pisahkan orang, hari-karyawan, sesi, dan menit. Angka kehadiran per hari menggunakan distinct karyawan+tanggal kerja; jangan memakai jumlah clock in sebagai jumlah orang unik.
- Jika menampilkan rasio, tuliskan penyebut dan pengecualiannya. Default penyebut adalah hari kerja terjadwal yang berlaku, mengecualikan Libur/batal/cuti penuh yang sah; kehadiran tanpa jadwal ditampilkan sebagai pengecualian dan tidak menaikkan pembilang rasio tersebut. Penyebut nol/tidak lengkap menghasilkan Tidak dapat dihitung.
- Atribusikan ke outlet/penugasan historis, bukan penempatan utama saat ini. Gunakan workDate untuk sesi lintas tengah malam; perbaikan jam dan perubahan keputusan cuti harus terefleksi konsisten tanpa menggandakan saldo/hari.
- Bedakan laporan **kejadian dalam periode** dari **backlog masih terbuka sekarang**. Jangan menyebut snapshot akhir bulan historis jika histori yang tersedia tidak cukup merekonstruksinya; tampilkan basis waktu agregat yang sebenarnya.
- Data manual/perangkat, alasan konfirmasi dan status belum terverifikasi tetap berbeda. Ringkasan tidak membuat penilaian disiplin, potongan otomatis atau ranking hukuman.
- Setiap angka memiliki drill-down yang sesuai filter. CSV agregat aman untuk spreadsheet dan cocok dengan rincian; foto, dokumen pribadi dan signed URL tidak ikut diekspor.
- Scope minimum ringkasan adalah tampilan sesuai permintaan dan ekspor, dengan waktu perhitungan/asOf terlihat. Pengiriman laporan otomatis melalui email/WhatsApp atau scheduler baru tidak termasuk milestone ini.

**Selesai bila:** agregat cocok dengan detail pada pergantian outlet/bulan/tahun, izin tumpang tindih, koreksi, reopen, data lama tanpa jam rencana, dan periode tanpa jadwal.

### SPV-10 — regresi integrasi dan upgrade

**Goal:** semua modul baru bekerja bersama tanpa mengulang temuan audit.

- Jalankan matriks pada bagian 8 dan suite pada bagian 9. Tambahkan tes untuk perilaku bisnis dan risiko yang berubah; tidak perlu tes yang hanya menyalin detail implementasi.
- Uji dua akun berwenang berbeda, dua tab akun sama, akun kasir, petugas operasional terbatas, akun nonaktif, anon, dan pergantian akun saat request tertunda.
- Uji install database bersih `0→N`, upgrade baseline Preview `18→N` (atau baseline aktual yang diverifikasi), serta upgrade historis `13→N` dengan preflight yang memang diperlukan sebelum migration lama yang dapat gagal.
- Jangan mengedit migration diterapkan. Historical preflight tidak dijalankan otomatis pada Preview 18. SQL reset legacy hanya boleh dijalankan oleh harness fixture in-memory yang memang mengujinya.
- Probe `verify-readiness-preview.sql` saat ini memeriksa baseline tepat 18. Untuk schema baru, buat/ubah probe version-aware secara sengaja dan uji tujuan/rollback-nya; jangan menghapus pemeriksaan baseline agar probe lama tampak lulus.
- Periksa indeks query backlog/filter/pagination dan kebocoran data. Gunakan fixture volume yang representatif, periksa rencana query aktual bila sesuai, dan catat pengukuran tanpa klaim skala yang belum diuji.

**Selesai bila:** seluruh pemeriksaan wajib lulus, kegagalan baru ditutup atau dicatat dengan blokir fitur yang jelas, dan tidak ada data/audit yang dihapus untuk meluluskan tes.

### SPV-11 — Preview, hosted dan panduan pengguna

**Goal:** rilis Preview dapat ditelusuri dari source sampai alur pengguna, dengan batas perangkat dinyatakan jujur.

- Verifikasi identitas target aktual pada bagian 10 sebelum tindakan remote. Lakukan dry-run migration; tinjau semua yang akan diterapkan.
- Urutkan database/frontend sesuai kompatibilitas yang diuji. Jika membutuhkan compatibility wrapper/versioned RPC, pertahankan perilaku klien lama yang masih dapat terbuka sampai strategi transisi aman. Jangan menghapus audit untuk rollback.
- Commit perubahan secara logis, push hanya ke `codex/preview`, verifikasi CI/source SHA/deployment ID/alias serta ref Supabase yang digunakan bundle. Tidak promosi ke Production.
- Jalankan alur hosted yang tersedia: login/sesi yang sah → tindakan UI → RPC/database → Realtime sesi kedua → reload → audit. Gunakan data uji teridentifikasi; pemulihan melalui pembatalan/update normal dan audit dipertahankan.
- Selesaikan semua pekerjaan mandiri sebelum meminta login/perangkat yang benar-benar diperlukan. Untuk tindakan yang mengubah kata sandi, pengguna memasukkan sendiri di halaman resmi. Jangan meminta secrets atau mengulang permintaan uji offline yang telah ditunda tanpa konteks kebutuhan baru.
- Perbarui halaman Panduan aplikasi untuk tugas kasir/SPV/admin; jelaskan status, konflik, batas data saat offline, dan cara meminta bantuan. Antarmuka pengguna tidak perlu memuat detail implementasi internal.
- Catat PVR-02 terpisah: bukti HTTP 200 script worker tanpa redirect, registration activated, controller setelah reload, offline shell, dan update lintas versi. Uji shell yang memblokir service worker tidak menutupnya.
- Uji iPhone/iPad nyata untuk pemasangan, kamera/GPS, notifikasi, background/resume dan pembaruan PWA hanya ketika pengguna tersedia. Bukti desktop/emulasi tidak menggantikannya.

**Selesai implementasi/rilis bila:** source, migration dan Preview terverifikasi serta panduan diperbarui. **Selesai verifikasi operasional penuh** hanya bila alur hosted/perangkat yang diwajibkan benar-benar lulus; status tertunda tetap ditulis terpisah.

## 8. Matriks penerimaan minimum

| ID | Skenario | Bukti yang diharapkan |
| --- | --- | --- |
| T01 | Kasus kemarin belum selesai, dashboard hari ini | Muncul dalam Semua belum selesai dan Tugas saya; tanggal asal jelas. |
| T02 | Lebih dari satu halaman backlog | Paging/total/filter stabil, tidak kehilangan atau menggandakan item saat data berubah. |
| T03 | Dua SPV menyimpan revisi sama | Satu sukses; satu konflik mempertahankan draft, audit tidak tertimpa. |
| T04 | Sumber kasus berubah, termasuk shift menjadi Libur | Konteks terbuka/revisi sesuai; riwayat selesai dipertahankan; tidak gagal constraint. |
| T05 | Catatan diketik selama request berjalan | Nilai baru tidak terhapus oleh settlement request lama. |
| T06 | Tenggat lewat, worker dieksekusi dua kali | Satu kejadian per revisi/penerima; tidak menggandakan notifikasi. |
| T07 | PIC berganti/nonaktif atau kasus selesai sebelum dispatch | Pemberitahuan usang tidak dikirim; antrian pengganti tetap terlihat. |
| T08 | Petugas sarana/stok mencoba HR/outlet/lampiran di luar scope | Server menolak; tidak ada rincian bocor pada bootstrap, Realtime, notifikasi atau ekspor. |
| T09 | Kasir outlet sementara mengirim laporan; kategori tanpa PIC | Outlet historis benar; laporan tersimpan dan terlihat pada antrian yang sah. |
| T10 | Kirim laporan dua kali atau respons hilang | Satu laporan/riwayat; retry hasil pasti, upload gagal tidak merusak laporan lain. |
| T11 | Serah terima direvisi setelah konfirmasi | Konfirmasi lama tetap terkait versi lama; versi baru memerlukan tindakan penerima. |
| T12 | Pengganti penerima/lintas tengah malam | Identitas/waktu/outlet tepat; clock out tidak tergantung form serah terima. |
| T13 | Tukar shift disetujui bersamaan dengan perubahan jadwal | Konflik aman; tidak ada perubahan salah satu pihak saja. |
| T14 | Dua permintaan memakai penugasan sama; self-approval | Hanya perubahan yang sah menang; self-approval ditolak. |
| T15 | Commit berhasil, respons hilang, reload, retry | Key/body asli dipulihkan; receipt hasil awal, tidak ada audit/notifikasi ganda. |
| T16 | Retry pasti ditolak karena cuti penuh; edit dan transaksi baru | Pending hanya dilepas atas bukti pasti; perubahan yang direview memakai key baru. |
| T17 | Draft tab A, tab B usang navigasi/menyimpan | Pending/version baru tidak dihapus; konflik teramati menahan aksi. |
| T18 | Logout A, login B ketika request A belum selesai | Data, draft, kanal, notifikasi dan hasil late callback A tidak muncul pada B. |
| T19 | Cold reload deep link beserta query | Path/minggu/kasus tidak hilang selama validasi sesi; signed-out nyata tetap diarahkan sesuai aturan. |
| T20 | Middle tanpa jam; minimum interval belum ditetapkan | Ditandai belum dapat dinilai, bukan dianggap cukup atau terlambat. |
| T21 | Izin parsial bertumpuk, pending adjustment, batas jam | Pengurangan union benar; keputusan lama tetap berlaku; tidak double count. |
| T22 | Perubahan konfigurasi/outlet setelah periode laporan | Angka historis tetap berbasis snapshot/workDate yang benar. |
| T23 | Ringkasan vs detail vs CSV | Nilai cocok, satuan jelas, denominator nol/tidak lengkap jujur. |
| T24 | Fresh install, upgrade Preview, upgrade historis | Hasil dipisah; historical preflight diuji idempoten dan bounded; audit tetap utuh. |
| T25 | GPS/camera callback tertunda dan unmount | Guard perbaikan lama tetap berlaku; stream usang dihentikan. |
| T26 | PWA hosted/perangkat | Registrasi/control/offline/update dibuktikan masing-masing; skipped atau Ready tidak dihitung pass. |

Kasus uji baru harus memakai fungsi/helper dan alur nyata sejauh mungkin. Fixture tiruan hanya membuktikan batas yang disimulasikan; jangan menutup risiko concurrency SQL dengan mengganti kedua helper aktual menjadi fungsi palsu.

## 9. Panduan pemeriksaan untuk pelaksana

### 9.1 Perintah pemeriksaan lokal

Jalankan dari root repo. Periksa kembali package scripts saat implementasi; command berikut sesuai baseline dokumen.

```powershell
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
node supabase/deployment/verify-readiness-preview.test.mjs
git diff --check
```

Suite probe terakhir wajib disesuaikan secara sadar bila versi migration berubah. Jalankan pemeriksaan terarah selama implementasi dan seluruh gate sebelum rilis; jangan mengulang suite besar tanpa perubahan/kegagalan baru yang memerlukannya.

### 9.2 Demo browser dan PWA lokal

Gunakan terminal/proses terpisah agar env uji tidak tertukar dengan build live. Jangan menimpa `.env` berisi kredensial. Nilai public env di bawah khusus fixture lokal.

Terminal server:

```powershell
$env:PUBLIC_APP_ENV = 'development'
$env:PUBLIC_SUPABASE_URL = ''
$env:PUBLIC_SUPABASE_ANON_KEY = ''
npm.cmd run build
npm.cmd run preview -- --port 5198 --strictPort
```

Terminal tes:

```powershell
$env:E2E_PWA = '1'
$env:E2E_BASE_URL = 'http://127.0.0.1:5198'
Remove-Item Env:E2E_LIVE_SUPABASE_MOCK -ErrorAction SilentlyContinue
npm.cmd run test:e2e -- tests/demo.spec.ts --reporter=line
```

### 9.3 Live-mock harus dijalankan eksplisit

Terminal server terpisah:

```powershell
$env:PUBLIC_APP_ENV = 'preview'
$env:PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54329'
$env:PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_isolated_audit_mock'
npm.cmd run dev -- --port 5183 --strictPort
```

Terminal tes terpisah:

```powershell
$env:E2E_LIVE_SUPABASE_MOCK = '1'
$env:E2E_BASE_URL = 'http://127.0.0.1:5183'
Remove-Item Env:E2E_PWA -ErrorAction SilentlyContinue
npm.cmd run test:e2e -- tests/live-cashier-roster-ambiguous.spec.ts --reporter=line
```

Mock menangkap request browser; tidak memerlukan server Supabase nyata di port 54329. Tambahkan spec modul baru dan jalankan secara eksplisit juga; menjalankan file roster saja tidak membuktikan seluruh fitur baru.

Konfigurasi baseline memakai Edge, WIB, satu worker, kamera/GPS palsu pada browser uji. Hal ini bukan bukti perangkat nyata. `npm run test:e2e` tanpa flag dapat melewati PWA/live-mock, sehingga catat jumlah pass/fail/skip dan daftar skenario.

CI baseline menjalankan check/unit/database/legacy/build; browser suites belum otomatis dijalankan CI. Bila CI diperluas, pastikan mode demo/mock terisolasi, tidak membuat mutasi ke Preview/Production, dan kegagalan test tidak disembunyikan oleh langkah cleanup.

## 10. Gate Supabase dan Vercel Preview

| Target yang diketahui | Identitas |
| --- | --- |
| Git | `yoga12-rgb/hr-rajaklana-jkt`, branch `codex/preview` |
| Supabase Preview | `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr` |
| Organisasi / region | `bvwgekyfibloctfslgdf` / `ap-southeast-2` |
| Vercel team | `team_S1Sn08iaksD0GQF4kk49kTkH` (`hr-rajaklana`) |
| Vercel project | `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb` (`hr-rajaklana-jkt`) |
| Alias Preview | <https://hr-rajaklana-jkt-preview.vercel.app> |

Ini identitas yang diketahui, bukan pengganti verifikasi aktual. Sebelum remote write, cocokkan ref/nama/organisasi, history migration, linked project, branch dan target deploy. Jika berbeda, hentikan tindakan pada target itu dan selesaikan investigasi identitas; jangan menebak dari nama yang mirip.

- Buat migration baru memakai CLI resmi yang telah dicek versinya. Jangan mengedit migration diterapkan atau menjalankan DDL eksperimen langsung di hosted.
- Tinjau dry-run; penerapan harus sama dengan source yang diuji. Simpan bukti version tanpa menampilkan secrets.
- Upgrade historis 13-migration berbeda dari upgrade Preview saat ini. Preflight historis harus berjalan sebelum migration lama yang membutuhkannya pada fixture; migration baru di akhir tidak dapat memperbaiki kegagalan yang terjadi sebelumnya.
- Jangan jalankan `reset-known-legacy.sql` pada Preview. Data uji dipulihkan lewat operasi aplikasi yang terotorisasi; riwayat uji tetap ada.
- Gunakan autentikasi resmi untuk Deployment Protection. Jangan menonaktifkan proteksi, memperluas akses, atau membuat bypass baru hanya agar smoke lulus. Akses OIDC pada shell tidak membuktikan worker browser menerima autentikasi sama.
- Verifikasi migration/RPC/grants/RLS/advisor yang relevan setelah deployment. Pisahkan warning baseline yang telah ditinjau dari regresi baru; jangan mencabut API secara massal.
- Catat commit SHA, CI URL, deployment ID, alias, ref Supabase, dan hasil alur hosted. Uji query/admin probe yang rollback bukan bukti pengguna berhasil login dan menyelesaikan alur Auth.

## 11. Peta source untuk memulai

| Area | Source baseline |
| --- | --- |
| Beranda | [dashboard/+page.svelte](../src/routes/(app)/dashboard/+page.svelte) |
| Panel SPV | [CashierSpvPanel.svelte](../src/lib/components/CashierSpvPanel.svelte) |
| Domain status/cakupan/kasus | [cashier-spv.ts](../src/lib/cashier-spv.ts) |
| Planner dan halaman jadwal | [CashierWeeklyPlanner.svelte](../src/lib/components/CashierWeeklyPlanner.svelte), [assignments/+page.svelte](../src/routes/(app)/assignments/+page.svelte) |
| Recovery roster | [cashier-spv-drafts.ts](../src/lib/cashier-spv-drafts.ts), [cashier-roster-reconcile.ts](../src/lib/cashier-roster-reconcile.ts), [cashier-roster-save-error.ts](../src/lib/cashier-roster-save-error.ts) |
| Draft catatan SPV | [spv-followup-drafts.ts](../src/lib/spv-followup-drafts.ts) |
| State, Auth dan Realtime | [state/app.ts](../src/lib/state/app.ts), [access.ts](../src/lib/access.ts), [types.ts](../src/lib/types.ts) |
| Rekap dan cuti | [reports/+page.svelte](../src/routes/(app)/reports/+page.svelte), [leave/+page.svelte](../src/routes/(app)/leave/+page.svelte) |
| Inbox/push/worker | [NotificationCenter.svelte](../src/lib/components/NotificationCenter.svelte), [device-push.ts](../src/lib/device-push.ts), [push.mjs](../api/push.mjs), [push-dispatch](../supabase/functions/push-dispatch/index.ts) |
| SPA/PWA dan panduan | [service-worker.ts](../src/service-worker.ts), [root layout](../src/routes/+layout.svelte), [guide/+page.svelte](../src/routes/(app)/guide/+page.svelte) |
| Migration awal SPV | [weekly roster](../supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql) |
| Konteks kasus dan perbaikan terbaru | [context locking](../supabase/migrations/20261021154511_cashier_followup_context_locking.sql), [readiness](../supabase/migrations/20261022170000_close_readiness_audit_findings.sql) |
| Uji database/upgrade | [database.mjs](../supabase/tests/database.mjs), [followup-upgrade-compatibility.mjs](../supabase/tests/followup-upgrade-compatibility.mjs), [biometric-push.mjs](../supabase/tests/biometric-push.mjs) |
| Preflight historis | [preflight-followup-off-compatibility.sql](../supabase/deployment/preflight-followup-off-compatibility.sql) |
| Probe baseline 18 | [verify-readiness-preview.sql](../supabase/deployment/verify-readiness-preview.sql), [harness](../supabase/deployment/verify-readiness-preview.test.mjs) |
| Uji browser | [demo.spec.ts](../tests/demo.spec.ts), [live-cashier-roster-ambiguous.spec.ts](../tests/live-cashier-roster-ambiguous.spec.ts), [playwright.config.ts](../playwright.config.ts) |

Daftar ini titik masuk, bukan batas file yang boleh berubah. Telusuri pemanggil dan seluruh helper aktual sebelum mengubah kontrak.

## 12. Bukti dan format handoff

Simpan hasil pelaksanaan dalam `docs/progres-supervisor-2026-10-23.md` ketika implementasi dimulai. Dokumen tersebut belum dibuat oleh tugas penyusunan guide ini. Untuk setiap milestone catat:

```text
Milestone:
Status: Belum dimulai / Dikerjakan / Lokal lulus / Preview dirilis / Hosted lulus / Menunggu interaksi
Commit dan branch:
Perubahan perilaku:
File/migration utama:
Pemeriksaan: perintah, mode/env, pass/fail/skip, waktu, bukti ringkas
Alur hosted dan identitas aktor (tanpa credentials):
Data uji dan cara pemulihan; audit dipertahankan:
Konflik/risiko/keterbatasan yang tersisa:
Langkah berikutnya:
```

Gunakan matriks kelulusan terpisah:

| Milestone | Implementasi lokal | Deployment Preview | Workflow hosted | Perangkat/PWA |
| --- | --- | --- | --- | --- |
| SPV-00–11 | Isi berdasarkan bukti tiap milestone | SHA/ID/migration aktual | Skenario/aktor/hasil | Perangkat/skenario/hasil atau tertunda |

Jangan memberi centang satu milestone seolah semua kolom lulus ketika hanya build berhasil. `Tidak berlaku` hanya untuk kolom yang memang tidak terkait, dengan alasan singkat. Bukti yang mengandung data HR, signed URL, atau token tidak dimasukkan ke repositori publik; laporan menggunakan ringkasan tersanitasi.

Checklist awal:

- [ ] SPV-00 — baseline dan rancangan.
- [ ] SPV-01 — Beranda tindakan.
- [ ] SPV-02 — backlog, tenggat, konflik dua SPV.
- [ ] SPV-03 — pengingat dan checkpoint Tahap A.
- [ ] SPV-04 — akses modul dan routing.
- [ ] SPV-05 — laporan kendala outlet.
- [ ] SPV-06 — serah terima.
- [ ] SPV-07 — tukar shift/pengganti.
- [ ] SPV-08 — cakupan interval.
- [ ] SPV-09 — ringkasan periodik.
- [ ] SPV-10 — regresi dan upgrade.
- [ ] SPV-11 — Preview, hosted, panduan dan handoff.
- [ ] PVR-02/perangkat — tutup hanya dengan bukti aktual; saat dokumen dibuat masih terbuka.

## 13. Prompt singkat untuk model pelaksana

> Kerjakan `docs/guide-goal-milestone-supervisor-2026-10-23.md` dengan teliti. Mulai SPV-00 dan jalankan milestone berurutan, dengan checkpoint yang dapat ditinjau. Bangun di atas fitur existing; pertahankan transaksi atomik, baseline/version checks, key/payload asli replay, RLS, riwayat kasus dan isolasi draft/akun. Jangan edit migration yang sudah diterapkan. Bedakan upgrade Preview baseline aktual dari upgrade historis 13 yang memerlukan preflight sebelum migration lama. Target hanya `codex/preview` dan Supabase Preview yang identitasnya diverifikasi; Production/main di luar cakupan. Jalankan live-mock eksplisit termasuk persist/reload/retry serta suite wajib, catat bukti tiap milestone pada dokumen progres. Pengguna menunda uji offline/perangkat; selesaikan pekerjaan mandiri dan pertahankan status PVR-02/perangkat terbuka tanpa menghambat semua pengembangan lokal. Jangan meminta secrets. Laporkan implementasi lokal, deployment, workflow hosted, dan perangkat nyata secara terpisah.
