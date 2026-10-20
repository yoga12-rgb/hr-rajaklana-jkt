# Goal, alur perbaikan, dan milestone hasil audit Tahap A

Tanggal rencana: **20 Oktober 2026 (WIB)**. Status pelaksanaan: **R0–R5 lulus di lokal; R6a Preview selesai; R6b hosted dan R6c perangkat masih pending**.

Acuan utama: [laporan audit 20 Oktober 2026](audit-tahap-a-2026-10-20.md). Source saat penyusunan: branch `codex/preview`, HEAD `77621e875a9aa3f1b87331baa884e72528f5ec7c`.

Dokumen ini ditujukan kepada agent pelaksana berikutnya. Tugas sesi penyusun hanya membuat rencana; tidak menerapkan perbaikan, migration, commit, push, atau deployment. Ketika pengguna memberikan dokumen ini sebagai instruksi eksekusi, kerjakan cakupan R0–R6 di bawah. Periksa ulang kondisi repository saat mulai karena source dapat berubah setelah handoff.

## 1. Goal dan ukuran keberhasilan

> Menutup ketujuh temuan audit agar jadwal tidak tertimpa oleh draft lama, pemulihan koneksi benar-benar sesuai SDK, tindak lanjut dapat diselesaikan sepanjang perubahan source, dan kasir melihat jadwal yang dimaksud oleh notifikasi.

Hasil yang harus dapat dibuktikan:

1. Perubahan SPV lain tidak tertimpa tanpa peninjauan konflik yang eksplisit.
2. Draft lama dan hasil simpan yang belum pasti tetap dapat ditangani tanpa kehilangan isi atau menggandakan transaksi.
3. Kanal Realtime terminal dapat diganti dengan kanal baru; refetch tetap berjalan walaupun subscribe gagal.
4. Kasus terbuka tetap dapat ditangani setelah source berubah atau masalahnya teratasi.
5. Outlet/shift kasus yang sedang ditangani sesuai source otoritatif; konteks historis tetap terlacak.
6. Notifikasi mingguan membuka jadwal satu minggu milik kasir sendiri.
7. Kasus durasi hanya dibuka jika masih ada selisih yang belum dijelaskan izin disetujui.
8. Bukti lokal, SDK, database, hosted, dan perangkat dilaporkan terpisah. Status selesai mengikuti bukti tersebut.

## 2. Ruang lingkup dan batas pelaksanaan

- Perbaiki **A01–A07** dari laporan audit, termasuk regresi, dokumentasi, dan rilis **Preview**.
- Branch rilis: `codex/preview`. Supabase Preview yang diketahui: `lypsqrwjzrmuyqtdcegr`. Vercel: `hr-rajaklana-jkt`, tim `HR Rajaklana`. Verifikasi identitas target melalui konfigurasi aktual sebelum tindakan remote.
- **Production, data Production, dan branch `main` berada di luar cakupan.** Penerapan ke Production memerlukan instruksi lain dari pengguna.
- Pertahankan aturan delapan jam termasuk istirahat, WIB, Middle fleksibel, GPS/selfie, cuti/izin, self-assignment, akses akun, audit, dan notifikasi privat.
- Pertahankan SPA/PWA dan tema Neumorphism kuning. Perbaikan ini tidak mengubah kebijakan kerja atau keputusan disiplin.
- Tahap B/M6–M10 pada roadmap lama tidak dikerjakan.
- Dokumen ini menggantikan arahan lama yang hanya meminta penyelesaian verifikasi M4, sejauh diperlukan untuk memperbaiki A01–A07. Fitur lama diperbaiki pada titik yang bermasalah; tidak dibangun ulang seluruhnya.
- Jangan mereset database, menghapus riwayat kasus/audit, mengganti akun, atau menambah layanan berbayar untuk menyelesaikan tugas ini.

## 3. Peta milestone dan dependensi

Penamaan **R0–R6** dipakai agar tidak tertukar dengan milestone M0–M10 pada roadmap fitur.

| Milestone | Cakupan | Dependensi | Hasil utama |
| --- | --- | --- | --- |
| R0 | Baseline, kontrak perbaikan, dan reproduksi | — | Ketujuh bug mempunyai bukti awal dan skenario regresi yang jelas |
| R1 | A01/P1: baseline draft dan konflik | R0 | Draft tidak menimpa perubahan sesi lain; draft lama ditangani dengan aman |
| R2 | A02 + A06: lifecycle Realtime dan respons RPC | Kontrak retry R1 disepakati | Recovery sesuai SDK; status HTTP dan rekonsiliasi tidak terputus |
| R3 | A03 + A04 + A07: tindak lanjut sepanjang perubahan source | R0; integrasi state mengikuti R2 | Kasus tetap bisa dikelola, konteks benar, validasi izin konsisten |
| R4 | A05: tampilan minggu milik kasir | R0 | Tautan lama maupun baru membuka tujuh tanggal yang benar |
| R5 | Regresi lintas fitur dan dokumentasi | R1–R4 | Semua temuan ditutup dengan bukti lokal dan pemeriksaan ulang |
| R6 | Rilis Preview dan verifikasi hosted/perangkat | R5 | Versi yang sama terpasang, teruji, dan sisa verifikasi dinyatakan jujur |

Alur utama: **R0 → R1 → R2 → R3 → R4 → R5 → R6**. Paket R3/R4 dapat dikerjakan paralel setelah kontraknya disepakati, asalkan kepemilikan file tidak bertabrakan. `src/lib/state/app.ts` dan migration harus mempunyai satu pemilik integrasi pada satu waktu.

## 4. R0 — Tetapkan baseline dan reproduksi sebelum mengubah perilaku

### Langkah kerja

1. Baca instruksi repository/AGENTS dan skill yang relevan. Jika `.codegraph/` tersedia saat eksekusi, gunakan CodeGraph sebelum pencarian source; jika tidak, jangan membuat indeks sendiri.
2. Periksa branch, HEAD, status lokal, remote, serta perubahan sesudah source audit. Pertahankan file audit/rencana yang mungkin masih untracked dan perubahan pengguna yang sudah ada.
3. Baca laporan audit, source yang dirujuk, kontrak backend, serta konfigurasi lingkungan. Nomor baris laporan merupakan acuan awal; gunakan simbol/source aktual bila bergeser.
4. Untuk perubahan Supabase, gunakan skill Supabase dan periksa dokumentasi/changelog terkini sebelum mengubah RPC, schema, atau integrasi SDK.
5. Bangun fixture dengan dua Admin HR, minimal dua kasir, dua outlet, satu minggu mendatang, dan izin yang dibutuhkan. Gunakan tanggal relatif terhadap hari eksekusi; tanggal Januari 2027 pada laporan adalah bukti audit, bukan tanggal wajib dalam tes.
6. Reproduksi ketujuh masalah secara lokal. Untuk A02/A06, pakai SDK terpasang atau fetch mock yang menghasilkan bentuk respons SDK sebenarnya. Untuk A01/A03/A05, lewatkan skenario melalui UI, bukan hanya helper domain.
7. Catat skenario yang gagal sebelum perbaikan. Tes regresi yang dibuat harus membedakan perilaku lama dan perilaku yang diharapkan; jangan mengubah fixture agar bug tidak terpicu.

### Baseline yang diketahui

- `check`: 0 error, 0 warning.
- Unit: 345 tes lulus pada 24 file.
- Suite database lokal: lulus dengan 13 migration, termasuk biometrik/push.
- Angka tersebut adalah riwayat audit, bukan bukti bahwa source agent berikutnya sudah lolos.

### Kriteria selesai R0

- [ ] Source dan lingkungan awal tercatat.
- [ ] Perubahan lokal pengguna terlindungi.
- [ ] Ada reproduksi awal A01–A07 dan rencana tes yang menangkap akar masalahnya.
- [ ] Tidak ada perubahan data hosted yang diperlukan untuk reproduksi awal.

## 5. R1 — A01: jadikan baseline draft tetap sampai konflik ditinjau

**Prioritas tertinggi.** Selesaikan kontrak ini sebelum memperluas perubahan pada retry/pemulihan draft.

### Source utama

`src/lib/components/CashierWeeklyPlanner.svelte`, `src/lib/cashier-spv-drafts.ts`, `src/lib/cashier-spv.ts`, `src/lib/cashier-roster-reconcile.ts`, `src/lib/state/app.ts`, serta tes draft/planner/batch.

### Alur yang harus dihasilkan

1. Saat sel pertama kali diedit, simpan **baseline penugasan saat itu** secara terpisah dari nilai draft pengguna.
2. Baseline mencakup keadaan ada/kosong, identitas baris, `updatedAt`, status, shift, dan outlet. Keadaan kosong dan baris batal harus dapat dibedakan.
3. `buildChanges()` menyusun identitas dan `expected_updated_at` dari baseline tersimpan, bukan dari state terbaru setelah refresh.
4. Ketika data masuk dari sesi lain, bandingkan dengan baseline. Jika berubah, tampilkan konflik yang tetap ada sampai pengguna memilih tindakan peninjauan.
5. Sediakan dua tindakan yang jelas: memakai jadwal server terbaru untuk sel tersebut, atau meninjau lalu menerapkan kembali nilai draft pengguna terhadap baseline baru. Tampilkan nilai draft dan jadwal terbaru agar pengguna memahami akibat pilihannya.
6. Hanya tindakan peninjauan eksplisit yang boleh mengganti baseline. Mengubah sel lain, alasan, filter, minggu, refetch, atau reload tidak boleh melakukan rebase diam-diam.
7. Pertahankan penolakan atomik server: bila satu perubahan usang, tidak ada baris lain dalam batch yang tersimpan sebagian.

### Draft lama dan idempotensi

- Versikan format draft baru. Draft v1 hanya menyimpan shift/outlet sehingga baseline aslinya tidak dapat direkonstruksi secara aman dari data terbaru.
- Pertahankan isi draft lama dan tandai **perlu ditinjau**; jangan menganggap pengguna sudah meninjau versi server terbaru. Jangan membuang isi secara diam-diam.
- Bedakan draft yang belum dikirim dengan **percobaan simpan yang hasilnya ambigu**. Simpan payload percobaan dan key yang tepat agar retry tidak berubah akibat refetch atau migrasi draft.
- Bila draft lama masih menyimpan fingerprint/key dari percobaan ambigu, periksa kemungkinan hasilnya sudah tersimpan sebelum menawarkan pengiriman baru. Jika payload lama dapat direkonstruksi dan divalidasi, retry memakai payload/key persis yang sama. Jika tidak, blokir pengiriman otomatis dan minta peninjauan hasil server; jangan menciptakan versi atau key pengganti secara diam-diam.
- Payload percobaan mencakup baseline yang dikirim. Retry payload identik memakai key sama. Setelah pengguna meninjau konflik dan mengubah payload, gunakan key baru.
- Selama percobaan ambigu belum direkonsiliasi, perubahan draft baru boleh disimpan lokal tetapi tidak boleh mengganti payload/key percobaan lama atau otomatis mengirim payload pengganti. Selesaikan rekonsiliasi atau retry percobaan lama terlebih dahulu.
- Hasil salin minggu harus menyimpan baseline target saat diterapkan. Target kosong yang kemudian diisi sesi lain harus menjadi konflik, bukan dianggap sudah ditinjau.

### Skenario wajib R1

- [ ] Draft Sore dibuat dari Pagi; sesi lain mengubah ke Middle; edit sel lain tidak menghilangkan konflik atau menimpa Middle.
- [ ] Source dibatalkan, dipindah outlet, atau diisi dari keadaan awal kosong setelah draft dibuat.
- [ ] Konflik bertahan setelah ganti alasan, pindah minggu, kembali ke minggu asal, dan reload.
- [ ] Membatalkan/mengaktifkan kembali penugasan tetap memakai identitas serta versi baseline yang benar.
- [ ] Draft v1 dipulihkan tanpa kehilangan isi dan tidak bisa langsung menimpa data terbaru.
- [ ] Review satu sel tidak mengubah baseline sel lain. Perubahan payload memakai key batch baru setelah percobaan ambigu lama diselesaikan; payload/key percobaan lama tetap utuh sampai saat itu.
- [ ] Satu sel usang menggagalkan seluruh batch; audit/notifikasi tidak tertulis sebagian.
- [ ] Commit berhasil lalu respons hilang, termasuk setelah reload/retry: tidak ada penugasan, audit, atau notifikasi ganda.

**Selesai bila:** reproduksi A01 ditolak atau meminta review yang benar, source sesi lain tetap utuh, dan pemulihan draft/idempotensi tetap bekerja.

## 6. R2 — A02 dan A06: perbaiki kontrak client dengan SDK

### Source utama

`src/lib/state/app.ts`, `src/lib/state/realtime-recovery.test.ts`, `src/lib/cashier-roster-save-error.ts`, `src/lib/cashier-roster-reconcile.ts`, serta tes live-mode browser.

### A02 — Lifecycle kanal

1. Pisahkan pembentukan kanal beserta seluruh binding dari penjadwalan retry.
2. Ketika kanal benar-benar `CLOSED`, invalidasi referensi lama dan bentuk **instance baru**. Jangan memanggil join/subscribe ulang pada kanal terminal yang sudah dipakai.
3. Gunakan identitas/generasi kanal dan sesi agar callback kanal lama tidak mengubah status atau memicu refresh setelah logout/pergantian akun.
4. Pastikan paling banyak satu kanal aktif dan satu timer retry untuk sesi saat ini. Event fokus/online/visibilitas yang berdekatan tidak boleh membuat kanal ganda.
5. Pertahankan retry transport SDK untuk `CHANNEL_ERROR`; hindari loop retry aplikasi kedua yang bersaing. Tentukan jalur `TIMED_OUT` sesuai perilaku versi SDK terpasang dan buktikan dengan tes.
6. Refetch saat aplikasi kembali aktif harus tetap berjalan walaupun pembentukan/subscribe kanal gagal. Tangani error tanpa membiarkan exception menghentikan seluruh pemulihan data.
7. Logout, sesi berakhir, dan pergantian akun membatalkan retry serta membersihkan kanal/data akun lama.
8. Pertahankan status teks **Offline**, **Menyambungkan**, dan **Terhubung** berdasarkan keadaan yang sebenarnya.

**Regresi wajib:** `CLOSED → kanal baru → SUBSCRIBED → refetch`; mock menolak join ulang pada instance lama; tes SDK nyata tanpa jaringan; callback kanal lama setelah kanal pengganti aktif; rangkaian fokus/online/resume; offline/logout saat timer menunggu; kegagalan subscribe tidak menghalangi refetch; tidak ada data akun sebelumnya setelah pergantian sesi.

### A06 — Status HTTP dan hasil simpan ambigu

1. Teruskan `status` dari hasil RPC **top-level** SDK, bukan dari properti `error.status` yang tidak dijamin ada.
2. Pertahankan message, SQLSTATE/code, dan status tanpa membocorkan konfigurasi atau kredensial.
3. Respons transport/gateway ambigu tanpa kode database masuk jalur rekonsiliasi. Penolakan SQLSTATE tetap menampilkan kesalahan validasi asli dan tidak dilaporkan sukses.
4. Rekonsiliasi menyegarkan jadwal dan memeriksa seluruh perubahan yang dikirim. Bersihkan draft hanya bila seluruh batch terbukti tercermin. Hasil parsial atau refresh gagal tanpa bukti penuh mempertahankan draft serta key percobaan.

**Regresi wajib:** fetch tiruan yang benar-benar mengembalikan HTTP 500 `{message:"Internal Server Error"}` lewat SDK; status 408/502/503/504 tanpa SQLSTATE; gagal jaringan; penolakan SQLSTATE; commit lalu respons hilang; hasil belum tersimpan; refresh tidak berhasil; replay idempoten setelah reload.

### Kriteria selesai R2

- [ ] Reproduksi A02 tidak lagi menghasilkan error join ulang dan kanal baru menerima pembaruan.
- [ ] Bentuk respons SDK pada A06 dikenali sebagai ambigu secara benar.
- [ ] Kontrak baseline/key R1 tetap terjaga selama reconnect dan rekonsiliasi.
- [ ] Tes tidak memakai mock yang mengizinkan perilaku yang ditolak SDK asli.

## 7. R3 — A03, A04, dan A07: benahi satu alur tindak lanjut utuh

### Source utama

`src/lib/components/CashierSpvPanel.svelte`, `src/lib/cashier-spv.ts`, `src/lib/attendance-status.ts`, `src/lib/state/app.ts`, model di `src/lib/types.ts`, RPC `spv_followup_start`/`spv_followup_update`, serta harness `supabase/tests/database.mjs`.

### A03 — Kasus terbuka tetap dapat ditutup

1. Gabungkan daftar sinyal terkini dengan kasus tersimpan berdasarkan identitas kasus, bukan hanya menampilkan kasus yang masih mempunyai sinyal.
2. Kasus `new`/`in_progress` tetap dapat diberi penanggung jawab, catatan, dan penyelesaian meskipun sinyal sumber hilang.
3. Tampilkan konteks seperti **kondisi sumber sudah teratasi; tindak lanjut menunggu penyelesaian**. Jangan mengubah status menjadi selesai hanya karena refetch.
4. Gunakan bagian riwayat baca-saja untuk kasus yang memang sudah selesai. Riwayat tidak boleh menjadi satu-satunya tempat bagi kasus yang masih terbuka.
5. Pertahankan keputusan penyelesaian yang eksplisit dan alasan penyelesaian wajib.

### A04 — Identitas stabil, konteks source benar

Default desain: pertahankan identitas kasus berdasarkan kejadian/source yang sama. Outlet/shift bukan alasan membuat kasus duplikat. Snapshot historis disimpan dalam audit.

1. Resolve karyawan, tanggal, outlet, dan shift dari source otoritatif di server; parameter client bukan sumber kebenaran.
2. Pada jalur reuse/reopen, sinkronkan metadata source yang berubah secara atomik. Untuk kasus masih aktif, jangan menghapus penanggung jawab/catatan atau mengubah status tanpa tindakan yang sah.
3. Kasus terbuka yang source-nya dipindahkan harus langsung dapat ditemukan dari outlet baru. Perbaikan tidak cukup hanya setelah pengguna menekan **Mulai** lagi.
4. Tentukan mekanisme sinkronisasi yang konsisten: pada transaksi perubahan source, atau proyeksi baca berdasarkan source terkini yang diikuti rekonsiliasi terkontrol pada aksi kasus. Jika memilih proyeksi baca, gabungkan kasus/sinyal **sebelum** filter outlet dan pastikan aksi update juga menyelaraskan data tersimpan. Membuka halaman/refetch tidak boleh membuat write tersembunyi.
5. Kasus selesai mempertahankan konteks penyelesaiannya sampai dibuka kembali. Saat reopen, ambil konteks terbaru dan simpan audit before/after. Retry pembukaan yang sama tidak menggandakan kasus atau jumlah reopen.
6. Source hilang/tidak lagi valid harus diberi penjelasan dan tetap mempunyai jalur penanganan; jangan menganggap kasus sudah selesai secara otomatis.

### Migration dan data yang sudah ada

- Buat **migration baru** melalui CLI Supabase; jangan mengubah migration `20261019061522_cashier_spv_weekly_roster.sql` yang sudah diterapkan ke Preview.
- Periksa dahulu bentuk data yang sudah ada: kasus terbuka, kasus selesai, konteks source yang berubah, dan relasi yang tidak dapat diresolve. Hindari menampilkan data pribadi pada log/commit.
- Sertakan strategi perbaikan kasus terbuka yang sudah menyimpan outlet/shift salah. Pertahankan ID, source, catatan, PJ, status, dan audit historis yang masih valid.
- Backfill atau proses rekonsiliasi harus dapat dilanjutkan/diulang tanpa duplikasi. Jangan menggunakan actor audit fiktif; pilih mekanisme audit yang sah dan terdokumentasi.
- Uji upgrade dari 13 migration lama dengan fixture bermasalah, serta instalasi dari nol dengan seluruh migration. Uji ulang keamanan dan hak execute RPC/helper. Jangan menghapus kasus untuk membuat tes lulus.
- Jika kontrak/model berubah, perbarui pemetaan live, demo, dan dokumentasi bersama-sama.

### A07 — Validasi durasi konsisten dengan izin

1. Hitung ulang kondisi `short_duration` di server berdasarkan catatan absensi dan izin disetujui saat aksi dilakukan.
2. Samakan semantik dengan `attendanceDurationReview()` yang berlaku: durasi aktual dan selisih dari 480 menit tetap ditampilkan; hanya selisih yang belum dijelaskan izin menjadi dasar kasus.
3. Gunakan snapshot jadwal pada catatan absensi, bukan jam outlet terbaru. Pertahankan penanganan lintas tengah malam dan Middle.
4. Izin pending/ditolak/dibatalkan tidak menjelaskan selisih. Usulan perubahan pending tidak mengganti keputusan izin lama.
5. Jangan mengurangkan izin dua kali. `temporary_exit` pada helper saat ini bersifat informasi, bukan pengurangan otomatis kedua dari durasi sesi; perubahan kebijakan itu bukan bagian tugas ini.
6. Bila seluruh selisih sudah dijelaskan izin, aksi dari tab usang harus ditolak atau mengembalikan hasil tidak-perlu-kasus yang jelas, tanpa membuat kasus/audit palsu.

### Skenario wajib R3

- [ ] Missing clock in → kasus diproses → kasir clock in → sumber teratasi → SPV tetap dapat mencatat hasil dan menyelesaikan.
- [ ] Sesi terbuka → kasus diproses → kasir clock out → jalur penyelesaian tetap tersedia.
- [ ] Kasus terbuka dipindah A/Pagi → B/Sore: tampil dan dapat diedit pada B, tanpa duplikat dan tanpa kehilangan PJ/catatan.
- [ ] Kasus selesai dibuka lagi setelah source berubah: konteks terbaru benar, audit lama utuh, reopen tidak ganda.
- [ ] Kasus lama yang sudah salah metadata diperbaiki melalui jalur upgrade yang dipilih.
- [ ] Source tidak lagi valid: tampil penjelasan dan tidak otomatis selesai/hilang.
- [ ] Absensi 07.00–14.00 dengan izin pulang 14.00 yang disetujui tidak membuka kasus selisih.
- [ ] Absensi yang sama tanpa izin tetap menghasilkan kasus; pulang sebelum batas izin menyisakan selisih yang benar.
- [ ] Izin datang terlambat/pulang awal, izin pending, serta sesi lintas tanggal menghasilkan keputusan frontend/server yang sama.
- [ ] Kasir, anon, dan akun nonaktif tidak dapat memakai RPC pengelolaan kasus atau membaca data HR orang lain.

**Selesai bila:** alur perubahan source → tindak lanjut → penyelesaian utuh di UI dan server, termasuk untuk data kasus yang sudah ada sebelum upgrade.

## 8. R4 — A05: notifikasi membuka minggu milik kasir

### Keputusan default

Tambahkan **tampilan mingguan baca-saja untuk kasir**, terpisah dari editor admin. Ini membuat tautan `?week=` yang sudah tersimpan pada notifikasi lama tetap berguna tanpa menulis ulang inbox.

### Langkah kerja

1. Pertahankan dukungan `?week=`, `?date=`, dan `?workDate=`. Validasi tanggal kalender dan normalisasi minggu ke Senin secara konsisten dalam WIB.
2. Ketika akun kasir membuka tautan minggu, tampilkan tujuh tanggal beserta penugasan dirinya: outlet penugasan, Pagi/Sore/Middle/Libur, belum ditugaskan, atau penugasan batal yang dijelaskan sesuai model.
3. Gunakan outlet dari penugasan, termasuk penempatan sementara. Jangan menggantinya dengan outlet utama terbaru karyawan.
4. Pertahankan tampilan harian dari tautan tanggal dan editor mingguan admin. Kasir tidak mendapat kontrol edit atau akses jadwal karyawan lain.
5. Pastikan halaman yang dibuka setelah klik notifikasi menunjukkan minggu/tanggal yang dimaksud, termasuk setelah reload dan navigasi SPA.
6. Pakai tampilan yang nyaman di ponsel, label status teks, fokus keyboard, serta tema kuning yang sudah ada.

### Kriteria selesai R4

- [ ] Batch Kamis/Jumat → notifikasi `?week=Senin` → kasir melihat Kamis/Jumat dengan shift yang benar.
- [ ] Notifikasi lama yang sudah memakai `?week=` tetap bekerja.
- [ ] Minggu lintas bulan/tahun, minggu kosong, Libur, pembatalan, dan outlet sementara ditampilkan benar.
- [ ] Akun kasir lain tidak dapat mengambil jadwal pengguna tersebut melalui API; pembatasan bukan sekadar menyembunyikan komponen.
- [ ] Editor admin serta tautan harian tetap bekerja tanpa regresi.

## 9. R5 — Regresi lintas fitur dan pembaruan bukti

### Urutan verifikasi

Jalankan tes terarah saat mengerjakan milestone. Jalankan suite lengkap setelah integrasi; ulangi jika ada perubahan source baru, kegagalan, atau masalah yang belum terjawab.

```powershell
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
npm.cmd run build
```

Tambahkan verifikasi browser yang benar-benar dijalankan pada environment yang sesuai:

- Suite demo: alur pengguna, UI konflik, kasus, notifikasi, navigasi SPA, dan viewport ponsel.
- Suite live-mode dengan backend tiruan: bentuk respons SDK, refresh dari source, konflik usang, respons hilang sesudah commit, dan HTTP 500 generik. Tes live-mock yang sekarang tersedia memerlukan `E2E_LIVE_SUPABASE_MOCK=1` dan server dengan konfigurasi publik tiruan; jalankan secara eksplisit, jangan menghitungnya lulus ketika skipped.
- Suite PWA pada build produksi lokal dengan `E2E_PWA=1`: service worker/shell offline dan pengecualian respons privat. Ini belum membuktikan resume iPhone.
- Bila `webServer` Playwright gagal mulai pada Windows, mulai server lokal secara eksplisit dan gunakan `E2E_BASE_URL`. Kegagalan proses/cache sebelum tes berjalan bukan alasan mengubah perilaku tes agar hijau.

### Matriks penutupan audit

| Temuan | Bukti minimal untuk penutupan lokal |
| --- | --- |
| A01 | Tes UI draft usang setelah update source + edit sel lain/reload, serta tes batch/version/idempotensi |
| A02 | Tes lifecycle yang menolak reuse kanal terminal + tes SDK terpasang + bukti kanal pengganti menerima update |
| A03 | Tes UI kasus tetap dapat diselesaikan sesudah sinyal hilang |
| A04 | Tes RPC authenticated, fixture upgrade data lama, dan filter/UI outlet baru |
| A05 | Tes klik notifikasi sebagai kasir dan penolakan akses jadwal akun lain |
| A06 | Tes melalui SDK/fetch berbentuk HTTP error asli, lalu rekonsiliasi UI dan key retry |
| A07 | Tes database dan frontend memakai fixture izin yang sama serta keputusan yang konsisten |

### Dokumentasi dan pemeriksaan ulang

- Perbarui panduan kasir/SPV, kontrak backend, kebijakan draft/retry, dan catatan operasi jika perilaku berubah.
- Pertahankan laporan audit sebagai bukti historis. Catat penutupan A01–A07 beserta commit dan hasil tes dalam dokumen ini atau laporan hasil baru.
- Koreksi status roadmap lama: jangan meninggalkan klaim “M0–M5 selesai sepenuhnya” bila verifikasi M4 masih terbuka.
- Periksa perubahan final terhadap audit, bukan hanya status tes. Pastikan tidak ada perbaikan yang memindahkan bug ke jalur demo/live lain.
- Pastikan CI pada branch yang didorong memeriksa source final. CI saat baseline memeriksa check, unit, database, legacy, dan build; ia belum menjalankan semua E2E khusus secara otomatis.

### Kriteria selesai R5

- [ ] A01–A07 memiliki reproduksi awal, perbaikan, dan bukti regresi yang relevan.
- [ ] Pemeriksaan tipe, unit, database, legacy, build, dan E2E yang diwajibkan lulus.
- [ ] Jumlah passed/skipped/failed dicatat bersama alasan skip; tidak ada klaim suite khusus lulus hanya karena tidak dijalankan.
- [ ] Dokumentasi sesuai source final dan hasil pemeriksaan ulang tidak meninggalkan temuan prioritas tinggi/sedang yang belum ditangani.

## 10. R6 — Rilis Preview, lalu buktikan alur hosted dan perangkat

### R6a — Terapkan versi yang sudah lolos ke Preview

1. Pastikan branch/remote serta project Supabase/Vercel cocok dengan environment Preview. Jika identitas target berbeda dari catatan, selesaikan perbedaan sebelum mutasi remote.
2. Verifikasi riwayat migration lokal/remote. Terapkan migration baru secara maju; jangan reset schema atau mengubah migration yang sudah tercatat.
3. Verifikasi metadata data kasus yang diperbaiki, grants/RLS, RPC, serta publikasi Realtime yang digunakan. Jalankan query pemeriksaan setelah perubahan.
4. Commit/push source, migration, tes, dan dokumentasi yang relevan pada branch Preview. Jangan menyertakan secrets, token sesi, atau dump data pribadi.
5. Pastikan CI dan deployment Preview **Ready** untuk source yang sama. Catat SHA, deployment ID, environment, dan alias yang terpasang.
6. Smoke test halaman login dan aset utama. Jika Preview dilindungi Vercel SSO, gunakan akses resmi seperti `vercel curl` atau header OIDC sesuai skill; jangan mematikan proteksi untuk membuat tes lolos.
7. Jika integrasi gagal, hentikan pengujian yang bergantung padanya, perbaiki dan verifikasi ulang. Untuk rollback, utamakan pemulihan kode yang kompatibel atau migration koreksi ke depan; jangan menghapus tabel/kasus baru secara spontan.

### R6b — Uji hosted yang menutup celah audit

Gunakan akun/data uji Preview dan catat baseline sebelum perubahan. Gunakan dua akun Admin HR jika tersedia; bila hanya satu akun dengan dua tab, laporkan batas tersebut.

- **Konflik jadwal:** tab A mempunyai draft, tab B menyimpan perubahan, tab A menerima update lalu mengedit sel lain/reload. Konflik harus tetap ada dan penugasan tab B tidak tertimpa.
- **Realtime terminal dan reconnect:** buktikan kanal pengganti menerima event setelah penutupan terminal terkontrol; uji putus-sambung jaringan browser sesungguhnya secara terpisah. Status kembali Terhubung dan data menyelaraskan tanpa reload.
- **Hasil simpan ambigu:** biarkan batch uji benar-benar commit lalu putus respons ke browser menggunakan harness/intersepsi test yang terkontrol. UI harus merekonsiliasi atau mempertahankan percobaan untuk retry key sama; pastikan tidak ada audit/notifikasi/batch ganda.
- **Kasus:** pindah outlet/shift, source teratasi, penanggung jawab/catatan, dan penyelesaian eksplisit tetap bekerja setelah refetch antar tab.
- **Kasir:** buka pemberitahuan perubahan hari non-Senin memakai akun kasir dan lihat minggu yang benar; data kasir lain tetap ditolak.
- **Izin:** izinkan pulang awal setelah sinyal durasi muncul, kemudian coba aksi dari tab yang belum refetch. Kasus yang sudah tidak relevan harus ditolak atau dijelaskan tanpa catatan palsu.

Untuk uji hosted, gunakan fixture khusus dan tanggal yang tidak mengganggu kegiatan pengguna. Bersihkan perubahan melalui jalur aplikasi/RPC yang sah: pulihkan nilai awal atau batalkan penugasan uji dan selesaikan kasus uji. Simpan audit sebagaimana aturan aplikasi; jangan menghapus jejak untuk membuat lingkungan tampak kosong. Verifikasi keadaan akhir di server dan kedua tab.

### R6c — iPhone/iPad dan PWA

- [ ] Buka aplikasi dari ikon Layar Utama, pertahankan sesi, lalu pindahkan aplikasi ke latar.
- [ ] Ubah jadwal dari sesi lain saat aplikasi berada di latar; buka kembali dan periksa refetch, kanal, serta data terbaru tanpa reload manual.
- [ ] Uji offline/online pada perangkat dan pemulihan setelah aplikasi dihentikan OS/dibuka kembali.
- [ ] Pastikan draft tidak hilang atau menimpa perubahan sesi lain setelah pemulihan tersebut.
- [ ] Pastikan notifikasi mingguan membuka minggu yang benar; opt-in dan logout push tetap mengikuti akun/perangkat.

Uji manual cuti yang sebelumnya ditunda tidak perlu diminta ulang pada setiap milestone. Selesaikan pekerjaan mandiri terlebih dahulu. Jika perangkat/login/tindakan manusia diperlukan, sampaikan kebutuhan yang spesifik sekali dan lanjutkan bagian yang independen. Jangan meminta kata sandi atau kode rahasia di chat.

### Kriteria selesai R6

- [x] R6a: source final dan migration terpasang hanya pada Preview; SHA/deployment/query verifikasi tercatat.
- [ ] R6b: skenario hosted di atas lulus, perubahan uji dipulihkan, dan batas jumlah akun/sesi dijelaskan.
- [ ] R6c: skenario perangkat lulus dengan bukti pengguna/perangkat yang jelas.
- [ ] Status akhir membedakan implementasi lokal, rilis Preview, verifikasi hosted, dan verifikasi perangkat.

Jika R6c atau skenario hosted belum dapat dijalankan, tandai **pending** dengan alasan dan langkah tersisa. R6 tetap terbuka; jangan menandai keseluruhan verifikasi selesai hanya karena deployment Ready atau unit test lulus.

## 11. Rekap progres yang harus diisi agent pelaksana

| Milestone | Status | Commit/hasil/bukti |
| --- | --- | --- |
| R0 | Selesai | Baseline audit A01–A07 direproduksi sebelum perubahan; branch `codex/preview`, source awal `77621e8`; perubahan lokal dan dua dokumen untracked dipertahankan. |
| R1 — A01 | Selesai lokal | Baseline draft per sel, review konflik yang menetap, migrasi draft v1, dan retry payload/key tetap; unit + E2E dua sesi demo lulus. Skenario commit-berhasil/respons-hilang pada hosted masih menunggu R6b. |
| R2 — A02/A06 | Selesai lokal | Kanal terminal diganti dengan instance baru; refetch tetap mandiri. Tes memakai adapter SDK Realtime 2.117.2 dan fetch Supabase JS 2.117.2 untuk HTTP 500; unit lulus. |
| R3 — A03/A04/A07 | Selesai lokal | Kasus terbuka tetap actionable; source context aktif diselaraskan dan diaudit, data lama diperbaiki dengan private before/after log, kasus selesai mempertahankan snapshot sampai reopen, dan validasi izin dihitung ulang server. PGlite upgrade/RPC lulus. Preview backfill menemukan 0 kasus lama yang perlu dikoreksi. |
| R4 — A05 | Selesai lokal | Route `?week=` dinormalisasi ke Senin; kasir melihat tujuh hari jadwal miliknya. E2E demo dan pemeriksaan privasi database lulus. |
| R5 | Selesai lokal | `check` 0 error/0 warning; unit 352/352; database + biometrik/push lulus; legacy reset refusal lulus; build lulus; E2E 19 passed, 2 skipped (dua tes membutuhkan konfigurasi Supabase hosted). `git diff --check` bersih. |
| R6a — Rilis Preview | Selesai | Commit `57907c9fc639b545a69dae07dd7753ce90404329` pada `codex/preview`; Vercel deployment `dpl_HxrXiohcTcmq3ZEV7vn1KpjpjpPV` berstatus READY, alias `hr-rajaklana-jkt-preview.vercel.app`, source Git `yoga12-rgb/hr-rajaklana-jkt`. Supabase Preview `lypsqrwjzrmuyqtdcegr` menjalankan migration `20261020060745_cashier_spv_audit_repairs` dan `20261020060913_cashier_spv_followup_repair_log_index`; query memverifikasi RPC, trigger, index, hak akses log private, publication Realtime, dan 0 backfill. GET `/login`, `/manifest.webmanifest`, dan bundle utama berhasil melalui `vercel curl` dengan proteksi tetap aktif. |
| R6b — Hosted | Pending | Belum dijalankan: memerlukan Admin HR Preview yang login untuk dua sesi, reconnect, hasil simpan ambigu, perubahan kasus/izin dan pemulihan fixture. Uji hosted Auth/Storage juga belum dijalankan. |
| R6c — Perangkat | Pending | Uji PWA iPhone/iPad dari ikon Layar Utama, latar/offline/online, dan notifikasi masih memerlukan interaksi perangkat. |

### Catatan hasil pelaksanaan

- Perbaikan A01–A07 sudah masuk source kerja, tetapi keseluruhan milestone belum selesai selama R6b/R6c pending.
- Supabase Security Advisor tidak menambah peringatan keamanan setelah migration; hitungan temuan yang tampak adalah baseline existing: 9 info RLS tanpa policy, 1 warning ekstensi `pg_net` di `public`, 33 warning fungsi `SECURITY DEFINER` authenticated yang merupakan pola RPC aplikasi, serta peringatan Auth MFA/leaked-password. Advisor performance kembali ke hitungan baseline 24 setelah indeks baru ditambahkan; temuan yang tersisa merupakan backlog existing.
- Backfill Preview mencatat 0 kasus lama yang perlu diperbaiki, jadi tidak ada data operasional Preview yang berubah. Migration tetap membuat log private untuk koreksi jika ada baris stale pada environment lain.
- E2E lokal memakai backend demo terisolasi. Dua tes live yang dilewati bukan bukti hosted lulus; keduanya perlu dijalankan sesudah source Preview siap.
- GitHub Actions run tidak dapat dibaca dari sesi ini (`gh` CLI tidak terpasang dan endpoint GitHub tidak tersedia melalui konektor web); padanan check/unit/database/legacy/build lulus lokal dan build Vercel deployment berstatus READY.

Setelah setiap milestone, catat perubahan, tes yang benar-benar dijalankan, temuan baru, commit terkait, dan pekerjaan tersisa. Hindari mengulang suite lengkap tanpa perubahan atau alasan baru.

## 12. Bentuk laporan akhir yang diharapkan

Agent berikutnya menyerahkan:

1. Ringkasan A01–A07: diperbaiki/belum, perubahan perilaku, serta bukti penutupannya.
2. Daftar migration dan penanganan data kasus/draft yang sudah ada.
3. Hasil check/unit/database/legacy/build/E2E dengan jumlah pass/skip/fail dan batas environment.
4. Commit/branch, status CI, deployment ID/alias Preview, serta bukti kesamaan source yang diuji dan dirilis.
5. Hasil pembersihan fixture hosted dan konfirmasi ruang lingkup environment yang disentuh.
6. Sisa verifikasi hosted/perangkat secara spesifik. Status pending tidak dilaporkan sebagai lulus.

## 13. Prompt siap pakai untuk agent berikutnya

```text
Eksekusi docs/goal-milestone-perbaikan-audit-tahap-a.md dengan teliti,
mengacu pada docs/audit-tahap-a-2026-10-20.md. Cakupan adalah R0–R6 untuk
menutup A01–A07; Tahap B tidak dikerjakan. Mulai dengan memeriksa source,
branch, perubahan lokal, dan instruksi repository yang berlaku.

Prioritaskan A01: baseline draft harus tetap sampai pengguna meninjau
konflik secara eksplisit. Tangani draft lama serta payload/key retry ambigu
tanpa kehilangan data atau menimpa perubahan sesi lain. Sesudah itu benahi
lifecycle SDK/status RPC, tindak lanjut beserta data existing, validasi izin,
dan tampilan jadwal mingguan milik kasir.

Buktikan perbaikan memakai regresi UI, SDK terpasang, database authenticated,
dan integrasi yang relevan. Migration harus baru dan bersifat koreksi ke
depan; pertahankan seluruh riwayat/audit. Rilis yang termasuk cakupan hanya
branch codex/preview dan Supabase Preview lypsqrwjzrmuyqtdcegr, setelah
memastikan identitas target aktual. Jangan mengubah Production atau main.

Perbarui progres dan bukti setelah setiap milestone. Setelah lokal lulus,
verifikasi CI/deployment Preview dan skenario hosted, kemudian uji perangkat
bila tersedia. Sisa uji manual yang benar-benar belum dijalankan tetap
pending; jangan menyatakan keseluruhan selesai hanya dari tes lokal atau
status Ready. Jangan meminta pengguna mengulang uji yang sudah terbukti,
dan jangan meminta kata sandi/kode rahasia ke chat.
```
