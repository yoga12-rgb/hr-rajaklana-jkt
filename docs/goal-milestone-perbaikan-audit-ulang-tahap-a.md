# Goal dan milestone perbaikan audit ulang Tahap A

Tanggal: **20 Oktober 2026 (WIB)**. Status: **Q0–Q6 selesai untuk implementasi dan verifikasi lokal; Q7a deploy dan smoke Preview selesai; Q7b hosted dan Q7c perangkat masih menunggu uji alur nyata**.

Dokumen ini menjadi acuan agent berikutnya untuk memperbaiki **enam temuan audit ulang**, bukan menambah fitur baru. Ia menggantikan klaim penutupan R1/R2/R3/R5 serta arahan “tinggal verifikasi R6” dalam [rencana sebelumnya](goal-milestone-perbaikan-audit-tahap-a.md). Laporan [audit pertama](audit-tahap-a-2026-10-20.md) tetap merupakan bukti historis A01–A07; temuan audit ulang di bawah memakai ID **U01–U06** agar tidak tertukar.

Source audit ulang: branch `codex/preview`, HEAD awal `ffd099522f8fc3b5145981288f8e90e48c43d37d`. Implementasi utama sebelumnya ada pada commit `57907c9fc639b545a69dae07dd7753ce90404329`. Dokumen ini sekarang mencatat eksekusi; nomor baris awal tetap penunjuk, bukan kontrak yang tidak boleh bergeser.

## 1. Goal dan batas pekerjaan

> Menutup keenam temuan audit ulang dengan perbaikan yang dapat dibuktikan, sehingga perubahan jadwal sah tidak gagal, hasil simpan ambigu dapat dipulihkan, konflik dapat ditinjau langsung, tindak lanjut mengikuti outlet yang benar, dan pergantian akun tidak menyisakan data akun sebelumnya.

Ukuran keberhasilan:

1. Jadwal dapat diubah ke **Libur** lewat RPC satu jadwal maupun batch meskipun ada tindak lanjut aktif; kasus dan riwayat tetap utuh.
2. Percobaan simpan ambigu dapat diulang setelah reload dengan **payload dan idempotency key asli**, termasuk jika state terbaru sudah berbeda dari baseline percobaan.
3. Perubahan source yang diterima melalui store/Realtime langsung menampilkan perbandingan konflik dan tindakan review tanpa edit tambahan atau reload.
4. Kasus `unassigned` terbuka mengikuti outlet penugasan aktif; perubahan outlet utama tidak mengalahkan penugasan sementara yang masih aktif.
5. Pergantian identitas Auth membersihkan state/channel akun lama segera, termasuk ketika pengambilan data akun baru gagal atau permintaan akun lama terlambat selesai.
6. Tes live-mock yang diwajibkan benar-benar berjalan dan lulus; skenario retry setelah reload ditambahkan terpisah dari rekonsiliasi langsung.
7. Instalasi baru, upgrade Preview terpasang, dan jalur upgrade historis yang berisiko mempunyai bukti yang dibedakan.
8. Status implementasi, pengujian lokal, Preview, hosted, dan perangkat ditulis sesuai bukti; tidak ada klaim selesai dari deployment Ready atau tes skipped.

Ruang lingkup eksekusi berikutnya:

- Source, migration koreksi, regresi, dokumentasi, dan rilis **Preview** setelah gerbang lokal lulus.
- Target yang diketahui: Supabase Preview `lypsqrwjzrmuyqtdcegr`, Vercel `hr-rajaklana-jkt`, alias `https://hr-rajaklana-jkt-preview.vercel.app`. Verifikasi identitas target sebelum mutasi remote; jangan mengandalkan project yang kebetulan tertaut di CLI.
- **Production dan branch `main` di luar cakupan.** Jangan reset database, menghapus kasus/riwayat/audit, mengganti akun pengguna, atau menambah layanan berbayar.
- Pertahankan delapan jam termasuk istirahat, WIB, Middle, GPS/selfie, cuti/izin, role/RLS, audit, notifikasi privat, SPA/PWA, dan tema kuning yang sudah ada.
- Pertahankan hasil R4 tentang tampilan minggu kasir; cukup verifikasi regresinya. Tahap B dan fitur baru kasir/SPV tidak dikerjakan.
- Q0–Q6 sudah dikerjakan dan gerbang lokal lulus. Q7a baru boleh ditutup setelah migration maju diterapkan hanya ke Supabase Preview, commit tersedia di branch `codex/preview`, serta deployment dan smoke check Preview cocok dengan source yang diuji. Q7b/Q7c tetap berstatus pending sampai alur hosted dan iPhone/PWA benar-benar diperiksa.

## 2. Temuan yang harus ditutup

| ID | Prioritas | Reproduksi dan dampak terkonfirmasi | Penunjuk source pada HEAD audit | Milestone |
| --- | --- | --- | --- | --- |
| U01 | P1 | Penugasan Pagi dengan kasus `missing_clockin` aktif diubah ke `off`; trigger menulis `off` ke `spv_followups.shift`, terkena CHECK, dan transaksi dibatalkan. Batch juga berisiko gagal. Backfill migration lama memiliki jalur serupa. | `supabase/migrations/20261020060745_cashier_spv_audit_repairs.sql:26,134,159–160`; constraint pada migration `20261019061522_cashier_spv_weekly_roster.sql` | Q1 |
| U02 | P2 | Commit berhasil, respons hilang, refresh gagal; setelah reload retry ditolak validasi baseline lokal sebelum RPC. Penolakan dianggap pasti lalu `pendingAttempt` dihapus. Draft tetap ada, tetapi payload/key percobaan kehilangan jalur pemulihannya. | `src/lib/state/app.ts:583`; `src/lib/components/CashierWeeklyPlanner.svelte:174` | Q3 |
| U03 | P2 | Draft Sore dari sel kosong menerima source Middle. UI menampilkan konflik dan memblokir Simpan, tetapi tidak menampilkan baris/pilihan review sampai sel lain diedit. | `src/lib/components/CashierWeeklyPlanner.svelte:99–104` | Q4 |
| U04 | P2 | Kasir utama outlet A mempunyai kasus `unassigned`; penugasan pertama dibuat di B. Kasus tetap menyimpan A sehingga tidak ditemukan lewat filter B. Trigger assignment hanya UPDATE dan tidak menyelaraskan kasus bertipe `roster`. | `supabase/migrations/20261020060745_cashier_spv_audit_repairs.sql:142–156,172–173`; `src/lib/components/CashierSpvPanel.svelte:15` | Q2 |
| U05 | P2 | Admin A sudah termuat; Auth berganti menjadi kasir B melalui `SIGNED_IN` tanpa `SIGNED_OUT`; fetch B gagal. State privat Admin A dan channel lama masih tertahan. Ini celah lama yang belum ditutup R2; audit tidak membuktikan bypass RLS. | `src/lib/state/app.ts:312,350` | Q5 |
| U06 | P3 | Live-mock E2E mencari `0 perubahan`, sementara UI menampilkan `0 perubahan draft`. Tes asli gagal saat diaktifkan; salinan dengan locator dikoreksi lulus, tetapi hanya membuktikan rekonsiliasi langsung. | `tests/live-cashier-roster-ambiguous.spec.ts:134` | Q6 |

Bukti audit ulang yang sudah ada: `npm run check` lulus 0 error/0 warning; reproduksi terarah U01–U05 dilakukan melalui database lokal, unit, compiler/store, dan/atau browser sesuai kasus. Constraint hosted Preview juga dikonfirmasi belum menerima `off`. Tes navigasi minggu kasir lulus. Seluruh suite unit/database/E2E **tidak** dijalankan ulang pada audit ulang; angka 352 unit dan 19 E2E pada rencana lama adalah riwayat pengujian sebelumnya.

## 3. Urutan dan kepemilikan milestone

| Milestone | Hasil | Dependensi | Gerbang selesai |
| --- | --- | --- | --- |
| Q0 | Baseline dan reproduksi keenam temuan | — | Source/target tercatat; regresi awal menangkap bug aktual |
| Q1 | Libur dan jalur migration aman | Q0 | RPC tunggal/batch serta tiga jalur instalasi/upgrade lulus |
| Q2 | Konteks kasus roster mengikuti source | Kontrak Q1 | INSERT/UPDATE/cancel/outlet utama benar, kasus historis utuh |
| Q3 | Retry ambigu bertahan setelah reload | Q0 | Replay payload/key asli sampai server; transaksi baru tetap melindungi baseline |
| Q4 | Review konflik langsung reaktif | Kontrak draft Q3 | Update source saja memunculkan dan memperbarui kontrol review |
| Q5 | Isolasi akun dan pekerjaan async | Q0; integrasi Q3 | Tidak ada state, channel, timer, atau hasil fetch akun lama yang masuk ke akun baru |
| Q6 | Tes wajib, integrasi, dan dokumentasi | Q1–Q5 | U01–U06 memiliki bukti penutupan dan suite wajib lulus |
| Q7a | Rilis Preview | Q6 | Source yang diuji terpasang; metadata/query/aset cocok |
| Q7b/Q7c | Hosted dan perangkat | Q7a | Alur hosted serta iPhone/PWA terbukti atau dilaporkan pending secara spesifik |

Urutan default: **Q0 → Q1 → Q2 → Q3 → Q4 → Q5 → Q6 → Q7**. Untuk paralel: paket backend Q1/Q2 dapat berjalan bersama paket planner Q3/Q4 dan paket sesi Q5 setelah kontrak disepakati. Tetapkan satu pemilik integrasi `src/lib/state/app.ts`, satu pemilik planner/draft, dan satu pemilik migration/harness; jangan menulis file bersama tanpa koordinasi. Q3 dan Q5 harus diintegrasikan sebelum tes pergantian akun dengan pending attempt.

## 4. Q0 — Baseline dan tes gagal yang relevan

1. Baca instruksi repository dan dokumen ini. Jika `.codegraph/` ada, gunakan CodeGraph sebelum menelusuri source; jika tidak ada, jangan membuat indeks sendiri.
2. Catat branch/HEAD, diff lokal, migration, versi SDK dari lockfile, serta konfigurasi lingkungan tanpa mencetak secrets. Pertahankan pekerjaan pengguna.
3. Baca source terkini dan rencana lama sebagai riwayat. Buka kembali status R1/R2/R3/R5; R4 tidak dianggap gagal hanya karena temuan lain masih terbuka.
4. Gunakan skill Supabase dan panduan Postgres untuk pekerjaan database/Auth/Realtime. Sebelum implementasi, periksa changelog/dokumentasi Supabase yang relevan dan CLI `--help`; jangan mengandalkan signature SDK atau flag yang diingat.
5. Buat fixture lokal terisolasi: Admin A, kasir B, minimal dua outlet, penugasan hari ini untuk `missing_clockin` bila diperlukan, minggu mendatang untuk planner, dan kasus `new`/`in_progress`/`completed`. Tanggal relatif mengikuti WIB agar tes tidak kedaluwarsa.
6. Tambahkan reproduksi ke harness repository yang dipelihara. Bukti audit sementara di folder ignored dapat membantu, tetapi tidak menggantikan tes regresi yang ikut commit.
7. Buktikan kegagalan awal U01–U06; catat langkah, expected/actual, environment, dan perintah. U05 harus memicu `SIGNED_IN` akun berbeda, bukan hanya logout lalu login.

**Selesai Q0:** keenam ID mempunyai reproduksi dan rencana penutupan; belum ada mutasi hosted yang diperlukan.

## 5. Q1 — U01: Libur tidak membatalkan transaksi yang sah

### Kontrak dan implementasi

1. Telusuri constraint `spv_followups.shift`, model/mapper demo-live, trigger `private.sync_spv_followup_source_context()`, backfill, dan RPC tindak lanjut.
2. Tentukan representasi ketika source assignment berubah ke Libur. Kasus aktif harus tetap dapat diberi catatan dan diselesaikan secara eksplisit; hilangnya sinyal tidak otomatis menutup kasus.
3. Pilih model yang konsisten: misalnya snapshot shift kejadian tetap tersedia dengan konteks source terbaru terpisah, atau dukungan `off` yang memang dimodelkan hingga types/UI/RPC. Nilai nullable hanya dipakai jika maknanya jelas. **Memperlebar CHECK saja tidak cukup** tanpa memeriksa seluruh konsumen dan semantik riwayat.
4. Pertahankan ID/case key/source, status aktif, PJ, catatan, jumlah reopen, dan audit. Kasus `completed` mempertahankan snapshot penyelesaiannya sampai reopen sah.
5. Buat migration koreksi baru melalui CLI. Jangan mengubah migration yang sudah diterapkan ke Preview. Sinkronisasi dan audit harus berada dalam transaksi source; rollback batch tidak meninggalkan audit/notifikasi sebagian.

### Tiga jalur migration yang wajib dibedakan

| Jalur | Fixture | Bukti yang diperlukan |
| --- | --- | --- |
| Instalasi kosong | Seluruh migration dari nol | Instalasi selesai; RPC/constraint/grants akhir benar |
| Upgrade terpasang | 15 migration sampai `20261020060913` + kasus aktif/selesai | Migration baru sukses, data lama ditangani, invariant/history terjaga |
| Upgrade historis | 13 migration sampai sebelum `20261020060745`; kasus aktif mengarah ke assignment yang sudah `off` | Jalur kompatibilitas teruji **sebelum** backfill lama yang bermasalah dijalankan |

**Perhatian upgrade historis:** migration baru yang urutannya setelah `20261020060745` tidak dapat menolong transaksi yang lebih dahulu gagal di backfill migration tersebut. Reproduksi kegagalannya dahulu. Sediakan prosedur/file preflight kompatibilitas yang eksplisit, idempoten, dibatasi pada versi schema yang tepat, dan dijalankan sebelum migration bermasalah pada database yang memang memerlukannya. Jelaskan perubahan sementara, audit/backup yang diperlukan, langkah akhir yang memulihkan invariant, serta cara verifikasinya. Jangan menghapus kasus, mengedit history seolah migration sudah berjalan, atau mengubah migration lama diam-diam. Prosedur ini diuji lokal; jangan menerapkannya ke Preview 15-migration bila tidak diperlukan. Jika belum diselesaikan, laporkan jalur historis sebagai pending dan jangan mengklaim kompatibilitas upgrade lengkap.

### Kriteria penerimaan Q1

- [ ] Authenticated HR mengubah Pagi/Sore/Middle menjadi Libur lewat `cashier_assignment_save` dengan kasus `new` maupun `in_progress`: sukses tanpa CHECK error, jadwal benar, kasus tetap actionable.
- [ ] Batch berisi perubahan Libur dan sel lain sukses atomik. Batch dengan satu konflik yang disengaja gagal atomik tanpa data/audit/notifikasi parsial.
- [ ] Kasus selesai tidak berubah snapshot otomatis. Reopen mengambil konteks sesuai kontrak tanpa menggandakan kasus.
- [ ] Backfill/preflight tidak menggandakan log pada pengulangan; actor audit bukan identitas fiktif.
- [ ] Ketiga jalur migration di atas diuji dan hasilnya dicatat terpisah.
- [ ] Anon, kasir, dan akun nonaktif tetap ditolak pada RPC pengelolaan HR; helper/log private tidak ikut terekspos.

## 6. Q2 — U04: sinkronisasi konteks kasus roster utuh

Source utama: migration koreksi Q1/Q2, `spv_followup_start`/`spv_followup_update`, `CashierSpvPanel.svelte`, `cashier-spv.ts`, `state/app.ts`, dan `supabase/tests/database.mjs`.

### Aturan konteks

- Untuk kasus `source_type='roster'`, `source_id IS NULL`, `issue_type='unassigned'`, identitas kasus tetap karyawan + tanggal. Munculnya assignment tidak membuat kasus baru atau menyelesaikan kasus secara otomatis.
- Penugasan aktif untuk karyawan/tanggal itu menjadi sumber outlet konteks, termasuk penempatan sementara. Bila tidak ada assignment aktif, gunakan outlet utama karyawan. Penanganan Libur mengikuti kontrak Q1.
- Perubahan outlet utama tidak memindahkan konteks dari outlet penugasan aktif. Pembatalan penugasan memicu resolve ulang ke fallback yang benar.
- Kasus terbuka mengikuti konteks terbaru; kasus selesai mempertahankan snapshot historis sampai reopen. `shift` kasus roster mengikuti model yang disepakati, tidak dipaksa ke nilai yang ditolak schema/RPC.

### Langkah dan kriteria penerimaan

1. Tangani assignment **INSERT, UPDATE, pembatalan/aktivasi ulang**, dan perubahan outlet utama; jangan hanya menambahkan INSERT tanpa menyelaraskan query kasus roster.
2. Jika jalur source mendukung perpindahan karyawan/tanggal, resolve pasangan lama dan baru agar kasus lama tidak tertinggal. Jangan memperluas kemampuan edit RPC hanya untuk memenuhi tes.
3. Gunakan resolver yang konsisten untuk runtime, reuse/reopen, dan backfill. Refetch/membuka halaman tidak membuat write tersembunyi.
4. Perbaiki metadata kasus terbuka yang sudah stale melalui migration/prosedur koreksi baru. Simpan before/after yang sah, ID, PJ, catatan, status, dan audit; pengulangan/no-op tidak menggandakan log.
5. Samakan live dan demo. Filter outlet harus bekerja setelah konteks benar; sekadar mengabaikan filter tidak menutup bug.

- [ ] Utama A → kasus unassigned aktif A → assignment pertama B: kasus yang sama langsung tampil/dapat ditangani melalui filter B.
- [ ] Assignment B → C, batal → fallback utama, aktif kembali → outlet assignment: konteks mengikuti setiap transaksi.
- [ ] Outlet utama A → C saat assignment B aktif: kasus tetap B. Setelah assignment dibatalkan, fallback menjadi C.
- [ ] Source berubah ke Libur atau sinyal sudah teratasi: kasus tetap bisa dicatat dan ditutup dengan alasan.
- [ ] Kasus selesai, reopen, metadata stale lama, dan no-op mempunyai audit/status yang benar tanpa duplikasi.
- [ ] RPC authenticated serta UI filter setelah refresh/Realtime diuji; hasil demo/live konsisten.

## 7. Q3 — U02: pulihkan percobaan ambigu tanpa kehilangan identitas transaksi

Source utama: `state/app.ts` (`saveCashierRosterBatch`), `CashierWeeklyPlanner.svelte`, `cashier-spv-drafts.ts`, `cashier-roster-save-error.ts`, `cashier-roster-reconcile.ts`, serta RPC `cashier_roster_batch_save`.

### Alur yang harus dihasilkan

1. Bedakan **transaksi baru** dengan **replay percobaan yang sudah pernah dikirim**. Validasi lokal transaksi baru tetap melindungi baseline dan role. Validasi lokal terhadap source terbaru tidak boleh menggagalkan replay hanya karena commit percobaan sendiri sudah mengubah source.
2. Simpan payload lengkap dan key sebelum pengiriman; pertahankan bentuk payload yang menentukan request hash, week, dan scope akun. Jangan mengganti baseline/payload/key replay dari state terbaru.
3. Biarkan server memeriksa otorisasi dan menyelesaikan lookup idempotensi untuk payload/key asli. Payload berbeda dengan key lama harus tetap ditolak. Jangan membuat endpoint tanpa otorisasi atau membuang optimistic concurrency server.
4. State hasil percobaan harus jelas: belum dikirim, hasil belum pasti, sukses terkonfirmasi, atau penolakan pasti terkonfirmasi. Error preflight lokal pada replay bukan bukti bahwa percobaan terdahulu tidak commit.
5. Bersihkan pending attempt hanya setelah bukti penuh: hasil RPC/replay sah atau rekonsiliasi seluruh batch yang memadai. Bedakan “operasi dahulu sukses” dari “jadwal saat ini sama”; server dapat berubah lagi setelah commit dan replay tidak boleh menimpa perubahan berikutnya.
6. Bila bukti belum lengkap atau refresh gagal, pertahankan percobaan asli dan pesan/tombol pemulihan. Edit draft baru tidak mengganti percobaan lama; selesaikan percobaan lama sebelum mengirim payload baru.
7. Setelah hasil pasti diperoleh, bersihkan hanya draft yang cocok dengan percobaan itu. Draft baru yang dibuat sambil menunggu tetap ada. Penolakan baru yang benar dapat kembali ke review tanpa menghapus draft secara diam-diam.

### Kriteria penerimaan Q3

- [ ] Commit sukses → respons terputus → refresh gagal → reload dengan data server terbaru → retry mencapai RPC dengan key/payload asli dan mengonfirmasi hasil; jumlah batch/audit/notifikasi tidak bertambah oleh replay dibanding efek commit pertama.
- [ ] Server belum commit → respons ambigu → reload/retry: payload/key sama menghasilkan satu commit, bukan transaksi pengganti.
- [ ] Commit awal sukses lalu SPV lain mengubah source lagi: replay mengonfirmasi hasil awal tanpa menimpa versi baru dan tanpa menyatakan versi baru sama dengan draft lama.
- [ ] Penolakan SQLSTATE pasti, key sama/payload berbeda, respons HTTP ambigu, refresh gagal, serta bukti parsial ditangani sesuai kontrak.
- [ ] Draft tambahan/reason/filter/minggu/reload tidak mengganti payload/key pending. Hanya draft percobaan yang cocok dibersihkan setelah sukses.
- [ ] Transaksi baru dari baseline usang tetap ditolak; R1/A01 tidak kembali rusak.
- [ ] Unit/state dan browser live-mock melewati persist → reload → retry. Tes rekonsiliasi langsung saja tidak cukup.

## 8. Q4 — U03: kontrol review mengikuti perubahan source

1. Jadikan dependensi store penugasan yang digunakan `reviewEntries` eksplisit pada reactive statement/derived computation sesuai Svelte yang terpasang. Pemanggilan helper yang membaca `$app` saja tidak cukup membuktikan dependensi compiler.
2. Perubahan source saja harus menghitung ulang daftar konflik dan nilai “Jadwal terbaru”. Baseline draft tetap versi awal hingga tindakan review eksplisit.
3. “Gunakan jadwal terbaru” membuang draft sel terpilih; “Terapkan kembali draft saya” memperbarui baseline hanya sel yang ditinjau. Konflik lain tetap ada.
4. Integrasikan dengan pending attempt Q3: review/edit tidak mengubah payload/key percobaan yang belum dipastikan.

Kriteria penerimaan:

- [ ] Draft Sore dari kosong → store menerima Middle: baris review, nilai draft/server, dan dua tindakan muncul langsung tanpa edit tambahan/reload.
- [ ] Perubahan source kedua memperbarui perbandingan yang sudah tampil. Uji shift, outlet, Libur, pembatalan, dan kosong → terisi.
- [ ] Dua sel konflik: meninjau satu sel tidak me-rebase atau menyembunyikan konflik sel lain.
- [ ] Edit sel lain, alasan, navigasi minggu, dan reload mempertahankan baseline serta konflik yang belum ditinjau.
- [ ] Tes browser memicu update store/source sebagai kejadian mandiri; jangan memanggil handler edit agar komputasi kebetulan diperbarui.

## 9. Q5 — U05: isolasi identitas Auth sebelum fetch baru

1. Tangani perubahan `session.user.id`, termasuk `SIGNED_IN` akun baru tanpa `SIGNED_OUT`. Jangan mengandalkan logout sebagai satu-satunya invalidasi.
2. Begitu identitas berganti/null, naikkan revision/generation dan kosongkan state privat akun lama, role, data turunannya, serta status UI yang terkait. UI akun B tidak boleh masih merender dataset Admin A saat loading/error.
3. Lepaskan channel lama, batalkan timer retry/refetch lama, dan beri penjaga generation pada callback, queue, dan hasil fetch/RPC yang sudah berjalan. Hasil terlambat akun A tidak boleh mengisi state B.
4. Muat akun baru secara mandiri. Kegagalan fetch B mempertahankan state kosong/error akun B, bukan fallback dataset A. Refresh token untuk identitas yang sama tetap berfungsi tanpa kanal ganda atau pembersihan yang tidak perlu.
5. Pertahankan recovery draft/pending transaction **per akun**. Jangan menghapus seluruh penyimpanan lokal untuk menutup kebocoran UI; akun B tidak boleh melihat/mengirim ulang percobaan A, sementara A dapat melanjutkan pemulihan ketika login kembali.
6. Periksa lifecycle auth listener agar tidak terpasang ganda dan callback Auth tidak mengalami deadlock akibat operasi Auth async di dalam listener. Gunakan perilaku SDK terpasang, termasuk alur lintas tab.

Kriteria penerimaan:

- [ ] Admin A termuat → `SIGNED_IN` kasir B tanpa sign-out → semua fetch B gagal: data/role/header/channel A segera hilang.
- [ ] Fetch A yang tertahan selesai setelah pergantian akun; state B tidak berubah ke A.
- [ ] Callback channel A, timer retry, atau refresh terjadwal A tidak membuat channel/state lama aktif lagi.
- [ ] `SIGNED_OUT`, session null, login ulang A, token refresh user sama, dan event lintas tab/setSession diuji.
- [ ] Pending attempt A tetap tersimpan dalam scope A, tidak terlihat/terkirim oleh B; login ulang A dapat melanjutkan Q3.
- [ ] RLS/RPC tetap membatasi akun B pada haknya; perbaikan client bukan pengganti otorisasi server.

## 10. Q6 — U06, regresi integrasi, dan koreksi dokumentasi

### Perbaiki tes yang usang

- Perbarui locator pada `tests/live-cashier-roster-ambiguous.spec.ts` terhadap kontrak UI saat ini; gunakan accessible locator/stable assertion yang menjelaskan perilaku pengguna.
- Tetap periksa baris assignment yang tersimpan, status draft/pending, payload/key, dan jumlah request/efek yang relevan. Jangan menghapus assertion, menambah skip, atau hanya menaikkan timeout agar tes lulus.
- Tambahkan skenario reload/replay Q3; tes lama hanya mencakup commit lalu rekonsiliasi langsung.

### Perintah dan environment

Jalankan tes terarah saat mengerjakan milestone. Setelah integrasi source final, jalankan:

```powershell
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Suite demo harus memakai server demo terisolasi sesuai konfigurasi repository. Jangan menjalankannya pada Preview hosted atau server yang memakai akun/data operasional.

Live-mock harus dijalankan **secara eksplisit**, memakai dua terminal agar environment tidak tercampur. Contoh pada port kosong 5183:

```powershell
# Terminal A: server khusus mock, hanya nilai publik tiruan.
$env:PUBLIC_APP_ENV = 'preview'
$env:PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54329'
$env:PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_isolated_audit_mock'
npm.cmd run dev -- --port 5183 --strictPort
```

```powershell
# Terminal B: test memakai server Terminal A.
$env:E2E_LIVE_SUPABASE_MOCK = '1'
$env:E2E_BASE_URL = 'http://127.0.0.1:5183'
npm.cmd run test:e2e -- tests/live-cashier-roster-ambiguous.spec.ts --reporter=line
```

Sesuaikan pilihan file bila regresi baru dipisah; seluruh skenario wajib tetap dijalankan. Hentikan server milik pengujian sendiri setelah selesai dan tutup terminal khusus/bersihkan variabelnya. Tes ini mengintersepsi backend tiruan melalui browser, tidak memerlukan server Supabase nyata di port 54329. Jangan memakai URL/key Production sebagai penggantinya. Gunakan `E2E_BASE_URL` ketika Playwright tidak dapat memulai webServer di Windows; perbaiki kendala proses/browser tanpa melemahkan assertion.

Jalankan tes PWA dengan `E2E_PWA=1` pada build produksi lokal menurut harness yang ada, secara terpisah dari live-mock. Build lokal/offline tidak membuktikan perilaku iPhone.

### Gerbang integrasi

- [ ] Q1–Q5 lulus melalui unit/state, UI, dan database/RPC sesuai jenis bug, bukan hanya helper yang meniru implementasi.
- [ ] Pengujian baru gagal pada baseline yang bermasalah dan lulus pada source perbaikan, atau ada reproduksi awal setara yang terdokumentasi.
- [ ] Suite wajib di atas, live-mock, dan PWA tercatat dengan pass/fail/skip. Tes yang skipped belum menjadi bukti lulus.
- [ ] Audit ulang diff final tidak menemukan penurunan perlindungan baseline, idempotensi, auth/RLS, atomisitas, maupun riwayat kasus.
- [ ] R4, penanganan izin durasi, kasus yang sinyalnya hilang, Middle/lintas tanggal, notifikasi privat, dan logout push tetap lolos regresi relevan.
- [ ] Panduan `docs/cashier-spv.md`, kontrak operasi/migration, kebijakan draft/retry, dan status rencana lama diperbarui sesuai perubahan.
- [ ] R1/R2/R3/R5 baru ditutup lagi setelah U01–U06 terbukti; hasil audit pertama dan hasil uji lama tetap ditandai sebagai riwayat.

## 11. Q7 — Preview dan verifikasi yang masih tertunda

### Q7a — Rilis setelah Q6

1. Periksa branch `codex/preview`, remote, identitas Supabase/Vercel, diff, dan migration history aktual. Audit ulang sebelumnya mengonfirmasi 15 migration di Preview; angka ini bukan alasan melewati pemeriksaan baru.
2. Terapkan migration baru secara maju hanya ke Preview. Jalur preflight historis Q1 tidak dijalankan pada schema terpasang yang tidak memerlukannya.
3. Verifikasi constraint/resolver/trigger, kasus yang perlu backfill, grants/RLS/helper private, dan audit before/after. Periksa advisor serta bandingkan dengan baseline; jangan mengklaim semua peringatan existing baru timbul karena perubahan ini.
4. Commit/push kode, migration, tes, dan dokumentasi ke branch Preview; jangan sertakan token, session, data pribadi, screenshot sensitif, atau `.env` rahasia.
5. Catat SHA, hasil CI yang benar-benar dapat diperiksa, deployment ID/status/alias, dan kesamaan source yang diuji dengan yang dirilis. Ready hanya menutup tahap deploy.
6. Smoke test login/aset/manifest dan route terdampak. Gunakan akses resmi jika Vercel dilindungi; jangan mematikan proteksi.

### Q7b — Bukti hosted

Gunakan fixture Preview khusus, catat kondisi awal, lalu uji:

- Jadwal → kasus aktif → Libur melalui satu jadwal dan batch; kasus dapat ditutup, riwayat tetap ada.
- Unassigned A → assignment B → pindah/batal/outlet utama berubah; filter dua sesi mengikuti konteks yang benar.
- Dua sesi mempunyai perubahan jadwal: kontrol review muncul tanpa edit tambahan dan keputusan hanya berlaku untuk sel yang ditinjau.
- Commit batch nyata lalu putus respons secara terkontrol, gagalkan refresh, reload, retry key asli; periksa tidak ada batch/audit/notifikasi efek awal ganda.
- Akun A → B, kegagalan fetch terkontrol, callback/fetch A terlambat; tidak ada data A tersisa pada B. Jangan menyimpan kredensial atau token dalam bukti.
- Reconnect, tautan minggu kasir, dan izin yang menjelaskan selisih durasi tetap benar, mengikuti sisa acceptance R6b lama.

Pulihkan fixture melalui aplikasi/RPC yang sah; simpan audit sesuai kebijakan. Jangan menghapus jejak untuk membuat lingkungan tampak kosong. Laporkan bila hanya satu akun dengan dua tab yang tersedia—itu tidak menggantikan uji pergantian dua identitas U05. Jika login/interaksi manusia diperlukan, selesaikan bagian mandiri dahulu lalu minta satu tindakan spesifik tanpa meminta password/kode di chat.

### Q7c — iPhone/iPad dan PWA

- [ ] Buka dari ikon Layar Utama; background/resume menerima perubahan source dan menampilkan review tanpa reload manual.
- [ ] Offline/online dan penghentian aplikasi oleh OS tidak menghilangkan draft atau mengganti key pending attempt.
- [ ] Pergantian akun tidak memperlihatkan state akun lama; transaksi tertunda tetap terisolasi.
- [ ] Notifikasi membuka minggu yang benar dan langganan push mengikuti akun/perangkat.

Q7b/Q7c meneruskan pekerjaan R6b/R6c lama yang masih pending. Bila perangkat/akses belum tersedia, tulis langkah tersisa dan alasan secara spesifik. Boleh melaporkan “implementasi lokal selesai” atau “Preview terpasang” sesuai bukti; **keseluruhan verifikasi belum selesai** sampai acceptance hosted/perangkat yang dipersyaratkan ditutup.

## 12. Catatan progres dan hasil akhir

Status berikut mencatat implementasi dan rilis sampai **20 Oktober 2026 WIB**. Migration koreksi yang diuji dan sudah tercatat di Preview adalah `20261020092014_cashier_followup_context_consistency.sql`; SQL file lokal disamakan nama versinya tanpa mengedit isi SQL yang sudah diterapkan.

| Milestone | Status | Bukti/commit/perintah/hasil/sisa pekerjaan |
| --- | --- | --- |
| Q0 | Selesai | Baseline audit `codex/preview` / `ffd0995`; target Preview diverifikasi sebelumnya sebagai `lypsqrwjzrmuyqtdcegr` dengan 15 migration. `.codegraph/` tidak ada. Reproduksi awal U01–U06 merujuk bukti audit ulang §2; tidak ada reset atau mutasi remote pada Q0–Q6. |
| Q1 — U01 | Selesai lokal + migration Preview | Migration baru `20261020092014_cashier_followup_context_consistency.sql`; migration lama yang terpasang tidak diubah. `npm run test:database` lulus dari instalasi kosong (16 migration), kasus aktif/selesai, satuan/batch, atomisitas, idempotensi, audit, dan RLS. `node supabase/tests/followup-upgrade-compatibility.mjs` membedakan upgrade Preview 15→16 dengan kasus aktif/selesai dari jalur historis 13→16. Kegagalan historis pada migration 14 direproduksi dahulu; `supabase/deployment/preflight-followup-off-compatibility.sql` dibatasi versi, lulus dua kali, mempertahankan kasus, lalu migration 14–16 sukses. Preview `lypsqrwjzrmuyqtdcegr` kini mencatat migration ke-16; query memverifikasi CHECK `off`, trigger assignment INSERT/UPDATE, trigger outlet karyawan, dan helper privat tanpa EXECUTE untuk anon/authenticated. Repair-log row = 0; tidak ada kasus operasional yang perlu diubah. |
| Q2 — U04 | Selesai lokal | Database regression membuktikan kasus roster terbuka mengikuti assignment aktif B, tetap B ketika outlet utama berubah, resolve ulang saat pindah/batal/reactivate, dan kembali ke outlet utama setelah pembatalan. ID, status, pemilik, dan catatan tetap; repair metadata menyimpan bukti before/after privat. Kasus selesai mempertahankan snapshot. |
| Q3 — U02 | Selesai lokal | Draft serialisasi menyimpan payload/key asli dalam scope akun+minggu; live-mock lulus commit+respons hilang+refresh gagal+reload+replay, percobaan belum commit lalu retry, serta perubahan source oleh SPV lain sebelum replay. Payload/key retry identik; server mock hanya meng-commit sekali dan hasil source terbaru tidak tertimpa. Tes database juga tetap menolak baseline usang dan key dengan payload berbeda. |
| Q4 — U03 | Selesai lokal | Live-mock memicu refresh source tanpa mengedit sel. Dua konflik tampil langsung; perubahan lanjutan ke Libur dan pembatalan memperbarui perbandingan. Review satu sel mempertahankan konflik kedua; kedua tindakan review teruji. |
| Q5 — U05 | Selesai lokal untuk reproduksi audit; hosted belum diuji | Unit `realtime-recovery.test.ts`: `SIGNED_IN` akun B tanpa `SIGNED_OUT`, seluruh pembacaan B gagal, fetch A terlambat selesai, dan callback channel lama diabaikan setelah state/channel lama dibersihkan. Varian session null/sign-out, login ulang akun A, dan token refresh identitas sama juga lulus. `cashier-spv-drafts.test.ts` membuktikan akun B tidak bisa membaca percobaan A, sementara key A tetap dapat dipulihkan. RLS/RPC tetap diverifikasi oleh tes database. Uji dua identitas hosted/lintas-tab fisik masih pending pada Q7b. |
| Q6 — U06/integrasi | Selesai lokal | `npm run check`: 0 error/0 warning. `npm test -- --maxWorkers=1`: 25 file, 354 tes lulus. `npm run test:database`: instalasi kosong dan semua skenario database/biometric/push lulus; `npm run test:database:legacy`: seluruh tes refusal/rollback lulus tanpa hosted DDL. `npm run build`: lulus. `npm run test:e2e`: 19 lulus; 5 default skip adalah 4 live-mock dan 1 PWA, seluruhnya dijalankan terpisah dan lulus (live-mock 4/4; PWA build produksi lokal 1/1). `git diff --check` lulus. Awalnya E2E memakai server Vite lama; setelah proses lama teridentifikasi dan dihentikan, suite dijalankan ulang terhadap server demo bersih dan lulus. |
| Q7a — Preview | Selesai: migration, deploy, smoke | Supabase project `hr-rajaklana-preview` (`lypsqrwjzrmuyqtdcegr`, ap-southeast-2) diverifikasi ulang; sebelumnya 15 migration dan kini 16, versi terakhir `20261020092014`. Vercel project `hr-rajaklana-jkt` (`prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`), owner HR Rajaklana, repo `yoga12-rgb/hr-rajaklana-jkt`, serta branch `codex/preview` diverifikasi. Migration diterapkan maju hanya ke Preview. Commit implementasi `dc7e2066b032467de3a12b35d6f4fac390a0a5cb` didorong ke `origin/codex/preview`; deployment Preview `dpl_tWEnjTfYe1GG5TZz1Z1VS3ZfAtNy` berstatus Ready, alias `https://hr-rajaklana-jkt-preview.vercel.app`. Smoke terlindungi Vercel dengan token sementara lokal: `/login` HTTP 200 dan terhidrasi, judul `Masuk · Rajaklana HR`, label Preview tampil; 15 aset JS ditemukan dan bundle menunjuk ke `lypsqrwjzrmuyqtdcegr.supabase.co`; manifest dan service worker masing-masing HTTP 200; 0 page error. Ini membuktikan source dan aset Preview termuat, bukan keberhasilan login atau alur bisnis hosted. Advisor snapshot setelah migration: 9 info RLS tanpa policy, peringatan `pg_net` publik, 33 fungsi `SECURITY DEFINER` yang terdeteksi dapat dipanggil authenticated, peringatan perlindungan kata sandi bocor dan opsi MFA; info performa 24 FK tanpa indeks dan 14 indeks belum terpakai. Tidak ada snapshot advisor sebelum migration, jadi temuan tersebut tidak dapat diatribusikan ke perubahan ini. Migration tidak menambah fungsi/tabel/FK/index publik baru. |
| Q7b — Hosted | Pending: perlu akun uji yang dapat dipakai | Smoke hanya mengonfirmasi shell login/aset. Belum menjalankan login aplikasi, fixture, RPC/replay, pergantian dua akun, filter, atau pemulihan kasus pada Preview setelah patch. Lanjutkan dengan dua akun SPV/kasir uji dan data uji yang disetujui; jangan memakai atau menghapus data operasional. Jangan kirim kata sandi melalui chat. |
| Q7c — Perangkat | Pending | Belum menguji iPhone/iPad, ikon Layar Utama, offline/resume, kamera/GPS, atau push untuk build ini. Tes PWA 1/1 hanya membuktikan build produksi lokal pada browser desktop. |

Rilis kode Q7a telah didorong dan diverifikasi. Catatan ini sendiri merupakan pembaruan dokumentasi setelah rilis; perubahan dokumentasi dapat menghasilkan deployment Preview otomatis baru. Catat SHA/deployment dokumentasi baru jika dibutuhkan untuk audit rilis. Jangan mengubah status Q7b/Q7c berdasarkan deployment Ready atau tes yang dilewati.

Laporan akhir agent harus memuat:

1. Status U01–U06 beserta bukti reproduksi awal dan regresi penutupannya.
2. Keputusan model Libur/konteks kasus, migration baru, preflight historis, serta hasil setiap jalur upgrade.
3. Kontrak replay, kapan pending attempt boleh dibersihkan, dan bagaimana scope akun dipertahankan.
4. Hasil tes lokal/live-mock/PWA/hosted/perangkat yang dipisahkan, termasuk skip/fail dan alasan.
5. Branch/SHA, CI, deployment ID/alias Preview, query verifikasi, pemulihan fixture, serta lingkungan yang disentuh.
6. Pekerjaan tersisa; jangan menandai milestone yang belum terbukti sebagai selesai.

## 13. Prompt siap pakai untuk agent pelaksana

```text
Kerjakan docs/goal-milestone-perbaikan-audit-ulang-tahap-a.md dengan teliti.
Dokumen ini adalah acuan terbaru; rencana sebelumnya masih memuat hasil uji
historis yang belum menutup enam temuan audit ulang U01–U06.

Mulai Q0, lalu Q1/Q2 untuk Libur dan konteks kasus, Q3/Q4 untuk replay serta
review konflik, Q5 untuk isolasi akun, Q6 untuk regresi, dan Q7 untuk Preview.
Pertahankan baseline/version checks transaksi baru, payload/key asli replay,
otorisasi/RLS, riwayat kasus, dan isolasi recovery draft per akun.

Jangan mengubah migration yang sudah diterapkan. Bedakan upgrade Preview
15-migration dari upgrade historis yang dapat gagal sebelum migration baru
berjalan; siapkan dan uji preflight yang diperlukan secara eksplisit.

Branch sasaran codex/preview. Supabase Preview yang diketahui
lypsqrwjzrmuyqtdcegr; verifikasi identitas aktual sebelum tindakan remote.
Production dan main di luar cakupan. Jangan reset atau menghapus audit/data
operasional untuk membuat tes lulus.

Tambahkan tes reproduksi, jalankan live-mock secara eksplisit termasuk
persist/reload/retry, lalu suite integrasi yang diwajibkan. Catat bukti dan
status setiap milestone. Selesaikan pekerjaan mandiri sebelum meminta
interaksi login/perangkat yang memang diperlukan; jangan meminta secrets.
Laporkan implementasi lokal, deployment Preview, hosted, dan iPhone/PWA
secara terpisah. Tes skipped atau deployment Ready bukan bukti alur lulus.
```
