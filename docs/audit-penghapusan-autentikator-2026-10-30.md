# Audit hasil penghapusan autentikator — 30 Oktober 2026

## Kesimpulan

Hasil belum dapat dinyatakan tuntas. Ada **tiga temuan baru**: satu regresi UI pada refresh token serta dua celah gate keamanan/regresi. Penghapusan UI/guard MFA, migration maju dan retirement recovery sudah tersedia di Preview. Penonaktifan toggle Auth remote dan penerimaan workflow hosted/perangkat masih terbuka sesuai laporan sebelumnya.

Audit ini tidak menerapkan perbaikan, deployment, atau perubahan Auth/database remote. Reproduksi pelemahan policy/grant hanya dilakukan pada PGlite terisolasi. Test audit sementara pada file source sudah dikembalikan; migration applied tidak diedit. Production/main tidak disentuh.

## Baseline dan bukti aktual

- Branch `codex/preview`, SHA `4cafee36d4586e98e3753060b49eaee2a7582418`; worktree awal bersih. Tidak ada `.codegraph/`.
- Diff dari `d094f8c` menambah satu migration `20261030031318_retire_application_authenticator.sql`; file migration lama tidak berubah.
- Supabase `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, `ACTIVE_HEALTHY`; 26 migration, terakhir hosted `20261030033256 retire_application_authenticator`.
- Query katalog baca-saja membuktikan guard aktif memeriksa akun dan session live, `requires_mfa=false`, tidak lagi membaca faktor. Ada 29 restrictive session policy public, 1 Storage; pemeriksaan predikat public tidak menemukan drift. Kedua RPC recovery tidak memiliki EXECUTE untuk anon/authenticated/service_role.
- Auth: **0 faktor**, **0 recovery record** saat audit. Ini snapshot saat pemeriksaan, bukan bukti enrollment telah dibekukan.
- Permintaan diagnostik Preview ke `recover_mfa` menghasilkan **HTTP 410** dengan pesan penghentian tetap.
- Vercel deployment `dpl_7mMg6BdyopNFGL4nTFjQVEcTgeaU` READY, target Preview, source SHA sama, alias `hr-rajaklana-jkt-preview.vercel.app` dan alias branch sesuai.
- [CI run 40999912878](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/40999912878) completed/success pada SHA audit. CI yang hijau tidak menutup celah cakupan yang diuraikan di bawah.

## Temuan baru

### AR-01 — P1: refresh token biasa membongkar halaman dan state formulir aktif

Lokasi: `src/lib/state/app.ts:559` dan jalur serupa `:433`; dampak rendering di `src/routes/(app)/+layout.svelte:47`.

Kondisi baru memperlakukan setiap perubahan access token seperti pergantian akun: callback memanggil `clearLiveState(null, true)` walaupun ID pengguna sama dan sesi tetap sah. Helper tersebut mengganti state menjadi `initialized=false`, `user=null`, dan melepaskan channel. Layout lalu menghapus seluruh shell/slot. Formulir yang hanya ada di memori komponen hilang; halaman absensi juga menjalankan `onDestroy(close)` yang membersihkan kamera/selfie.

Reproduksi unit sementara memakai mock existing: init Admin HR → ganti access token saja, user tetap sama → kirim `TOKEN_REFRESHED` → tangkap state sebelum refresh data selesai → tunggu validasi selesai. Expected state selama rotasi tetap memiliki UI akun yang sama; actual `{initialized:false,userId:null}`. Test terarah gagal seperti yang diprediksi. Ini kegagalan baru yang tidak ditangkap 466 test existing.

Perbaikan: pisahkan invalidasi generasi/token read dari penghapusan identitas/komponen. Pertahankan penolakan respons lama serta pemeriksaan sesi sebelum data baru dipublikasi; kosongkan data ketika akun berganti atau sesi ditolak. Tambahkan browser regression refresh token saat form cuti/karyawan, draft/replay supervisor dan selfie aktif. Jangan menghapus live-session validation untuk menutup temuan ini.

### AR-02 — P2: probe final menerima pelemahan kontrol akses

Lokasi: `supabase/deployment/verify-authenticator-removed-preview.sql:8` dan `:18–29`.

Probe mengganti pemeriksaan ordered history, ACL24, seluruh restrictive public policy dan predikat Storage dengan count26 serta beberapa existence checks. Source guard hanya dicari dengan substring `requires_mfa`; keberadaan nama policy Storage tidak memastikan predikat atau target role masih benar. Grant recovery juga hanya diperiksa pada dua kombinasi role/function.

Reproduksi pada PGlite, masing-masing dipulihkan sebelum skenario berikutnya: probe tetap lulus setelah (1) authenticated diberi INSERT pada `shift_handovers`, (2) restrictive policy `employees` dihapus, (3) predikat restrictive Storage diganti `true`, dan (4) nama migration foundation diganti sambil count tetap26. Output harness tetap menyatakan `Authenticator removal LOCAL OK`.

Reproduksi tersedia lokal di `.vercel/audit-auth-retirement-probe.mjs`, dijalankan dengan `node .vercel/audit-auth-retirement-probe.mjs`. File ini hanya mengubah fixture lokal dan tidak mengakses database hosted.

Perbaikan: bawa kembali kontrak katalog yang masih relevan dari probe25, adaptasikan khusus password-only, periksa ordered names/history, seluruh RLS/policy/role/USING/WITH CHECK, ACL24, rantai helper/session dan semua grant recovery. Tambahkan negative mutation tests yang wajib menolak keempat pelemahan di atas dan grant anon/service_role yang tidak semestinya. Jalankan hosted probe dalam transaksi `BEGIN READ ONLY`. Temuan ini menunjukkan kelemahan deteksi; audit tidak menemukan empat pelemahan tersebut telah diterapkan pada Preview.

### AR-03 — P2: suite pengganti belum mempertahankan regresi sesi, Storage, operator dan upgrade25

Lokasi: `package.json:31`, `supabase/tests/authenticator-removal.mjs:35`, `supabase/tests/auth-session-fixture.mjs:14`, `supabase/tests/followup-upgrade-compatibility.mjs:228`, dan `tests/live-mfa.spec.ts:20`.

`test:database` mengeluarkan `mfa-enforcement.mjs`, tetapi harness baru hanya membuktikan satu admin aal1 tanpa faktor, SELECT employee, satu RPC recovery ditolak, dan session expired. Regresi session/user mismatch, missing/malformed session, Storage read/insert/delete setelah revokasi, dan operator managed network yang ada pada harness lama belum dipindahkan seluruhnya. Harness lama masih menerapkan semua26 migration lalu menjalankan probe25: menjalankannya langsung gagal `Expected exact ordered MFA Preview baseline 25`, sebelum tes operator dijalankan.

Fixture bisnis utama tetap default aal2 dan selalu membuat faktor verified, termasuk ketika dipanggil dengan aal1. Test browser berjudul `admin with no factor` juga memakai fixture yang selalu menyertakan faktor legacy verified. Jalur upgrade menanam data pada baseline24 lalu menerapkan25+26; tidak ada checkpoint actual25 yang lebih dulu berisi recovery/audit/receipt lalu membuktikan semuanya identik sesudah26. Kasus18 berhenti pada25. Log harness final mengklaim history preservation padahal hanya memeriksa tabel recovery masih ada.

Perbaikan: fixture final default aal1 tanpa faktor; faktor historis hanya opt-in. Pindahkan tes sesi/Storage/operator yang tetap relevan ke gate aktif. Batasi harness historis25 tepat sampai25. Tambahkan actual25→26 dengan recovery pending/failed/completed, audit, receipt dan snapshot sebelum/sesudah; teruskan18 sampai final dengan preflight21 pada batas yang benar. Pisahkan fixture browser tanpa faktor dari fixture legacy factor. Tambahkan tes cleanup operator dry-run/partial failure/re-list/absent/retry memakai manifest asli seperti AUTH-04. AUTH-05 belum memenuhi seluruh acceptance panduan hanya karena gate existing lulus.

## Bagian yang tetap terbuka dan koreksi bukti

1. **AUTH-06 / konfigurasi Auth remote:** laporan progres sendiri menyatakan enrollment freeze dan toggle remote belum diterapkan. Nol faktor tidak cukup membuktikan pendaftaran baru ditolak. Endpoint publik `/auth/v1/settings` tidak mengekspos toggle TOTP, sehingga audit ini tidak mengklaim telah membaca nilai efektifnya. Perlu update hanya dua flag yang relevan melalui mekanisme scoped, disusul verifikasi effective config dan penolakan enrollment/verify. `config push` penuh sebelumnya ditolak auto-review karena dapat menimpa konfigurasi layanan lain; audit ini tidak mencobanya lagi.
2. **AUTH-04 / bukti cleanup dan drain:** HTTP200 cleanup dan nol faktor dapat dikonfirmasi sebagai hasil, tetapi status `selesai` dan frasa `snapshot sesudah drain` belum didukung artefak operator teruji, freeze terlebih dahulu, manifest persisten/operator key, atau bukti batas runtime/drain. Jangan mengarang bukti retrospektif. Koreksi status persiapan/reproduksi dan catat ketidakpastian urutan secara jujur; jangan mendaftarkan faktor baru hanya untuk merekonstruksi uji hosted.
3. **Workflow hosted/perangkat:** login password-only nyata lintas role, logout/login ulang, tab lama, update PWA dengan draft, Auth/Storage end-to-end belum dibuktikan oleh audit ini. PVR-02/offline/iPhone/iPad tetap ditunda dan tidak boleh berubah menjadi lulus dari status deployment READY.
4. **Runbook lama:** `docs/mfa-rollout-recovery.md:7` masih menyatakan MFA wajib dan instruksi mengaktifkan TOTP tanpa banner superseded/link keputusan baru. Beri penanda historis agar operator berikutnya tidak mengaktifkannya kembali. Bukti uji lama tetap dipertahankan.
5. **Risiko existing pg_net:** snapshot katalog Preview masih memberi schema USAGE serta EXECUTE pada12 fungsi net kepada anon dan authenticated. Tidak ada fungsi jaringan yang dieksekusi oleh audit ini; hak katalog ini bukan bukti bahwa seluruh fungsi tersebut langsung terekspos melalui Data API. Temuan operator existing tetap perlu ditangani/diputuskan tersendiri. [Rujukan advisor extension](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

## Validasi audit dan batas hasil

| Pemeriksaan | Hasil aktual |
| --- | --- |
| Unit existing `npm.cmd test -- --maxWorkers=1` | 37 file, 466 passed; run sandbox awal gagal EPERM sebelum tes, rerun di luar sandbox lulus |
| Reproduksi refresh token sementara | 1 failed sesuai temuan AR-01; 20 skipped karena filter tes terarah, bukan dianggap suite wajib lulus; perubahan test sementara sudah dipulihkan |
| `node supabase/tests/authenticator-removal.mjs` | Lulus, dengan batas cakupan AR-02/AR-03 |
| `npm.cmd run test:database` | Lulus penuh: database bisnis, upgrade, biometric/push dan harness final; celah cakupan AR-02/AR-03 tetap berlaku |
| `node supabase/tests/followup-upgrade-compatibility.mjs` | Lulus18→25,24→26,historis12→26; belum membuktikan checkpoint populated25→26 |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | Historical23 lulus; bukan probe final26 |
| `node supabase/tests/mfa-enforcement.mjs` | Gagal pada ordered baseline25; harness historis belum dibatasi tepat25 |
| Mutation probe PGlite terisolasi | 4 pelemahan sengaja diterima, mereproduksi AR-02 |
| Remote Preview | Identitas/history/source/policy/grants/factor count diperiksa baca-saja; recovery410 diperiksa tanpa menjalankan recovery |
| CI SHA4cafee3 | Success; build dan browser existing tetap hijau, tidak meniadakan temuan baru |

Prioritas berikutnya: tutup AR-01, kuatkan probe dan regresi AR-02/AR-03, lengkapi konfigurasi Auth remote serta bukti AUTH-04/06, lalu validasi hosted. Penghapusan autentikator adalah keputusan pengguna yang tetap berlaku; audit ini tidak merekomendasikan mewajibkannya kembali.
