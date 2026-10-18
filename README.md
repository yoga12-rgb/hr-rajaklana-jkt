# Rajaklana HR — Jabodetabek

Aplikasi HR dengan SvelteKit + TypeScript, navigasi SPA dan PWA. Cakupan awal: data karyawan/master organisasi, clock in/out kasir dengan GPS dan selfie, cuti/izin beserta persetujuan dan perubahan, serta rekap HR. Lihat [spesifikasi](docs/specification.md) dan [kontrak backend](supabase/CONTRACT.md).

## Status

Frontend dapat dijalankan dalam **mode demo lokal berlabel jelas** ketika konfigurasi publik Supabase kosong. Data contoh disimpan pada browser ini saja; bukan data perusahaan, bukan backend operasional, dan tidak disinkronkan antar perangkat.

Snapshot hosted 13 Oktober 2026 mencatat Production dan Preview **READY**: [Production](https://hr-rajaklana-jkt.vercel.app) dan [Preview](https://hr-rajaklana-jkt-preview.vercel.app). Rilis kode yang diuji berasal dari commit `db42cbc`, setelah rilis CLI awal `2f4f96a`. Preview tetap memakai proteksi akses Vercel. Kedua lingkungan terhubung ke proyek Supabase Free yang terpisah: Production `iywvnopsooroediwawnd`, Preview `lypsqrwjzrmuyqtdcegr`. Pada snapshot itu tujuh migrasi telah diterapkan dan Edge Function `hr-api` aktif dengan bundle yang sama. Lihat [konfigurasi lingkungan](docs/deployment-environments.md) dan [hasil verifikasi hosted](docs/hosted-verification.md).

Snapshot alur kerja 16 Oktober mencatat **214 test, check, build, database sembilan migrasi, dan 13 fixture legacy lulus**. Production dan Preview sudah READY pada snapshot kode `fe50a5e`; CI kedua branch lulus. Kedua database memakai sembilan migrasi; uji transaksi/RLS Preview serta pemeriksaan catalog/akses anonim kedua lingkungan lulus. Edge Function tidak berubah. Bukti historis dan batas pengujian dicatat pada [validasi alur kerja 16 Oktober](docs/workflows-validation-2026-10-16.md).

Source 18 Oktober menambah penugasan harian HR yang wajib sebelum kasir clock in, outlet tugas sementara, GPS maksimal 60 detik, penanda sesi panjang termasuk sesudah pulang, pemisahan kekurangan durasi berizin, permintaan koreksi absensi kasir, serta pencatatan izin lampau dan koreksi jam oleh HR. Verifikasi wajah privat 1:1 dengan persetujuan dan tinjauan HR lain, push perangkat opt-in, serta pengirim/pengingat 8 jam dari server sudah diimplementasikan. Pemeriksaan lokal **285 test, check 0 error/0 warning, build, dan database 11 migrasi lulus**. Browser sudah memverifikasi penugasan outlet sementara → permintaan koreksi kasir → notifikasi HR → persetujuan HR, serta pencatatan izin pribadi pulang awal dan koreksi jam 14:00 menjadi 14:30. Rilis/konfigurasi layanan hosted terbaru masih menunggu verifikasi akhir; kamera/GPS fisik dan pengiriman push per perangkat belum diuji. Lihat [validasi kasir 18 Oktober](docs/cashier-validation-2026-10-18.md).

Verifikasi 13 Oktober 2026 memastikan **Admin HR kedua lingkungan telah dibuat, aktif, dan terhubung ke Auth**: masing-masing memiliki 1 admin/1 karyawan. Pengguna mengonfirmasi login dan Dashboard berhasil pada Production maupun Preview. Secret bootstrap kedua proyek dan berkas kode lokal terkait telah dihapus; konfigurasi origin tetap tersedia. Setup ulang ditolak dengan HTTP 403. Password dipilih sendiri oleh pengguna.

**Git integration Vercel terhubung** ke `yoga12-rgb/hr-rajaklana-jkt`. Push `codex/preview` diuji terlebih dahulu, lalu commit yang sama dipush ke `main`; keduanya menghasilkan deployment `source=git`, READY, dan alias yang diperbarui otomatis. GitHub CI kedua cabang juga lulus. GitHub Actions memeriksa kode tanpa menjalankan deployment atau migrasi hosted.

Koneksi dapat diperiksa pada [Settings → Git proyek Vercel](https://vercel.com/hr-rajaklana/hr-rajaklana-jkt/settings/git). Domain Preview mengikuti `codex/preview`; domain Production mengikuti `main`. Keduanya memakai environment Production/Preview standar, tanpa custom environment berbayar. Pengguna menyelesaikan OAuth GitHub Owner Yoga dengan akun Vercel Raja. [Ketentuan repo personal Vercel](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories).

Kedua lingkungan dipakai untuk uji coba; gunakan data fiktif saat menguji karyawan dan operasional. Login awal kedua lingkungan telah dikonfirmasi pengguna. Aktivasi, hak akses lintas akun, foto privat, realtime antar perangkat, serta kamera/GPS ponsel masih harus diuji melalui layanan hosted sebelum pemakaian operasional. Tidak ada upgrade berbayar otomatis.

## Jalankan lokal

Gunakan Node.js LTS modern (22.12 atau lebih baru) dan npm. Pada Windows gunakan `npm.cmd` bila PowerShell memblokir wrapper `.ps1`.

CI dan deployment menggunakan Node.js 24.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

Buka URL lokal yang ditampilkan terminal. Biarkan kedua nilai `.env` kosong untuk demo. Login contoh: `RK000001` / `DemoRajaklana123!`, atau pilih tombol Admin HR, Head Baker, Kasir. Pada Profil terdapat pilihan akun contoh untuk mencoba alur antara pemohon dan atasan.

Nama, outlet, lokasi, dan permohonan dalam demo semuanya fiktif. GPS masih diperiksa terhadap koordinat outlet contoh. Ubah titik outlet melalui Organisasi saat mencoba dari lokasi sendiri. Demo tidak mengunggah selfie ke Supabase; pratinjau selfie lokal tidak bertahan setelah reload. Tautan aktivasi/pemulihan demo hanya bekerja pada browser yang sama; penggunaan nyata di perangkat karyawan memerlukan mode live.

Selfie baru memiliki cap nama outlet, koordinat/akurasi GPS, serta tanggal dan waktu pengambilan dalam WIB. Cap menjadi bagian dari JPEG, ditempatkan pada footer agar frame kamera tetap utuh. Waktu foto berasal dari perangkat dan disimpan terpisah dari waktu clock in; pemeriksaan ulang lokasi mengharuskan selfie diambil ulang. Lihat [verifikasi cap selfie](docs/selfie-watermark.md) untuk contoh visual dan batas pengujian.

Ikuti [uji pendaftaran lokal](docs/local-pilot.md) untuk mencoba alur HR → undangan → aktivasi → login karyawan. Tombol **Masuk dengan akun ini** setelah aktivasi/pemulihan mengakhiri sesi sebelumnya dan mengisi nomor karyawan pada halaman masuk; kata sandi tetap harus dimasukkan sendiri.

Setelah data siap, ikuti [uji operasional lokal](docs/operational-pilot.md) untuk clock in/out kasir, cuti, izin beberapa jam, dan keputusan atasan. Demo mengikuti validasi periode izin, pembatalan tanggal lampau, serta pembulatan keterlambatan backend. Durasi 8 jam sudah termasuk istirahat; clock out lebih awal tetap dicatat untuk ditinjau HR.

Panduan penggunaan dan ketentuan tersedia di `/guide` setelah login. Buka **Panduan** pada menu komputer atau **Profil → Panduan penggunaan** pada ponsel. Halaman ini merangkum alur tiap peran, ketentuan cuti/absensi, batas demo, dan langkah saat mengalami kendala.

Perilaku source serta batas pemeriksaan terbaru tercatat pada [validasi kasir 18 Oktober 2026](docs/cashier-validation-2026-10-18.md). Bukti historis tersedia pada [validasi alur kerja 16 Oktober](docs/workflows-validation-2026-10-16.md) dan [uji operasional lokal 12 Oktober](docs/local-validation-2026-10-12.md).

## Konfigurasi frontend live

Isi hanya kunci **publik** di `.env` dan pada environment build hosting:

```dotenv
PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
PUBLIC_SUPABASE_ANON_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
PUBLIC_APP_ENV=production
```

File `.env` diabaikan Git. Jangan memasukkan `service_role`, secret key, password database, atau bootstrap secret pada variabel `PUBLIC_*`, frontend, tangkapan layar, atau Git. Restart dev server/rebuild sesudah mengubah environment. Konfigurasi salah harus menghasilkan pesan kegagalan, bukan beralih ke data demo seolah login berhasil.

Dev server dan build memeriksa pasangan URL/kunci terlebih dahulu. Konfigurasi yang hanya terisi sebagian, URL yang tidak sesuai, serta secret/service role key ditolak tanpa mencetak nilainya. Mode demo hanya berjalan di lingkungan lokal (`PUBLIC_APP_ENV=development`) ketika kedua nilai kosong. Build hosted Production/Preview harus memiliki konfigurasi Supabase yang lengkap. Validasi bentuk ini bukan pemeriksaan koneksi ke proyek hosted. [Jenis kunci Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

Pada Beranda Admin HR, **Persiapan tim** merangkum outlet yang lokasi absensinya belum lengkap, akun karyawan yang belum aktif, dan atasan pengajuan yang belum siap. Tautan mengarah ke Organisasi atau Karyawan untuk dilengkapi. Ringkasan ini membantu penyiapan data; pengujian layanan live dan perangkat tetap diperlukan sebelum pemakaian outlet.

## Siapkan Supabase

Backend hosted untuk kedua lingkungan telah disiapkan. Langkah di bawah adalah referensi penyiapan/rilis untuk operator; pilih project reference yang benar sebelum menjalankan perintah dan jangan membuat ulang proyek yang sudah tersedia.

1. Gunakan proyek Production atau Preview pada [daftar lingkungan](docs/deployment-environments.md), dan catat URL/kunci publik yang sesuai.
2. Login CLI, tautkan proyek yang benar, dan pratinjau migrasi sebelum menerapkan.

```powershell
npx.cmd supabase@2.111.0 login
npx.cmd supabase@2.111.0 link --project-ref PROJECT_REF
npx.cmd supabase@2.111.0 db push --dry-run
npx.cmd supabase@2.111.0 db push
```

Migrasi diterapkan menurut urutan nama di `supabase/migrations`. Source berisi sebelas migrasi untuk organisasi, tabel HR, fungsi transaksi, audit, RLS, token akun, bucket privat, alur cuti/notifikasi, penugasan/koreksi kasir, serta biometrik/push. Snapshot hosted 13 Oktober memverifikasi tujuh migrasi sampai `20261012094903_hr_api_service_role_reads.sql`; dua migrasi 16 Oktober diterapkan dan diverifikasi pada kedua database pada 18 Oktober. Dua migrasi source 18 Oktober harus diverifikasi pada Preview sebelum promosi. Pengguna telah menyetujui penghapusan 13 tabel aplikasi lama beserta datanya pada Production; Auth/Storage dan dua akun Auth lama dipertahankan. Proses ini tidak membuat arsip data lama dan bukan langkah deploy rutin. Perubahan berikutnya harus ditinjau pada Preview terlebih dahulu. [Referensi resmi migrasi Supabase](https://supabase.com/docs/reference/cli/supabase-db-push).

3. Matikan **public signup secara global**, tetapi tetap aktifkan **provider Email/password** yang diperlukan login nomor karyawan. Konfigurasi CLI menggunakan `[auth].enable_signup=false` dan `[auth.email].enable_signup=true`; pengaturan hosted yang telah diverifikasi adalah `disable_signup=true` dan `external.email=true`. Minimum password 10 karakter; Site URL mengikuti origin frontend HTTPS. Tidak perlu SMTP untuk aktivasi melalui WhatsApp karena akun dibuat server dan kata sandi diatur melalui token aplikasi.
4. Siapkan secret **server Edge Function** pada berkas lokal yang diabaikan Git, misalnya `.env.hr-api`:

```dotenv
APP_ORIGIN=https://DOMAIN_APLIKASI
APP_ALLOWED_ORIGINS=
HR_BOOTSTRAP_SECRET=RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` tersedia pada lingkungan hosted Edge Function. `APP_ORIGIN` adalah origin frontend utama dan tujuan tautan akun. `APP_ALLOWED_ORIGINS` opsional berisi origin tambahan yang eksplisit, dipisahkan koma; tidak menerima wildcard atau URL dengan path. Untuk lokal boleh `http://127.0.0.1:5173`. Bootstrap secret dibuat acak, digunakan sementara, dan disimpan server saja. Berkas kode bootstrap lokal tiap lingkungan dijelaskan di [panduan deployment](docs/deployment-environments.md); jangan memasukkan nilainya ke Git atau frontend.

```powershell
npx.cmd supabase@2.111.0 secrets set --env-file .env.hr-api
npx.cmd supabase@2.111.0 functions deploy hr-api --no-verify-jwt
```

Verifier platform dinonaktifkan karena fungsi mendukung login/aktivasi publik. Aksi administrasi tetap memverifikasi token pengguna dan otorisasi database secara eksplisit. [Panduan resmi deployment Edge Functions](https://supabase.com/docs/guides/functions/deploy).

5. Buka `/setup` pada frontend yang sudah terhubung Supabase. Isi enam kolom: nama lengkap, nomor WhatsApp, nama outlet pertama, kode pengaturan awal (`HR_BOOTSTRAP_SECRET`), kata sandi akun, dan konfirmasi kata sandi. Pilih kata sandi pribadi sendiri, minimal 10 karakter. Halaman ini hanya dapat membuat admin pertama. Alternatif untuk operator teknis: POST ke `https://PROJECT_REF.supabase.co/functions/v1/hr-api`, header `apikey: PUBLIC_ANON_OR_PUBLISHABLE_KEY` dan `Content-Type: application/json`. Body:

```json
{
  "action": "bootstrap",
  "bootstrap_secret": "SERVER_BOOTSTRAP_SECRET",
  "full_name": "NAMA_ADMIN_PERTAMA",
  "whatsapp": "NOMOR_WHATSAPP",
  "password": "KATA_SANDI_PRIBADI_MINIMUM_10_KARAKTER",
  "outlet_name": "NAMA_OUTLET_PERTAMA"
}
```

Respons mengembalikan nomor karyawan untuk login. Endpoint hanya bekerja sebelum Admin HR pertama tersedia. Sesudah berhasil, hapus bootstrap secret dari server dan berkas lokal:

```powershell
npx.cmd supabase@2.111.0 secrets unset HR_BOOTSTRAP_SECRET
```

6. Login admin, lengkapi koordinat/jam/radius outlet, tambah karyawan, pilih atasan, dan beri hak Admin HR kepada supervisor yang ditunjuk. Outlet bootstrap sengaja belum memiliki koordinat; absensi tidak akan berhasil sampai diatur.
7. Periksa publication `supabase_realtime` untuk tabel yang digunakan dan uji bahwa akun lain mendapat perubahan sesuai hak aksesnya. Jangan menjadikan bucket selfie publik.

Pesan “Admin awal sudah dibuat atau bootstrap belum siap” pada diagnosis Production 12 Oktober muncul ketika SQL masih menunjukkan 0 admin/0 karyawan. Penyebabnya adalah grant `SELECT` yang diperlukan Edge Function pada `employees`/`employee_roles` belum tersedia untuk `service_role`, walaupun role mempunyai `USAGE` dan bypass RLS. Migrasi `20261012094903_hr_api_service_role_reads.sql` telah diterapkan dan diuji pada Preview lalu Production. Perbaikannya hanya menambah `SELECT` pada dua tabel tersebut; tidak menambah akses anonim atau izin tulis. Verifikasi 13 Oktober memastikan admin Production kemudian berhasil dibuat dan aktif, sehingga setup Production tidak perlu diulang. Lanjutkan ke login dengan password yang dipilih pengguna. [Penjelasan grant dan RLS Supabase](https://supabase.com/docs/guides/api/securing-your-api).

Kegagalan login awal setelah setup juga diperiksa: Auth menghasilkan `422 email_provider_disabled`, bukan password yang salah. Provider Email/password telah diaktifkan pada Preview lalu Production, sementara public signup tetap dimatikan. Pengguna kemudian mengonfirmasi Dashboard Production berhasil dibuka. Edge Function kini membedakan kegagalan Auth lewat kode/status yang aman tanpa mencatat password, token, atau respons sensitif.

Untuk backend lokal (Docker dan Supabase CLI dibutuhkan), gunakan `supabase start`, `supabase db reset`, kemudian `supabase functions serve hr-api --env-file .env.hr-api`. `db reset` menghapus database lokal dan tidak boleh digunakan sebagai langkah biasa pada database berisi data penting.

Vector Storage secara eksplisit dimatikan pada `supabase/config.toml` agar config push tetap sesuai paket Free. Selfie dan dokumen memakai Storage biasa; tidak ada layanan berbayar yang diaktifkan.

## Build dan hosting

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Build frontend statis berada di `build/` dengan fallback SPA `200.html`. `vercel.json` menyiapkan rewrite/header dan fungsi Node untuk API biometrik serta push. Konfigurasi build Vercel memakai `npm run check && npm run build`, output directory `build`, Node.js 24, serta public environment variables di atas. API tersebut memerlukan environment server privat; push memerlukan kunci VAPID, worker, dan scheduler. Kelulusan build lokal belum membuktikan konfigurasi atau pengiriman hosted.

Pemisahan branch, database, akun, foto, konfigurasi server, dan langkah bootstrap dijelaskan di [Production dan Preview](docs/deployment-environments.md). CI pada `.github/workflows/ci.yml` menjalankan instalasi terkunci, pemeriksaan Svelte/TypeScript, unit test, tes database PGlite, 13 fixture penggantian schema lama, dan build tanpa akses layanan hosted. CI ini belum menjadi gate deployment Vercel. Integrasi Git, pemetaan domain, deployment otomatis dari push, dan CI kedua cabang telah diverifikasi.

**Vercel Hobby dibatasi untuk penggunaan pribadi nonkomersial.** Operasional HR perusahaan perlu paket atau penyedia hosting yang sesuai. Frontend statis dapat dipasang pada hosting HTTPS lain yang mendukung fallback SPA; API biometrik/push dan worker tetap memerlukan runtime server yang sesuai. [Ketentuan Vercel Hobby](https://vercel.com/docs/plans/hobby).

Supabase Free dapat dipakai untuk memulai pengujian dengan memantau kapasitas database, Storage, Realtime, dan trafik. Pertumbuhan foto selfie perlu dipantau secara rutin; jangan menganggap kapasitas gratis tidak terbatas. Lihat [kuota resmi Supabase](https://supabase.com/pricing) saat memilih paket.

## Uji

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:database
npm.cmd run test:database:legacy
npm.cmd run build
npm.cmd run test:e2e
```

Playwright memakai Microsoft Edge yang terpasang pada Windows secara default. Atur `PLAYWRIGHT_CHANNEL=chromium` bila menjalankan browser Chromium milik Playwright. `E2E_BASE_URL` dapat menunjuk server yang sudah berjalan. Tanpa nilai itu, konfigurasi memulai dev server pada `127.0.0.1:5173`.

Untuk pengujian PWA gunakan build produksi dan preview, kemudian pada terminal lain:

```powershell
$env:E2E_BASE_URL='http://127.0.0.1:4173'
$env:E2E_PWA='1'
npm.cmd run test:e2e
```

E2E hanya berjalan pada mode demo yang terlihat; setiap test mendapat konteks browser terpisah. Izin geolokasi dan stream kamera dari canvas bertanda `TEST CAMERA ONLY` **hanya untuk pengujian** dan tidak menjadi jalan pintas pada aplikasi. Uji mencakup navigasi mobile/desktop, master data dinamis, karyawan, persetujuan/perubahan/pembatalan saldo, larangan persetujuan sendiri, validasi GPS/selfie clock in/out, catatan manual HR, reset kata sandi satu kali pakai, serta manifest/cache/offline PWA pada build produksi. Tetap uji kamera, GPS, dan PWA pada ponsel nyata sebelum pemakaian outlet.

Uji migrasi dan RLS terpisah tersedia melalui `npm run test:database` menggunakan PGlite yang terpasang dari lockfile. Harness meniru plumbing Auth/Storage Supabase dan menjalankan SQL migrasi asli di memori; tidak membutuhkan folder `supabase/.verification`, Docker, atau kredensial hosting. Ini bukan pengganti uji Auth, Storage, dan Edge Function pada proyek hosted.

## Operasional dan privasi

- Absensi harus online. Waktu live berasal dari database; mengubah jam perangkat tidak mengubah waktu pencatatan server.
- Clock in memerlukan penugasan harian aktif dari HR dan memakai outlet/shift penugasan. Tugas di outlet sementara tidak mengganti penempatan utama. GPS maksimal 60 detik diperiksa kembali sebelum konfirmasi; pembaruan lokasi membatalkan selfie lama.
- Satu clock in terbuka harus diakhiri clock out. Kasir dapat mengajukan waktu aktual dan alasan koreksi untuk diputuskan HR lain. Jika pencatatan gagal karena kendala lapangan, Admin HR dapat membuat catatan manual melalui Rekap, dengan alasan dan sumber konfirmasi. Catatan manual dibedakan dari clock GPS/selfie dan tidak boleh dibuat/dikoreksi untuk diri sendiri. Sesi 12 jam atau lebih tetap perlu diperiksa walaupun sudah ditutup; tidak ada clock out otomatis.
- Selfie disimpan pada bucket privat; pemilik dan Admin HR melihat URL sementara. Foto/API tidak masuk cache PWA. Tentukan masa simpan dan proses pembersihan sebelum data asli bertambah; pembersihan otomatis belum disiapkan.
- GPS browser mendukung pemeriksaan radius, bukan jaminan anti spoofing. Referensi wajah memerlukan persetujuan serta tinjauan HR lain sebelum pencocokan privat 1:1 oleh server. Sistem belum menyediakan liveness kuat atau jaminan anti foto; kegagalan ditangani melalui proses manual HR.
- Push perangkat memerlukan pilihan pengguna dan dukungan browser/platform. Penolakan izin tetap menyediakan lonceng di aplikasi. Logout melepas langganan; pengingat saat aplikasi tertutup bergantung pada konfigurasi worker/scheduler dan harus diuji pada perangkat.
- PWA bisa dipasang dari browser yang mendukung. Navigasi/data diperbarui tanpa refresh penuh. Versi kode baru menampilkan pemberitahuan; terapkan setelah menyelesaikan formulir atau selfie agar pekerjaan tidak terputus.
- Uji deployment pertama di satu outlet dengan beberapa karyawan. Uji akses lintas peran, kegagalan upload/lokasi, aktivasi/reset, clock out lewat tengah malam, dan penyesuaian saldo sebelum digunakan seluruh tim.
