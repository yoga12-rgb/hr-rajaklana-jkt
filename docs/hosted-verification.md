# Verifikasi deployment hosted — 12 Oktober 2026

Production dan Preview telah berstatus **READY**, memakai database, Auth, dan Storage Supabase yang terpisah. Laporan ini mencatat rilis yang diperiksa dan batas pengujiannya; Admin HR pertama belum dibuat dan alur pengguna lengkap masih menunggu pengujian setelah setup.

## Deployment yang diperiksa

| Komponen | Production | Preview |
| --- | --- | --- |
| Alias aktif | [hr-rajaklana-jkt.vercel.app](https://hr-rajaklana-jkt.vercel.app) | [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app) |
| Deployment ID | `dpl_HtnMH9oEN2vV8vEDH7nbwP8uUopg` | `dpl_2sKgzsQmWEf6sQ1fzszaykCXKqPK` |
| URL deployment immutable | [hr-rajaklana-hq3jkevw3-hr-rajaklana.vercel.app](https://hr-rajaklana-hq3jkevw3-hr-rajaklana.vercel.app) | [hr-rajaklana-jnzzl66rr-hr-rajaklana.vercel.app](https://hr-rajaklana-jnzzl66rr-hr-rajaklana.vercel.app) |
| Status Vercel | READY | READY |
| Source commit | `2f4f96a` | `2f4f96a` |
| Supabase project reference | `iywvnopsooroediwawnd` | `lypsqrwjzrmuyqtdcegr` |
| Paket Supabase | Free | Free |
| Edge Function `hr-api` | ACTIVE, versi 1 | ACTIVE, versi 1 |
| Migrasi aplikasi | Enam versi sesuai repositori | Enam versi sesuai repositori |

Kedua fungsi memakai source hash SHA-256 yang sama: `e4840c353b8aee8adc2de0425c85dbec04fce7d92aa0848c767afb853a5214aa`.

Deployment dibuat melalui CLI. Git integration Vercel belum terhubung, sehingga push GitHub belum menerbitkan aplikasi otomatis. GitHub Actions hanya menjalankan pemeriksaan kode/database dalam memori. Preview tetap dilindungi Vercel; akses ke frontend Preview dapat memerlukan akun yang diizinkan. Proteksi tidak dinonaktifkan untuk pengujian.

Pengguna telah menyetujui koneksi Git dan deploy otomatis. Upaya penautan yang dijalankan ditolak Vercel dengan HTTP 400 karena akun integrasi memerlukan akses admin/write ke repositori `hr-rajaklana-jkt`. Koneksi belum terbentuk. Langkah pemilik yang masih diperlukan: hubungkan akun GitHub yang memiliki akses tersebut dan izinkan Vercel GitHub App mengakses repositori pada pengaturan Git proyek, lalu verifikasi satu push uji. [Panduan integrasi Vercel untuk GitHub](https://vercel.com/docs/git/vercel-for-github).

## Hasil pemeriksaan

| Pemeriksaan | Production | Preview | Makna |
| --- | --- | --- | --- |
| Instalasi bersih `npm ci`, Svelte/TypeScript check, build remote | Lulus | Lulus | Build memakai lockfile dan konfigurasi lingkungan masing-masing |
| HTTP frontend melalui alias utama | 200; aset SPA tersedia | HTTP 200 terverifikasi melalui CLI dengan akses proteksi | Frontend terbit; akses Preview tetap mengikuti proteksi Vercel |
| HTTP `/setup` Production | 200; aset SPA tersedia | Tidak dinilai melalui browser | Form setup Production tersedia |
| Preflight `OPTIONS` ke `hr-api` dari origin utama | 204, origin diizinkan | 204, origin diizinkan | CORS menerima origin aplikasi yang dikonfigurasi |
| Request ke `hr-api` dari origin asing | 403 | 403 | Origin asing ditolak |
| Login dengan kredensial dummy yang tidak valid | 401 | 401 | Login gagal sebagaimana diharapkan; tidak memakai identitas karyawan |
| REST `employees` tanpa sesi pengguna, memakai kunci publik | 401 | 401 | Data karyawan tidak dapat dibaca tanpa autentikasi |
| Riwayat enam migrasi | Sesuai repositori | Sesuai repositori | Metadata versi migrasi telah diselaraskan |
| Karyawan / Admin HR saat diperiksa | 0 / 0 | 0 / 0 | Pengaturan admin pertama belum dilakukan |
| Tabel `public` tanpa RLS | 0 | 0 | RLS aktif pada seluruh tabel `public` |
| Bucket `attendance-selfies`, `leave-attachments`, `profile-photos` | Ketiganya `public=false` | Ketiganya `public=false` | Foto dan lampiran tidak dijadikan bucket publik |

Pemeriksaan lokal juga lulus: **163 unit test**, check tanpa error/warning, harness database PGlite, **13 fixture** penggantian schema lama, dan build. Harness database menjalankan fungsi/SQL migrasi asli, dengan plumbing Auth/Storage Supabase ditiru dalam memori. Hasil lokal dan probe HTTP tidak menggantikan pengujian login berhasil, upload foto, atau realtime menggunakan akun HR nyata di lingkungan uji.

GitHub CI untuk source commit `2f4f96a` berhasil pada [run `main` 38228695148](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38228695148) dan [run Preview 38229327856](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38229327856). Build Vercel memakai `npm run check && npm run build` setelah instalasi bersih.

Browser pada alias Production menampilkan halaman login **mode live**. Percobaan login dummy `RK999999` menghasilkan pesan terlihat: “Nomor karyawan atau kata sandi tidak sesuai”. Halaman `/setup` menampilkan form kosong yang valid; form belum dikirim dan tidak membuat akun admin. Bukti visual: [login Production](screenshots/production-live-login.png) dan [form pengaturan admin Production](screenshots/production-admin-setup.png). Screenshot tidak memuat identitas karyawan atau secret.

Pemeriksaan UI Preview berhenti pada redirect ke Vercel Authentication: automatic approval review menolak tindakan tersebut karena batas request `429`. Halaman aplikasi Preview belum diperiksa melalui browser pada sesi ini. HTTP 200 melalui CLI dengan akses proteksi telah terverifikasi sebelumnya; pemeriksaan itu tidak menggantikan interaksi UI. Tidak dilakukan bypass atau penonaktifan proteksi Preview.

Penggantian aplikasi lama pada Production dilakukan dalam transaksi yang diotorisasi pengguna: **13 tabel beserta datanya dan dua fungsi lama dihapus**, lalu foundation HR baru diterapkan. Data tidak diarsipkan. Auth dan Storage dipertahankan; dua akun Auth lama tetap ada tanpa terhubung ke karyawan HR baru. Identitas kedua akun tidak dibaca.

## Akses dan pemeriksaan keamanan

Advisors keamanan Production tidak melaporkan temuan berlevel critical/error. Pada Preview, hasil advisors hanya berisi **INFO lint 0008** untuk `account_tokens` tanpa policy dan **16 WARN lint 0029** untuk fungsi `SECURITY DEFINER` yang dapat dijalankan pengguna terautentikasi; tidak ada ERROR. Temuan tersebut tetap dicatat, tidak dinyatakan telah hilang.

Tabel `account_tokens` memakai RLS tanpa policy client karena hanya dipakai oleh layanan server; client tidak diberi akses ke isinya. Fungsi `SECURITY DEFINER` yang sengaja menjadi RPC aplikasi harus memeriksa autentikasi, input, dan kewenangan sesuai aksi. Keputusan mempertahankan akses harus dinilai per fungsi; temuan warning tidak boleh disembunyikan dengan mengubah hak akses secara menyeluruh tanpa meninjau alur aplikasi.[^lint-0008][^lint-0029]

Perlindungan password bocor dan MFA belum dikonfigurasi pada penyiapan Free ini. Bucket selfie tetap privat. Vector Storage dimatikan secara eksplisit karena aplikasi memakai Storage biasa dan tidak memerlukan fitur berbayar tersebut. Tidak ada upgrade berbayar otomatis.

## Langkah pengguna yang masih diperlukan

1. Buka `/setup` pada lingkungan yang sesuai. Isi enam kolom: nama lengkap, nomor WhatsApp, nama outlet pertama, kode bootstrap privat dari berkas lokal operator, **password pribadi sendiri** minimal 10 karakter, dan konfirmasi password yang sama. Jangan membagikan kode/password melalui Git atau tangkapan layar.
2. Setelah admin pertama berhasil dibuat, hapus `HR_BOOTSTRAP_SECRET` dan berkas kode bootstrap pada lingkungan tersebut. Catat nomor karyawan yang diberikan sistem untuk login.
3. Lengkapi outlet, lokasi/radius, jam operasional, karyawan, dan atasan menggunakan data fiktif selama uji coba.
4. Uji login/aktivasi/pemulihan, batas akses antar akun, cuti/izin/persetujuan, foto privat setelah reload, realtime dua perangkat, serta kamera/GPS dan pemasangan PWA pada ponsel.

Lokasi berkas kode bootstrap dan kontrak environment tersedia pada [Production dan Preview](deployment-environments.md). Nilai secret tidak dimasukkan ke laporan ini. Deployment READY menunjukkan rilis platform berhasil; aplikasi belum dipakai untuk operasional karyawan sebelum setup dan pengujian pengguna selesai.

[^lint-0008]: [Remediation resmi lint 0008 — RLS enabled, no policy](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0008_rls_enabled_no_policy). Supabase menyarankan policy penolakan eksplisit bila semua akses client memang sengaja ditolak; policy akses hanya dibuat bila ada kebutuhan client yang sah.

[^lint-0029]: [Remediation resmi lint 0029 — authenticated SECURITY DEFINER function executable](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable). Evaluasi setiap fungsi: cabut hak execute yang tidak diperlukan, gunakan `SECURITY INVOKER` bila sesuai, atau pertahankan RPC yang disengaja dengan validasi dan pembatasan yang benar.
