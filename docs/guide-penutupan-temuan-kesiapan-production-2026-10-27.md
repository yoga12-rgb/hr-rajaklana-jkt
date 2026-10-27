# Panduan penutupan temuan kesiapan Production — 27 Oktober 2026

Dokumen ini adalah acuan kerja agent implementasi berikutnya. Tujuannya menutup temuan audit keamanan dan membuktikan alur operasional sebelum versi terbaru dipakai untuk HR Rajaklana. Status `READY` di Vercel berarti build/deployment selesai; status itu tidak membuktikan login, transaksi, Realtime, PWA, atau perangkat nyata lulus.

## 1. Baseline dan keputusan rilis

Snapshot yang diperiksa pada 27 Oktober 2026; **verifikasi ulang sebelum bertindak**:

| Lingkungan | Vercel alias dan source | Supabase | Riwayat migration |
| --- | --- | --- | --- |
| Preview | `hr-rajaklana-jkt-preview.vercel.app`, `codex/preview` `63ce080`, deployment `dpl_4TLtGaRMm8JCQvVkxVPfG6qdTuXS`, `READY` | `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr` | 23; terakhir supervisor configuration concurrency |
| Production | `hr-rajaklana-jkt.vercel.app`, `main` `94cd993`, deployment `dpl_CKjQ6s1B47kYqjyHSLRCdvzZSx7n`, `READY` | `Rajaklana`, ref `iywvnopsooroediwawnd` menurut [pemetaan lingkungan](deployment-environments.md) | 12; terakhir `20261018162525_push_subscription_status` |

Kedua proyek Supabase `ACTIVE_HEALTHY`. Pemetaan Supabase Production dalam tabel berasal dari dokumen proyek dan daftar proyek; nilai environment deployment belum dibaca. Periksa identitas target dari metadata Vercel dan URL publik Supabase tanpa mencetak kunci atau secret.

**Keputusan saat ini: belum siap untuk Production penuh.** Preview masih memiliki Auth yang perlu penguatan dan gerbang browser/perangkat yang belum lulus. Jalur upgrade database Production belum dijalankan; fixture lokal sekarang mencakup **12→13→m14–m24**, sedangkan fixture terdahulu hanya mencakup 13→23 dan 18→23. Source terakhir lulus 35 suite/440 tes, database, build, PWA lokal, dan live-mock, tetapi hasil lokal tidak menutup gerbang hosted.

Target implementasi awal hanya `codex/preview` dan Supabase Preview yang ref-nya diverifikasi. Production dan `main` hanya diperiksa secara baca-saja sampai rancangan upgrade, hasil Preview, serta keputusan rilis ditinjau. Dokumen ini sendiri bukan instruksi menjalankan migrasi atau deploy ke Production.

## 2. Aturan pengerjaan

1. Mulai dengan branch, SHA, `git status`, remote, project ref, riwayat migration **berdasarkan versi dan nama**, Vercel project/alias, serta daftar perubahan pengguna. `.codegraph/` tidak ada pada snapshot ini; jika kemudian ada, gunakan CodeGraph sebelum pencarian source. Jangan menimpa perubahan yang belum di-commit.
2. Jangan mengedit migration yang sudah diterapkan, menjalankan reset/`migration repair`, menghapus audit atau data operasional, atau memakai satu `db push` generik untuk mengejar selisih Production. Pertahankan transaksi atomik, baseline/revision checks, key **dan payload asli** replay, RLS, riwayat kasus, dan recovery draft per akun.
3. Jangan menampilkan secret, JWT, cookie, URL selfie bertanda tangan, gambar biometrik, atau data HR dalam log, artefak, dan tangkapan layar. Gunakan fixture uji teridentifikasi; pulihkan melalui operasi bisnis biasa dan simpan auditnya.
4. Perubahan schema dibuat sebagai migration **baru** melalui CLI yang versinya dan `--help` sudah diperiksa. Untuk tes SQL, pakai fixture lokal/PGlite dan transaksi rollback; pemeriksaan hosted awalnya baca-saja. Jangan menjalankan probe DML pada tabel operasional nyata demi membuktikan RLS.
5. Setelah tiap milestone, isi catatan progres: SHA, target/ref, tes yang benar-benar dijalankan, lulus/gagal/skipped, bukti hosted, sisa risiko, dan status `selesai`, `terbatas`, atau `terbuka`. `Ready`, HTTP 200, dan tes skipped tidak boleh ditulis sebagai keberhasilan workflow.

## M0 — bekukan baseline dan reproduksi temuan

**Kerjakan:**

- Cocokkan `HEAD`, `origin/codex/preview`, worktree, migration source, Preview m23, dan Production m12. Migration ke-13 adalah `20261019061522_cashier_spv_weekly_roster.sql`; migration ke-14 `20261020060745_cashier_spv_audit_repairs.sql`. Riwayat remote dapat memakai timestamp berbeda dari filename source: cocokkan nama, urutan, dan isi penting, bukan hitungan saja.
- Ambil snapshot baca-saja ACL, RLS/policy, `EXECUTE` RPC, dan advisor kedua Supabase. Ulangi query `has_table_privilege`/`pg_catalog` untuk target tabel; simpan hasil tanpa nilai data HR.
- Verifikasi target Vercel, branch Production, alias, commit, status, environment variable **nama/target/ref** tanpa membaca atau menampilkan nilainya. Bedakan source Preview dari source Production.
- Reproduksi ACL terlalu luas pada fixture yang meniru grant default hosted. Pastikan tes negatif gagal pada baseline sebelum migration perbaikan.
- Catat batas uji yang masih terbuka dari [progres supervisor](progres-supervisor-2026-10-23.md) dan [panduan PWA](guide-penutupan-celah-audit-2026-10-26.md): PWA hosted, iPhone/iPad, SPV-11 dua akun, dan alur login/reset yang memerlukan pengguna.

**Checkpoint M0:** satu tabel temuan berisi bukti baseline, risiko aktual, dan tes penutupnya. Temuan ACL adalah pelanggaran least privilege yang terkonfirmasi; **belum ada bukti bypass RLS**. Jangan mengubah Production.

## M1 — perketat ACL tabel operasional Preview

**Masalah yang dibuktikan pada Preview:** RLS aktif, tetapi `anon` memiliki hak tulis pada lima tabel handover/exchange; `authenticated` memiliki hak tulis pada tabel tersebut, lima tabel issue/config, dan `staffing_interval_requirements`. Policy tabel terkait saat ini hanya mengizinkan SELECT; direct write tertahan oleh RLS. `pg_default_acl` Preview menunjukkan default privilege tabel `public` yang memberi hak luas kepada `anon`/`authenticated`; `GRANT SELECT` tanpa `REVOKE` tidak mempersempitnya. Grant yang terlalu luas tetap berbahaya jika policy bergeser.

| Kelompok | Tabel public yang harus diperiksa |
| --- | --- |
| Anon dan authenticated memiliki DML berlebih | `shift_handovers`, `shift_handover_versions`, `shift_handover_events`, `shift_exchange_requests`, `shift_exchange_events` |
| Authenticated memiliki DML berlebih | `supervisor_issue_categories`, `supervisor_capabilities`, `supervisor_issue_routes`, `outlet_issues`, `outlet_issue_events`, `staffing_interval_requirements` |

Sumber kelalaian grant ada pada [supervisor operations](../supabase/migrations/20261023181824_supervisor_operations.sql) dan [planning reports](../supabase/migrations/20261023183130_supervisor_planning_reports.sql). Jangan memperbaiki file migration lama.

**Implementasi:**

1. Inventarisasi ACL efektif per role dan operasi, policy RLS, ketergantungan client SELECT, RPC penulis, dan `service_role`. Tambahkan tes regresi yang meniru default privilege/grant luas hosted; harness PGlite lama mungkin tidak meniru default grant tersebut. Jangan mengubah default privilege platform secara massal tanpa analisis dampak pada tabel aplikasi lain.
2. Buat migration maju baru yang mencabut hak berlebih dari `PUBLIC`, `anon`, dan `authenticated` pada tabel yang tepat; berikan kembali hanya SELECT yang memang dibutuhkan UI/RPC. Jangan mencabut hak `service_role`/owner atau SELECT yang sah secara membabi buta. Tinjau default privileges untuk tabel berikutnya agar kesalahan sama tidak terulang.
3. Uji langsung sebagai `anon` dan `authenticated`: INSERT/UPDATE/DELETE ditolak pada fixture lokal, SELECT mengikuti RLS, dan RPC berotorisasi tetap dapat menulis. Uji kasir, Admin HR, SPV berbeda, akun nonaktif, dan outlet di luar scope. Pastikan audit, konflik versi, serta replay key/payload tetap benar.
4. Terapkan ke Preview hanya setelah identitas/ref, dry-run tepat satu migration baru, dan hasil lokal disetujui oleh bukti. Verifikasi `has_table_privilege`, policy, RPC, dan advisor sesudahnya. Probe hosted yang mengubah fixture harus menggunakan rollback eksplisit dan tidak menyentuh data operasional.

**Selesai M1 bila:** tidak ada DML langsung berlebih untuk `anon`/`authenticated`, akses SELECT yang sah dan seluruh RPC bisnis tetap bekerja, serta tes ACL lokal dan pemeriksaan ACL Preview sama-sama lulus. Laporkan setiap pengecualian secara spesifik.

## M2 — keamanan akun Admin HR dan SPV

Supabase Advisor pada **kedua** proyek masih melaporkan leaked-password protection nonaktif dan pilihan MFA kurang memadai. Paket Supabase yang terdokumentasi saat ini Free. [Perlindungan password bocor hanya tersedia pada Pro ke atas](https://supabase.com/docs/guides/auth/password-security); jangan menganggap toggle itu dapat diaktifkan pada Free atau melakukan upgrade berbayar tanpa keputusan pengguna.

**M2a — kebijakan password:** periksa aturan minimum saat aktivasi, bootstrap, reset, dan perubahan password serta rate limit login. Pertahankan minimal 10 karakter yang sudah ada; uji penolakan password lemah, token sekali pakai, dan pesan kegagalan yang tidak membocorkan identitas. Untuk go-live, catat pilihan eksplisit: aktifkan fitur kebocoran pada Supabase Pro dan verifikasi advisor, atau tulis kontrol kompensasi yang diuji beserta risiko yang masih diterima. Selama di Free, warning ini tetap `terbuka`, bukan `selesai`.

**M2b — MFA berhak istimewa:** saat ini [login](../src/routes/login/+page.svelte), [state](../src/lib/state/app.ts), dan [Edge `hr-api`](../supabase/functions/hr-api/index.ts) mengakhiri login setelah password tanpa `auth.mfa`/`aal2`. Menyalakan opsi MFA pada dashboard saja tidak cukup. Bangun alur TOTP untuk pendaftaran faktor, challenge/verifikasi sesudah password, kehilangan/pemulihan faktor yang diaudit, dan peralihan akun. Tentukan secara eksplisit siapa yang wajib MFA: Admin HR dan setiap SPV yang dapat menjalankan aksi berhak istimewa; kasir tetap dapat memakai alur biasa kecuali kebijakan berubah.

Tegakkan `aal2` pada **server dan RPC privileged**, bukan hanya menyembunyikan tombol. Banyak RPC menggunakan `SECURITY DEFINER` sehingga policy RLS pada tabel tidak otomatis membatasi badan fungsi. Periksa seluruh API server/Edge yang memakai service key, akses role, dan token JWT; gunakan otorisasi yang tidak bergantung pada `user_metadata` yang dapat diubah pengguna. Sediakan alur bagi sesi `aal1` untuk menyelesaikan challenge tanpa bisa menjalankan aksi HR/SPV. Rancang migrasi akun lama dan proses recovery agar admin tidak terkunci atau dapat melewati MFA secara diam-diam. Ikuti [panduan MFA Supabase](https://supabase.com/docs/guides/auth/auth-mfa).

**Tes wajib:** password benar tetapi `aal1` ditolak oleh UI **dan** pemanggilan RPC/API langsung untuk aksi HR/SPV; `aal2` berhasil sesuai role/scope; akun kasir tidak mendapat hak HR setelah MFA; faktor dicabut/recovery menurunkan akses dengan benar; reload, dua tab, reset password, pergantian akun, dan akun nonaktif diuji. Jangan simpan seed TOTP atau recovery code di repo/log.

**Selesai M2 bila:** enforcement MFA telah dibuktikan end-to-end pada Preview dan jalur recovery didokumentasikan. Warning password bocor hanya ditutup setelah pengaturan aktual tersedia dan diverifikasi pada target go-live; alternatif kompensasi harus tetap dicatat sebagai risiko residual.

## M3 — tinjau permukaan database lainnya

1. Advisor Preview menandai sekitar **60** RPC `SECURITY DEFINER` yang dapat dieksekusi `authenticated`. Inventarisasi satu per satu: API publik yang memang perlu dipanggil, helper internal, `EXECUTE` efektif, `search_path`, actor/role/ownership check, dan tes direct-call. Jangan mencabut semua `EXECUTE` atau mengubah semua fungsi menjadi invoker karena transaksi aplikasi dapat rusak. Cabut akses internal yang tidak perlu melalui migration baru dan uji penolakan anon/role yang salah.
2. `pg_net` terpasang di schema `public`. Tinjau dependency, grant, dan dukungan relokasi versi extension sekarang. Jika aman, pindahkan dengan migration maju yang diuji pada fixture/Preview; jika tidak aman, minimalkan grant yang relevan dan catat alasan serta risiko residual. Jangan memindahkan extension secara spekulatif.
3. `public.account_tokens` dan `public.cashier_roster_batches` memiliki RLS tanpa policy dan saat ini fail-closed untuk akses langsung. Buktikan grant/akses efektif dan jalur RPC/service yang disengaja; dokumentasikan desain atau pindahkan ke schema private lewat perubahan kompatibel jika terbukti lebih aman. Jangan menambah policy permisif hanya untuk menghilangkan warning.
4. Performance advisor (foreign key tanpa index, index belum dipakai, satu tabel audit historis tanpa PK) dinilai terpisah dengan query plan/data representatif. Jangan menghapus index atau mengubah tabel audit hanya karena linter; beri prioritas setelah keamanan dan workflow.

**Selesai M3 bila:** setiap warning mempunyai keputusan dengan bukti (`diperbaiki`, `diterima sementara`, atau `terbuka`), dan tidak ada RPC internal tanpa otorisasi yang dapat dipanggil role publik. Untuk risiko yang diterima sementara, tulis pemilik dan syarat peninjauan ulang.

## M4 — regresi lokal dan gate CI

Jalankan suite yang sesuai setelah setiap perubahan schema/Auth, lalu gate lengkap sebelum push:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
npm.cmd run build
npm.cmd audit --audit-level=moderate
```

Jalankan browser PWA lokal dan live-mock **secara eksplisit** menurut [matriks perintah supervisor](guide-goal-milestone-supervisor-2026-10-23.md); `npm run test:e2e` polos dapat melewatkan kedua kelompok. Sertakan persist/reload/retry, penolakan domain, respons commit yang hilang, konflik baseline, dan replay memakai key/payload awal. Tambahkan regresi ACL/MFA yang menguji perilaku dari endpoint nyata, bukan hanya memeriksa teks migration. CI saat ini menjalankan check/unit/database/legacy/readiness/build, sedangkan browser E2E dan hosted belum menjadi gate otomatis; putuskan cara mengikat hasilnya sebelum rilis Production.

**Selesai M4 bila:** semua tes relevan lulus tanpa skipped pada kelompok yang diwajibkan, build berhasil, dan hasil dapat direproduksi dari SHA yang sama. Kegagalan sandbox/perizinan mesin dibedakan dari kegagalan aplikasi, lalu rerun yang sah dicatat.

## M5 — buktikan alur Preview hosted dan perangkat

Setelah migration, Edge Function, dan deployment Preview mengarah ke SHA/ref yang benar, uji dengan akun uji berwenang di hostname yang sama:

- **SPV-11:** dua identitas SPV/Admin HR yang berbeda menjalankan login → tindakan UI (kasus, penugasan, serah-terima/tukar shift, persetujuan sesuai role) → RPC/database → Realtime di sesi kedua → reload → riwayat audit. Sertakan konflik dua editor, otorisasi outlet, akun kasir/nonaktif, dan pemulihan retry. Batalkan fixture melalui tindakan bisnis normal; jangan hapus audit.
- **PWA/T-01:** pada browser biasa yang lolos Vercel Authentication untuk alias Preview, buktikan request internal `register('/service-worker.js')` tanpa redirect, worker `activated`, controller sesudah reload, shell aplikasi saat offline, lalu pembaruan versi A→B tanpa menghilangkan draft/selfie yang sedang dipakai. HTTP 200 dari `vercel curl` tidak menutup tes ini. Rujuk [panduan celah PWA](guide-penutupan-celah-audit-2026-10-26.md).
- **iPhone/iPad:** ketika pengguna tersedia, uji instalasi PWA, kamera/selfie dan geofence GPS pada outlet uji, clock in/out, notifikasi opt-in, background/resume, serta update versi. Catat model/iOS/browser, izin, hasil, dan kegagalan tanpa menyimpan foto/token. Pengguna sebelumnya menunda tes offline/perangkat; statusnya tetap `menunggu`, bukan lulus, sampai benar-benar dijalankan.
- **Auth/Storage hosted:** login baru, aktivasi/reset, MFA, akses foto privat sesuai pemilik/role, dan logout/revokasi diuji melalui aplikasi; probe SQL rollback tidak menggantikan pengujian alur ini.

**Selesai M5 bila:** seluruh workflow wajib mempunyai bukti UI → API → data → sesi lain/reload → audit, PWA hosted punya bukti controller/offline/update, dan pengujian perangkat nyata lulus. Catat masing-masing terpisah; jangan menaikkan status perangkat berdasarkan emulator desktop.

## M6 — rancang upgrade Production 12→versi final

Milestone ini menyiapkan keputusan rilis, **bukan perintah untuk menjalankan upgrade Production sekarang**.

1. Verifikasi ref Production `iywvnopsooroediwawnd`, backup/restore yang benar-benar dapat digunakan, jumlah dan bentuk data/Auth/Storage, extension, policy, fungsi, serta 12 versi migration aktual. Jangan mengandalkan dokumen bertanggal saja. Periksa drift dan fungsi yang mungkin dipakai frontend Production lama.
2. Tambahkan fixture upgrade **12→13→preflight sebelum m14→m14–m21→preflight sebelum m22→m22–m23→m24 ACL**. `preflight-followup-off-compatibility.sql` hanya pada history tepat 13; `preflight-supervisor-operational-hardening.sql` hanya pada history tepat 21. Buktikan kondisi gagal sebelum preflight, idempotensi, tidak hilangnya kasus/audit, serta penolakan aman bila baseline berbeda. Fixture 13→23 dan Preview 18→23 lama tidak membuktikan tahap 12→13. Perbarui [harness upgrade](../supabase/tests/followup-upgrade-compatibility.mjs) agar target migration terakhir m24; jalur historis di dalamnya juga harus menjalankan file preflight m22 secara eksplisit, bukan hanya bergantung pada guard migration m22.
3. Susun prosedur penerapan bertahap yang dapat dijalankan pada target tanpa menjalankan semua migration tertunda sekaligus. `supabase db push --dry-run` hanya menampilkan daftar; satu `db push` biasa akan menerapkan semuanya dan tidak memberi jeda preflight. Jangan mengubah migration lama atau menandai versi sebagai applied tanpa SQL berjalan. Periksa `--help` CLI versi aktual dan [referensi resmi](https://supabase.com/docs/reference/cli/supabase-db-push) sebelum menulis perintah final.
4. Tentukan urutan database, Edge Function, environment server, dan frontend yang kompatibel dengan tab frontend lama yang masih terbuka. Siapkan langkah pemulihan maju jika migrasi sudah commit; rollback Vercel tidak mengembalikan schema atau data Supabase. Latih backup/restore pada salinan yang aman, bukan langsung pada Production.
5. Periksa paket sebelum operasional: [Vercel Hobby membatasi penggunaan nonkomersial pribadi](https://vercel.com/docs/plans/hobby), dan proteksi password bocor Supabase memerlukan Pro. Pengguna sebelumnya memilih paket gratis selama uji lalu Pro setelah normal; jangan menaikkan paket atau menimbulkan biaya otomatis. Catat keputusan paket/hosting sebagai gerbang rilis.
6. Vercel saat ini menghubungkan `main` ke domain Production secara otomatis, sedangkan CI belum menjadi deployment gate. Sebelum merge/push `main`, sediakan Deployment Checks atau rilis Production bertahap tanpa assignment domain, lalu uji build dengan environment Production dan promosikan build **Production** yang sama. Jangan menganggap deployment Preview dapat dipromosikan tanpa rebuild/config Production. Ikuti [panduan promosi Vercel](https://vercel.com/docs/deployments/promoting-a-deployment).

**Selesai M6 bila:** fixture 12→versi final dan prosedur preflight bertahap lulus, backup/restore serta kompatibilitas versi teruji, environment dan paket jelas, dan rencana cutover/rollback diputuskan. Production tetap tidak disentuh oleh milestone perencanaan ini.

## M7 — keputusan go/no-go dan rilis terkontrol

Agent menyerahkan tabel berikut untuk ditinjau sebelum rilis Production:

| Gerbang | Bukti minimum | Status awal 27 Okt |
| --- | --- | --- |
| ACL dan RLS | Migration maju, tes negatif direct DML, RPC positif, verifikasi ACL Preview | Terbuka |
| Auth berhak istimewa | MFA TOTP `aal2` end-to-end, bypass RPC/API ditolak, recovery diuji | Terbuka |
| Perlindungan password bocor | Setting aktual pada paket yang mendukung atau risiko kompensasi diterima eksplisit | Terbuka pada Free |
| Security advisor lain | 60 RPC, `pg_net`, dua tabel no-policy diputuskan per item | Terbuka |
| Lokal/CI | Suite penuh, PWA/live-mock eksplisit, 0 skipped relevan, SHA sama | Ulangi setelah perubahan |
| Hosted Preview | SPV-11 dua akun, Auth/Storage, PWA controller/offline/update | Terbuka |
| iPhone/iPad | Kamera, GPS, clock in/out, push, resume/update | Ditunda pengguna |
| Upgrade Production | Fixture 12→final, preflight dua tahap, backup/restore, kompatibilitas | Terbuka |
| Paket dan deployment gate | Hosting komersial sesuai, build Production staged, CI gate, rollback plan | Terbuka |

Keputusan **GO** baru dapat diberikan jika semua gerbang wajib lulus atau risiko residual nonkritis diterima secara tertulis dengan pemilik dan batas waktu. Jika pengguna tetap menunda perangkat, laporkan `NO-GO untuk operasional penuh; Preview pilot terbatas` dan lanjutkan pekerjaan mandiri yang tidak memerlukan perangkat. Setelah rilis yang disetujui, verifikasi SHA/domain/ref, lakukan smoke transaksi berotorisasi dan audit pada Production, amati error/log dan kapasitas, serta catat jalur pemulihan tanpa menghapus data.

## Format laporan agent

Untuk setiap milestone, tulis: `ID | status | source SHA | target/ref | bukti tes | bukti hosted | dampak data/audit | risiko tersisa | langkah berikutnya`. Akhiri dengan empat status terpisah: **implementasi lokal**, **deployment Preview**, **workflow hosted**, dan **iPhone/PWA nyata**, lalu status **rencana/eksekusi Production**. Jika suatu tes memerlukan login/perangkat pengguna, selesaikan pekerjaan mandiri lebih dahulu; pengguna memasukkan kata sandi/faktor sendiri pada halaman resmi, bukan di chat.

## Catatan eksekusi — 27 Oktober 2026

Catatan ini adalah checkpoint eksekusi terhadap panduan di atas. SHA lokal saat checkpoint ini masih `63ce080e29367bffa74f84e6dd5958a512b45e83`; perubahan di bawah belum menjadi bagian dari SHA tersebut sampai commit dibuat. Production dan `main` tidak ditulis.

| ID | Status | Source/target | Bukti yang benar-benar dijalankan | Dampak data/audit | Risiko tersisa / langkah berikutnya |
| --- | --- | --- | --- | --- | --- |
| M0 | selesai | `codex/preview`; Preview `lypsqrwjzrmuyqtdcegr`; Production `iywvnopsooroediwawnd` | Verifikasi metadata proyek, alias/deployment, urutan migration, advisor Security, tabel/kolom/RLS. Preview berada di 23 migration sebelum perubahan; Production tetap 12. | Baca-saja; tidak ada data operasional diubah. | Advisor Preview tetap menampilkan 16 tabel RLS tanpa policy, `pg_net` di `public`, 60 `SECURITY DEFINER`, leaked-password protection, dan MFA. M3/M2 tetap terbuka. |
| M1 | selesai untuk ACL | Migration baru lokal `20261027090000_sensitive_operational_acl_hardening.sql`; Preview migration tercatat sebagai `20261027031129_sensitive_operational_acl_hardening` (connector memakai timestamp sendiri) | `npm.cmd run test:database` lulus. Regresi mereproduksi grant hosted luas, lalu membuktikan `INSERT/UPDATE/DELETE` ditolak untuk `anon` dan `authenticated` pada 11 tabel; `authenticated SELECT` dan RLS tetap aktif. Preview `has_table_privilege` menunjukkan seluruh 11 tabel: DML `false`, SELECT authenticated `true`, RLS `true`. | Hanya ACL yang berubah; tidak ada row, audit, kasus, atau history yang dihapus/ditulis. RPC bisnis tetap diuji positif pada fixture lokal. | Hosted RPC/Realtime/Auth/Storage masih harus diuji lewat workflow aplikasi. Advisor SECURITY DEFINER tetap terbuka sampai inventaris M3 selesai. |
| M4 | selesai untuk gate lokal non-browser | SHA kerja sama dengan tabel di atas | `npm.cmd run check` (0 error/0 warning); Vitest ulang di luar sandbox (35 file/440 test lulus); `npm.cmd run test:database` (database, Preview-style 18→24, historical 12→24, biometric/push lulus); `npm.cmd run test:database:legacy` lulus; `npm.cmd run build` lulus; `npm.cmd audit --audit-level=moderate` menemukan 0 vulnerability. | Fixture memakai transaksi/rollback dan tidak menyentuh hosted data. | Browser E2E, live-mock hosted, PWA controller/offline/update, dan perangkat nyata belum dijalankan. Kegagalan Vitest pertama adalah EPERM sandbox dengan 0 test; rerun resmi lulus. |
| M6 | selesai untuk fixture/prosedur awal | Local migrations 1→24; Production tetap 12 | Harness kini mencakup 12→13→m14 failure→preflight m14→m14–m21→preflight m22 dua kali→m22–m24; juga mempertahankan jalur Preview 18→24. Preflight ganda idempotent, key/payload/revisi, kasus, audit, dan recovery token tetap diperiksa. | Tidak ada upgrade Production, reset, repair, atau penghapusan data. | Backup/restore nyata, drift Production, environment compatibility, staged cutover, dan keputusan paket belum dibuktikan. |
| M2 | terbuka | Preview/Production | Belum mengubah Auth. Advisor masih melaporkan leaked-password protection dan MFA. | Tidak ada perubahan akun. | Perlu desain dan implementasi TOTP `aal2` end-to-end, recovery, dan kontrol kompensasi Free/Pro sebelum go-live. |
| M3 | terbatas — inventory dan fail-closed table selesai | Preview | Advisor menunjukkan 80 fungsi `SECURITY DEFINER`; 60 memiliki `authenticated EXECUTE`, 0 memiliki `anon EXECUTE`, dan seluruh 80 mem-pin `search_path`. `account_tokens`/`cashier_roster_batches` tidak dapat dibaca anon/authenticated, hanya service path; tidak ada fungsi public yang mereferensikan `pg_net`. Regresi lokal memeriksa invariant ini. | Tidak ada perubahan schema selain ACL M1. | Keputusan per-RPC dan bukti direct-call ber-sesi/role masih terbuka. `pg_net` tetap di `public` karena belum ada dependency aplikasi dan relokasi belum dibuktikan aman; jangan mencabut EXECUTE massal. |
| M5 | terbuka/ditunda | Preview alias `hr-rajaklana-jkt-preview.vercel.app`; iPhone/iPad | Belum meminta login/perangkat; PWA dan workflow hosted belum dianggap lulus dari status deployment `READY`. | Tidak ada fixture hosted yang dibuat. | SPV-11 dua akun, Realtime/reload/retry, Auth/Storage, PWA controller/offline/update, dan iPhone/iPad tetap menunggu uji yang memang memerlukan pengguna/perangkat. |
| M7 | NO-GO | Semua | Tidak semua gerbang wajib lulus. | Production/main tetap aman tidak tersentuh. | Status rilis tetap `NO-GO untuk operasional penuh; Preview pilot terbatas` sampai M2, M3, M5, dan keputusan M6 selesai. |

### Detail ACL Preview sesudah M1 dan inventory M3

Query catalog tanpa membaca data HR mengembalikan untuk semua 11 tabel target (`shift_handovers`, `shift_handover_versions`, `shift_handover_events`, `shift_exchange_requests`, `shift_exchange_events`, `supervisor_issue_categories`, `supervisor_capabilities`, `supervisor_issue_routes`, `outlet_issues`, `outlet_issue_events`, `staffing_interval_requirements`): `anon INSERT/UPDATE/DELETE=false`, `authenticated INSERT/UPDATE/DELETE=false`, `authenticated SELECT=true`, dan `RLS=true`. Migration history Preview tetap memiliki nama supervisor lama serta migration ACL baru; perbedaan timestamp connector terhadap filename lokal dicatat sebagai drift nama/version yang tidak mengubah isi migration.

Inventory fungsi hosted yang hanya membaca katalog menunjukkan 80 fungsi public `SECURITY DEFINER`: 60 diekspos ke `authenticated`, tidak ada yang diekspos ke `anon`, dan seluruhnya mempunyai `SET search_path`. Beberapa fungsi mengikat actor melalui helper private seperti `private.require_employee()`, `private.require_hr()`, `private.assert_approver()`, atau capability check; temuan advisor bukan bukti bypass dengan sendirinya. Karena direct-call ber-sesi, dua akun, dan `aal2` belum diuji hosted, M3 tetap terbatas dan tidak ditutup dengan mencabut semua `EXECUTE`.

Untuk warning lain, `pg_net` memang berada di schema `public`, tetapi inventory definisi fungsi public tidak menemukan referensi `net.*`; belum ada alasan aman untuk memindahkan extension secara spekulatif. `public.account_tokens` dan `public.cashier_roster_batches` tetap RLS-enabled, `anon`/`authenticated` tidak memiliki `SELECT`, dan service path memiliki akses yang diperlukan. Keduanya fail-closed tanpa policy sehingga warning tidak dihilangkan dengan policy permisif.

### Catatan tooling dan deployment

CLI Supabase lokal tidak dapat membuat file migration karena telemetry mencoba menulis file sementara di profil Windows dan terkena `EPERM`; file migration dibuat dengan `apply_patch` setelah SQL dan versi CLI diperiksa, lalu diuji penuh di PGlite. Migration hosted diterapkan hanya ke Preview melalui connector setelah inspeksi tabel; Production tidak disentuh. Commit dan deployment Preview harus tetap diverifikasi lagi setelah push: status Vercel `READY` saja bukan bukti workflow.

### Verifikasi post-push

Commit `0bdabffec44fd435619c7202e21f60cecb65b007` sudah dipush ke `origin/codex/preview`. Vercel deployment `dpl_9phXyeei9rb8g97MyMkNxx2eYB3a` kemudian menjadi `READY`, bersumber dari `yoga12-rgb/hr-rajaklana-jkt`, branch `codex/preview`, dan alias Preview `hr-rajaklana-jkt-preview.vercel.app`. Ini membuktikan source/deployment tersinkron; belum membuktikan login, RPC, Realtime, PWA, atau perangkat.
