# Rilis penghapusan verifikasi wajah — 3 November2026

Pengguna meminta menghapus fitur verifikasi wajah, lalu mengizinkan push dan deployment. Rilis terpisah ini hanya membawa penghapusan pendaftaran/tinjauan/pencocokan wajah, endpoint dan receipt selfie pengganti, penyesuaian panduan, serta tes yang relevan. Fitur konflik cuti dan migration27–31 pada worktree pengembangan tidak disertakan.

Absensi tetap membutuhkan penugasan resmi, akun/sesi aktif dengan can_clock, GPS yang memenuhi radius/akurasi dan masih baru, serta selfie kamera langsung. Foto tetap memiliki cap waktu/lokasi. Server memeriksa JPEG dan hash byte, bukan identitas wajah. HR/SPV memeriksa foto melalui detail kehadiran. URL lama `/face-verification` mengarah ke Absensi; API lama menjawab410 tanpa efek samping.

## Kontrak database

Identitas sebelum rilis: Preview `lypsqrwjzrmuyqtdcegr` dan Production `iywvnopsooroediwawnd`, organisasi Rajaklana. Keduanya memiliki26migration. Production memakai versi canonical; Preview mempunyai delapan alias versi historis19–26. Probe26 asli mengizinkan hanya dua daftar pasangan yang telah ditinjau tersebut. Seluruh22body fungsi terkait dan struktur lima tabel cocok dengan baseline lokal26. Tidak ada history yang diperbaiki atau migration applied yang diedit.

File baru `20261103021143_remove_face_verification.sql` menjadi **migration ke27 pada rilis terpisah ini**, walaupun pada fixture pengembangan lengkap ia diuji sebagai migration32. Namanya tetap sama. SQL mencabut akses fitur wajah dan kedua overload clock-in lama, membuat receipt selfie privat, dan mempertahankan perlindungan Storage. Preview memiliki lima grant service_role historis tambahan; fixture mereproduksi dan menutupnya melalui SQL yang sama. Tidak ada referensi, descriptor, foto, audit, absensi, atau data operasional lama yang dihapus.

Jalankan `node supabase/deployment/verify-face-retirement-release.mjs --print` untuk menghasilkan **satu transaksi read-only** dengan semua kontrak26 yang dipertahankan, inventory tepat27, dua peta version/name yang ditinjau, dan kontrak baru selfie/Storage/ACL. Ini tidak mengubah catalog/history. Probe final32 pada worktree pengembangan adalah fixture alternatif31→32 dan bukan gate untuk rilis ini.

Receipt baru mengikat employee, objectID/path/hash, GPS, metadata pengambilan, penugasan/outlet dan shift. Receipt berlaku90detik, sekali pakai, serta dikonsumsi atomik bersama clock-in. Perubahan akun/sesi/hak, metadata, foto atau penugasan ditolak. Jam/foto harus tetap baru ketika dicatat. Data biometrik historis dipertahankan privat tanpa fitur untuk mengaksesnya; retensi/penghapusan historis bukan bagian rilis.

## Verifikasi dan batas bukti

`npm run test:database` mencakup upgrade populated26→27, snapshot bukti historis, kasir tanpa referensi, sesi dicabut, GPS, receipt, Storage dan19mutasi negatif/restored positives. Harness biometrik/auth lama dibatasi tepat26 agar hasil historis dibedakan dari final27. Suite browser SDK memakai kamera/GPS sintetis dan endpoint loopback; PWA memakai build/serviceworker nyata pada desktop. Tes ini bukan bukti perangkat iPhone/iPad atau layanan managed hosted.

Gate rilis juga mencakup typecheck, unit, SQL/RLS, guarded legacy, dependency audit, build, seluruh SDK live-mock dan PWA tanpa skipped/flaky/unexpected. CI hosted, deployment, probe hosted/datahash dan workflow pengguna harus dicatat terpisah; READY saja tidak membuktikan alur kasir lulus. PVR-02/perangkat nyata tetap DEFERRED.

## Operasi rilis dan pengembangan berikutnya

Database, API dan UI harus dirilis bersama. Klien lama yang memakai verifikasi wajah akan ditolak setelah migrasi; muat versi baru sesudah menyelesaikan formulir yang masih terbuka. Rollback frontend ke versi wajib-wajah saja tidak kompatibel; gunakan perbaikan forward yang mempertahankan kontrak tanpa wajah.

Sebelum tindakan hosted, verifikasi kembali identitas, exact history/catalog, hash SQL, dan gate lokal. Mirror filename alias Preview hanya dipakai di direktori staging operator dengan byte SQL baseline yang sama; jangan rename/repair migration hosted. Dry-run harus menunjukkan hanya file removal yang dimaksud.

Migration konflik cuti bertanggal1–2November yang masih lokal kini mendahului version removal yang sudah dirilis. Rilis konflik cuti berikutnya wajib merencanakan upgrade dari baseline27 aktual, menguji dependency/urutan dan transaksi gabungan yang aman, serta memperbarui probe secara forward. Jangan menjalankan db push/include-all secara buta, merilis intermediate27 konflik yang berisiko, mengubah file applied removal, menghapus data, atau memperbaiki history agar tes lulus.

Snapshot integritas hosted cukup berisi count/hash rowset yang dihitung server-side; tidak perlu mengunduh foto atau data pribadi untuk rilis tanpa penghapusan ini. Secret cukup dipakai oleh sesi CLI/provider resmi dan tidak dimasukkan ke Git, command argument, log atau artifacts. Perubahan konfigurasi MFA/worker/paket hosting berada di luar rilis ini.
