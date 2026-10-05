# Rajaklana HR — Jabodetabek

Aplikasi HR dengan SvelteKit + TypeScript, navigasi SPA dan PWA. Cakupan awal: data karyawan/master organisasi, clock in/out kasir dengan GPS dan selfie, cuti/izin beserta persetujuan dan perubahan, serta rekap HR. Lihat [spesifikasi](docs/specification.md) dan [kontrak backend](supabase/CONTRACT.md).

## Status

Frontend dapat dijalankan dalam **mode demo berlabel jelas** ketika konfigurasi publik Supabase kosong. Data contoh disimpan pada browser ini saja; bukan data perusahaan, bukan backend operasional, dan tidak disinkronkan antar perangkat. Belum ada proyek Supabase hosted yang terhubung atau website produksi yang dipublikasikan dari repositori ini.

Mode live sudah memiliki jalur integrasi, migrasi, RLS, bucket privat, RPC transaksi, dan Edge Function. Jalur tersebut harus diuji pada proyek Supabase nyata sebelum produksi. Demo tidak membuktikan keamanan RLS, pengiriman realtime antar perangkat, atau kamera/GPS ponsel nyata.

## Jalankan lokal

Gunakan Node.js LTS modern (22.12 atau lebih baru) dan npm. Pada Windows gunakan `npm.cmd` bila PowerShell memblokir wrapper `.ps1`.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

Buka URL lokal yang ditampilkan terminal. Biarkan kedua nilai `.env` kosong untuk demo. Login contoh: `RK000001` / `DemoRajaklana123!`, atau pilih tombol Admin HR, Head Baker, Kasir. Pada Profil terdapat pilihan akun contoh untuk mencoba alur antara pemohon dan atasan.

Nama, outlet, lokasi, dan permohonan dalam demo semuanya fiktif. GPS masih diperiksa terhadap koordinat outlet contoh. Ubah titik outlet melalui Organisasi saat mencoba dari lokasi sendiri. Demo tidak mengunggah selfie ke Supabase; pratinjau selfie lokal tidak bertahan setelah reload. Tautan aktivasi/pemulihan demo hanya bekerja pada browser yang sama; penggunaan nyata di perangkat karyawan memerlukan mode live.

Ikuti [uji pendaftaran lokal](docs/local-pilot.md) untuk mencoba alur HR → undangan → aktivasi → login karyawan. Tombol **Masuk dengan akun ini** setelah aktivasi/pemulihan mengakhiri sesi sebelumnya dan mengisi nomor karyawan pada halaman masuk; kata sandi tetap harus dimasukkan sendiri.

## Konfigurasi frontend live

Isi hanya kunci **publik** di `.env` dan pada environment build hosting:

```dotenv
PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
PUBLIC_SUPABASE_ANON_KEY=PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

File `.env` diabaikan Git. Jangan memasukkan `service_role`, secret key, password database, atau bootstrap secret pada variabel `PUBLIC_*`, frontend, tangkapan layar, atau Git. Restart dev server/rebuild sesudah mengubah environment. Konfigurasi salah harus menghasilkan pesan kegagalan, bukan beralih ke data demo seolah login berhasil.

Dev server dan build memeriksa pasangan URL/kunci terlebih dahulu. Konfigurasi yang hanya terisi sebagian, URL yang tidak sesuai, serta secret/service role key ditolak tanpa mencetak nilainya. Mode demo hanya berjalan ketika kedua nilai kosong. Validasi bentuk ini bukan pemeriksaan koneksi ke proyek hosted. [Jenis kunci Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

Pada Beranda Admin HR, **Persiapan tim** merangkum outlet yang lokasi absensinya belum lengkap, akun karyawan yang belum aktif, dan atasan pengajuan yang belum siap. Tautan mengarah ke Organisasi atau Karyawan untuk dilengkapi. Ringkasan ini membantu penyiapan data; pengujian layanan live dan perangkat tetap diperlukan sebelum pemakaian outlet.

## Siapkan Supabase

Proyek hosted memerlukan akses pemilik proyek. Perintah di bawah adalah panduan setup dan belum dijalankan ke layanan hosted.

1. Buat proyek Supabase dan catat project reference serta URL/kunci publik.
2. Login CLI, tautkan proyek yang benar, dan pratinjau migrasi sebelum menerapkan.

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref PROJECT_REF
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Migrasi diterapkan menurut urutan nama di `supabase/migrations`. Migrasi menyiapkan organisasi awal, tabel HR, fungsi transaksi, audit, RLS, token akun, serta bucket privat. Pada proyek yang telah memiliki data, tinjau SQL dan siapkan backup dahulu. [Referensi resmi migrasi Supabase](https://supabase.com/docs/reference/cli/supabase-db-push).

3. Pada Auth settings matikan public signup; minimum password 10 karakter. Set Site URL ke origin frontend HTTPS. Tidak perlu SMTP untuk aktivasi melalui WhatsApp karena akun dibuat server dan kata sandi diatur melalui token aplikasi.
4. Siapkan secret **server Edge Function** pada berkas lokal yang diabaikan Git, misalnya `.env.hr-api`:

```dotenv
APP_ORIGIN=https://DOMAIN_APLIKASI
HR_BOOTSTRAP_SECRET=RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` tersedia pada lingkungan hosted Edge Function. `APP_ORIGIN` harus persis origin frontend, tanpa slash di akhir. Untuk lokal boleh `http://127.0.0.1:5173`. Bootstrap secret dibuat acak, digunakan sementara, dan disimpan server saja.

```powershell
npx.cmd supabase secrets set --env-file .env.hr-api
npx.cmd supabase functions deploy hr-api --no-verify-jwt
```

Verifier platform dinonaktifkan karena fungsi mendukung login/aktivasi publik. Aksi administrasi tetap memverifikasi token pengguna dan otorisasi database secara eksplisit. [Panduan resmi deployment Edge Functions](https://supabase.com/docs/guides/functions/deploy).

5. Buka `/setup` pada frontend yang sudah terhubung Supabase. Isi nama admin, WhatsApp, nama outlet pertama, kode pengaturan awal (`HR_BOOTSTRAP_SECRET`), dan kata sandi pribadi. Halaman ini hanya dapat membuat admin pertama. Alternatif untuk operator teknis: POST ke `https://PROJECT_REF.supabase.co/functions/v1/hr-api`, header `apikey: PUBLIC_ANON_OR_PUBLISHABLE_KEY` dan `Content-Type: application/json`. Body:

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
npx.cmd supabase secrets unset HR_BOOTSTRAP_SECRET
```

6. Login admin, lengkapi koordinat/jam/radius outlet, tambah karyawan, pilih atasan, dan beri hak Admin HR kepada supervisor yang ditunjuk. Outlet bootstrap sengaja belum memiliki koordinat; absensi tidak akan berhasil sampai diatur.
7. Periksa publication `supabase_realtime` untuk tabel yang digunakan dan uji bahwa akun lain mendapat perubahan sesuai hak aksesnya. Jangan menjadikan bucket selfie publik.

Untuk backend lokal (Docker dan Supabase CLI dibutuhkan), gunakan `supabase start`, `supabase db reset`, kemudian `supabase functions serve hr-api --env-file .env.hr-api`. `db reset` menghapus database lokal dan tidak boleh digunakan sebagai langkah biasa pada database berisi data penting.

## Build dan hosting

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Build statis berada di `build/` dengan fallback SPA `200.html`. `vercel.json` menyiapkan rewrite dan header. Pada Vercel gunakan build command `npm run build`, output directory `build`, serta kedua public environment variables di atas.

**Vercel Hobby dibatasi untuk penggunaan pribadi nonkomersial.** Operasional HR perusahaan perlu paket atau penyedia hosting yang sesuai. Kode statis ini dapat dipasang pada hosting HTTPS lain yang mendukung fallback SPA. [Ketentuan Vercel Hobby](https://vercel.com/docs/plans/hobby).

Supabase Free dapat dipakai untuk memulai pengujian dengan memantau kapasitas database, Storage, Realtime, dan trafik. Pertumbuhan foto selfie perlu dipantau secara rutin; jangan menganggap kapasitas gratis tidak terbatas. Lihat [kuota resmi Supabase](https://supabase.com/pricing) saat memilih paket.

## Uji

```powershell
npm.cmd run check
npm.cmd test
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

Uji migrasi dan RLS terpisah tersedia di `supabase/tests/database.mjs` menggunakan PGlite. Harness meniru plumbing Auth/Storage Supabase dan menjalankan SQL migrasi asli. Ini bukan pengganti uji Auth, Storage, dan Edge Function pada proyek hosted.

## Operasional dan privasi

- Absensi harus online. Waktu live berasal dari database; mengubah jam perangkat tidak mengubah waktu pencatatan server.
- Satu clock in terbuka harus diakhiri clock out. Jika lupa, HR melakukan koreksi beralasan dan audit tetap tersedia. Jika pencatatan gagal karena kendala lapangan, Admin HR dapat membuat catatan manual melalui Rekap, dengan alasan dan sumber konfirmasi. Catatan manual dibedakan dari clock GPS/selfie dan tidak boleh dibuat/dikoreksi untuk diri sendiri.
- Selfie disimpan pada bucket privat; pemilik dan Admin HR melihat URL sementara. Foto/API tidak masuk cache PWA. Tentukan masa simpan dan proses pembersihan sebelum data asli bertambah; pembersihan otomatis belum disiapkan.
- GPS browser mendukung pemeriksaan radius, bukan jaminan anti spoofing. Selfie ditinjau manusia, bukan identifikasi wajah otomatis.
- PWA bisa dipasang dari browser yang mendukung. Navigasi/data diperbarui tanpa refresh penuh. Versi kode baru menampilkan pemberitahuan; terapkan setelah menyelesaikan formulir atau selfie agar pekerjaan tidak terputus.
- Uji deployment pertama di satu outlet dengan beberapa karyawan. Uji akses lintas peran, kegagalan upload/lokasi, aktivasi/reset, clock out lewat tengah malam, dan penyesuaian saldo sebelum digunakan seluruh tim.
