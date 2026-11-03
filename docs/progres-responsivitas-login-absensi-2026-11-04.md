# Responsivitas login dan absensi — 4 November 2026

## Ruang lingkup

Memperpendek waktu tunggu setelah login dan setelah transaksi absensi berhasil, di atas baseline rilis `2accb633b030068ec30ca2f971844a75a0a9f20b`. Pengerjaan berada di checkout rilis terpisah, branch `codex/responsive-actions-20261104`, agar perubahan lain yang belum dirilis di checkout utama tidak ikut terpublikasi.

Tidak ada perubahan database, migration, RPC, RLS, kebijakan lokasi, kewajiban selfie, atau konfigurasi kredensial. API Vercel tetap di Sydney (`syd1`). Supabase Preview `lypsqrwjzrmuyqtdcegr` dan Production `iywvnopsooroediwawnd` diverifikasi dengan konektor: nama/organisasi sesuai, `ACTIVE_HEALTHY`, `ap-southeast-2`.

## Checkpoint implementasi

1. **Baseline:** login, clock in, dan clock out sebelumnya menunggu `refresh()` seluruh ruang kerja. Refresh mencakup semua tabel dasar, audit, saldo, dan URL privat untuk foto/lampiran; event Auth/Realtime dapat meminta putaran tambahan.
2. **Absensi:** tampilkan hanya baris hasil RPC yang benar-benar sudah berhasil. Ikat hasil ke akun, revision sesi, outlet, ID catatan untuk clock out, dan status masuk/pulang. Tidak ada keberhasilan optimistis sebelum respons server. Sinkronisasi data lain berjalan di belakang layar. Counter penulisan mencegah snapshot refresh yang dimulai sebelum commit menimpa hasil transaksi.
3. **Login:** validasi konteks sesi langsung, karyawan aktif, role, dan organisasi sebelum menampilkan shell akun. Data operasional tetap memiliki status loading yang eksplisit; halaman fitur dan tindakan tidak dibuka dengan tabel kosong sementara. Pemuatan tambahan diparalelkan ketika tidak saling bergantung. Rotasi token akun yang sama mempertahankan halaman yang sudah dimuat.
4. **Regresi:** uji respons server tertunda, pembacaan global tertunda, snapshot lama, penolakan RPC, respons salah akun/outlet/catatan, logout/pergantian akun, revokasi akses, kamera/GPS, reload, dan recovery lama. Jika koreksi SPV yang lebih baru sudah terbaca ketika receipt RPC lama tiba, lakukan SELECT satu catatan di bawah RLS dan periksa ulang scope sesudah await. Fencing diterapkan lagi saat publikasi untuk menolak refresh yang dimulai selama SELECT tersebut.

## Batas klaim performa

Pemisahan ini mengurangi pekerjaan yang harus ditunggu tombol login/absensi. Seluruh data ruang kerja masih harus selesai dimuat sebelum fitur operasional pertama tersedia. Ini belum merupakan pagination seluruh modul atau pemuatan foto berdasarkan halaman. Tidak ada klaim pengurangan latensi RPC, p95, atau waktu perangkat nyata tanpa pengukuran pengguna.

## Bukti dan status

- Implementasi lokal: **PASS**.
- `check`: 0 error, 0 warning; unit: **496/496**, 39 file. Termasuk 7 regresi bootstrap login dan 15 regresi receipt/race absensi.
- Suite database sintetis, legacy/preflight fixtures, historical-readiness, operator subprocess, browser report checker dan evidence helper: **PASS**. Tidak ada tindakan cleanup atau reset hosted.
- Audit dependensi pada ambang moderate: **PASS**, 0 moderate/high/critical; 4 temuan low tetap ada pada baseline dependensi.
- Build SPA/PWA: **PASS**.
- Browser live-mock eksplisit: **32/32**, 0 skipped/flaky/unexpected; termasuk kamera/GPS, commit tertunda, background read tertunda, penolakan RPC, login bertahap, rotasi sesi, Realtime dan persist/reload/retry.
- Browser demo-PWA eksplisit: **24/24**, 0 skipped/flaky/unexpected. Offline shell di browser sintetis desktop tidak menutup PVR-02 perangkat nyata.
- Fingerprint sumber sama sebelum/sesudah semua gate; ringkasan dan hash bukti: `docs/evidence/responsivitas-login-absensi-2026-11-04.json`.
- Deployment Preview: **PENDING**.
- Deployment Production: **PENDING**.
- Workflow hosted dengan akun nyata: **NOT RUN**; smoke anonim tidak dianggap sebagai bukti transaksi kasir.
- iPhone/PWA perangkat nyata dan PVR-02: **DEFERRED** sesuai keputusan sebelumnya.

Status deployment di atas adalah checkpoint sebelum publikasi commit ini. Hasil operator setelah rilis dicatat pada dokumen progres bernama sama di checkout utama; status READY tidak menggantikan pengujian workflow.
