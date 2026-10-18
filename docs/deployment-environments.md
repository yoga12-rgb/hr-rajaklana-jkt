# Production dan Preview

Production dan Preview memakai build frontend serta proyek Supabase yang terpisah. Selama tahap uji coba, gunakan data fiktif untuk pengujian karyawan dan operasional. Nama environment **Production** menunjukkan target deployment utama; aplikasi belum layak dipakai untuk operasional sebelum pemeriksaan layanan hosted dan perangkat selesai.

## Source dan rencana rilis — 16 Oktober 2026

Source kini memiliki sembilan migrasi. Pemeriksaan lokal pembaruan alur kerja lulus: 214 test, check Svelte/TypeScript, build, harness database sembilan migrasi, dan 13 fixture penggantian schema lama. Dua migrasi tambahan adalah `20261016063305_hr_leave_workflows.sql` dan `20261016063418_hr_notifications.sql`. Database Preview sudah memakai sembilan migrasi; uji transaksi RPC/RLS hosted lulus dan di-rollback. Frontend baru serta database Production masih menunggu rilis; Edge Function tidak berubah. Gunakan [validasi alur kerja 16 Oktober](workflows-validation-2026-10-16.md) untuk SHA snapshot rilis dan bukti hosted yang akan diisi saat rilis.

## Snapshot hosted terverifikasi — 13 Oktober 2026

Kedua proyek Supabase berada di organisasi **Rajaklana** (`bvwgekyfibloctfslgdf`) dengan paket **Free**. Pada snapshot ini tujuh migrasi aplikasi telah diterapkan pada kedua proyek; versi/nama riwayatnya sesuai source rilis tersebut, termasuk perbaikan grant server `20261012094903_hr_api_service_role_reads.sql` yang diuji pada Preview sebelum Production. Rilis kode yang diuji memakai commit `db42cbc`. Edge Function `hr-api` ACTIVE versi 3 pada keduanya, dengan hash bundle yang sama setelah perbaikan pelaporan kegagalan Auth dan penutupan bootstrap.

Vercel memakai proyek **hr-rajaklana-jkt** (`prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`) pada tim **hr-rajaklana** (`team_S1Sn08iaksD0GQF4kk49kTkH`). Setelah rilis CLI awal 12 Oktober, push Preview lalu Production pada 13 Oktober menghasilkan deployment Git **READY** dan memperbarui alias otomatis. Preview tetap memakai proteksi akses Vercel. Admin HR kedua lingkungan telah dibuat, aktif, dan terhubung ke Auth; pengguna mengonfirmasi login dan Dashboard berhasil pada keduanya. Hasil build serta pemeriksaan HTTP/backend dicatat pada [verifikasi hosted](hosted-verification.md).

Rilis awal 12 Oktober memuat enam migrasi. Perbaikan grant server menambah migrasi ketujuh; pembacaan hosted dan metadata ketujuhnya telah diverifikasi pada kedua proyek. Perbaikan grant tidak memerlukan rebuild frontend. Perbaikan Auth berikutnya mengaktifkan provider Email/password dan memperbarui Edge Function.

Git integration Vercel **CONNECTED** ke repositori `yoga12-rgb/hr-rajaklana-jkt`; API proyek mengonfirmasi provider `github`, owner `yoga12-rgb`, repository `hr-rajaklana-jkt`, dan Production branch `main`. Deployment otomatis dari push commit `db42cbc` sudah diverifikasi pada kedua cabang, dengan `source=git`, READY, alias otomatis, dan CI GitHub lulus.

Penautan awal ditolak ketika memakai akun kolaborator. Repositori dimiliki akun personal dan Vercel mensyaratkan **Owner** untuk penautan; Collaborator tidak cukup. Pengguna kemudian menyelesaikan OAuth GitHub Owner Yoga dengan akun Vercel Raja tetap dipakai, dan penautan CLI berhasil. [Ketentuan repo personal Vercel](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories).

[Settings → Git proyek Vercel](https://vercel.com/hr-rajaklana/hr-rajaklana-jkt/settings/git) menampilkan pengaturan integrasi proyek. Pesan “No Git Repositories Found” dan batas request `429` merupakan kendala pada pemeriksaan awal sebelum koneksi berhasil.

Domain Preview `hr-rajaklana-jkt-preview.vercel.app` menjadi domain proyek terverifikasi dengan `gitBranch=codex/preview` pada project ID `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`. Domain Production memakai `gitBranch=null` dan mengikuti Production branch `main`. Kedua alias telah mengikuti deployment dari push yang diuji. Keduanya memakai environment Production/Preview standar, tanpa custom environment berbayar.

## Pemisahan lingkungan

| Komponen | Production | Preview |
| --- | --- | --- |
| Branch Git | `main` — Production branch dikonfirmasi pada API proyek | `codex/preview` — domain proyek terverifikasi mengikuti branch ini |
| Environment Vercel | Production | Preview |
| `PUBLIC_APP_ENV` | `production` | `preview` |
| Proyek Supabase | Rajaklana — `iywvnopsooroediwawnd` | hr-rajaklana-preview — `lypsqrwjzrmuyqtdcegr` |
| URL Supabase | `https://iywvnopsooroediwawnd.supabase.co` | `https://lypsqrwjzrmuyqtdcegr.supabase.co` |
| Paket Supabase | Free | Free |
| Database, Auth, foto selfie | Hanya milik Production | Hanya milik Preview |
| Admin / karyawan pada 13 Oktober | 1 / 1; admin aktif dan terhubung Auth | 1 / 1; admin aktif dan terhubung Auth |
| Origin frontend | [hr-rajaklana-jkt.vercel.app](https://hr-rajaklana-jkt.vercel.app) — aktif, READY | [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app) — aktif, READY, proteksi Vercel |

Jangan memasang URL atau kunci proyek Production pada environment Preview. Nomor karyawan, password, token aktivasi, saldo cuti, dan foto tidak disalin antar lingkungan. Sebuah Preview deployment boleh dihapus atau diganti tanpa memindahkan data ke Production.

Gunakan `codex/preview` sebagai branch uji yang stabil; domain Preview mengikuti branch tersebut. Setelah perubahan diterima, kode yang sama masuk ke `main`, lalu dibangun ulang dengan konfigurasi Production. Alur ini telah diuji dengan commit `db42cbc`: Preview diperiksa terlebih dahulu, kemudian Production. Mempromosikan Preview tidak memindahkan database maupun akun Preview ke Production.

Vercel membuat URL deployment yang unik dan dapat memberi URL branch yang stabil melalui Git integration. `APP_ORIGIN` adalah origin utama per proyek dan selalu dipakai sebagai tujuan undangan/aktivasi/pemulihan. URL deployment tambahan hanya diizinkan melalui daftar `APP_ALLOWED_ORIGINS` yang eksplisit; tidak ada wildcard untuk seluruh domain Vercel. [Dokumentasi Git Vercel](https://vercel.com/docs/git), [environment variables Vercel](https://vercel.com/docs/environment-variables).

Pada proyek Production lama, pengguna telah menyetujui penghapusan **13 tabel aplikasi lama beserta datanya**. Skrip `supabase/deployment/reset-known-legacy.sql` menjalankan penggantian yang dijaga dan foundation baru dalam satu transaksi; 13 tabel dan dua fungsi lama telah dihapus. Data lama dihapus, tidak diarsipkan. Schema layanan Supabase Auth dan Storage dipertahankan; dua akun Auth lama masih tersedia tanpa terhubung ke data karyawan HR baru. Identitas akun lama tidak dibaca. Jangan mengulang skrip ini sebagai langkah deploy rutin.

## Konfigurasi publik frontend

Pasang tiga nilai berikut pada target environment Vercel yang sesuai, lalu buat deployment baru. Nilai frontend masuk ke build statis dan dapat dilihat pengguna; hanya gunakan kunci publishable/anon publik.

```dotenv
PUBLIC_APP_ENV=production
PUBLIC_SUPABASE_URL=https://iywvnopsooroediwawnd.supabase.co
PUBLIC_SUPABASE_ANON_KEY=PRODUCTION_PUBLIC_KEY
```

Preview memakai `PUBLIC_APP_ENV=preview`, `PUBLIC_SUPABASE_URL=https://lypsqrwjzrmuyqtdcegr.supabase.co`, dan kunci publik Preview. Build hosted harus gagal bila konfigurasi backend kosong, tidak lengkap, atau berisi secret/service-role key. Mode demo lokal menggunakan `PUBLIC_APP_ENV=development` dengan kedua nilai Supabase kosong.

Jangan menyimpan token Vercel, access token Supabase, password database, `service_role`, atau kode bootstrap di variabel `PUBLIC_*`, Git, tangkapan layar, maupun hasil build. [Jenis kunci Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## Konfigurasi server Supabase

Setiap proyek mempunyai Edge Function `hr-api` serta secret sendiri:

| Nama | Tempat | Nilai |
| --- | --- | --- |
| `APP_ORIGIN` | Supabase Edge Function secrets | Origin HTTPS frontend pada lingkungan tersebut, tanpa slash terakhir |
| `APP_ALLOWED_ORIGINS` | Supabase Edge Function secrets | Daftar origin HTTPS tambahan yang eksplisit, dipisahkan koma; opsional |
| `HR_BOOTSTRAP_SECRET` | Supabase Edge Function secrets | Kode acak sementara, minimal 32 karakter, berbeda per proyek |
| `SUPABASE_URL` | Bawaan Supabase Edge Functions | URL proyek terkait |
| `SUPABASE_ANON_KEY` | Bawaan Supabase Edge Functions | Kunci publik proyek terkait |
| `SUPABASE_SERVICE_ROLE_KEY` | Bawaan Supabase Edge Functions | Kredensial server; tidak boleh dikirim ke frontend |

Matikan public signup secara global dan tetap aktifkan provider Email/password untuk login nomor karyawan yang dipetakan ke alias Auth internal. Pada konfigurasi CLI, `[auth].enable_signup=false` dan `[auth.email].enable_signup=true`. Pada kedua layanan hosted, pengaturan telah diperiksa: `disable_signup=true`, `external.email=true`. Provider aktif tidak membuka pendaftaran publik. Minimum password 10 karakter dan Auth Site URL mengikuti origin lingkungan. Aktivasi karyawan tetap memakai token aplikasi yang dikirim manual melalui WhatsApp, sehingga tidak memerlukan akun email karyawan atau SMTP.

Origin utama pada server sudah diset ke domain Production dan alias Preview aktif pada tabel di atas. Jika memakai URL deployment tambahan, tambahkan origin persisnya pada `APP_ALLOWED_ORIGINS` di proyek yang sesuai. Hanya origin HTTPS tanpa path, query, kredensial, fragment, atau wildcard yang diterima; HTTP hanya untuk localhost. Permintaan dari origin yang tidak terdaftar ditolak sebelum body, rate limit, Auth, atau database diproses. Origin tambahan tidak mengubah tujuan tautan akun yang tetap mengikuti `APP_ORIGIN`.

Admin HR Production dan Preview sudah dibuat; lanjutkan ke login dan jangan mengulang `/setup`. Pada penyiapan pertama, pengguna mengisi nama, WhatsApp, outlet pertama, kode bootstrap, password pribadi minimal 10 karakter, dan konfirmasi password. Nomor karyawan dihasilkan sistem. Outlet pertama belum memiliki koordinat saat bootstrap; lengkapi lokasi, radius, jam, dan aturan shift sebelum mencoba absensi.

`HR_BOOTSTRAP_SECRET` telah dihapus dari kedua proyek setelah admin masing-masing dibuat. Metadata secret memastikan kode tersebut tidak ada dan `APP_ORIGIN` tetap ada. Berkas lokal `bootstrap-code.txt` dan `edge-secrets.env` pada kedua folder operator juga telah dihapus dan ketidakberadaannya diverifikasi. Probe bootstrap kedua lingkungan menghasilkan HTTP 403. Nilai kode tidak disimpan di dokumentasi, Git, frontend, atau artefak deployment. Password admin dipilih sendiri oleh pengguna.

Function menggunakan `verify_jwt=false` karena login, aktivasi, dan bootstrap adalah endpoint publik. Setiap aksi administratif memverifikasi JWT pengguna dan otorisasi database di dalam function. Bucket selfie tetap privat. [Deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy).

### Kendala pengaturan admin pertama

Pesan “Admin awal sudah dibuat atau bootstrap belum siap” pada Production ditemukan ketika jumlah admin/karyawan masih 0. Edge Function memakai `service_role` untuk membaca tabel HR, tetapi grant `SELECT` yang diperlukan pada `employees` dan `employee_roles` belum tersedia. `USAGE` schema dan bypass RLS tidak memberikan hak baca tabel secara otomatis. Preview baru mempunyai default grant yang berbeda, sehingga perbedaan izin pada proyek lama perlu ditangani eksplisit.

Migrasi `20261012094903_hr_api_service_role_reads.sql` telah diterapkan pada Preview, diuji dengan `SET LOCAL ROLE service_role`, lalu diterapkan dan diuji pada Production. Pada pemeriksaan perbaikan sebelum setup, count admin/karyawan berhasil pada keduanya dengan hasil 0/0. Perbaikan hanya menambah **SELECT pada dua tabel tersebut** untuk role server; tidak menambah akses anonim atau izin tulis. Setelah setup 13 Oktober, keduanya memiliki 1 admin/1 karyawan dan admin aktif terhubung Auth. Diagnosis awal bukan kesalahan password atau kode bootstrap pengguna. [Grant dan RLS Supabase](https://supabase.com/docs/guides/api/securing-your-api).

Catalog akhir pada kedua proyek memastikan SELECT `service_role` tersedia untuk kedua tabel, SELECT `anon` tetap tidak tersedia, semua tabel `public` memakai RLS, dan riwayat versi/nama migrasi ketujuh telah sesuai. Perbaikan ini tidak memerlukan rebuild frontend atau redeploy Edge Function.

### Kendala provider login

Lima kejadian Auth awal setelah setup menghasilkan token response `422` dengan kode `email_provider_disabled`. Penyebabnya adalah `[auth.email].enable_signup=false` yang menonaktifkan provider Email/password; kejadian ini bukan bukti password pengguna salah. Konfigurasi sekarang tetap menolak public signup secara global dan mengaktifkan provider Email/password. Diff config yang diterapkan hanya mengubah pengaturan Email tersebut, diuji pada Preview terlebih dahulu lalu Production.

Auth GET settings pada kedua proyek menunjukkan `external.email=true` dan `disable_signup=true`. Login dummy langsung ke Auth Production menghasilkan `400 invalid_credentials` sebagaimana diharapkan, sementara Edge `hr-api` pada keduanya menghasilkan `401` untuk kredensial dummy. Bootstrap kedua lingkungan yang telah ditutup menghasilkan `403`. Pengguna mengonfirmasi login dan Dashboard berhasil pada Production maupun Preview; alur absensi, kamera/GPS, dan lintas akun tetap perlu diuji terpisah.

`supabase/config.toml` secara eksplisit mengatur `[storage.vector] enabled = false`. Aplikasi memakai Storage biasa untuk selfie/dokumen dan tidak memerlukan Vector Storage. Konfigurasi eksplisit ini menghindari penolakan `402` saat mendorong konfigurasi layanan yang tidak tersedia pada paket Free; tidak ada fitur berbayar yang diaktifkan.

## Migrasi dan rilis

Migrasi pada `supabase/migrations` diterapkan menurut urutan nama ke Preview terlebih dahulu. Periksa fungsi, RLS, Auth, Storage, realtime, dan alur aplikasi pada Preview. Tinjau perubahan serta kondisi proyek Production sebelum menerapkan migrasi yang sama ke Production. Jangan reset atau menimpa data lama tanpa pemeriksaan dan backup yang sesuai.

Workflow `.github/workflows/ci.yml` tidak mempunyai kredensial hosting dan tidak menjalankan migrasi pada layanan hosted. Perubahan database dan deployment Edge Function tetap langkah rilis terpisah; rollback frontend tidak mengembalikan schema database secara otomatis. [Migrasi Supabase](https://supabase.com/docs/guides/deployment/managing-environments).

## Pemeriksaan otomatis

CI berjalan pada push ke `main`/`codex/**`, pull request, atau pemicu manual. Runner Node.js 24 menjalankan:

```sh
npm ci
npm run check
npm test
npm run test:database
npm run test:database:legacy
npm run build
```

Dependency Supabase dan PGlite dipin, dengan `package-lock.json` sebagai sumber versi instalasi. Tes database menjalankan migrasi dan fungsi Postgres asli pada PGlite dalam memori; hanya plumbing Auth/Storage milik Supabase yang ditiru. Tes ini tidak menghubungi proyek hosted dan belum membuktikan deployment Auth, Storage, atau Edge Function. [Keamanan instalasi npm Supabase](https://supabase.com/docs/guides/security/npm-security).

`test:database:legacy` menjalankan 13 fixture untuk penggantian schema lama, termasuk penolakan kondisi yang tidak sesuai dan rollback transaksi. Pemeriksaan lokal source 16 Oktober mencatat **214 test** lulus, check Svelte/TypeScript serta build lulus, harness database menjalankan sembilan migrasi, dan 13 fixture penggantian schema lama lulus. Lihat [snapshot validasi alur kerja](workflows-validation-2026-10-16.md) untuk cakupan dan batasnya. Kedua build remote pada rilis lama menjalankan instalasi bersih, check, dan build hingga READY. Verifikasi SQL 13 Oktober mengonfirmasi admin Production aktif, dan pengguna mengonfirmasi login/Dashboard berhasil; hasil lama itu tidak memverifikasi alur baru atau deployment source 16 Oktober.

Actions resmi dipin ke SHA rilis yang diverifikasi: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) dan [setup-node v6.5.0](https://github.com/actions/setup-node/releases/tag/v6.5.0). Workflow memiliki izin `contents: read`, tidak menyimpan kredensial checkout, serta tidak mengunggah `.env` atau artefak berisi secret. [Panduan keamanan GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

CI memeriksa kode; **workflow ini belum menjadi gate deployment Vercel** dan tidak melakukan deployment. Integrasi Vercel membangun push secara independen dari CI. Push Preview lalu Production sudah diuji; masing-masing deployment READY dan CI berhasil. Gate otomatis masih memerlukan konfigurasi Deployment Checks atau alur staging dan promotion tambahan. [Deployment Checks Vercel](https://vercel.com/docs/deployment-checks).

CI rilis kode `db42cbc` berhasil pada [run `main` 38366039079](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38366039079) dan [run Preview 38365675293](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38365675293). Build hosted menggunakan perintah `npm run check && npm run build`. Pada verifikasi 13 Oktober, kedua proyek memiliki **1 karyawan dan 1 Admin HR aktif**, semua tabel `public` memakai RLS, dan tiga bucket aplikasi tetap privat. Lihat [laporan hosted](hosted-verification.md) untuk bukti browser serta temuan advisors yang masih dicatat.

Sebelum digunakan karyawan, uji kedua lingkungan: bootstrap/login, undangan dan aktivasi, batas akses antar akun, cuti/izin dan persetujuan, selfie/GPS pada ponsel, foto privat setelah reload, serta realtime di dua perangkat. Vercel Hobby hanya untuk uji pribadi nonkomersial; penggunaan HR perusahaan memerlukan paket atau hosting yang sesuai sebelum operasional. Tidak ada upgrade berbayar otomatis. [Ketentuan Vercel Hobby](https://vercel.com/docs/plans/hobby).
