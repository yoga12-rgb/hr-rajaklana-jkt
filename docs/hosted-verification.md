# Verifikasi deployment hosted — pembaruan 13 Oktober 2026

Production dan Preview telah berstatus **READY**, memakai database, Auth, dan Storage Supabase yang terpisah. Rilis frontend awal dan smoke test di bawah dicatat pada 12 Oktober 2026. Verifikasi terbaru 13 Oktober memastikan **Admin HR Production telah dibuat, aktif, dan terhubung ke Auth**; Production memiliki 1 admin/1 karyawan, Preview tetap 0/0. Setelah provider Auth diperbaiki, pengguna mengonfirmasi login Production berhasil dan Dashboard terbuka. Setup admin Preview masih diperlukan.

Rilis awal 12 Oktober memuat enam migrasi. Setelah perbaikan izin baca server, kedua proyek memiliki tujuh versi/nama migrasi yang sesuai repositori, terakhir `20261012094903` / `hr_api_service_role_reads`. Source frontend tetap `2f4f96a`; Edge Function telah diperbarui untuk membedakan kegagalan Auth dengan aman.

## Deployment yang diperiksa

| Komponen | Production | Preview |
| --- | --- | --- |
| Alias aktif | [hr-rajaklana-jkt.vercel.app](https://hr-rajaklana-jkt.vercel.app) | [hr-rajaklana-jkt-preview.vercel.app](https://hr-rajaklana-jkt-preview.vercel.app) |
| Deployment ID | `dpl_HtnMH9oEN2vV8vEDH7nbwP8uUopg` | `dpl_2sKgzsQmWEf6sQ1fzszaykCXKqPK` |
| URL deployment immutable | [hr-rajaklana-hq3jkevw3-hr-rajaklana.vercel.app](https://hr-rajaklana-hq3jkevw3-hr-rajaklana.vercel.app) | [hr-rajaklana-jnzzl66rr-hr-rajaklana.vercel.app](https://hr-rajaklana-jnzzl66rr-hr-rajaklana.vercel.app) |
| Status Vercel | READY | READY |
| Source commit frontend | `2f4f96a` | `2f4f96a` |
| Supabase project reference | `iywvnopsooroediwawnd` | `lypsqrwjzrmuyqtdcegr` |
| Paket Supabase | Free | Free |
| Edge Function `hr-api` terkini | ACTIVE, versi 3 | ACTIVE, versi 2 |
| Migrasi aplikasi saat pembaruan laporan | Tujuh versi/nama sesuai repositori | Tujuh versi/nama sesuai repositori |

Kedua fungsi saat ini memakai hash bundle SHA-256 yang sama: `5742f067d71210dd3d43e011fa46f05e9a048334d5e21ae73c297df91345bd0a`. Hash awal rilis 12 Oktober berbeda karena pelaporan kegagalan Auth kemudian diperbaiki tanpa menyimpan secret atau respons Auth sensitif pada log.

Rilis awal dibuat melalui CLI. Git integration Vercel kini **CONNECTED**, tetapi deployment otomatis dari push belum selesai diverifikasi. GitHub Actions hanya menjalankan pemeriksaan kode/database dalam memori. Preview tetap dilindungi Vercel; akses ke frontend Preview dapat memerlukan akun yang diizinkan. Proteksi tidak dinonaktifkan untuk pengujian.

Penautan awal ditolak Vercel dengan HTTP 400. Pemeriksaan GitHub memastikan akses kolaborator aktif dan instalasi Vercel GitHub App `132470462` telah ada sejak Mei 2026 dengan scope seluruh repositori; scope App tidak diubah dalam proses ini. Dokumentasi Vercel mensyaratkan **Owner** untuk menghubungkan repositori milik akun personal, sehingga status Collaborator saja tidak cukup. Pengguna kemudian menyelesaikan OAuth akun Owner dan penautan berhasil. [Ketentuan repo personal Vercel](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories).

[Pengaturan Git proyek](https://vercel.com/hr-rajaklana/hr-rajaklana-jkt/settings/git) sudah dapat dibuka setelah login Vercel selesai. Pesan “No Git Repositories Found” dicatat pada tahap awal. Setelah akun Owner terhubung, CLI `git connect` menghasilkan **Connected SUCCESS**. API proyek mengonfirmasi koneksi Git aktif, provider `github`, owner `yoga12-rgb`, repository `hr-rajaklana-jkt`, dan Production branch `main`.

Pengguna secara eksplisit memilih **akun Vercel Raja + GitHub Owner Yoga** dan telah menyelesaikan OAuth sendiri. Authentication Vercel telah memperlihatkan GitHub `yoga12-rgb` baru dipakai; akun Vercel Raja dan kepemilikan repo tetap sama. Domain Preview kini telah dikonfigurasi untuk branch `codex/preview`; deployment otomatis dari push baru masih menunggu hasil pengujian.

API domain proyek memastikan `hr-rajaklana-jkt-preview.vercel.app` memiliki `verified=true`, `gitBranch=codex/preview`, dan project ID `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`. Domain Production mempunyai `gitBranch=null` dan mengikuti Production branch `main`. Kedua target memakai environment Production/Preview standar; custom environment berbayar tidak dibuat. Pengaturan domain branch ini berbeda dari bukti deployment push, yang belum selesai diuji.

## Hasil pemeriksaan

| Pemeriksaan | Production | Preview | Makna |
| --- | --- | --- | --- |
| Instalasi bersih `npm ci`, Svelte/TypeScript check, build remote | Lulus | Lulus | Build memakai lockfile dan konfigurasi lingkungan masing-masing |
| HTTP frontend melalui alias utama | 200; aset SPA tersedia | HTTP 200 terverifikasi melalui CLI dengan akses proteksi | Frontend terbit; akses Preview tetap mengikuti proteksi Vercel |
| HTTP `/setup` Production | 200; aset SPA tersedia | Tidak dinilai melalui browser | Form setup Production tersedia |
| Preflight `OPTIONS` ke `hr-api` dari origin utama | 204, origin diizinkan | 204, origin diizinkan | CORS menerima origin aplikasi yang dikonfigurasi |
| Request ke `hr-api` dari origin asing | 403 | 403 | Origin asing ditolak |
| Login dengan kredensial dummy yang tidak valid | 401 | 401 | Login gagal sebagaimana diharapkan; tidak memakai identitas karyawan |
| Auth settings sesudah perbaikan provider — 13 Oktober | `external.email=true`, `disable_signup=true` | `external.email=true`, `disable_signup=true` | Login Email/password aktif, public signup tetap ditolak |
| Login dummy langsung ke Auth sesudah perbaikan | 400 `invalid_credentials` | Konfigurasi provider diperiksa | Provider tidak lagi gagal dengan `email_provider_disabled` |
| Bootstrap Production setelah kode awal dihapus | 403 | Setup Preview masih tersedia | Pengaturan awal Production sudah ditutup |
| Login pengguna dan Dashboard — 13 Oktober | Berhasil, dikonfirmasi pengguna | Belum diuji oleh pengguna | Membuktikan login awal Production, bukan seluruh alur operasional |
| REST `employees` tanpa sesi pengguna, memakai kunci publik | 401 | 401 | Data karyawan tidak dapat dibaca tanpa autentikasi |
| Riwayat tujuh migrasi | Sesuai repositori | Sesuai repositori | Versi/nama terbaru `20261012094903` / `hr_api_service_role_reads` telah diverifikasi |
| Migrasi izin baca server `20261012094903` | Diterapkan setelah verifikasi Preview | Diterapkan dan diverifikasi terlebih dahulu | Menambah SELECT server pada dua tabel HR |
| Pembacaan hosted dengan `SET LOCAL ROLE service_role` sebelum setup | Count admin/karyawan berhasil, 0/0 | Count admin/karyawan berhasil, 0/0 | Role server sebenarnya dapat menjalankan pemeriksaan awal |
| Grant SELECT server pada `employees` / `employee_roles` | true / true | true / true | Izin baca yang diperlukan Edge Function tersedia |
| Grant SELECT anonim pada `employees` / `employee_roles` | false / false | false / false | Perbaikan server tidak membuka akses anonim |
| Karyawan / Admin HR — verifikasi 13 Oktober | 1 / 1 | 0 / 0 | Setup Production berhasil; setup Preview masih diperlukan |
| Admin pertama aktif dan terhubung Auth — 13 Oktober | true / true | Belum ada admin | Keberadaan akun dikonfirmasi tanpa mencatat identitas privat |
| Secret bootstrap setelah setup — 13 Oktober | Dihapus; metadata tidak memuat secret, `APP_ORIGIN` tetap ada | Tetap untuk setup admin yang belum dilakukan | Kode awal Production sudah ditutup |
| Berkas lokal bootstrap setelah setup — 13 Oktober | `bootstrap-code.txt` dan `edge-secrets.env` dihapus, Test-Path false | Berkas Preview tidak diubah | Berkas Production yang tidak diperlukan telah dibersihkan |
| Tabel `public` tanpa RLS | 0 | 0 | RLS aktif pada seluruh tabel `public` |
| Bucket `attendance-selfies`, `leave-attachments`, `profile-photos` | Ketiganya `public=false` | Ketiganya `public=false` | Foto dan lampiran tidak dijadikan bucket publik |

Pemeriksaan lokal terbaru lulus: **190 unit test dalam 11 berkas**, Svelte/TypeScript tanpa error/warning, harness database PGlite dengan **tujuh migrasi**, serta **13 fixture** penggantian schema lama. Hasil build remote rilis awal juga lulus. Harness database menjalankan fungsi/SQL migrasi asli, dengan plumbing Auth/Storage Supabase ditiru dalam memori. Login awal Production dikonfirmasi langsung oleh pengguna; upload foto, realtime, kamera/GPS, dan alur lintas akun tetap memerlukan pengujian terpisah.

GitHub CI untuk source commit `2f4f96a` berhasil pada [run `main` 38228695148](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38228695148) dan [run Preview 38229327856](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/38229327856). Build Vercel memakai `npm run check && npm run build` setelah instalasi bersih.

Pada pemeriksaan browser 12 Oktober, alias Production menampilkan halaman login **mode live**. Percobaan login dummy `RK999999` menghasilkan pesan terlihat: “Nomor karyawan atau kata sandi tidak sesuai”. Halaman `/setup` menampilkan form kosong yang valid; operator pengujian tidak mengirim form atau memilih password pengguna. Bukti visual awal: [login Production](screenshots/production-live-login.png) dan [form pengaturan admin Production](screenshots/production-admin-setup.png). Screenshot tidak memuat identitas karyawan atau secret. Setup Production kemudian dilakukan pengguna dan dikonfirmasi lewat SQL pada 13 Oktober; screenshot awal bukan bukti login akun yang baru dibuat.

Pada pemeriksaan awal, redirect browser ke Vercel Authentication ditolak automatic approval review karena batas request `429`. Navigasi baru kemudian berhasil dan login Vercel telah selesai; `429` bukan penghalang aktif saat laporan diperbarui. UI aplikasi Preview tetap belum diperiksa dalam pembaruan ini. HTTP 200 melalui CLI dengan akses proteksi telah terverifikasi sebelumnya; pemeriksaan itu tidak menggantikan interaksi UI. Tidak dilakukan bypass atau penonaktifan proteksi Preview.

## Diagnosis kendala setup Production

Pengguna kemudian melaporkan pesan “Admin awal sudah dibuat atau bootstrap belum siap”. Pemeriksaan SQL menunjukkan **0 Admin HR dan 0 karyawan**, sehingga pesan tersebut tidak berarti admin telah dibuat. `service_role` pada Production memiliki `USAGE` schema dan bypass RLS, tetapi tidak memiliki grant `SELECT` yang diperlukan untuk pembacaan `employees`/`employee_roles` oleh Edge Function. Preview baru mempunyai grant default yang berbeda.

Migrasi `20261012094903_hr_api_service_role_reads.sql` telah diterapkan ke Preview terlebih dahulu. Dalam transaksi hosted, `SET LOCAL ROLE service_role` diikuti pembacaan count `employee_roles` dan `employees` berhasil, role efektif benar-benar `service_role`, hasil admin/karyawan 0/0. Setelah lolos, migrasi diterapkan ke Production dan pemeriksaan yang sama berhasil dengan hasil 0/0. Perbaikan hanya menambah `SELECT` untuk role server pada dua tabel tersebut; tidak menambah grant anonim, `INSERT`, `UPDATE`, atau `DELETE`.

Pemeriksaan catalog terakhir pada keduanya memastikan SELECT server `true` untuk kedua tabel, SELECT anonim `false`, dan tabel `public` tanpa RLS tetap 0. Metadata migrasi terbaru juga telah diperiksa setelah perbaikan: versi `20261012094903`, nama `hr_api_service_role_reads` tersedia pada kedua proyek. GRANT database tetap tersimpan; perbaikan metadata riwayat dicatat terpisah setelah verifikasinya selesai.

Kasus regresi database memeriksa kondisi sebelum grant ditolak dan pembacaan yang diperlukan pemeriksaan bootstrap/login berhasil setelah grant. Perbaikan grant sendiri tidak memerlukan perubahan frontend/Edge Function; function kemudian diperbarui untuk pelaporan kegagalan Auth yang terpisah. Pemeriksaan baru 13 Oktober memastikan Production mempunyai 1 admin/1 karyawan, akun admin aktif dan terhubung Auth; Preview tetap 0/0. Setelah perbaikan provider berikutnya, pengguna mengonfirmasi login berhasil. Diagnosis grant awal berkaitan dengan izin database, bukan password pengguna atau admin yang sudah ada. [Dokumentasi grant dan RLS](https://supabase.com/docs/guides/api/securing-your-api).

## Perbaikan provider login Auth — 13 Oktober

Lima kejadian Auth awal sesudah setup menghasilkan HTTP token `422` dengan kode `email_provider_disabled`. Kegagalan ini berasal dari `[auth.email].enable_signup=false` yang menonaktifkan provider Email/password, bukan bukti kata sandi pengguna salah. Nomor karyawan tetap dipetakan ke alias Auth internal, sehingga provider Email/password diperlukan meskipun pengguna tidak memakai alamat email untuk login.

Konfigurasi sekarang memakai `[auth].enable_signup=false` dan `[auth.email].enable_signup=true`. Diff config CLI yang diterapkan hanya mengubah pengaturan Email: Preview diuji terlebih dahulu, lalu Production. GET Auth settings pada keduanya menunjukkan `external.email=true` dan `disable_signup=true`; pendaftaran publik tetap dimatikan. Probe dummy Auth Production menghasilkan `400 invalid_credentials`, Edge Function pada kedua proyek menghasilkan `401`, dan bootstrap Production yang telah ditutup menghasilkan `403`.

Edge Function memakai klasifikasi error login dengan kode/status yang disanitasi; password, token, dan respons sensitif tidak dicatat pada log. Kedua deployment function ACTIVE dengan hash bundle yang sama, Production versi 3 dan Preview versi 2. Pengguna kemudian menyatakan Dashboard Production berhasil dibuka. Bukti keberhasilan ini berasal dari pengguna, tanpa membaca atau menyimpan password maupun identitas privat.

Setelah akun admin Production berhasil dibuat, `HR_BOOTSTRAP_SECRET` telah dihapus dengan hasil CLI exit 0. Daftar metadata secret sesudahnya memastikan kode bootstrap tidak ada dan `APP_ORIGIN` masih ada. Dua berkas lokal terkait pada `.vercel/supabase-production/` — `bootstrap-code.txt` dan `edge-secrets.env` — telah dihapus; `Test-Path` keduanya menghasilkan false. Berkas dan kebutuhan bootstrap Preview tidak diubah karena admin Preview belum dibuat. Nilai secret dan identitas admin tidak dicantumkan dalam pembaruan laporan.

Penggantian aplikasi lama pada Production dilakukan dalam transaksi yang diotorisasi pengguna: **13 tabel beserta datanya dan dua fungsi lama dihapus**, lalu foundation HR baru diterapkan. Data tidak diarsipkan. Auth dan Storage dipertahankan; dua akun Auth lama tetap ada tanpa terhubung ke karyawan HR baru. Identitas kedua akun tidak dibaca.

## Akses dan pemeriksaan keamanan

Setelah perbaikan grant, advisors Production tetap mencatat **INFO lint 0008** untuk `account_tokens` tanpa policy, **16 WARN lint 0029** untuk fungsi `SECURITY DEFINER` yang dapat dijalankan pengguna terautentikasi, satu WARN perlindungan password bocor belum aktif, dan satu WARN MFA belum dikonfigurasi; tidak ada ERROR. Pada Preview, hasil advisors yang diperiksa berisi INFO untuk `account_tokens` dan 16 WARN `SECURITY DEFINER`, tanpa ERROR. Temuan tersebut tetap dicatat, tidak dinyatakan telah hilang.

Tabel `account_tokens` memakai RLS tanpa policy client karena hanya dipakai oleh layanan server; client tidak diberi akses ke isinya. Fungsi `SECURITY DEFINER` yang sengaja menjadi RPC aplikasi harus memeriksa autentikasi, input, dan kewenangan sesuai aksi. Keputusan mempertahankan akses harus dinilai per fungsi; temuan warning tidak boleh disembunyikan dengan mengubah hak akses secara menyeluruh tanpa meninjau alur aplikasi.[^lint-0008][^lint-0029]

Perlindungan password bocor dan MFA belum dikonfigurasi pada penyiapan Free ini. Bucket selfie tetap privat. Vector Storage dimatikan secara eksplisit karena aplikasi memakai Storage biasa dan tidak memerlukan fitur berbayar tersebut. Tidak ada upgrade berbayar otomatis.

## Langkah pengguna yang masih diperlukan

1. Production: login awal dan Dashboard sudah dikonfirmasi berhasil oleh pengguna. Lanjutkan penyiapan outlet dan tim; jangan mengulang `/setup` Production atau membagikan password.
2. Preview: bila akan diuji, buka `/setup` dan isi enam kolom: nama lengkap, nomor WhatsApp, nama outlet pertama, kode bootstrap privat dari berkas lokal operator, **password pribadi sendiri** minimal 10 karakter, dan konfirmasi password yang sama. Setelah admin Preview dibuat, hapus `HR_BOOTSTRAP_SECRET` dan berkas kode bootstrap pada lingkungan tersebut. Jangan membagikan kode/password melalui Git atau tangkapan layar.
3. Lengkapi outlet, lokasi/radius, jam operasional, karyawan, dan atasan menggunakan data fiktif selama uji coba.
4. Uji login/aktivasi/pemulihan, batas akses antar akun, cuti/izin/persetujuan, foto privat setelah reload, realtime dua perangkat, serta kamera/GPS dan pemasangan PWA pada ponsel.

Lokasi berkas kode bootstrap dan kontrak environment tersedia pada [Production dan Preview](deployment-environments.md). Nilai secret tidak dimasukkan ke laporan ini. Deployment READY menunjukkan rilis platform berhasil; aplikasi belum dipakai untuk operasional karyawan sebelum setup dan pengujian pengguna selesai.

[^lint-0008]: [Remediation resmi lint 0008 — RLS enabled, no policy](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0008_rls_enabled_no_policy). Supabase menyarankan policy penolakan eksplisit bila semua akses client memang sengaja ditolak; policy akses hanya dibuat bila ada kebutuhan client yang sah.

[^lint-0029]: [Remediation resmi lint 0029 — authenticated SECURITY DEFINER function executable](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable). Evaluasi setiap fungsi: cabut hak execute yang tidak diperlukan, gunakan `SECURITY INVOKER` bila sesuai, atau pertahankan RPC yang disengaja dengan validasi dan pembatasan yang benar.
