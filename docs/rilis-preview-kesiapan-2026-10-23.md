# Rilis Preview perbaikan kesiapan — 23 Oktober 2026

## Cakupan

Menindaklanjuti [audit 22 Oktober](audit-kesiapan-aplikasi-2026-10-22.md), APP-01–APP-08 diperbaiki pada branch `codex/preview`. Production dan branch `main` di luar cakupan. Tidak ada reset/penghapusan audit atau data operasional untuk meluluskan tes.

- Source APP-01–APP-08: `9377c7e6e8ccab7551331e6b1486926b85090c96`.
- Source final beserta PVR-01: `359d5f91dc8f5cd73e6f9fb9e9b0e5f57ad9ca4f`.
- Repo: `yoga12-rgb/hr-rajaklana-jkt`.
- Supabase: `hr-rajaklana-preview`, `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, region `ap-southeast-2`.
- Vercel: `hr-rajaklana-jkt`, project `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`, tim `team_S1Sn08iaksD0GQF4kk49kTkH`.
- URL Preview: https://hr-rajaklana-jkt-preview.vercel.app.

## Perbaikan final

1. APP-01: stale-tab write/delete diblokir; sinkronisasi storage menjaga pending replay. Settlement membandingkan snapshot yang digunakan menghitung hasil, dan planner hanya mengakui snapshot yang benar-benar ditulis/diterapkan. Key/body replay tetap asli.
2. APP-02: hanya penolakan domain benturan cuti penuh yang pasti non-commit melepas pending. Respons ambigu tetap memakai attempt awal; draft yang sudah direview dapat menjadi transaksi baru.
3. APP-03: nilai draft catatan/owner yang telah tersimpan dibersihkan supaya tidak menimpa Realtime terbaru. Edit selama request dan draft penyelesaian yang belum disimpan server tetap ada.
4. APP-04/05/06: identitas karyawan berakun dipertahankan ketika reaktivasi; inspect/claim abandoned token selaras; data/status/peran disimpan atomik melalui RPC baru dengan audit dan otorisasi. Mode demo mengikuti reaktivasi tanpa membuka akun yang belum aktivasi.
5. APP-07/08: callback GPS usang diabaikan termasuk setelah unmount; stream kamera referensi memakai opening/revision guard dan seluruh stream usang dihentikan.

Compare-then-write `localStorage` mengatasi interleaving yang diuji, tetapi API tersebut tidak menyediakan CAS lintas renderer. Batas ini tetap dicatat; tidak ada klaim atomicity seluruh kemungkinan race browser.

## Bukti lokal

| Pemeriksaan | Hasil |
| --- | --- |
| Svelte/TypeScript | 0 error, 0 warning |
| Unit final | 29 file, 418/418 lulus |
| Database PGlite | 18 migration, RPC/RLS/audit/biometric/push lulus |
| Upgrade | Preview sintetis 17→18; historis 13→18 dengan preflight terbatas dua kali, lulus |
| Guard legacy | Refusal/rollback lulus pada fixture in-memory |
| Build SPA/PWA | Lulus, mode demo lokal |
| Demo browser/PWA | 22/22 lulus tanpa skipped, `E2E_PWA=1` |
| Live-mock final | 11/11 lulus tanpa skipped; cold route/query, persist/reload/retry dan original replay |
| Harness probe Preview | Dua eksekusi rollback identik dan fail-closed tanpa fixture aman lulus |

Playwright memakai Microsoft Edge desktop/emulasi ponsel. Hasil ini tidak menggantikan iPhone/iPad nyata.

## Supabase Preview

Identitas project diperiksa sebelum tindakan remote. Baseline aktual 17 migration; dry-run hanya menawarkan `20261022170000_close_readiness_audit_findings.sql`. CLI resmi menerapkan tepat migration itu dengan version yang sama. Migration lama tidak diedit. Preflight historis 13-migration tidak dijalankan pada Preview 17-migration.

Sesudah penerapan: history 18 migration, RPC `hr_save_employee_with_roles` tersedia dan memiliki `require_hr`, search_path kosong, EXECUTE authenticated dengan anon ditolak. `inspect_account_token` tetap khusus service role; seluruh tabel public tetap RLS.

[Probe hosted](../supabase/deployment/verify-readiness-preview.sql) menjalankan RPC sebagai authenticated untuk disable/perubahan peran/reaktivasi pada fixture existing yang aman, lalu exception sentinel mewajibkan rollback. Probe **PASS**, termasuk pengembalian state dan konteks JWT/role. Ini menggunakan database-admin probe, bukan login browser atau Supabase Auth password flow.

Jumlah sebelum migration dan sesudah probe tetap **3 karyawan, 4 peran, 4 assignment, 25 audit events**. Tidak ada akun active/disabled/Auth-linked yang membutuhkan backfill. Token operasional tidak diterbitkan/diubah/dikonsumsi oleh probe.

Advisor: RPC SECURITY DEFINER authenticated bertambah 33→34 karena API HR baru yang memang dijaga otorisasi. Warning pg_net, password bocor, dan pilihan MFA tetap sama dengan baseline; tidak dilakukan pencabutan API massal. Rujukan warning RPC: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.

## GitHub dan Vercel

Push source commit ke `codex/preview` berhasil. Production branch Vercel diverifikasi `main`; target push ini Preview. Konektor Vercel mengembalikan 404, sehingga identitas project dan status deployment dibaca melalui CLI resmi dengan tim/project eksplisit.

- CI source: https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39890441969 — **success**.
- Deployment source `9377c7e`: `dpl_8i6Lm3FjgWzTWojnBDAFggG5cQjp`, URL `hr-rajaklana-50xme9tn0-hr-rajaklana.vercel.app`, **READY**, target Preview. Build sekitar 50,6 detik. Alias Preview diverifikasi menunjuk deployment ini.
- Shell/bundle hosted [verify-preview-shell.mjs](../scripts/verify-preview-shell.mjs) **lulus** melalui OIDC development sementara: login HTTP 200, label Preview, tanpa demo, 37 bundle JS, satu ref Supabase Preview yang benar, RPC atomik tersedia dalam bundle, 0 page errors. Tes tanpa autentikasi proteksi awal gagal mencapai form login; tidak dihitung lulus. Proteksi tidak diubah; token hanya dalam memori, tepat origin, redirect ditolak.
- Deployment final aplikasi `359d5f9`: `dpl_FVs1rUMuLacxT2LVewgdtakbSscv`, URL `hr-rajaklana-68l9rhbze-hr-rajaklana.vercel.app`, **READY**, target Preview; build sekitar 50,9 detik. Alias diverifikasi menunjuk deployment ini. [CI final source](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39892384119) **success**. Shell OIDC dijalankan ulang dan lulus pada rilis ini dengan hasil 37 bundle/0 page errors yang sama. Worker diblokir pada smoke shell; ini tidak menguji instalasi PWA.

## Workflow browser hosted dan temuan lanjutan

Sesi Admin HR tersedia di browser. Dashboard terhubung dengan data 3 karyawan/2 outlet. Edit alamat sementara pada akun uji `RK000003` berhasil melalui UI, tetap ada setelah reload dan membuka kembali profil, lalu dikembalikan kosong melalui UI. Verifikasi database: alamat pulih, akun tetap aktif, peran tetap employee. Dua audit perubahan tetap disimpan sehingga audit bertambah 25→27; tidak dihapus untuk mengembalikan angka awal.

**PVR-01 — reload route:** saat reload `/employees`, aplikasi sempat menandai sesi tersimpan sebagai unauthenticated ketika data karyawan masih dimuat. Layout mengalihkan ke `/login`, lalu halaman login ke `/dashboard` setelah sesi pulih. Data tidak hilang, tetapi path/query tujuan hilang. Ini ditemukan melalui pengujian hosted, meskipun suite sebelumnya lulus.

Perbaikan membedakan validasi sesi yang diketahui dari signed-out yang sudah pasti: data akun lama langsung dikosongkan, tetapi `initialized:false/loading:true` menahan redirect sampai validasi selesai. Logout, akun nonaktif, dan isolasi akun tetap diuji. Unit final **418/418** dan check/build lulus; regresi browser menguji cold path/query dan reload dengan pembacaan employee tertunda. Helper tes lama yang menavigasikan ulang setelah route hilang diganti menjadi assertion bahwa path dan minggu asli tetap terjaga.

PVR-01 **ditutup pada hosted**: akses langsung `/employees?probe=readiness-20261023` lalu hard reload mempertahankan path/query dan menampilkan Data karyawan dengan akun yang sama. Tidak terjadi pengalihan ke Dashboard.

Roster hosted minggu 2–8 November juga diuji dengan akun uji RK000003:

1. Dua tab akun Admin HR yang sama awalnya belum mempunyai jadwal/draft. Tab B mengisi Libur tanggal 2 November dan alasan uji; tab A menerima shift/alasan melalui storage event.
2. Tab A pindah ke minggu berikutnya lalu kembali; draft tetap utuh.
3. Simpan batch melalui UI berhasil, database mencatat assignment aktif `off`, dan reload tetap pada minggu yang sama dengan nilai Libur serta draft kosong. Tab B mengikuti hasil tersimpan dan draftnya juga kosong.
4. Penugasan sintetis dibatalkan lewat batch UI dengan alasan jelas. Database mencatat `cancelled`, active assignment pada sel uji nol; kedua tab kembali Belum ditugaskan dengan draft kosong. Satu record cancelled dan audit dipertahankan, bukan dihapus.

Jumlah akhir: **3 karyawan, 4 peran, 5 assignment (termasuk satu cancelled uji), 29 audit events**. Empat assignment awal dipertahankan; alamat akun uji tetap kosong dan hak akses tidak berubah. Tidak dilakukan pemaksaan network failure/replay pada hosted; skenario tersebut tetap dibuktikan lewat live-mock.

**PVR-02 — PWA hosted masih terbuka:** console browser IAB mencatat SecurityError bahwa `/service-worker.js` berada di balik redirect sehingga pendaftaran service worker ditolak. Tujuh catatan pada tab utama dan satu pada tab kedua semuanya pesan yang sama; tidak ditemukan pesan error aplikasi lain dari daftar tersebut. Halaman dan transaksi authenticated berjalan, tetapi shell smoke dengan worker diblokir tidak menutup kondisi PWA ini. Deployment Protection tidak dinonaktifkan. Uji iPhone/PWA belum dilakukan dan tidak diklaim lulus.

Diagnosis: [algoritme pembaruan service worker](https://w3c.github.io/ServiceWorker/#update-algorithm) menolak redirect pada script utama. Menurut [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication), login resmi dapat memberi cookie akses untuk URL deployment yang dibuka. Akses navigasi otomatis di IAB tidak membuktikan request internal worker menerima autentikasi sama; penyebab spesifik perbedaan IAB tersebut masih inferensi. [Playwright](https://playwright.dev/docs/service-workers#known-limitations) juga membatasi routing request pembaruan script worker. Tidak ada dasar untuk menganggap header OIDC smoke menghasilkan cookie browser; tidak dibuat bypass baru atau diambil cookie/secrets.

Langkah penutupan PVR-02: buka alias Preview yang persis sama di browser biasa, selesaikan autentikasi Vercel resmi di browser tersebut, lalu periksa `/service-worker.js` tanpa header tambahan dengan kredensial same-origin dan redirect ditolak. Respons harus HTTP 200 dengan MIME JavaScript; sesudah itu buktikan registrasi, aktivasi, reload serta controller. Jangan menyalin cookie/token. Browser biasa tidak tersedia melalui kontrol browser sesi ini (hanya IAB/MCP Apps), sehingga autentikasi pada browser pengguna menjadi prasyarat uji berikutnya. Bahkan registrasi berhasil belum membuktikan update lintas versi atau iPhone/PWA.

## Verifikasi yang masih memerlukan interaksi

1. PVR-01, UI → API → data → reload karyawan, dan dua tab roster pada identitas yang sama sudah lulus sesuai batas bukti di atas. Dua identitas SPV berbeda belum tersedia untuk menguji seluruh skenario catatan. Tidak ada kata sandi/token diminta di chat.
2. Alur pemulihan/reset melalui halaman harus diselesaikan pengguna saat memasukkan dan mengubah kata sandi; probe SQL tidak menggantikan alur tersebut.
3. Selesaikan PVR-02 dengan autentikasi proteksi yang sesuai sebelum mengklaim PWA Preview tersedia; kemudian uji iPhone/iPad nyata untuk kamera double-tap/tutup/buka, GPS, notifikasi, background/resume, dan update lintas versi.

Deployment `READY`, shell HTTP 200, atau tes skipped tidak diperlakukan sebagai bukti workflow authenticated lulus.
