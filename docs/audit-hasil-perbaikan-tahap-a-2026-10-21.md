# Audit hasil perbaikan Tahap A — 21 Oktober 2026

## Lingkup dan kesimpulan

Audit terhadap branch `codex/preview`, HEAD `c2e2023835778aa7b6bc71d592f74ddebbfc2262`.
Commit implementasi yang diperiksa: `dc7e2066b032467de3a12b35d6f4fac390a0a5cb`, dibandingkan dengan baseline `ffd099522f8fc3b5145981288f8e90e48c43d37d`.
Acuan: [goal-milestone-perbaikan-audit-ulang-tahap-a.md](D:/aplikasi-web/rajaklana-hr/docs/goal-milestone-perbaikan-audit-ulang-tahap-a.md).

Empat masalah berhasil direproduksi melalui source/helper aktual dan browser mock lokal. Satu risiko konkurensi SQL tambahan ditemukan melalui telaah transaksi, tetapi belum direproduksi dengan dua koneksi PostgreSQL. Karena itu Q3, Q5, dan kesetaraan demo pada Q2 belum dapat dinyatakan tuntas meskipun suite yang sudah tersedia lulus.

Audit tidak mengubah kode aplikasi, migration, atau deployment. Tidak ada data operasional/remote yang dimutasi. Laporan ini merupakan satu-satunya berkas baru. `.codegraph/` tidak tersedia; tidak dibuat indeks baru.

## Temuan yang direproduksi

### V01 — P2: error autentikasi pada replay menghapus key percobaan asli

Lokasi: [CashierWeeklyPlanner.svelte:180](D:/aplikasi-web/rajaklana-hr/src/lib/components/CashierWeeklyPlanner.svelte:180). Terkait U02 / Q3.

Cabang penanganan error mengosongkan `pendingAttempt` untuk seluruh error yang dianggap pasti. Ini tidak membedakan penolakan transaksi pertama dari replay yang ditolak sebelum server mencari hasil idempotensi. HTTP 401 hanya membuktikan retry sekarang ditolak; hasil commit percobaan semula masih mungkin sukses.

Reproduksi browser menggunakan fixture live-mock aktual:

1. Save awal melakukan commit; respons diputus dan pembacaan rekonsiliasi digagalkan.
2. Reload; key/payload pending berhasil dipulihkan.
3. Intersep hanya RPC replay dengan HTTP 401, body `{ "code": "PGRST301", "message": "JWT expired" }`.
4. Pending dan tombol replay menghilang; data commit pertama masih tersimpan.

Hasil terukur:

```json
{"beforeHasPending":true,"afterHasPending":false,"originalCommitted":1,"storedAssignments":1,"pendingControlCount":0}
```

Perbaikan yang diperlukan: pertahankan identitas percobaan lama ketika autentikasi/preflight replay ditolak sebelum lookup idempotensi. Tetap jalankan otorisasi; hasil pasti dari retry tidak otomatis menjadi bukti hasil transaksi pertama. Tambahkan regresi HTTP 401/penolakan otorisasi → autentikasi pulih → replay dengan key dan payload semula.

### V02 — P2: hasil `getSession()` lama dapat mengeluarkan akun baru

Lokasi: [app.ts:262](D:/aplikasi-web/rajaklana-hr/src/lib/state/app.ts:262), adopsi identitas pada baris 264–268, keputusan sign-out pada baris 275. Terkait U05 / Q5.

`refreshNow()` menyimpan revision sebelum `await getSession()`, tetapi tidak memeriksa revision tersebut segera setelah await. Jika hasil A terlambat selesai setelah event `SIGNED_IN` B, blok adopsi identitas menjadikan A berlaku kembali dan memperbarui revision. Pembacaan tabel berikutnya memakai sesi B, sehingga karyawan A tidak ditemukan dan cabang akun tidak aktif memanggil `signOut()` terhadap B.

Reproduksi terhadap `app.ts` aktual melalui harness Node/TypeScript tanpa berkas:

1. Muat Admin A.
2. Mulai refresh; tahan hasil `getSession()` yang sudah menangkap A.
3. Ganti sesi menjadi kasir B dan kirim `SIGNED_IN` B; state A dibersihkan.
4. Lepaskan hasil sesi A; pembacaan karyawan berikutnya mengembalikan data B yang sah.
5. Akun B justru dikeluarkan.

```json
{"signouts":1,"sessionAfter":null,"loadedUser":null,"error":null}
```

Perbaikan yang diperlukan: buang hasil pembacaan sesi bila revision permintaan sudah berubah, sebelum mengadopsi identitas atau mengubah revision. Tambahkan regresi yang menahan **getSession**, lalu membuktikan B tetap login dan berhasil termuat. Tes saat ini menahan pembacaan karyawan setelah getSession serta membuat fetch B gagal; jalur itu belum menutup kasus ini.

Ini merupakan sisa celah Q5, bukan klaim bahwa seluruh perilaku tersebut baru diperkenalkan oleh commit terakhir.

### V03 — P2: konteks kasus demo tidak mengikuti perpindahan assignment

Lokasi jalur satu jadwal: [app.ts:571](D:/aplikasi-web/rajaklana-hr/src/lib/state/app.ts:571). Jalur batch: [app.ts:604](D:/aplikasi-web/rajaklana-hr/src/lib/state/app.ts:604). Helper: [cashier-workflows.ts:36](D:/aplikasi-web/rajaklana-hr/src/lib/cashier-workflows.ts:36). Terkait U04 / Q2.

Migration memperbaiki jalur live, tetapi jalur demo hanya memperbarui `cashierAssignments`; `spvFollowups` tidak diselaraskan. Kasus unassigned yang sudah terbuka tetap berada pada outlet A setelah assignment pertama dibuat di B. Sinyal unassigned menghilang, sedangkan daftar kasus tersimpan tetap difilter memakai outlet lama ([CashierSpvPanel.svelte:15](D:/aplikasi-web/rajaklana-hr/src/lib/components/CashierSpvPanel.svelte:15)).

Reproduksi helper aktual pada state demo terisolasi:

1. Kasir utama A, belum memiliki assignment/absensi/cuti pada tanggal uji.
2. Buat kasus `unassigned` aktif A.
3. Simpan assignment kasir tersebut ke B melalui helper yang dipakai action demo.

```json
{"before":"outlet-a","assignmentOutlet":"outlet-b","caseOutlet":"outlet-a","noLongerSignal":true,"visibleThroughOutletB":0}
```

Perbaikan yang diperlukan: resolver/transisi konteks demo yang setara dengan live untuk simpan tunggal/batch, pembatalan/aktivasi kembali, dan perubahan outlet utama; tetap pertahankan riwayat kasus selesai. Tambahkan pengujian action/UI lintas outlet, bukan hanya kasus yang sinyalnya sudah hilang pada outlet sama.

### V04 — P3: RPC dikirim walaupun key/payload pending gagal disimpan

Lokasi: [CashierWeeklyPlanner.svelte:169](D:/aplikasi-web/rajaklana-hr/src/lib/components/CashierWeeklyPlanner.svelte:169); kegagalan penyimpanan ditangkap pada [baris 28](D:/aplikasi-web/rajaklana-hr/src/lib/components/CashierWeeklyPlanner.svelte:28). Terkait kontrak persist-before-send Q3.

`persistDraft()` hanya menampilkan peringatan saat `localStorage.setItem()` gagal; action save tetap mengirim RPC. Bila respons serta refresh hilang dan aplikasi di-reload, percobaan tidak mempunyai key yang dapat dipulihkan.

Reproduksi browser:

1. Draft dan alasan tersimpan normal.
2. Sebelum Save, injeksikan `QuotaExceededError` khusus pada key storage roster.
3. Save commit; putus respons dan gagalkan refresh; reload.

```json
{"originalCommitted":1,"storedPending":false,"pendingControlAfterReload":0,"reviewCountAfterReload":1}
```

Peringatan penyimpanan memang terlihat, sehingga prioritas lebih rendah dari V01. Namun key asli tetap hilang setelah reload. Perbaikan memerlukan penghentian pengiriman baru bila persist attempt gagal, atau mekanisme recovery eksplisit yang setara. Tambahkan regresi storage penuh/ditolak untuk attempt baru dan proses pemulihannya.

## Risiko SQL yang belum direproduksi dengan dua koneksi

### V05 — P2 potensial: snapshot kasus yang baru selesai dapat ditulis ulang oleh trigger konteks

Lokasi: [migration koreksi:37](D:/aplikasi-web/rajaklana-hr/supabase/migrations/20261020092014_cashier_followup_context_consistency.sql:37). Pola serupa terdapat dalam trigger generik pada baris 97–108. Terkait kontrak riwayat Q1/Q2.

CTE `targets` memilih `status <> 'completed'`, tetapi UPDATE akhirnya hanya memakai `f.id=t.id`. Sementara itu [spv_followup_update:284](D:/aplikasi-web/rajaklana-hr/supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql:284) mengunci kasus tanpa mutex karyawan yang dipakai RPC assignment.

Urutan yang perlu diuji:

1. Transaksi penyelesaian mengunci kasus dan menulis status completed, tetapi belum commit.
2. Transaksi assignment memilih snapshot kasus lama yang masih terbuka, lalu UPDATE trigger menunggu kunci kasus.
3. Transaksi penyelesaian commit.
4. UPDATE konteks melanjutkan dengan predicate ID saja; outlet snapshot kasus selesai dapat berubah dan audit before-data berasal dari snapshot sebelum penyelesaian.

Ini merupakan inferensi dari source dan aturan PostgreSQL Read Committed: setelah menunggu transaksi lain, UPDATE memeriksa ulang WHERE terhadap versi baris terbaru. Predicate ID tetap cocok. Lihat [dokumentasi Transaction Isolation PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html).

Belum ada bukti eksekusi dua koneksi untuk skenario ini; harness PGlite yang dipakai suite bersifat sekuensial dan PostgreSQL lokal multi-session tidak tersedia pada audit. Jangan menyebutnya hasil repro hosted. Uji dan perbaiki dengan locking target yang konsisten, recheck status pada UPDATE, dan snapshot audit yang diambil setelah lock. Jika terkonfirmasi, gunakan migration maju baru; migration yang sudah diterapkan tidak diubah.

## Hasil verifikasi ulang lokal

| Pemeriksaan | Hasil audit 21 Oktober 2026 |
| --- | --- |
| `npm run check` | Lulus, 0 error / 0 warning |
| `npm test -- --maxWorkers=1` | 25 file / 354 tes lulus |
| `npm run test:database` | Lulus; 16 migration, RPC/RLS/audit/idempotensi serta biometric/push |
| Upgrade Preview 15→16 | Lulus lokal dengan kasus aktif/selesai, Libur dan koreksi outlet |
| Upgrade historis 13→16 | Kegagalan sebelum preflight direproduksi; preflight terbatas dua kali dan upgrade selanjutnya lulus |
| `npm run test:database:legacy` | Lulus; refusal/rollback diuji lokal, tanpa DDL hosted |
| `npm run build` | Lulus; build demo lokal tanpa URL/key Supabase |
| Live-mock eksplisit | 4/4 lulus; termasuk commit/noncommit, persist/reload/replay serta konflik reaktif |
| Demo E2E pada build lokal | 20/20 lulus, termasuk tes PWA yang diaktifkan eksplisit dengan `E2E_PWA=1` |
| Hosted / dua identitas Preview | Tidak dijalankan pada audit ini |
| iPhone/iPad/PWA perangkat nyata | Tidak dijalankan pada audit ini |

Tes unit awal berhenti sebelum collection karena EPERM rename folder sementara sandbox Windows; tidak ada tes aplikasi yang berjalan pada percobaan itu. Pengulangan dengan akses eksekusi lokal lulus 354/354. Ini dibedakan dari kegagalan aplikasi.

Live-mock memakai server khusus `127.0.0.1:5191`, URL backend tiruan `127.0.0.1:54329`, publishable key palsu dan intersepsi request Playwright. Demo/PWA memakai server build lokal khusus `127.0.0.1:5192`. Tidak digunakan akun/data hosted. Reproduksi V01/V04 memakai context browser tersendiri; V02 memakai source aktual dalam VM; V03 memakai helper aktual melalui Vite SSR. Reproduksi tambahan tersebut belum ditambahkan sebagai tes regresi yang dipelihara.

## Status terhadap U01–U06 dan milestone

| Acuan | Penilaian audit |
| --- | --- |
| U01 / Q1 | Perbaikan Libur dan tiga jalur migration lulus lokal sekuensial. Risiko riwayat paralel V05 belum diuji dua koneksi. |
| U02 / Q3 | Bug baseline replay semula tertutup oleh tes 4/4, tetapi pemulihan belum utuh karena V01 dan V04. |
| U03 / Q4 | Dependensi source eksplisit; dua konflik, Libur, pembatalan dan review terpilih lulus live-mock. Tidak ditemukan bug baru pada reaktivitas tersebut. |
| U04 / Q2 | Resolver live lulus sekuensial; kesetaraan demo belum terpenuhi karena V03. |
| U05 / Q5 | Pergantian identitas dan delayed table-fetch tertangani, tetapi delayed getSession masih gagal pada V02. |
| U06 / Q6 | Locator serta live-mock eksplisit sudah benar dan lulus. Suite yang ada belum mencakup V01–V04. |
| Q7a | Dokumen sebelumnya mencatat deployment/smoke 20 Oktober. Audit ini tidak mengulang pemeriksaan remote deployment. |
| Q7b / Q7c | Tetap pending; hasil lokal, mock, atau build Ready tidak menjadi bukti alur hosted dan iPhone. |

Prioritas tindak lanjut: V01 dan V02, lalu kesetaraan konteks V03; uji dua transaksi untuk V05 sebelum klaim riwayat aman; tutup V04 dengan kontrak recovery penyimpanan yang jelas. Tambahkan regresi yang gagal pada HEAD audit ini, baru ulangi gerbang lokal dan rilis Preview. Hosted serta perangkat tetap dilaporkan terpisah.

## Pembaruan tindak lanjut — 21 Oktober 2026

> Catatan pada bagian sebelumnya adalah keadaan saat audit dimulai. Bagian ini mencatat perbaikan setelah audit; langkah reproduksi awal dan hasil lama tetap dipertahankan sebagai bukti historis.

### Perbaikan lokal dan regresi

| Temuan | Perbaikan | Bukti penutupan lokal |
| --- | --- | --- |
| V01 — replay ditolak autentikasi | Replay dari percobaan tersimpan tetap mempertahankan `pendingAttempt` ketika HTTP 401 terjadi sebelum hasil idempotensi dapat diperiksa. Pengguna bisa login kembali dan mengirim ulang percobaan semula. | Live-mock menguji commit pertama dengan respons/refresh hilang, reload, replay 401, lalu replay sukses. Body RPC dan key idempotensi sama pada setiap pengiriman; efek commit hanya satu. |
| V02 — `getSession()` terlambat | `refreshNow()` memeriksa ulang `authRevision` segera sesudah `getSession()` selesai, sebelum mengadopsi identitas hasil lama. | Regresi menahan hasil sesi A, mengganti sesi ke B, lalu melepas A. B tetap login dan datanya termuat; B tidak di-sign-out. |
| V03 — konteks kasus demo | Jalur demo menyelaraskan kasus roster terbuka setelah penugasan tunggal/batch, pembatalan/aktivasi kembali, serta perubahan outlet utama. Kasus selesai mempertahankan snapshot historisnya. | Unit menguji tiap jalur, termasuk prioritas penugasan aktif atas outlet utama dan pelestarian kasus selesai. |
| V04 — persist attempt gagal | Penyimpanan `pendingAttempt` sekarang menjadi syarat sebelum RPC pertama dikirim. Bila storage menolak penulisan, pengguna mendapat peringatan dan transaksi tidak dikirim. | Live-mock menyuntikkan `QuotaExceededError`, memastikan RPC belum dipanggil, lalu memulihkan storage, reload draft, dan menyimpan ulang dengan sukses. |
| V05 — perubahan konteks beradu dengan penutupan kasus | Migration maju baru mengunci baris kasus target dengan urutan stabil, mengambil before-image setelah lock, lalu memeriksa ulang `status <> 'completed'` pada UPDATE. Migration lama tetap utuh. | Upgrade test mencakup instalasi kosong, Preview 15→17, dan jalur historis 13→17 dengan preflight lama sebelum migration yang berisiko. Migration/fungsi aktif diperiksa di Preview. **Uji konkurensi dua koneksi PostgreSQL yang benar-benar berjalan bersamaan masih belum terbukti**; panggilan SQL konektor yang tersedia berjalan serial. |

V01–V04 ditutup oleh regresi yang dipelihara. Perbaikan V05 diterapkan, tetapi kriteria uji konkurensi tidak ditandai lulus hanya dari uji sekuensial atau inspeksi definisi fungsi.

### Gerbang lokal setelah perbaikan

| Pemeriksaan | Hasil |
| --- | --- |
| Tes terarah auth dan workflow | 28/28 lulus |
| `npm run check` | Lulus, 0 error / 0 warning |
| `npm test -- --maxWorkers=1` | 25 file / 357 tes lulus |
| `npm run test:database` | Lulus; instalasi 17 migration, RPC/RLS/audit, dan upgrade compatibility |
| Preview upgrade compatibility | 15→17 lulus; kasus terbuka/selesai dan penguncian diperiksa |
| Historis upgrade compatibility | 13→17 lulus; kegagalan sebelum preflight direproduksi, preflight terbatas dijalankan dua kali |
| `npm run build` | Lulus; Svelte static adapter dan service worker |
| Live-mock eksplisit | 6/6 lulus, termasuk replay 401, persist/reload/retry sesudah storage pulih, dan review konflik reaktif |
| `git diff --check` | Lulus |

Server live-mock menggunakan port lokal 5191, URL backend tiruan `127.0.0.1:54329`, dan publishable key tiruan. Tes mencegat request lewat Playwright; tidak menggunakan akun atau data hosted. Docker daemon dan server PostgreSQL lokal multi-session tidak tersedia.

### Status Preview dan batas verifikasi

Identitas Supabase diverifikasi ulang sebelum tindakan: project `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, region `ap-southeast-2`, status `ACTIVE_HEALTHY`. Preview kini mencatat 17 migration; versi terakhir remote `20261021154511` bernama `cashier_followup_context_locking`. File migration maju lokal adalah [20261021150856_cashier_followup_context_locking.sql](../supabase/migrations/20261021150856_cashier_followup_context_locking.sql). Definisi fungsi aktif di Preview telah diperiksa dan memuat `FOR UPDATE OF f` serta pemeriksaan ulang status kasus.

Migration adalah satu-satunya perubahan terhadap schema aplikasi Preview pada pekerjaan ini. Tidak ada tabel, kasus, audit, akun, maupun data operasional publik yang dihapus atau diubah oleh pengujian. Untuk mencoba race V05, dibuat schema uji sintetis `audit_v05_20261021` berisi tabel assignment, follow-up, dan audit. Schema itu masih ada di Preview karena panggilan pembersihan sebelumnya tidak selesai. Ia bukan schema/aplikasi operasional; Supabase advisor menandai tabel audit sintetisnya yang tidak memiliki primary key. Penghapusan schema fixture tersebut masih memerlukan tindakan pembersihan eksplisit dan harus dicatat terpisah dari data operasional.

| Tahap | Status setelah perbaikan |
| --- | --- |
| Implementasi dan regresi lokal V01–V04 | Selesai; hasil tercantum di tabel di atas |
| V05 — migration maju dan upgrade | Diterapkan ke Supabase Preview dan terverifikasi; bukti concurrency dua koneksi masih pending |
| Q6 — gerbang lokal | Lulus sesuai perintah dan hasil di atas |
| Q7a — commit/deployment Preview dari source final | Selesai untuk deployment dan smoke shell/aset; detail SHA dan URL di bagian berikut. Alur bisnis hosted tetap Q7b. |
| Q7b — alur bisnis hosted | Pending; tidak diklaim dari hasil migration atau build |
| Q7c — iPhone/iPad/PWA nyata | Pending; tidak dijalankan pada pembaruan ini |

Snapshot advisor Supabase diambil setelah migration dan tidak memiliki snapshot pembanding sebelum perubahan. Karena itu temuan advisor yang sudah ada tidak dapat diatribusikan kepada patch. Salah satu temuan performa merujuk fixture sintetis di `audit_v05_20261021`; bersihkan fixture sebelum memakai snapshot advisor sebagai baseline baru.

### Q7a — deployment dan smoke setelah perbaikan

Source perbaikan dikomit dan didorong ke `origin/codex/preview`: commit `2f8c980055f1c37ca47347b35900e55f1e402bd6` (`fix: address cashier audit follow-up findings`). Karena push belum menghasilkan deployment untuk SHA baru, Vercel CLI terhubung digunakan dengan perintah `vercel.cmd deploy --yes --scope hr-rajaklana`; target tidak diarahkan ke Production.

Deployment yang diverifikasi: `dpl_FS8KWYpwcaMxXtxF3YzzU2BqFEPK`, status `READY`, source `cli`, branch `codex/preview`, SHA `2f8c980055f1c37ca47347b35900e55f1e402bd6`, alias [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app). Project Vercel `hr-rajaklana-jkt` dan team `team_S1Sn08iaksD0GQF4kk49kTkH` cocok dengan target yang telah ditetapkan. Build Vercel menjalankan `svelte-check` dengan 0 error/0 warning dan `vite build` berhasil.

Smoke memakai `vercel curl` agar akses SSO tetap aktif: `/login` mengembalikan shell HTML; `/manifest.webmanifest` dan `/service-worker.js` masing-masing HTTP 200. Konektor fetch Vercel ditolak 403 oleh proteksi, lalu CLI lokal berhasil mengakses deployment. Ini membuktikan shell/aset Preview termuat, bukan login HR, RPC, replay, Realtime lintas akun, ataupun alur hosted lainnya. Deployment build mencatat 4 temuan audit dependency (3 moderate, 1 high); paket dan jalur perbaikannya belum diaudit dalam pekerjaan ini.

Tidak ada deployment Production atau perubahan `main`.
