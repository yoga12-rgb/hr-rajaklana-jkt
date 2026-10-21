# Audit ulang hasil perbaikan Tahap A — 21 Oktober 2026

## Lingkup dan kesimpulan

Source: branch `codex/preview`, HEAD `447887f`; implementasi yang diperiksa ada pada `2f8c980`, diikuti dokumentasi `55e0f0d` dan penyelarasan nama migration `447887f`. Pembanding sebelum perbaikan: `c2e2023`. Acuan temuan sebelumnya: [audit hasil perbaikan](audit-hasil-perbaikan-tahap-a-2026-10-21.md).

**Belum seluruhnya tuntas.** Ditemukan satu regresi baru P2 pada penanganan replay, satu celah startup Auth P2 yang belum tertutup, dan satu perbedaan konteks kasus P3 khusus mode demo. Ketiganya berhasil direproduksi dengan source aktual dan fixture lokal terisolasi. Suite yang sudah tersedia tetap lulus karena tidak mencakup kondisi-kondisi tersebut.

Tidak ada kode aplikasi, migration, deployment, atau data remote yang diubah pada audit ini. Akses Supabase/Vercel hanya membaca metadata. Laporan ini adalah berkas source-control baru; harness reproduksi berada di folder ignored `.vercel/audit-recheck/`. `.codegraph/` tidak tersedia dan tidak dibuat.

## W01 — P2: replay yang ditolak konflik pasti mengunci minggu jadwal

Lokasi utama: [CashierWeeklyPlanner.svelte:187](../src/lib/components/CashierWeeklyPlanner.svelte#L187). Pemilihan attempt pada baris 162–177 dan tombol simpan pada baris 221 membuat pending lama satu-satunya jalur simpan.

Perbaikan V01 benar mempertahankan key saat replay mendapat 401 sebelum lookup idempotensi. Namun predicate `!replayingPersistedAttempt` sekarang mempertahankan pending untuk **setiap** error replay, termasuk penolakan baseline setelah server memastikan key tersebut belum pernah commit.

Dalam RPC, lookup key/hasil berada sebelum validasi baseline ([migration:117–124](../supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql#L117)); konflik baseline ditolak pada baris 154–159. Bila key sudah commit, hasil lama dikembalikan sebelum validasi itu. Bila key belum commit dan baseline berubah, transaksi retry ditolak dan insert key ikut rollback. Kondisi ini berbeda dari penolakan autentikasi atau gangguan jaringan yang belum memastikan hasil percobaan lama.

Reproduksi browser live-mock pada source aktual:

1. Kirim draft Pagi dari sel kosong; simulasikan percobaan belum commit dan hilangnya respons serta refresh.
2. SPV lain membuat assignment Sore pada sel itu. Reload; pending lama dan konflik berhasil dipulihkan.
3. Replay mengembalikan `P0001: Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik`, sesuai jalur SQL setelah lookup key tanpa commit lama.
4. Pilih “Terapkan kembali draft saya”. Baseline draft berubah ke assignment Sore, tetapi pending tetap memakai baseline awal kosong.
5. Tombol simpan baru berjumlah 0. Retry berikutnya mengirim body/key lama yang sama dan kembali gagal. Reload tetap terkunci.

Hasil terukur: original commit count 0; dua replay identik; baseline pending `expectedUpdatedAt=null`; baseline draft menunjuk assignment SPV lain; tombol simpan baru `count=0` setelah review dan reload.

Ini regresi dari perluasan penanganan error replay pada perbaikan terakhir. Dampaknya adalah minggu/akun tersebut tidak bisa menyimpan draft yang sudah direview melalui UI normal.

Arahan perbaikan: bedakan hasil server yang secara eksplisit memastikan tidak ada commit lama dan validasi transaksi ditolak dari error sebelum lookup/hasil ambigu. Gunakan outcome/error terstruktur atau jalur resolusi status yang sah sebelum mengakhiri pending. Jangan membersihkan seluruh `P0001`, mengganti key percobaan ambigu, atau menghapus storage untuk melewati kebuntuan. Tambahkan regresi belum-commit → source berubah → replay ditolak pasti → review → attempt baru sukses, disertai regresi 401 yang tetap mempertahankan key asli.

## W02 — P2: pergantian akun selama startup masih bisa mengeluarkan akun baru

Lokasi utama: [app.ts:369](../src/lib/state/app.ts#L369); tindakan sign-out pada [baris 284](../src/lib/state/app.ts#L284).

`actions.init()` menjalankan `await refresh()` sebelum mendaftarkan `onAuthStateChange`. Pemeriksaan `authRevision` baru sesudah `getSession()` benar untuk refresh setelah listener tersedia. Pada pembacaan pertama, perubahan sesi A→B belum menaikkan revision karena listener belum terpasang.

Reproduksi VM dari `app.ts` aktual, tanpa network atau persistence:

1. Mulai init dan tahan hasil `getSession()` yang telah menangkap A.
2. Sebelum listener tersedia, ganti sesi aktif menjadi B.
3. Lepas hasil A; pembacaan employee mencerminkan RLS sesi B yang sah.
4. Pencarian employee A gagal, revision masih dianggap berlaku, lalu branch akun tidak aktif memanggil sign-out terhadap sesi B.

```json
{"listenerRegisteredBeforeSwitch":false,"signouts":1,"sessionAfter":null,"stateUser":null,"error":"Akses akun tidak aktif. Hubungi Admin HR."}
```

Ini celah lama yang masih tersisa dalam penutupan V02/Q5, bukan regresi yang diperkenalkan oleh satu baris pemeriksaan revision terakhir. Audit tidak menemukan bypass RLS; dampak terkonfirmasi adalah logout akun B yang sah. Tes V02 baru memanggil `openLiveApp()` sampai selesai dahulu sehingga tidak mencakup startup.

Arahan perbaikan: pasang invalidasi/listener identitas sebelum fetch awal dengan lifecycle tunggal, dan pastikan tindakan sign-out akibat data akun tidak aktif hanya berlaku untuk identitas yang masih sama. Tambahkan tes perpindahan sesi selama init pertama, bukan hanya refresh setelah init.

## W03 — P3: konteks kasus bersumber assignment belum setara di demo

Lokasi: [cashier-workflows.ts:25](../src/lib/cashier-workflows.ts#L25), dengan konsumen [CashierSpvPanel.svelte:15](../src/lib/components/CashierSpvPanel.svelte#L15).

Helper baru menyelaraskan kasus `roster/unassigned` dan jalur itu sudah benar. Kasus bersumber `assignment` tidak ikut diselaraskan oleh `saveAssignmentInState`, sementara trigger generik live memperbarui konteks kasus terbuka ketika assignment berubah.

Reproduksi helper aktual memakai fixture sintetis:

1. Assignment Pagi/outlet A mempunyai kasus `missing_clockin` terbuka dengan source ID assignment yang sama.
2. Ubah assignment itu menjadi Libur/outlet B.
3. Assignment berubah, tetapi konteks kasus tetap A/Pagi. Sinyal missing clock-in hilang karena Libur; filter kasus tersimpan untuk outlet B tidak menemukannya.

```json
{"assignmentOutlet":"B","assignmentShift":"off","caseOutlet":"A","caseShift":"morning","visibleOpenResolvedForB":0}
```

Ini masalah demo yang sudah ada, bukan regresi baru dan bukan bukti V03 khusus `roster/unassigned` masih gagal. Ia merupakan sisa kesetaraan konteks generik Q1/Q2. Jalur live tidak terbukti mengalami masalah ini. Lengkapi transisi demo bagi kasus terbuka yang bersumber assignment sambil mempertahankan snapshot kasus completed; uji outlet, Libur, pembatalan, single/batch, dan audit melalui action yang digunakan UI.

## Hal yang terverifikasi tetap benar dan kekurangan bukti

- V01 untuk penolakan 401 sebelum lookup: payload/key asli tetap tersimpan dan dapat direplay.
- V02 untuk refresh setelah listener terpasang: pemeriksaan revision baru dan regresi delayed getSession bekerja; W02 adalah jalur startup yang terpisah.
- V03 khusus roster/unassigned: perpindahan tunggal/batch, fallback outlet utama, dan snapshot completed tercakup tes yang lulus.
- V04: kegagalan persist key/payload menghentikan pengiriman RPC pertama; skenario storage pulih dan reload lulus.
- V05: tidak ditemukan defect baru konkret pada penguncian target, recheck completed, atau otorisasi patch terakhir. Tes upgrade masih menggunakan satu backend PGlite; assertion lock di `followup-upgrade-compatibility.mjs:96–100` memeriksa teks fungsi. **Lock wait, before-image setelah transaksi lain commit, serta perlindungan completed pada dua koneksi serentak tetap belum diuji.** Ini gap verifikasi yang sudah diakui laporan, bukan hasil repro bug baru.

## Pengujian baru pada audit ini

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `npm run check` | Lulus, 0 error/0 warning |
| `npm test -- --maxWorkers=1` | 25 file / 357 tes lulus |
| `npm run test:database` | Lulus, 17 migration; RPC/RLS/audit, biometric/push, dan tiga jalur migration |
| Preview upgrade lokal 15→17 | Lulus |
| Historis upgrade lokal 13→17 | Kegagalan sebelum preflight direproduksi; preflight terbatas dua kali dan upgrade lulus |
| `npm run test:database:legacy` | Lulus, termasuk refusal/rollback; tidak menjalankan DDL hosted |
| `npm run build` | Lulus, mode demo lokal tanpa URL/key Supabase |
| Live-mock eksplisit `tests/live-cashier-roster-ambiguous.spec.ts` | 6/6 lulus, tidak skipped |
| Reproduksi W01 melalui browser | 1/1 berhasil mereproduksi bug; ini bukan tes penerimaan yang lulus |
| Reproduksi W02/W03 melalui source aktual dalam VM | Output di atas berhasil diulang oleh pemeriksa utama |
| `git diff --check` | Lulus |
| Demo E2E/PWA lengkap | Tidak diulang pada audit ini; hasil sebelumnya tetap historis |
| Alur bisnis hosted / iPhone-PWA nyata / dua koneksi PostgreSQL | Tidak dijalankan |

Live-mock memakai server khusus `127.0.0.1:5193`, backend tiruan `127.0.0.1:54329`, publishable key palsu, dan intersepsi Playwright. Server milik audit dihentikan setelah pengujian. Harness baru berada di `.vercel/audit-recheck/` dan belum menjadi tes regresi terpelihara; perbaikan berikutnya perlu menambahkannya ke suite yang ikut commit.

## Pemeriksaan remote read-only saat audit awal

Supabase terverifikasi sebagai `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, region `ap-southeast-2`, `ACTIVE_HEALTHY`. Riwayat memiliki 17 migration, terakhir `20261021154511_cashier_followup_context_locking`, cocok dengan nama file lokal. Kedua fungsi sinkronisasi private mempunyai lock `FOR UPDATE OF f`, bukan security definer, dan tidak dapat dieksekusi langsung oleh anon/authenticated.

Schema fixture `audit_v05_20261021` masih ada sebagaimana telah dilaporkan. Pemeriksaan catalog menunjukkan anon/authenticated tidak memiliki USAGE schema maupun SELECT pada tiga tabel sintetisnya. Pembersihan belum dilakukan; permintaan audit ini tidak dianggap sebagai persetujuan penghapusan yang ditanyakan pada giliran sebelumnya.

Alias Vercel Preview menunjuk deployment `dpl_FS8KWYpwcaMxXtxF3YzzU2BqFEPK`, `READY`, source `cli`, branch `codex/preview`, commit implementasi `2f8c980055f1c37ca47347b35900e55f1e402bd6`. Selisih ke HEAD lokal hanya dokumentasi dan nama file migration; frontend yang diterapkan sesuai implementasi yang diaudit. Tidak dibuat deployment baru. Build Ready dan metadata tersebut tidak menjadi bukti login atau alur bisnis hosted; keberhasilan deployment otomatis dari Git juga tidak dibuktikan oleh deployment CLI ini.

Peringatan empat dependency dari build Vercel sebelumnya belum ditelaah ulang pada audit ini dan tidak dinyatakan sebagai kerentanan baru dari patch.

## Urutan tindak lanjut yang ditetapkan saat audit awal

1. Perbaiki W01 tanpa mengurangi perlindungan key/payload replay ambigu dan 401.
2. Tutup W02 dengan regresi startup yang benar-benar mengganti identitas sebelum init selesai.
3. Lengkapi W03 untuk konteks kasus assignment demo; pertahankan riwayat completed dan audit.
4. Ulangi gerbang lokal serta live-mock setelah regresi baru masuk suite terpelihara.
5. Selesaikan bukti V05 dengan PostgreSQL dua koneksi, lalu uji alur hosted dan iPhone/PWA secara terpisah. Jangan menghapus data operasional atau audit untuk membuat fixture lulus.

## Hasil tindak lanjut per 21 Oktober 2026

Perbaikan lokal dan tes regresi untuk W01–W03 telah ditambahkan setelah audit di atas. Temuan dan reproduksi pada bagian sebelumnya tetap merekam keadaan sebelum perbaikan; bagian ini mencatat hasil setelah patch.

| Temuan | Status implementasi lokal | Bukti penutupan |
| --- | --- | --- |
| W01 — replay ditolak konflik baseline | Selesai lokal | Planner mengenali hanya respons RPC `P0001` dengan pesan baseline konflik yang tepat dan HTTP 400. Ia memuat ulang jadwal; pending attempt dilepas hanya jika pembacaan berhasil dan ID/waktu versi source berbeda dari baseline. Jika refresh gagal, payload/key lama tetap tertahan. Tes live-mock menjalankan belum commit → source SPV lain berubah → replay P0001 → refresh gagal → replay payload/key asli lagi → refresh berhasil → draft review bertahan setelah reload → draft diterapkan ulang dan satu transaksi baru berhasil dengan key/baseline baru. Tes 401 tetap membuktikan key dan payload asli dipertahankan. |
| W02 — pergantian Auth saat startup | Selesai lokal | `onAuthStateChange` dipasang sebelum fetch awal dan `init()` memakai satu promise agar listener tidak ganda. Tes menahan `getSession()` yang menangkap akun A, mengganti sesi ke B sebelum init selesai, lalu memastikan A diabaikan, B termuat, dan `signOut` tidak dipanggil. Regresi refresh tertunda, fetch B gagal, callback channel lama, logout/login, dan token refresh tetap tercakup. |
| W03 — konteks kasus assignment demo | Selesai lokal | Mode demo kini menyelaraskan tanggal, outlet, karyawan, dan shift kasus assignment terbuka saat assignment tunggal atau batch berubah. Tes mencakup pindah outlet, shift, Libur, batal dan aktif kembali, audit konteks, status/pemilik/catatan kasus, serta snapshot completed yang tidak berubah. |

### Bukti verifikasi setelah patch

| Pemeriksaan | Hasil setelah patch |
| --- | --- |
| `npm.cmd run check` | Lulus, 0 error / 0 warning |
| Tes terarah W01–W03 | 40/40 lulus |
| `npm.cmd test -- --maxWorkers=1` | 25 file / 361 tes lulus |
| `npm.cmd run test:database` | Lulus; 17 migration, RPC/RLS/audit, upgrade Preview 15→17 dan historis 13→17, biometric/push |
| `npm.cmd run test:database:legacy` | Lulus; refusal/rollback lokal, tanpa DDL hosted |
| `npm.cmd run build` | Lulus dalam mode demo lokal tanpa URL/key Supabase |
| Demo E2E penuh | 19 lulus, 8 terskip: 7 live-mock dan 1 PWA; masing-masing dijalankan terpisah setelahnya |
| Live-mock eksplisit | 7/7 lulus, tanpa skip, termasuk persist/reload/retry dan recovery draft W01 |
| PWA pada build produksi lokal | 1/1 lulus; ini bukti browser desktop lokal, bukan iPhone |
| `git diff --check` | Lulus |

Tidak ada migration yang ditambah atau diubah karena W01–W03 dapat ditutup dengan kontrak error RPC yang sudah ada, lifecycle Auth client, dan penyelarasan state demo. Database lokal tetap lulus pada 17 migration. Implementasi sudah di-deploy ke Preview; rincian deployment dan pemeriksaan endpoint hosted dicatat pada bagian berikutnya.

### Verifikasi yang masih terbuka

- V05 masih belum memiliki bukti lock wait dan audit before-image dari dua sesi PostgreSQL nyata. PGlite pada suite database menggunakan satu backend. Komputer ini tidak memiliki `psql`/PostgreSQL lokal; Docker Desktop terpasang tetapi engine tidak aktif, dan WSL menolak akses. Karena itu hasil unit/SQL-shape tidak diklaim sebagai uji konkurensi dua koneksi.
- Alur bisnis hosted Preview sesudah patch belum dijalankan. Shell `/login`, manifest, dan service worker berhasil dicek `200 OK`, tetapi login aplikasi dan workflow kasir nyata masih perlu diuji pada akun uji.
- iPhone/iPad, ikon Layar Utama, offline/resume, kamera/GPS, dan push belum diuji pada versi yang diperbaiki. Tes PWA 1/1 hanya menguji build lokal di browser desktop.
- Schema fixture sintetis `audit_v05_20261021` yang sudah ada tetap tidak disentuh. Tidak ada data operasional, audit, atau schema hosted yang direset/dihapus pada tindak lanjut ini.

### Status deployment Preview setelah patch

Identitas proyek tetap `hr-rajaklana-jkt`, project ID `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`, dengan source GitHub `yoga12-rgb/hr-rajaklana-jkt`. Target Supabase tetap Preview `lypsqrwjzrmuyqtdcegr` dengan 17 migration yang sudah diterapkan; patch W01–W03 tidak memerlukan migration dan tidak mengubah database hosted.

Commit `77f81a14d6d992193e61d63dbd16184eab5cf394` berada di branch `codex/preview`. Vercel membuat deployment Git otomatis `dpl_7t6LX5N6ZNumzGMJP9QFcTgvYbN2`; status `READY`, target Preview, dan alias `hr-rajaklana-jkt-preview.vercel.app` tercantum pada deployment tersebut. Deployment `dpl_MQpbMyPXQQL56pHdRP3zMMDk4Who` kemudian dibuat ulang dari latest commit lewat koneksi Git proyek yang sama; statusnya juga `READY` dan metadata SHA/branch sama. Pemeriksaan HTTP pada alias Preview melalui `vercel curl -I` memberikan:

| Endpoint hosted | Status | Content-Type |
| --- | --- | --- |
| `/login` | `200 OK` | `text/html; charset=utf-8` |
| `/manifest.webmanifest` | `200 OK` | `application/manifest+json; charset=utf-8` |
| `/service-worker.js` | `200 OK` | `application/javascript; charset=utf-8` |

Pemeriksaan ini hanya mencakup shell dan aset PWA hosted. Sesi autentikasi aplikasi, operasi kasir, alur database hosted, serta iPhone/iPad belum dijalankan. Konektor fetch Vercel menolak bypass dengan 403; pemeriksaan endpoint yang tercatat dilakukan melalui Vercel CLI pada proyek tertaut. Deployment Protection tidak diubah. Production dan branch `main` tetap di luar cakupan.
