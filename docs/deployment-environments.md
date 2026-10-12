# Production dan Preview

Production dan Preview memakai build frontend serta proyek Supabase yang terpisah. Selama tahap uji coba, kedua lingkungan hanya diisi akun dan data fiktif. Nama environment **Production** menunjukkan target deployment utama; aplikasi belum layak dipakai untuk operasional sebelum pemeriksaan layanan hosted dan perangkat selesai.

## Status penyiapan — 12 Oktober 2026

Kedua proyek Supabase berada di organisasi **Rajaklana** (`bvwgekyfibloctfslgdf`) dengan paket **Free**. Seluruh enam migrasi aplikasi telah diterapkan pada kedua proyek; versi dalam riwayat migrasi sesuai berkas repositori. Edge Function `hr-api` aktif pada keduanya, versi 1 dengan hash source yang sama. Ini membuktikan penyiapan backend, bukan kelulusan semua alur aplikasi melalui browser.

Vercel memakai proyek **hr-rajaklana-jkt** (`prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`) pada tim **hr-rajaklana** (`team_S1Sn08iaksD0GQF4kk49kTkH`). Kedua deployment berstatus **READY** dari commit `2f4f96a`, dengan alias Production dan Preview yang aktif. Preview tetap memakai proteksi akses Vercel. Admin HR pertama masih menunggu kode bootstrap privat dan pengaturan password pribadi melalui `/setup`. Hasil build serta pemeriksaan HTTP/backend dicatat pada [verifikasi hosted](hosted-verification.md).

Deployment saat ini dibuat melalui CLI. Git integration Vercel **belum terhubung**; push GitHub menjalankan pemeriksaan CI dan belum menerbitkan frontend otomatis.

Pengguna telah menyetujui koneksi Git dan deploy otomatis. Penautan yang dijalankan masih ditolak Vercel dengan HTTP 400: akun integrasi memerlukan akses admin/write ke repositori `hr-rajaklana-jkt`. Pemilik perlu membuka pengaturan Git proyek, menghubungkan akun GitHub yang memiliki akses tersebut, dan mengizinkan Vercel GitHub App mengakses repositori. Setelah penautan berhasil, verifikasi Production branch, konfigurasi Preview, dan satu push uji sebelum menyatakan deploy otomatis aktif. [Integrasi resmi Vercel untuk GitHub](https://vercel.com/docs/git/vercel-for-github).

## Pemisahan lingkungan

| Komponen | Production | Preview |
| --- | --- | --- |
| Branch yang disarankan saat integrasi Git disiapkan | `main` | `codex/preview` |
| Environment Vercel | Production | Preview |
| `PUBLIC_APP_ENV` | `production` | `preview` |
| Proyek Supabase | Rajaklana — `iywvnopsooroediwawnd` | hr-rajaklana-preview — `lypsqrwjzrmuyqtdcegr` |
| URL Supabase | `https://iywvnopsooroediwawnd.supabase.co` | `https://lypsqrwjzrmuyqtdcegr.supabase.co` |
| Paket Supabase | Free | Free |
| Database, Auth, foto selfie | Hanya milik Production | Hanya milik Preview |
| Origin frontend | [hr-rajaklana-jkt.vercel.app](https://hr-rajaklana-jkt.vercel.app) — aktif, READY | [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app) — aktif, READY, proteksi Vercel |

Jangan memasang URL atau kunci proyek Production pada environment Preview. Nomor karyawan, password, token aktivasi, saldo cuti, dan foto tidak disalin antar lingkungan. Sebuah Preview deployment boleh dihapus atau diganti tanpa memindahkan data ke Production.

Saat integrasi Git disiapkan, gunakan `codex/preview` sebagai branch uji yang stabil. Setelah perubahan diterima, kode yang sama masuk ke `main`, lalu dibangun ulang dengan konfigurasi Production. Deployment yang tersedia sekarang memakai source commit yang sama melalui CLI. Mempromosikan Preview tidak memindahkan database maupun akun Preview ke Production.

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

Matikan public signup. Atur minimum password 10 karakter dan Auth Site URL sesuai origin lingkungan. Aktivasi karyawan tetap memakai token aplikasi yang dikirim manual melalui WhatsApp, sehingga tidak memerlukan akun email karyawan atau SMTP.

Origin utama pada server sudah diset ke domain Production dan alias Preview aktif pada tabel di atas. Jika memakai URL deployment tambahan, tambahkan origin persisnya pada `APP_ALLOWED_ORIGINS` di proyek yang sesuai. Hanya origin HTTPS tanpa path, query, kredensial, fragment, atau wildcard yang diterima; HTTP hanya untuk localhost. Permintaan dari origin yang tidak terdaftar ditolak sebelum body, rate limit, Auth, atau database diproses. Origin tambahan tidak mengubah tujuan tautan akun yang tetap mengikuti `APP_ORIGIN`.

Gunakan `/setup` pada masing-masing frontend untuk membuat Admin HR pertama. Isi enam kolom: nama lengkap, nomor WhatsApp, nama outlet pertama, kode bootstrap, **password pribadi yang dipilih sendiri** minimal 10 karakter, dan konfirmasi password yang sama. Nomor karyawan dihasilkan sistem. Setelah berhasil, hapus `HR_BOOTSTRAP_SECRET` dari proyek terkait dan berkas lokal operator. Outlet pertama belum memiliki koordinat; lengkapi lokasi, radius, jam, dan aturan shift sebelum mencoba absensi.

Kode bootstrap kedua lingkungan tersedia untuk operator pada berkas lokal yang diabaikan Git: `.vercel/supabase-production/bootstrap-code.txt` dan `.vercel/supabase-preview/bootstrap-code.txt`. Nilainya tidak disimpan di dokumentasi, Git, frontend, atau artefak deployment. Membuat akun admin dan memilih password tetap langkah pengguna; akun belum dibuat otomatis atas nama pengguna.

Function menggunakan `verify_jwt=false` karena login, aktivasi, dan bootstrap adalah endpoint publik. Setiap aksi administratif memverifikasi JWT pengguna dan otorisasi database di dalam function. Bucket selfie tetap privat. [Deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy).

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

`test:database:legacy` menjalankan 13 fixture untuk penggantian schema lama, termasuk penolakan kondisi yang tidak sesuai dan rollback transaksi. Pemeriksaan lokal pada penyiapan ini mencatat 163 unit test lulus, Svelte/TypeScript tanpa error atau warning, dan build berhasil. Kedua build remote juga menjalankan instalasi bersih, check, dan build hingga READY. Hasil ini belum membuktikan akun admin telah dibuat atau seluruh alur digunakan manusia.

Actions resmi dipin ke SHA rilis yang diverifikasi: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) dan [setup-node v6.5.0](https://github.com/actions/setup-node/releases/tag/v6.5.0). Workflow memiliki izin `contents: read`, tidak menyimpan kredensial checkout, serta tidak mengunggah `.env` atau artefak berisi secret. [Panduan keamanan GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

CI memeriksa kode; **workflow ini belum menjadi gate deployment Vercel** dan tidak melakukan deployment. Git integration Vercel belum terhubung. Jika integrasi Git diaktifkan nanti, Vercel dapat membangun setiap push secara independen; gate otomatis masih memerlukan konfigurasi Deployment Checks atau alur staging dan promotion tambahan. [Deployment Checks Vercel](https://vercel.com/docs/deployment-checks).

CI commit `2f4f96a` telah berhasil pada [run `main`](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38228695148) dan [run branch Preview](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38229327856). Build hosted menggunakan perintah `npm run check && npm run build`. Kedua database masih memiliki **0 karyawan dan 0 Admin HR**, semua tabel `public` memakai RLS, dan tiga bucket aplikasi tetap privat. Lihat [laporan hosted](hosted-verification.md) untuk bukti browser, batas pemeriksaan Preview, serta temuan advisors yang masih dicatat.

Sebelum digunakan karyawan, uji kedua lingkungan: bootstrap/login, undangan dan aktivasi, batas akses antar akun, cuti/izin dan persetujuan, selfie/GPS pada ponsel, foto privat setelah reload, serta realtime di dua perangkat. Vercel Hobby hanya untuk uji pribadi nonkomersial; penggunaan HR perusahaan memerlukan paket atau hosting yang sesuai sebelum operasional. Tidak ada upgrade berbayar otomatis. [Ketentuan Vercel Hobby](https://vercel.com/docs/plans/hobby).
