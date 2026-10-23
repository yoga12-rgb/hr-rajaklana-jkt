# Audit kesiapan aplikasi HR — 22 Oktober 2026

## Kesimpulan

**Delapan temuan P2 sudah diperbaiki pada workspace lokal `codex/preview`, dan seluruh pemeriksaan lokal yang diwajibkan lulus.** Perbaikannya melindungi recovery jadwal, retry yang pasti ditolak, catatan SPV, pemulihan akun, transaksi data dan peran, koordinat outlet, serta lifecycle kamera.

Aplikasi **belum dapat dinyatakan normal untuk operasional penuh** karena alur hosted dengan login dan perangkat nyata belum selesai diuji. Kelanjutan 23 Oktober telah menerapkan migration ke Supabase Preview; status frontend dan bukti rilis dicatat pada bagian kelanjutan di akhir dokumen. Kamera, GPS, notifikasi, dan pembaruan PWA pada iPhone/iPad tetap memerlukan uji perangkat.

P2 di laporan ini berarti kondisi tertentu dapat menghambat alur atau merusak state operasional, sehingga perlu diperbaiki. Ini bukan klaim bahwa seluruh fitur gagal atau terdapat eksploitasi akses yang sudah terjadi.

## Lingkup dan metode

- Branch `codex/preview`, HEAD `f92165d5aa15864d6e991e512d993c731bab66b1`; kode implementasi terakhir `496ebe7`. Workspace awal bersih. `.codegraph/` tidak ada dan tidak dibuat.
- Ditinjau: login/sesi dan hak akses, data karyawan/aktivasi/reset, cuti/izin, jadwal kasir/recovery, absensi/kamera/lokasi/koreksi, panel SPV, notifikasi/push, serta SPA/PWA.
- Pada audit awal, suite unit, database, upgrade, live-mock dan demo browser dijalankan ulang untuk mengonfirmasi temuan. Setelah perbaikan, hasil terkini dicatat pada bagian “Hasil pengujian ulang setelah perbaikan”.
- Preview Supabase/Vercel diperiksa read-only. Tidak ada source aplikasi, migration, konfigurasi remote, akun, data operasional, atau audit remote yang diubah. Tidak ada deployment/commit/push baru dari audit ini. Server uji lokal hanya memakai data contoh atau REST mock.
- Reproduksi ignored berada di `.vercel/audit-app-oct22/`; langkah dan hasil penting dicatat di bawah agar laporan tetap dapat dipakai tanpa bergantung pada folder ignored.

## Temuan terkonfirmasi sebelum perbaikan

### APP-01 / P2 — tab lama menghapus recovery jadwal tab lain

Source: [CashierWeeklyPlanner.svelte:54](../src/lib/components/CashierWeeklyPlanner.svelte#L54), [aktivasi scope:60](../src/lib/components/CashierWeeklyPlanner.svelte#L60), [penghapusan storage:199](../src/lib/cashier-spv-drafts.ts#L199).

`persistDraft()` masih menulis/menghapus seluruh snapshot aktif tanpa membandingkan versi record storage terbaru. Perbaikan A22-01 sebelumnya melindungi callback request yang berpindah minggu/akun; skenario ini adalah **dua tab pada akun dan minggu yang sama**.

Reproduksi:

1. Buka minggu A pada dua tab. Tab B dimuat saat belum ada draft/pending.
2. Tab A memperoleh pending attempt sah yang harus disimpan untuk replay; tampilkan banner pending pada A.
3. Pada B yang masih memegang state kosong, tekan “Minggu berikutnya”.
4. Navigasi B memanggil persist untuk minggu A dan menghapus key milik A. Tidak ada peringatan.

Bukti source VM: `beforeValidPending:true`, `afterA:null`, `draftStorageWarning:false`. **Reproduksi browser juga mengonfirmasi** pending sebelum navigasi ada, setelahnya hilang tanpa warning. Fixture browser menanam pending valid secara lokal; tidak membuat kegagalan network sungguhan pada hosted.

Dampak: jalur pemulihan dengan key/body asli hilang. Audit tidak membuktikan transaksi backend terduplikasi; kehilangan record recovery itu sendiri terkonfirmasi.

Arah perbaikan: persist harus mengenali revisi/snapshot yang terakhir dibaca, mendeteksi perubahan tab lain, dan tidak menghapus/menimpa record yang bukan versinya. Sinkronkan perubahan storage antar-tab; pertahankan draft yang bertentangan untuk review. Regresi harus menavigasikan tab lama setelah tab lain membuat pending, lalu reload keduanya.

### APP-02 / P2 — retry jadwal buntu setelah penolakan aturan operasional

Source: [CashierWeeklyPlanner.svelte:240](../src/lib/components/CashierWeeklyPlanner.svelte#L240), [tombol transaksi baru:274](../src/lib/components/CashierWeeklyPlanner.svelte#L274), [penolakan cuti penuh:166](../supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql#L166).

Reproduksi: percobaan Pagi sempat kehilangan respons dan belum commit, sehingga pending tersimpan. Setelah cuti penuh disetujui, retry mendapat `P0001` dengan pesan “Penugasan kerja berbenturan dengan cuti sehari penuh yang disetujui”. Pengguna mengganti draft menjadi Libur, tetapi tombol retry tetap mengirim Pagi dan key lama. Classifier hanya mempunyai jalur pemulihan khusus untuk penolakan baseline; pending persisted lain tidak dilepas, sementara tombol transaksi baru disembunyikan.

Source VM mencatat dua pemanggilan dengan shift `morning` dan key sama meskipun `draftShift:'off'`; pending tetap ada dan penolakan yang sama berulang. Bukti ini memakai handler aktual dan respons error sesuai SQL; bukan transaksi hosted.

Dampak: SPV tidak dapat menyimpan jadwal yang sudah diperbaiki melalui UI pada kondisi tersebut.

Arah perbaikan: sediakan kontrak hasil attempt/penolakan yang membuktikan apakah transaksi dengan key asli sudah commit. Hanya setelah non-commit terkonfirmasi, lepaskan pending dan izinkan review/transaksi baru. **Jangan membersihkan semua `P0001`** atau mengganti key untuk hasil ambigu. Uji commit-response-lost, non-commit-domain-reject, refresh gagal, reload, serta retry hasil perbaikan.

### APP-03 / P2 — catatan SPV lama menimpa pembaruan SPV lain

Source: [CashierSpvPanel.svelte:34](../src/lib/components/CashierSpvPanel.svelte#L34), [update database:292](../supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql#L292).

`noteDraft`, `ownerDraft`, dan `resolutionDraft` tidak dibersihkan setelah simpan sukses. Reproduksi: A menyimpan catatan A; Realtime kemudian membawa catatan B dari SPV lain. UI A tetap mengutamakan catatan draft A. Ketika A hanya mengubah penanggung jawab, handler kembali mengirim catatan A dan menimpa catatan B.

Source VM menghasilkan `remoteNoteBeforeOwnerChange:'SPV B memastikan kasir sudah tiba di outlet'`, tetapi payload owner-only dan catatan akhir berisi `Kasir dihubungi oleh SPV A`. Riwayat audit sebelumnya tidak dihapus; yang tertimpa adalah ringkasan operasional terkini.

Arah perbaikan: bersihkan draft yang telah disimpan sambil mempertahankan edit baru selama request; gunakan baseline/version atau pembaruan field yang benar-benar diubah agar edit lain tidak tertimpa tanpa review. Uji dua sesi: simpan A → update B → A mengganti owner saja.

### APP-04 / P2 — karyawan yang diaktifkan kembali tidak dapat memulihkan akses melalui UI

Source: [hr_save_employee:497](../supabase/migrations/20261018045749_cashier_operational_workflows.sql#L497), [pilihan tombol akun:51](../src/routes/(app)/employees/+page.svelte#L51), [issue_account_token:537](../supabase/migrations/20261018045749_cashier_operational_workflows.sql#L537).

Sesudah karyawan berakun dinonaktifkan lalu diubah kembali menjadi aktif, database mempertahankan `account_status='disabled'` dan `auth_user_id` lama. UI menawarkan aktivasi karena account status belum aktif. RPC menolaknya karena Auth identity sudah ada.

Reproduksi SQL aktual 17 migration: `status:'active'`, `accountStatus:'disabled'`, `uiPurpose:'activation'`, error **“Akun sudah diaktifkan”**.

Dampak: Admin HR tidak mempunyai alur UI yang berhasil untuk memulihkan akses karyawan tersebut.

Arah perbaikan: definisikan transisi reaktivasi yang mempertahankan identitas Auth dan audit; sediakan pemulihan akun yang sesuai, bukan aktivasi akun baru. Uji inactive → active → proses pemulihan → login dengan nomor karyawan yang sama. Jangan membuat akun Auth duplikat atau mengganti nomor karyawan.

### APP-05 / P2 — tautan pemulihan yang diklaim tidak dapat dibuka kembali setelah lima menit

Source: [hr-api:145](../supabase/functions/hr-api/index.ts#L145), [inspect_account_token:26](../supabase/migrations/202610030002_auth_support.sql#L26), [halaman aktivasi:7](../src/routes/activate/+page.svelte#L7).

Jika pekerjaan Auth/finalisasi terputus, API mengarahkan pengguna mencoba tautan yang sama lagi setelah lima menit. RPC claim memang mengizinkan takeover claim yang telah ditinggalkan. Namun halaman aktivasi selalu memanggil inspect lebih dahulu, dan inspect menolak semua token yang `claimed_at`-nya terisi.

Reproduksi SQL aktual: setelah claim berumur enam menit, inspect menolak **“Tautan tidak berlaku atau sudah digunakan”**, sedangkan claim langsung berhasil mengambil alih token yang sama. Ini membuktikan jalur backend tersedia tetapi tertutup oleh prasyarat UI/API.

Arah perbaikan: selaraskan inspect dan claim untuk state abandoned yang sah, tanpa membuka token consumed, expired, atau revoked dan tanpa menampilkan informasi sensitif. Uji lewat halaman setelah reload; kelulusan RPC claim sendiri tidak cukup.

### APP-06 / P2 — penonaktifan dan perubahan peran tersimpan sebagian

Source: [app.ts:426–429](../src/lib/state/app.ts#L426), [hr_set_roles:524](../supabase/migrations/20261018045749_cashier_operational_workflows.sql#L524).

Simpan karyawan memakai dua RPC terpisah: status/data disimpan dahulu, lalu peran. Jika Admin HR menonaktifkan karyawan sekaligus mencabut perannya, RPC pertama commit. RPC peran kemudian menolak karena karyawan sudah nonaktif; refresh tidak dijalankan karena error.

Reproduksi SQL aktual: error **“Karyawan aktif tidak ditemukan”**, tetapi status sudah `inactive/disabled` dan peran `head_baker` masih tersimpan. UI menampilkan kegagalan meskipun sebagian perubahan telah terjadi. Status nonaktif tetap menolak akses; ini bukan bukti akun nonaktif dapat login.

Arah perbaikan: lakukan perubahan data/status/peran sebagai transaksi yang konsisten atau kontrak transisi yang aman, beserta audit. Jangan sekadar membalik urutan RPC tanpa menangani kegagalan di langkah kedua. Uji rollback kegagalan, tampilan sesudah reload, serta larangan mengubah hak akses sendiri.

### APP-07 / P2 — hasil GPS permintaan outlet A menimpa form outlet B

Source: [organization/+page.svelte:20](../src/routes/(app)/organization/+page.svelte#L20), [modal dapat ditutup:33](../src/routes/(app)/organization/+page.svelte#L33), [penyimpanan koordinat:19](../src/routes/(app)/organization/+page.svelte#L19).

Callback `getCurrentPosition` memperbarui variabel outlet saat ini tanpa identitas permintaan. Mulai “Gunakan lokasi saya” pada A → tutup modal → buka B → respons GPS A datang. Callback mengisi latitude/longitude B. Tombol Simpan kemudian dapat menyimpan koordinat salah tersebut.

Source VM dan **browser demo aktual** sama-sama membuktikan form B tetap bernama B tetapi koordinatnya menjadi `-6.20123 / 106.80123` dari permintaan A. Browser sengaja **tidak menekan Simpan**, sehingga tidak mengubah data outlet.

Dampak: jika disimpan, geofence outlet B salah dan absensi kasir bisa ditolak atau dinilai pada lokasi yang keliru.

Arah perbaikan: tangkap ID/generation outlet dan permintaan; abaikan respons setelah modal dibatalkan, outlet berubah, atau komponen dilepas. Regresi harus memakai callback GPS tertunda dan membuka outlet lain sebelum respons selesai.

### APP-08 / P2 — dua permintaan kamera referensi meninggalkan stream pertama aktif

Source: [face-verification/+page.svelte:22](../src/routes/(app)/face-verification/+page.svelte#L22), [tombol kamera:43](../src/routes/(app)/face-verification/+page.svelte#L43).

Tombol kamera referensi tetap aktif selama `getUserMedia` menunggu. Dua klik memulai dua permintaan; kedua hasil kemudian menulis variabel `stream` yang sama tanpa menghentikan stream hasil pertama. Saat halaman ditutup, hanya stream terakhir yang dihentikan.

Source VM dengan track spy menghasilkan `stopped:[0,1]`, `plays:2`, dan stream pertama masih hidup sesudah destroy. Pembanding penting: satu request yang selesai setelah destroy berhenti melalui catch pada teardown normal; kamera absensi utama sudah mempunyai revision guard dan menghentikan kedua stream. Temuan ini khusus kamera referensi pada permintaan bersamaan, bukan klaim seluruh kamera absensi bocor.

Arah perbaikan: tambahkan status opening/revision guard, hentikan setiap stream hasil usang, dan batalkan ownership saat destroy. Uji double tap, permission tertunda, tutup/buka ulang, serta meninggalkan halaman. Dampak perangkat nyata masih perlu diuji di iPhone.

## Perbaikan APP-01–APP-08

| Temuan | Perbaikan pada workspace | Bukti lokal | Sisa batas verifikasi |
| --- | --- | --- | --- |
| APP-01 | Draft roster dibandingkan dengan snapshot yang terakhir dibaca sebelum ditulis/dihapus. Perubahan storage dari tab lain menyegarkan tab yang masih bersih; konflik atau kegagalan persist memblokir navigasi/simpan agar record terbaru tidak terhapus. | Tes unit memastikan snapshot kosong yang usang tidak dapat menghapus pending replay. Regresi dua tab di Edge membuktikan tab lama menyinkronkan pending, navigasi ke minggu lain dan kembali tanpa kehilangan key. Suite live-mock roster 10/10 juga lulus persist/reload/retry. | Sangat sempitnya race lintas renderer tetap dibatasi oleh API compare-then-write `localStorage` yang tidak menyediakan CAS; konflik yang teramati menahan aksi dan mempertahankan record. |
| APP-02 | Hanya respons non-commit spesifik untuk benturan cuti sehari penuh yang melepas pending attempt; semua respons ambigu tetap memakai key dan payload awal. | Regresi live-mock membuktikan penolakan spesifik, edit ulang shift, lalu transaksi baru memakai key dan payload yang diperbarui. Suite live-mock 10/10 lulus. | Integrasi Auth/database hosted belum dijalankan. |
| APP-03 | Setelah simpan berhasil, hanya nilai yang benar-benar disimpan server dan sama dengan payload terkirim yang dibersihkan; edit selama request dan draft penyelesaian pada simpan progres tetap tersimpan. | Tes unit `spv-followup-drafts` lulus di suite unit 415/415. | Skenario dua sesi SPV pada Preview belum dijalankan. |
| APP-04 | Karyawan berakun yang diaktifkan kembali mempertahankan employee number dan Auth identity; status akun dipulihkan sehingga Admin HR dapat mengirim tautan pemulihan akses. | PGlite menjalankan lifecycle nonaktif → aktif → pemulihan dengan identitas yang sama. Tes database dan upgrade Preview sintetis lulus; parity demo juga lulus. | Login dan tautan pemulihan melalui hr-api/Supabase Auth hosted belum dijalankan. |
| APP-05 | `inspect_account_token` menerima claim yang sudah ditinggalkan minimal lima menit, sesuai aturan takeover pada claim; token consumed/expired/revoked dan claim baru tetap ditolak. | Tes database menguji inspect sebelum claim ulang; upgrade historis sintetis 13→18 lulus dengan preflight terbatas dua kali. | Pengiriman tautan dan halaman reset pada Preview belum dijalankan. |
| APP-06 | Migration baru menyediakan `hr_save_employee_with_roles`, satu transaksi untuk data, status, serta peran; frontend memakai satu RPC itu. Audit peran dan larangan mengubah peran sendiri tetap berlaku. | Tes database menyuntikkan kegagalan pada penulisan peran dan memastikan perubahan status/data ikut rollback; lifecycle penonaktifan/reaktivasi lulus. | Penyimpanan melalui UI dengan Auth hosted belum dijalankan. |
| APP-07 | Callback geolokasi diikat ke generation dan outlet saat permintaan dimulai; respons setelah batal, ubah form, ganti tab atau unmount diabaikan. Tombol simpan ditahan selama lookup lokasi berlangsung. | Regresi browser demo menyelesaikan callback outlet A setelah membuka outlet B, lalu memastikan koordinat B tidak berubah dan tetap bisa disimpan. Demo browser/PWA 22/22 lulus. | GPS perangkat nyata dan penyimpanan outlet di Preview belum diuji. |
| APP-08 | Lifecycle stream kamera referensi memakai lease/revision, menolak permintaan tumpang tindih, menghentikan stream usang, dan membersihkan `srcObject` saat dihentikan/destroy. | Tes unit `media-stream-lease` lulus di suite unit 415/415; Svelte check dan build lulus. | Double-tap kamera serta teardown stream perlu diuji pada iPhone/iPad nyata. |

Migration `20261022170000_close_readiness_audit_findings.sql` adalah migration forward-only. Migration yang telah diterapkan tidak diubah. Suite migration di bawah menggunakan PGlite lokal; penerapan aktual ke Preview dilakukan terpisah pada 23 Oktober dan dicatat di akhir dokumen.

## Hasil pengujian ulang setelah perbaikan

| Pemeriksaan | Hasil pada audit ini | Batas bukti |
| --- | --- | --- |
| `npm.cmd run check` | Lulus, 0 error / 0 warning | Pemeriksaan statis |
| `npm.cmd test -- --maxWorkers=1` | **29 file / 415 tes lulus** | Unit lokal, bukan hosted |
| `npm.cmd run test:database` | Lulus, seluruh 18 migration dan tes RPC/RLS/audit/biometric/push | Database PGlite lokal |
| Upgrade Preview 17→18 | Lulus; riwayat SPV dipertahankan, akun terkait diaktifkan kembali, token abandoned diinspeksi dan di-claim ulang | Fixture lokal, tidak mengubah Preview |
| Upgrade historis 13→18 | Preflight yang hilang direproduksi; preflight terbatas dijalankan dua kali; migration 14–18 lulus | Berbeda dari upgrade Preview |
| `npm.cmd run test:database:legacy` | Lulus refusal/rollback; reset berhasil pada fixture in-memory berisi 13 tabel | Auth, Storage, schema/extensions dan event trigger platform dipertahankan; tidak ada hosted DDL/reset |
| Build demo SPA/PWA | Lulus; service worker terbangun | `PUBLIC_APP_ENV=development`, URL/key Supabase kosong |
| Live-mock eksplisit | **10/10 lulus**, tanpa skipped | REST mock lokal; persist, reload, replay, penolakan domain dan retry |
| Demo browser + PWA | **22/22 lulus**, tanpa skipped, `E2E_PWA=1` | Microsoft Edge desktop/emulasi ponsel; cache/offline lokal |
| Regresi browser APP-01/APP-07 | Lulus: tab lama mempertahankan pending replay lintas minggu; callback GPS tertunda dari A tidak mengganti koordinat B dan B berhasil disimpan | Build demo lokal, bukan Preview |
| Login/workflow hosted | Belum dibuktikan setelah perbaikan | Deployment `READY` saja bukan bukti alur |
| iPhone/iPad-PWA aktual | Belum dijalankan setelah perbaikan | Kamera/GPS/push/resume/update lintas versi belum ditutup |

Suite live-mock setelah perbaikan dijalankan dengan `E2E_LIVE_SUPABASE_MOCK=1`, base URL `http://127.0.0.1:5197`, dan `PUBLIC_SUPABASE_URL=http://127.0.0.1:54329`. Suite demo dijalankan terhadap build lokal `http://127.0.0.1:5198` dengan `E2E_PWA=1`. TEMP/TMP memakai folder ignored workspace agar cache Vitest tidak mengalami EPERM sandbox.

Perintah reproduksi audit:

```powershell
node .vercel/audit-app-oct22/cross-tab-pending-repro.mjs
node .vercel/audit-app-oct22/domain-rejection-replay-repro.mjs
node .vercel/audit-app-oct22/spv-sticky-note-repro.mjs
node .vercel/audit-app-oct22/auth-onboarding-repro.mjs
node .vercel/audit-app-oct22/outlet-location-scope-repro.mjs
node .vercel/audit-app-oct22/face-camera-late-repro.mjs
npx.cmd playwright test --config .vercel/audit-app-oct22/playwright.config.ts
```

## Snapshot Preview sebelum perbaikan (read-only)

- Supabase saat audit awal: `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, region `ap-southeast-2`, `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.003`. Snapshot memiliki 17 migration, terakhir `20261021154511_cashier_followup_context_locking`. Migration penutupan temuan yang baru ditambahkan masih lokal dan belum diterapkan ke Preview.
- Vercel saat audit awal, alias `hr-rajaklana-jkt-preview.vercel.app`: deployment `dpl_F4Jr21n9KnL3nggQV2UJc7kmg3qh`, source Git repo `yoga12-rgb/hr-rajaklana-jkt`, branch `codex/preview`, SHA sama dengan HEAD audit, Preview (`target:null`), `READY`, tanpa alias error. Perbaikan lokal belum dirilis. Ini bukti source/rilis baseline, bukan workflow.
- Dataset Preview saat snapshot: 3 karyawan aktif, 2 outlet aktif, 4 assignment, 2 absensi, 0 pengajuan cuti. Cuti yang lulus pada suite tidak diklaim sudah diuji lewat transaksi hosted berdasarkan dataset ini.
- Semua **18 tabel public** mempunyai RLS. Dua tabel private tanpa RLS (`request_limits`, `spv_followup_context_repair_log`) tidak mempunyai schema USAGE maupun SELECT untuk anon/authenticated. Tidak ditemukan paparan client dari pemeriksaan ACL tersebut; ini bukan pengganti seluruh audit keamanan.
- Edge Functions `hr-api` v4 dan `push-dispatch` v1 aktif. Worker host mengarah ke ref Preview yang benar dan secret terkonfigurasi (nilainya tidak dibaca/ditampilkan).
- Cron `hr-push-minute` aktif setiap menit, 1.440 eksekusi `succeeded` dalam 24 jam. Outbox: 9 delivered, 0 pending, 0 abandoned; delivery terakhir 19 Oktober. Bukti ini menunjukkan mekanisme backend pernah mengirim, bukan penerimaan push pada iPhone saat audit sekarang.
- Konektor runtime logs Vercel menolak 403. Fallback CLI resmi pada tim/project/deployment yang sama selesai tanpa entry error dalam window yang diminta; tidak ada klaim bahwa seluruh request aplikasi hosted telah berjalan. Preview juga dilindungi Deployment Protection sesuai bukti sebelumnya; audit ini tidak mengubah proteksi atau meminta kredensial.
- Log Supabase dalam 24 jam memuat delapan ERROR PostgreSQL: `P0001` (6), `42883` (1), `42703` (1). Pesan/konteks per request belum dipetakan; jangan menyimpulkan semuanya error aplikasi atau semuanya aman. Query awal memakai atribut level yang tidak tersedia, kemudian diperbaiki ke `parsed.error_severity`; angka nol dari query awal tidak dipakai sebagai bukti. Upaya mengambil field `body` ditolak schema log, sehingga isi pesan belum dipakai untuk klasifikasi.

## Advisor dan batas audit

Advisor tidak diperlakukan sebagai daftar bug operasional otomatis. Ada warning [pg_net di public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [33 RPC security definer yang dapat dieksekusi authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [perlindungan password bocor belum aktif](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), dan [opsi MFA terbatas](https://supabase.com/docs/guides/auth/auth-mfa). RPC publik yang memang menjadi API harus dinilai bersama pemeriksaan aktor/otorisasi; jangan mengganti seluruhnya menjadi invoker atau mencabut EXECUTE secara massal karena dapat merusak aplikasi. Suite database menguji batas akses, tetapi hardening akun admin tetap perlu ditinjau sebelum operasional penuh.

Informasi performance: 25 foreign key tanpa covering index (termasuk fixture), 14 index belum digunakan, satu tabel audit fixture tanpa primary key. Dataset masih kecil; tidak ada load test dalam audit ini. Jangan menghapus index hanya karena belum digunakan pada Preview. Rujukan: [foreign key index](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [primary key](https://supabase.com/docs/guides/database/database-linter?lint=0004_no_primary_key).

Batas V05 dari laporan sebelumnya tetap terbuka: bukti concurrency dua sesi menggunakan fixture sintetis, belum kedua helper aktual pada tabel public. Audit ini tidak menjalankan concurrency yang mengubah data hosted untuk menutupnya. Tidak ada klaim Production, perangkat nyata, cold-start inferensi wajah, atau update PWA lintas versi telah lulus.

## Langkah berikutnya

1. Rilis perubahan ke branch `codex/preview`, lalu terapkan migration baru hanya setelah ref Supabase Preview `lypsqrwjzrmuyqtdcegr` dan project Vercel Preview diverifikasi kembali. Production dan `main` berada di luar cakupan.
2. Setelah deployment, jalankan alur hosted dengan akun uji: login, simpan/replay jadwal, penolakan benturan cuti dan percobaan ulang, perubahan data/peran, serta pembukaan kembali tautan reset. Jangan menganggap build `READY` sebagai hasil alur.
3. Uji iPhone/iPad PWA nyata untuk izin kamera/lokasi/notifikasi, stream kamera yang dibuka/tutup berulang, resume dari background, dan update versi PWA. Hasil viewport mobile Edge tidak menggantikan pemeriksaan tersebut.

Status APP-01–APP-08: **diperbaiki dan lulus regresi lokal sesuai bukti di atas; verifikasi hosted dan perangkat masih terbuka.** Aplikasi berjalan normal pada skenario lokal yang diuji, tetapi belum dapat dinyatakan siap operasional penuh sebelum langkah hosted dan iPhone/PWA selesai.

## Kelanjutan rilis Preview — 23 Oktober 2026

- Review sebelum rilis menutup tambahan interleaving APP-01: settlement memakai snapshot awal untuk validasi, dan planner hanya mengakui snapshot yang benar-benar ditulis/diterapkan. Snapshot tab lain yang belum diterapkan tidak boleh dianggap sebagai versi milik tab ini. Regresi interleaving baru lulus.
- APP-03 juga mempertahankan draft penyelesaian saat hanya menyimpan progres; APP-04 mode demo kini memulihkan akun yang pernah aktif setelah nonaktif/reload/aktif tanpa mengganti identitas dan kredensial. Akun yang belum pernah diaktifkan tidak dibuka.
- Identitas Supabase `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf` diverifikasi kembali. Baseline aktual tepat 17 migration; dry-run hanya menampilkan `20261022170000_close_readiness_audit_findings.sql`. Preflight historis 13-migration tidak dijalankan pada Preview 17-migration.
- CLI resmi menerapkan tepat migration tersebut; pemeriksaan sesudahnya mengonfirmasi history 18 migration, RPC atomik tersedia, anon ditolak, authenticated dapat memanggil RPC yang dijaga `require_hr`, serta inspect token tetap khusus service role. Seluruh tabel public tetap menggunakan RLS.
- Jumlah sebelum/sesudah migration: 3 karyawan, 4 peran, 4 assignment dan 25 audit events. Tidak ada akun `active/disabled/Auth-linked` atau inactive linked pada preflight. Tidak ada reset, penghapusan riwayat, atau backfill akun massal.
- Probe database hosted [verify-readiness-preview.sql](../supabase/deployment/verify-readiness-preview.sql) lulus: authenticated RPC menjalankan disable/perubahan peran/reaktivasi dengan identitas sama, lalu mandatory rollback mengembalikan data, audit, peran dan konteks JWT/role. Harness lokal [verify-readiness-preview.test.mjs](../supabase/deployment/verify-readiness-preview.test.mjs) juga menguji dua probe berulang dan fail-closed tanpa fixture aman. Ini bukti lapisan database hosted, bukan login Supabase Auth melalui browser.
- Advisor sesudah migration menambah satu warning RPC SECURITY DEFINER yang memang menjadi API HR (33→34); batas `require_hr`, EXECUTE dan search_path diperiksa. Warning lain sama dengan baseline dan tidak dicabut massal.
- Vercel terverifikasi melalui CLI resmi setelah konektor mengembalikan 404: tim `team_S1Sn08iaksD0GQF4kk49kTkH`, project `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`, repo `yoga12-rgb/hr-rajaklana-jkt`; production branch `main`, branch rilis ini `codex/preview`.
- Pemeriksaan lokal final: 415/415 unit, check 0 error/0 warning, build SPA/PWA lulus, demo browser/PWA 22/22 dan live-mock 10/10 tanpa skipped. Hasil deployment dicatat setelah selesai. Halaman login Preview tersedia; sesi Admin HR belum tersedia untuk verifikasi workflow browser.
