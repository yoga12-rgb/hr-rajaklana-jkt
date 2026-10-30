# Panduan, goal, dan milestone penghapusan autentikator

Disusun: 29 Oktober 2026. Ditinjau kembali: 30 Oktober 2026. Dokumen ini disiapkan untuk agent implementasi berikutnya. **Pembuatan panduan ini belum menghapus atau menonaktifkan fitur pada aplikasi.**

## 1. Keputusan pengguna dan tujuan

Pengguna memutuskan autentikator/MFA belum diperlukan untuk lingkup HR yang masih kecil. Hasil akhir yang diminta adalah login **nomor karyawan + kata sandi** untuk seluruh peran, termasuk Admin HR, supervisor, Head Baker, dan kasir. Sesudah kredensial benar serta akun/sesi tervalidasi, aplikasi langsung membuka Dashboard sesuai haknya.

Hapus alur pendaftaran autentikator, QR/kunci TOTP, kode enam angka, autentikator cadangan, kewajiban `aal2`, dan pemulihan MFA dari produk. Jangan menyisakannya sebagai fitur opsional atau menambah feature flag/halaman pengaturan pengganti. Pertahankan satu redirect kompatibilitas untuk URL `/mfa` lama.

**Dokumen ini menggantikan persyaratan MFA aplikasi** pada `guide-penutupan-temuan-kesiapan-production-2026-10-27.md`, `mfa-rollout-recovery.md`, dan checkpoint progres terkait. Dokumen lama tetap bukti historis. Jangan menuntut pemasangan autentikator kembali atau menaikkan status warning MFA sebagai blocker dengan merujuk ketentuan lama yang sudah diganti pengguna.

Keputusan ini hanya mencakup MFA login aplikasi HR. Hal berikut tetap berlaku:

- Verifikasi JWT, akun aktif/terhubung, sesi yang masih sah, role, capability, kepemilikan, outlet/team scope, dan RLS.
- Kebijakan kata sandi, rate limit login, pesan error generik, aktivasi dan reset kata sandi melalui tautan sekali pakai, serta bootstrap tertutup.
- Transaksi atomik, baseline/version/revision checks, receipt, key **dan payload asli** replay, riwayat kasus/audit, dan isolasi draft per akun/proyek.
- Validasi wajah/biometrik **untuk foto absensi**, GPS, selfie, serta persetujuan referensi wajah. Ini fitur berbeda dari autentikator login dan tidak boleh ikut dihapus.
- MFA akun pemilik Supabase/Vercel/GitHub/Google dan entri layanan lain di aplikasi Authenticator ponsel. Jangan mengubahnya atau meminta pengguna menghapus aplikasi Authenticator.

Lingkup implementasi pertama tetap **`codex/preview` + Supabase Preview yang diverifikasi**. Production dan `main` di luar cakupan. Pengguna mengotorisasi panduan penghapusan; task penulisan panduan ini tidak mengotorisasi mutasi Auth/database/deployment sekarang. Saat pengguna kemudian memerintahkan eksekusi panduan ini, jalankan milestone di bawah dalam scope Preview tersebut.

## 2. Baseline yang harus diverifikasi ulang

| Komponen | Snapshot yang diketahui; bukan asumsi untuk tindakan remote |
| --- | --- |
| Repo/branch | `yoga12-rgb/hr-rajaklana-jkt`, `codex/preview`; HEAD saat panduan disusun `d094f8c` |
| Implementasi MFA | Commit `f283a64c04e2eeb595c9af80d497c98b4e0c311d`; commit setelahnya mencatat bukti |
| Supabase Preview | `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf` |
| History Preview | 25 migration; terakhir `privileged_account_mfa_enforcement`, versi hosted `20261029032121`, filename lokal `20261027090100_privileged_account_mfa_enforcement.sql` |
| Edge Preview | `hr-api` ACTIVE v5 pada checkpoint terakhir; verifikasi ulang versi/bundle dan origin |
| Frontend Preview | `https://hr-rajaklana-jkt-preview.vercel.app`; periksa SHA/alias aktual karena commit dokumentasi juga memicu deployment |
| Production | Ref `iywvnopsooroediwawnd`, branch `main`, source terakhir diverifikasi `94cd993`, 12 migration; baca-saja bila perlu pemetaan |
| Bukti MFA historis | Pengguna telah berhasil menghubungkan autentikator, login awal, logout, dan login ulang dengan kode tanpa QR ulang. Berarti ada faktor nyata yang perlu ditangani saat penghentian fitur. |
| Gate terakhir | 41 file/516 unit, database/upgrade/legacy, 25 live-mock, 22 demo/PWA lokal lulus; CI `029d91c` run `40812016604` success. Angka ini historis, bukan target jumlah tes setelah fitur dihapus. |

Periksa `.codegraph/` sebelum mencari source: tidak ada saat panduan ditulis. Jika nanti ada, ikuti instruksi CodeGraph repo. Catat branch, SHA, status worktree, remote, ref/URL proyek, history **nama+urutan+versi**, alias, serta perubahan yang sudah ada. Jangan menimpa pekerjaan agent/pengguna lain.

## 3. Kontrak teknis hasil akhir

### 3.1 Sesi dan otorisasi tetap diperiksa

Jangan mengembalikan semua perubahan ke baseline sebelum MFA. Migration25 menambahkan pemeriksaan sesi yang berguna di luar MFA. Pertahankan:

1. Identitas Auth dari JWT yang diverifikasi, terikat `auth.uid()` dan karyawan yang benar.
2. `employees.status='active'` serta `account_status='active'`.
3. `session_id` signed claims berupa UUID valid; ada di `auth.sessions`, `user_id` sesuai pengguna, dan `not_after` belum lewat bila terisi.
4. Pemeriksaan role/capability/scope pada fungsi bisnis dan server; `aal1` tidak berarti mendapat semua akses.
5. Konteks yang gagal/rusak/tidak tersedia menolak akses sebelum service reads atau publikasi state; tidak fallback ke data demo atau cache akun lama.

Sesi `aal1` yang sah cukup untuk seluruh peran. `aal2` lama juga tidak ditolak **semata karena levelnya** selama sesi itu masih sah. Keputusan akses tidak lagi bergantung pada level AAL, `factor_id`, status faktor, jumlah faktor, atau keberadaan TOTP. Jangan mewajibkan `auth.sessions.aal='aal1'`: sesi lama tidak perlu dikunci hanya karena pernah MFA.

Untuk kompatibilitas satu jendela rollout, pertahankan `public.auth_access_context()` dan bentuk respons yang dipakai client lama:

```json
{
  "employee_id": "<id karyawan sendiri atau null>",
  "requires_mfa": false,
  "current_level": "aal1",
  "allowed": true,
  "reason": null
}
```

`current_level` tetap dapat mencerminkan claim aktual `aal1`/`aal2`; bukan sumber izin. `requires_mfa` selalu `false`. Alasan penolakan aktif hanya `inactive`/`session_revoked` atau error kontrak. Tidak ada hasil `mfa_required`. Field kompatibilitas ini bukan fitur MFA aktif. Jangan menghapus endpoint atau field sebelum membuktikan tidak ada client lama yang bergantung padanya.

### 3.2 Pertahankan pembatas sesi di RLS dan Storage

Saat ini 29 tabel public dan `storage.objects` mempunyai restrictive policy `privileged_mfa_session` yang memanggil `private.session_allowed()`. **Jangan menghapus policy ini untuk meloloskan login.** Ubah arti helper menjadi pemeriksaan sesi aktif tanpa faktor. Policy boleh di-rename ke nama sesi yang jelas melalui migration baru setelah dependency/probe ditinjau; sifat restrictive, role, dan predikat tetap setara.

Ada alasan konkret: jalur penghapusan foto masalah outlet sendiri yang belum direferensikan tidak semuanya memanggil `private.employee_id()` melalui permissive policy. Menghapus restrictive policy dapat mengizinkan sesi nonaktif/dicabut menghapus objek walaupun guard RPC pusat dipertahankan. Regresi lokal sebelumnya sudah mereproduksi jalur ini.

`account_tokens`, `cashier_roster_batches`, dan tabel private recovery lama tetap fail-closed; jangan menambah permissive policy/grant hanya agar advisor bersih. ACL11 tabel yang diperketat migration24 juga harus tetap sama.

### 3.3 Histori recovery dipertahankan, layanan recovery dihentikan

Tutup Edge action `recover_mfa` dan RPC `auth_mfa_recovery_authorize`/`auth_mfa_recovery_complete`. Jangan membiarkan Admin HR password-only mengakses endpoint penghapusan faktor lama. Opsi transisi yang disarankan adalah respons penghentian tetap pada Edge, misalnya HTTP410, tanpa memanggil Auth Admin, dan RPC tanpa EXECUTE public/anon/authenticated/service_role atau body penolakan tetap. Jika fungsi dihapus, gunakan DROP spesifik tanpa CASCADE setelah dependency ditinjau.

Simpan `private.mfa_recovery_requests` beserta seluruh record dan `audit_events` terkait. Jangan mengubah pending/failed menjadi completed sekadar menutup fitur; jangan hapus receipt, alasan, actor, atau snapshot faktor. Jika ada transaksi recovery ambigu, rekonsiliasi hasil aktual melalui prosedur operator tanpa membuat snapshot/permintaan baru atau mengarang audit keberhasilan. Bila perlu audit penghentian fitur, gunakan action/referensi rollout yang berbeda dari keberhasilan recovery lama.

## 4. Peta source untuk agent

| Lokasi | Arah perubahan |
| --- | --- |
| `supabase/migrations/20261027090100_privileged_account_mfa_enforcement.sql` | **Jangan edit/hapus**; sudah applied. Buat migration maju baru setelah baseline aktual. |
| `private.session_access_context`, `session_allowed`, `raw_employee_id`, `employee_id`, `require_employee`, `require_hr` | Pertahankan rantai actor/sesi/role; hilangkan ketergantungan AAL/faktor. `require_hr` tetap meminta HR aktif, bukan setiap pengguna. |
| `private.employee_requires_mfa` dan dua RPC recovery | Retire setelah call/dependency review; tidak boleh tetap menjadi jalur aktif penghapusan faktor. |
| `server/security.mjs`, API biometric/push | Pertahankan `getUser` → user-scoped access context → binding employee/Auth → service reads. Hapus syarat `aal2`/error MFA; jangan menghapus wrapper authenticate atau memakai service client sebagai identitas pengguna. |
| `supabase/functions/hr-api/index.ts`, `mfa-recovery.ts` | Tutup `recover_mfa`, hapus import/helper aktif setelah tombstone disiapkan. Login, account-token/reset/bootstrap, origin checks, rate limit dan service-key isolation tetap berlaku. |
| `supabase/functions/hr-api/password-policy.ts` | Pertahankan seluruh aturan kata sandi; file ini bukan fitur MFA. |
| `src/lib/auth-mfa.ts` | Berisi validator konteks generik **dan** flow MFA. Pindahkan validator generik ke modul sesi, kemudian hapus flow/tipe/SDK MFA. Jangan menghapus validasi konteks bersama kelas MFA. |
| `src/lib/state/app.ts`, `types.ts` | Hapus `mfaRequired`, `mfaProtected`, `mfaUserId`, `tokenHintsAal2` dan gate login MFA. Pertahankan `authRevision`, clear state/channel, validasi konteks sebelum reads, serta perbandingan token yang ditangkap sesudah context dan sebelum `app.set`. |
| `src/lib/state/client.ts`, `auth-session-storage.ts` | Hapus installer sesi MFA/pending-token-specific guard. Pertahankan storage key `sb-<project>-auth-token`, persist/refresh session, serta pengamanan pergantian akun yang masih relevan. Jangan menyimpan ulang token lama di atas login akun baru; bila adaptor dihapus, buktikan perilaku SDK biasa dengan tes race akun. |
| `src/lib/auth-mfa-scope.ts`, scope/storage MFA tests | Hapus lease/marker khusus enrollment setelah tidak ada caller. Jangan menjadikan Web Locks syarat login password. Simpan tes sesi/account race yang masih relevan dalam modul generik. |
| `src/routes/mfa/+page.svelte` | Ganti dengan redirect shim tanpa QR/kunci/OTP, SDK MFA, atau permintaan enrollment. Tunggu init; sesi valid → Dashboard, tidak ada/ditolak → login, tanpa loop. |
| `src/routes/login/+page.svelte`, `(app)/+layout.svelte`, `(app)/profile/+page.svelte` | Hapus redirect/menu “Keamanan akun” khusus autentikator, instruksi kode dan akses cadangan. Login langsung mengikuti hasil validasi akun/sesi. |
| `src/routes/(app)/employees/+page.svelte` | Hapus tombol/dialog/banner recovery MFA dan helper terkait; **pertahankan** tautan aktivasi/reset kata sandi, profil karyawan, dan role/approval controls. |
| `src/lib/mfa-recovery-pending.ts` dan tests | Hentikan penulisan/replay recovery MFA. Cleanup browser hanya key fitur yang tepat milik akun/proyek aktif; jangan membersihkan seluruh storage. |
| `supabase/config.toml`, konfigurasi linked Preview | Atur penghentian TOTP bertahap; jangan mengubah provider Email/password, public-signup, minimum password, URL/origin atau layanan lain. |
| `supabase/tests/auth-session-fixture.mjs`, database/biometric-push/upgrade harness | Sediakan fixture sesi password-only tanpa faktor; tetap sediakan faktor sintetis untuk menguji upgrade historis25 dan pembersihan. |
| `supabase/tests/mfa-enforcement.mjs`, `verify-mfa-readiness-preview.sql` | Pertahankan sebagai baseline25 historis yang dibatasi tepat25; buat harness/probe terbaru untuk hasil penghapusan. Pindahkan regresi sesi, ACL/Storage dan operator net yang masih dibutuhkan ke suite aktif. |
| `src/lib/mfa-recovery.test.ts`, `server-mfa-boundary.test.ts`, `realtime-recovery.test.ts` | Pisahkan tes password dari recovery; ganti expectation MFA dengan kontrak sesi/role password-only. Pertahankan malformed context, revocation, no service-read-before-auth dan race tests. |
| `tests/live-mfa*.spec.ts`, tiga spec workflow supervisor/kasir | Ganti uji fitur lama dengan password-only/no-factor/URL lama/retired endpoint/account isolation. Ubah mock admin utama dari `aal2/requires_mfa:true` ke `aal1/requires_mfa:false`. |
| `.github/workflows/ci.yml`, `package.json` | Pertahankan validate, browser demo-PWA/live-mock, strict stats gate dan legacy/probe checks. Perbarui target probe/harness secara eksplisit; jangan menurunkan gate agar jumlah tes yang berkurang tampak hijau. |
| Dokumen MFA/progres/cutover/inventory | Beri penanda historis atau superseded, tautkan panduan ini, lalu tulis progres eksekusi baru. Jangan mengganti bukti uji lama menjadi hasil penghapusan. |

## 5. Urutan milestone

Jalankan berurutan. Tahap review/tests lokal boleh diparalelkan dengan ownership file yang jelas; rollout remote, drain, dan cleanup harus terurut. Buat `docs/progres-penghapusan-autentikator-2026-10-29.md` ketika implementasi dimulai, bukan sebagai laporan lulus pada task penulisan panduan ini.

### AUTH-00 — baseline, kontrak, dan reproduksi

- Bekukan identitas/source/history/schema/ACL/policy/Auth config/Edge/Vercel aktual. Jangan menganggap count25 saja cukup. Periksa seluruh dependency MFA dan status recovery pending/ambigu secara terbatas; log hanya metadata nonrahasia yang diperlukan.
- Reproduksi pada fixture: HR/SPV `aal1` ditolak sebelum perubahan; kasir biasa sudah diterima; faktor existing dapat terhubung pada sesi lama. Simpan expected behavior baru untuk setiap peran.
- Identifikasi seluruh akun Auth yang terhubung ke karyawan **aplikasi Preview ini**. Pisahkan verified/unverified TOTP, akun tidak aktif, serta akun Auth orphan/layanan lain. Jangan memakai inventaris seluruh organisasi sebagai daftar penghapusan.
- Tentukan urutan rollout dan batas waktu drain request Edge lama berdasarkan limit runtime aktual/dokumentasi; jangan menebak durasi aman.

**Checkpoint:** tabel baseline+dependency, matriks kontrak dan tes reproduksi tersedia; belum ada remote mutation. User decision penghapusan sudah jelas; jangan meminta persetujuan produk yang sama lagi.

### AUTH-01 — migration maju untuk sesi tanpa MFA

- Periksa CLI versi dan `migration new --help`, lalu buat file migration baru melalui CLI. Jangan menentukan versi final sebelum baseline dicek; **26 hanya perkiraan bila masih25**.
- Ganti guard konteks menjadi pemeriksaan akun/sesi saja sesuai §3.1. Pertahankan public response kompatibel dan grant sempit. `search_path` tetap dipin, helper internal tidak dibuka.
- Dalam transaksi migration yang sama, retire/revoke endpoint recovery lama, ganti `require_employee` agar tidak lagi meminta MFA, pertahankan `require_hr`/capability checks dan restrictive policies. Tidak ada interval commit yang menerima HR `aal1` sambil recovery lama masih callable.
- Retire helper khusus faktor jika tidak lagi dipakai; gunakan daftar DROP spesifik setelah dependency review, bukan CASCADE. Jangan menghapus tabel histori recovery, audit, atau tabel managed Auth.
- Tambahkan probe katalog baru yang memeriksa urutan/nama baseline final, session guards, restrictive policy, ACL24, retired RPCs, dan tidak adanya syarat faktor pada guard aktif. Probe hosted harus `BEGIN READ ONLY` tanpa fake claims/DML operasional.

**Checkpoint:** fixture HR/SPV tanpa faktor `aal1` berhasil sesuai scope; invalid/revoked/inactive/cross-user session tetap ditolak; history/audit sama; probe menolak drift. File migration lama tidak berubah.

### AUTH-02 — server/Edge tanpa gate autentikator

- Hilangkan pemeriksaan AAL/faktor dari wrapper API; pertahankan context shape validation, role/scope/binding dan pemeriksaan sesi sebelum service access.
- Sediakan Edge retirement untuk `recover_mfa` dengan respons tetap, tanpa memanggil list/delete factor atau RPC recovery. Hapus helper aktif dari bundle setelah call graph bersih. Tombstone adalah endpoint pensiun, bukan layanan recovery baru.
- Pertahankan login, aktivasi/reset, password policy, bootstrap tertutup, CORS/origin, rate limit dan error sanitization. Jangan menambah bypass, password universal, signup publik, atau menurunkan minimum10 karakter.
- Uji endpoint handler nyata: HR `aal1` sah dan kasir sesuai hak berhasil; bearer/context invalid dan role salah ditolak sebelum service work; retired recovery tidak mengubah Auth/audit.

**Checkpoint:** API dapat dipakai sesi password-only dengan hak yang benar; reset password masih bekerja; tidak ada call Auth MFA dalam jalur aplikasi.

### AUTH-03 — UI, route lama, storage dan state

- Bersihkan halaman/menu/OTP/cadangan/recovery MFA dan state sesuai peta file. Pertahankan keamanan init/refresh/account switch serta prompt update PWA.
- `/mfa` lama menjadi redirect shim; jangan redirect kembali ke dirinya sendiri, membuka protected data sebelum init, atau menghilangkan route tanpa uji deep link.
- Akun yang berganti harus langsung menghapus data HR lama dari memori/channel. Respons terlambat A tidak menimpa sesi/draft akunB. Refresh JWT biasa tidak memicu loop/loading permanen atau syarat Web Locks khusus MFA.
- Hentikan replay recovery MFA lokal. Setelah status ambigu direview, bersihkan hanya marker `rk-mfa-enrollment-scope` dan key recovery MFA **scope akun/proyek yang tepat**. Jangan memindai/menghapus draft akun lain, `sessionStorage.clear()`, `localStorage.clear()`, seluruh cache PWA, atau storage key Supabase.
- Alasan/receipt recovery lama tetap disimpan server; jangan menyalin material sensitif ke log/browser dump untuk cleanup. Operational drafts tetap persist/reload/retry dengan payload/key awal.

**Checkpoint:** UI login semua peran langsung menuju Dashboard, route lama aman, tidak ada kontrol autentikator tersisa; kasir/absensi/cuti/penugasan tetap dapat dipakai sesuai hak.

### AUTH-04 — rencana dan alat cleanup faktor existing

Siapkan dan uji alat operator **sebelum** dipakai remote:

1. Default dry-run; target/ref/proyek eksplisit dan diverifikasi. Jalankan hanya dari server/operator dengan kredensial yang sudah sah, bukan service key di browser atau token di chat/argumen/log.
2. Gunakan Auth Admin API resmi `listFactors`/`deleteFactor`, bukan SQL DELETE pada `auth.mfa_factors`, `auth.sessions`, atau menghapus/membuat ulang akun/password.
3. Batasi scope ke akun Auth yang terhubung dengan aplikasi pada proyek Preview. Hapus verified dan unverified **TOTP aplikasi** yang diinventarisasi; jangan menghapus phone/WebAuthn/layanan lain atau akun orphan tanpa pemetaan. Friendly name saja tidak cukup menentukan kepemilikan; kombinasikan project + linkage account + tipe faktor. Bila akun dipakai aplikasi lain dalam proyek sama, hentikan cleanup akun tersebut untuk pemetaan dahulu.
4. Siapkan format manifest project/user/factor IDs dan operation key. Inventaris baseline/dry-run awal masih bersifat sementara: **manifest eksekusi remote baru dibekukan setelah enrollment baru dihentikan dan request enrollment lama sudah drain**, lalu faktor di-list ulang pada AUTH-06. Simpan di lokasi operator yang dibatasi/diabaikan Git, tanpa seed/QR/OTP/JWT. Report publik cukup jumlah dan status; audit operator dapat menyimpan opaque IDs sesuai kebutuhan verifikasi.
5. Retry memakai manifest asli dan re-list keberadaan ID. Faktor yang sudah tidak ada dicatat **observed/already absent** dan aman dilewati; jangan mengklaim operator ini yang menghapusnya bila tidak ada bukti, karena actor berwenang lain mungkin sudah melakukannya. Jangan membuat permintaan baru atau menyapu faktor baru yang tidak ada pada manifest.
6. Penghapusan faktor **verified mengeluarkan pengguna dari seluruh sesi aktif** menurut kontrak Auth Admin. Jelaskan dampak login ulang yang terencana. Akses JWT lama tetap harus ditolak oleh live session guard. Jangan menampilkan cleanup selesai sebelum verified absence dan hasil tiap akun dikonfirmasi.
7. Jika muncul faktor baru saat freeze seharusnya aktif, akun baru/di luar scope, error provider, atau hasil ambigu: simpan pending/error dan lanjutkan verifikasi terarah. Jangan memperluas manifest atau menyatakan lulus diam-diam. Rollout belum ditutup sampai sisa target selesai.

Pengguna tidak perlu menyerahkan password, OTP atau seed. Penghapusan entri “Rajaklana HR Preview” di aplikasi Authenticator ponsel dilakukan sendiri oleh pengguna **setelah** login password-only teruji dan faktor server dipastikan tidak diperlukan. Agent tidak mengendalikan atau menghapus entri lain pada ponsel.

**Checkpoint:** dry-run terarah, retry/partial failure/absent IDs diuji lokal; rencana revokasi sesi dan laporan operator siap. Belum menjalankan cleanup remote pada milestone persiapan ini.

### AUTH-05 — regresi lengkap dan upgrade

Pertahankan suite bisnis yang ada dan tambah pengganti tes MFA; jangan sekadar menghapus11 browser MFA/recovery supaya suite hijau. Tidak ada target “harus516 tes” setelah penghapusan, tetapi setiap invariant harus tetap mempunyai bukti.

Jalur database wajib dibedakan:

- **Preview aktual25 → final**: migration maju baru saja; tanpa preflight13/21. Sertakan data+audit+receipt/recovery historis sebelum-sesudah yang sama.
- **Baseline24 →25 →final**: pastikan pemasangan MFA historis tidak meninggalkan syarat faktor di hasil akhir. Tidak menjalankan preflight lama pada baseline ini.
- **Upgrade18 →final**: pertahankan gate preflight21 sebelum22 bila jalur itu melewati batas tersebut.
- **Historis12 →13 →preflight sebelum14 →14–21 →preflight sebelum22 →22–25 →final**: buktikan kegagalan tanpa preflight yang diperlukan, idempotensi dan tidak ada history/data hilang. Jangan menulis ulang migration lama agar preflight tampak tidak dibutuhkan.

Fixture utama hasil akhir harus **`aal1` tanpa `auth.mfa_factors` row**, dengan sesi hidup yang terikat. Jangan membiarkan helper `fixtureSession` default `aal2` otomatis membuat verified factor lalu menganggap penghapusan sudah diuji. Fixture historis25 dapat tetap menyediakan faktor sintetis secara eksplisit; bukan default semua tes bisnis final.

Perintah gate minimal:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
node supabase/deployment/verify-readiness-preview.test.mjs
npm.cmd run build
npm.cmd audit --audit-level=moderate
git diff --check
```

Probe di atas tetap historis23; jalankan pula harness probe final baru melalui suite yang diperbarui. Historical MFA25 harus berhenti tepat25 bila dipertahankan; jangan menjalankan probe25 di database final26+ atau mengganti hardcoded count saja tanpa kontrak baru. Regresi operator net pada harness MFA lama harus tetap masuk gate aktif, meskipun tidak terkait fitur yang dihapus.

Browser wajib, eksplisit dan terpisah:

| Suite | Lingkungan/perintah |
| --- | --- |
| Live-mock | Server dev terisolasi: `PUBLIC_APP_ENV=preview`, URL `http://127.0.0.1:54329`, fake key `sb_publishable_isolated_audit_mock`, port5198. Set `E2E_LIVE_SUPABASE_MOCK=1`, `E2E_BASE_URL=http://127.0.0.1:5198`; jalankan `npm.cmd run test:e2e -- 'live-.*\.spec\.ts' --reporter=line,json --forbid-only --retries=0`. |
| Demo/PWA | Stop server dev dahulu; build dengan `PUBLIC_APP_ENV=development`, URL/key kosong, lalu `npm.cmd run preview -- --port 5198 --strictPort`. Set `E2E_PWA=1`, base URL yang sama; jalankan `npm.cmd run test:e2e -- tests/demo.spec.ts --reporter=line,json --forbid-only --retries=0`. |

Tetapkan `PLAYWRIGHT_JSON_OUTPUT_FILE` dan `--output` berbeda agar proses/artefak tidak berbenturan. Jangan menjalankan dua suite pada server port/build yang sama secara bersamaan. CI memasang Chromium; Windows lokal boleh memakai `PLAYWRIGHT_CHANNEL=msedge` jika Chromium belum ada. Kegagalan browser binary/sandbox dicatat terpisah, bukan “bug aplikasi” atau tes lulus. JSON harus menunjukkan expected>0, skipped=0, unexpected=0, flaky=0 pada kelompok wajib. Tes skipped dan retry yang menutupi flaky tidak menutup milestone.

**Checkpoint:** seluruh suite/probe/build lulus dari source yang sama; daftar tes yang diganti/dipindah/ditambah beserta alasan dan invariant tercatat. CI validate + kedua job browser tetap aktif.

### AUTH-06 — cutover Preview dan cleanup Auth

Jalankan setelah semua artefak/lokal siap. Verifikasi kembali target sebelum **setiap** tindakan remote. Jangan menyalin kredensial/config Production, memakai satu `db push` generik pada history connector yang timestamp-nya berbeda, atau menjalankan preflight historis pada Preview aktual.

Urutan yang diwajibkan:

1. Catat manifest rilis, SHA/ref/history, pending recovery dan status operator. Siapkan jendela perubahan Preview yang singkat; tidak ada kode darurat untuk melewati auth bila rollout gagal.
2. Hentikan **enrollment baru** pada Auth Preview: `enroll_enabled=false`; pertahankan `verify_enabled=true` sementara agar sesi/alur lama masih punya jalur masuk sampai stack baru siap. Periksa diff aktual config; jangan menerapkan setelan layanan yang tidak terkait. Pastikan request enrollment yang telah diterima sebelum freeze sudah drain, baru list ulang metadata faktor dan bekukan manifest eksekusi AUTH-04. Manifest dari baseline/dry-run sebelum freeze bukan daftar final penghapusan.
3. Deploy Edge retirement `recover_mfa` dahulu, verifikasi respons pensiun tanpa SDK factor calls; hentikan ingress recovery baru dan drain worker versi lama yang sudah berjalan. Pakai timeout runtime/log yang benar; jangan berasumsi deploy membatalkan invocation lama. Rekonsiliasi hasil ambigu secara jujur.
4. Terapkan migration maju baru: session-only guard dan retirement/revoke RPC atomik. Verifikasi nama/urutan history, ACL/RLS/Storage dan probe final baca-saja.
5. Deploy frontend/server password-only ke alias Preview dari commit yang diuji. Pastikan bagian server API ikut berubah, bukan hanya bundle statis. Verifikasi build env Preview mengarah ref yang benar tanpa mencetak kunci.
6. Buktikan login password-only sebelum faktor dihapus, termasuk akun yang masih mempunyai TOTP dan akun tanpa faktor, route `/mfa`, API dan akses sesuai role. Field context kompatibel menjaga tab lama, tetapi penerimaan versi baru tetap harus diuji. Jangan mematikan `verify_enabled` terlebih dahulu bila masih ada client aktif yang memerlukannya.
7. Jalankan cleanup Auth Admin dari manifest AUTH-04 yang dibekukan sesudah freeze/drain enrollment, setelah guard tidak lagi bergantung pada faktor dan Edge recovery lama sudah drain. Cocokkan ulang akun/proyek/ID terhadap manifest sebelum mutasi; retry tetap memakai manifest yang sama. Verifikasi sisa faktor dan pencabutan sesi. Login ulang yang diminta akibat penghapusan verified factor adalah dampak terencana; data akun/password tidak dibuat ulang.
8. Setelah cleanup terverifikasi, set TOTP **enroll=false dan verify=false** secara eksplisit pada config source/Preview aktual. Jangan mengubah `max_enrolled_factors` ke nilai tak tervalidasi sebagai jalan pintas. Periksa setting efektif dan penolakan enrollment/verify langsung dengan fixture yang sesuai tanpa membuat faktor baru di akun nyata.
9. Verifikasi login baru semua peran, logout/login ulang, reload, tab lama, update PWA tanpa kehilangan draft, retired endpoints, dan API/RLS negatif. Baca advisor dan CI untuk SHA aktual; warning MFA yang kembali muncul adalah konsekuensi kebijakan yang dipilih, bukan alasan untuk mengaktifkan MFA diam-diam. Warning password/net lain tetap dinilai terpisah.

Jika cleanup gagal sebagian, aplikasi password-only dapat diverifikasi secara terpisah tetapi **penghapusan fitur keseluruhan belum selesai**. Pertahankan status cleanup terbuka; jangan menulis nol faktor atau menghapus bukti kesalahan. Semua Auth factor mutation dilakukan melalui API resmi; tidak ada SQL penghapusan managed Auth.

**Checkpoint:** Preview sesuai ref/SHA, migration maju applied, Edge pensiun, UI/server tanpa gate MFA, faktor target TOTP selesai dibersihkan, kedua toggle nonaktif, login password-only hosted terbukti. Tidak ada mutasi Production/main.

### AUTH-07 — validasi hosted dan penyerahan

- User memasukkan kredensial sendiri di aplikasi; agent tidak meminta password/token. Cukup minta hasil nonrahasia untuk login yang memang memerlukan pengguna, setelah seluruh pekerjaan mandiri selesai.
- Buktikan alur UI → API → data → reload/sesi lain → audit dengan akun uji berwenang. Aksi uji operasional memakai fixture teridentifikasi dan dipulihkan melalui aksi bisnis; audit tidak dihapus.
- Catat secara terpisah implementasi lokal, deployment Preview, workflow hosted, cleanup Auth faktor/sesi, serta iPhone/PWA. Riwayat uji MFA lama tidak berubah menjadi bukti login tanpa MFA.
- PVR-02/offline/perangkat yang sebelumnya ditunda pengguna tetap terbuka tanpa menghentikan pengembangan lokal/deployment lain. Jangan meminta uji perangkat yang ditunda sebagai syarat menyelesaikan penghapusan kode lokal.
- Perbarui panduan penggunaan login, runbook/progres/inventory/cutover. Tandai kewajiban MFA lama superseded; jangan menghapus audit atau menulis ulang hasil uji historis. M2 versi lama harus dibaca sesuai keputusan pengguna baru, bukan mendorong MFA kembali.

**Checkpoint:** seluruh acceptance di bawah memiliki bukti atau status terbuka dengan sebab yang spesifik. Source bersih/commit Preview dan dokumen progres memadai untuk agent berikutnya. Production tidak dirilis oleh task ini.

## 6. Matriks penerimaan wajib

| ID | Skenario dan hasil yang harus dibuktikan |
| --- | --- |
| P01 | Admin HR, setiap SPV/capability, Head Baker/approver dan kasir aktif login `aal1` tanpa faktor → Dashboard; hak tetap berbeda sesuai role. |
| P02 | Akun yang masih punya TOTP sebelum cleanup dapat memakai alur password-only baru; tidak dituntut QR/OTP. Sesudah cleanup tetap dapat login dengan password yang sama. |
| P03 | Password salah/nomor tidak ada memakai error generik; rate limit, bootstrap tertutup, aktivasi/reset-token sekali pakai dan minimum password tetap berlaku. |
| P04 | Logout/login ulang dan reload tidak memunculkan OTP, loop `/mfa`, sesi hilang, atau loading permanen. Deep link `/mfa` → Dashboard/login sesuai state. |
| P05 | HR/SPV `aal1` memanggil RPC/API yang sah; kasir `aal1` tetap ditolak untuk aksi HR; scope outlet/tim lain dan self-approval tetap dibatasi. |
| P06 | JWT palsu, `session_id` hilang/malformed, session/user mismatch, session hilang/expired, akun nonaktif/disabled ditolak pada RPC/RLS/Storage/server sebelum service reads. |
| P07 | Konteks malformed/error atau account switch saat refresh tidak mempublikasikan cache/data akun lama; respons/token terlambat A tidak mengganti login/draftB. |
| P08 | Token refresh `aal2` lama → `aal1` baru bukan alasan penolakan selama sesi sah; role/claim `user_metadata` palsu tidak menaikkan akses. |
| P09 | Faktor tidak ada/unverified/deleted bukan syarat akses; **sesi yang dicabut** oleh penghapusan verified factor tetap ditolak. Bedakan alasan faktor dan revokasi sesi yang nyata. |
| P10 | Restrictive session policy menjaga SELECT/INSERT/DELETE Storage, khususnya foto issue sendiri yang belum direferensikan; sesi dicabut/nonaktif tidak dapat menghapusnya. Akses pemilik sah sesuai policy tetap bekerja. |
| P11 | Selfie/GPS/biometrik clock in/out, izin/cuti/persetujuan, roster/Libur, followup/serah-terima/tukar shift dan laporan tetap lolos regresi sesuai hak. |
| P12 | Persist → reload → retry kasus/roster/konfigurasi tetap memakai key/payload awal; respons commit hilang tidak menulis ganda; konflik baseline meminta review yang benar. |
| P13 | Edge recovery pensiun dan RPC recovery tak callable; permintaan lama/tokennya tidak memanggil list/delete faktor atau mengubah record/audit sebagai sukses. |
| P14 | Dry-run cleanup tepat akun/proyek, partial failure/re-list/retry ID asli, faktor absen dan faktor baru di luar manifest diuji; audit/manifest tidak berisi seed/QR/OTP/JWT. |
| P15 | Record recovery/audit yang sudah ada identik setelah migration. Pending ambigu tidak dipalsukan menjadi completed; tidak ada operational reset/repair/delete untuk meloloskan tes. |
| P16 | Browser cleanup hanya menghapus key MFA yang tepat; draft roster/kasus/konfigurasi, sesi Supabase dan data akun lain tetap ada. |
| P17 | Sesi/tab/PWA versi lama menerima update atau login ulang secara wajar tanpa lost draft/selfie aktif; tidak ada enrollment baru yang lolos saat freeze. |
| P18 | Final Auth enroll/verify nonaktif dan faktor TOTP target terverifikasi selesai dibersihkan; akun/password tetap sama; logout terencana sesuai hasil API dibuktikan. |
| P19 | Upgrade aktual25,24,18 dan historis12/13 lulus dengan preflight pada batas yang benar; probe final menolak history/ACL/policy drift. |
| P20 | Suite lokal, dua browser CI dengan0 skipped/flaky, dan build lulus. Ready/HTTP200 bukan bukti workflow; hasil hosted/perangkat dicatat terpisah. |

## 7. Pemulihan bila cutover gagal

Hentikan langkah berikutnya dan simpan bukti sanitized; jangan membuka akses anonim, melemahkan role/session guard, atau memasang password universal. Jangan rollback database dengan mengedit migration lama/repair history.

Utamakan perbaikan maju yang memulihkan login password-only sambil menjaga sesi/role. Rollback frontend ke versi MFA setelah verified factors dihapus dapat mengunci pengguna; rollback Vercel tidak memulihkan faktor, schema, ataupun sesi Auth. Penghapusan faktor tidak dapat dibatalkan dengan menaruh seed lama ke SQL. Bila pemasangan MFA kembali memang diputuskan pada masa depan, itu task/keputusan baru dengan enrollment resmi; bukan tindakan pemulihan diam-diam pada task ini.

## 8. Format progres dan definisi selesai

Setiap milestone menulis:

`ID | selesai/terbatas/terbuka | SHA | target/ref | perubahan file | perintah/tes aktual + pass/fail/skipped | bukti hosted | dampak Auth/data/audit | risiko/sisa kerja`

Task penulisan panduan ini selesai ketika dokumen ini dapat diberikan ke agent lain. Task **implementasi penghapusan** baru selesai ketika UI dan server/RPC tidak meminta MFA, faktor existing dalam scope telah diproses dan toggle final benar, sesi/role/RLS tetap terjaga, seluruh gate relevan lulus, serta perubahan/progres dipush hanya ke branch Preview. Bagian yang menunggu pengguna/perangkat dilaporkan apa adanya; jangan menyebut aplikasi siap Production karena fitur ini sudah dihapus.

Prompt handoff yang dapat digunakan:

> Kerjakan `docs/guide-penghapusan-autentikator-2026-10-29.md` dengan teliti, mulai AUTH-00 dan milestone berurutan. Keputusan pengguna adalah menghapus autentikator login untuk seluruh role, sehingga nomor karyawan dan kata sandi cukup; pertahankan live-session validation, role/capability/RLS, biometrik absensi, transaksi/version checks, audit dan draft/replay per akun. Jangan edit migration applied. Verifikasi identitas Supabase Preview serta baseline aktual, bedakan upgrade25 dari historis12/13 dengan preflight yang diperlukan. Retire/drain recovery sebelum relaksasi guard, gunakan Auth Admin API untuk cleanup faktor terarah dan retry memakai manifest asli, lalu nonaktifkan TOTP sesuai urutan. Jalankan gate lokal/live-mock/PWA/CI eksplisit dan tulis bukti tiap milestone pada dokumen progres. Production/main di luar scope. Jangan meminta secrets; kerjakan mandiri dahulu dan pisahkan hasil lokal, deployment, cleanup Auth, workflow hosted, serta perangkat yang ditunda.

## 9. Referensi

- [Progres baseline25 dan konfirmasi pengguna](progres-kesiapan-production-2026-10-29.md).
- [Runbook MFA lama, sebagai histori](mfa-rollout-recovery.md).
- [Inventory RPC dan residual `pg_net`](security-rpc-inventory-2026-10-27.md).
- [Rencana upgrade historis/cutover Production, belum dieksekusi](production-cutover-plan.md).
- [Auth Admin deleteFactor: penghapusan faktor verified mencabut seluruh sesi aktif](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor).
- [MFA aplikasi Supabase](https://supabase.com/docs/guides/auth/auth-mfa) dan [konfigurasi CLI](https://supabase.com/docs/guides/local-development/cli/config). Periksa versi/help/dokumentasi aktual sebelum memakai setting; instruksi self-hosted Docker tidak langsung diterapkan pada proyek managed.

Tidak ada perubahan aplikasi, Auth, migration, faktor pengguna, atau deployment yang dilakukan hanya dengan menyusun panduan ini.
