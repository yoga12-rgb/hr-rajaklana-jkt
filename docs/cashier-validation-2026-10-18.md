# Validasi rilis kasir — 18 Oktober 2026

**Production dan Preview READY** untuk kode `0a79085d0ee5d1d5c4e6c735a37590cbc895363b`. Sebelas migrasi yang sama telah diterapkan pada kedua database melalui profil CLI dan direktori kerja yang terpisah. Bukti berikut mencatat hasil rilis ini; pengujian perangkat nyata tetap memiliki batas tersendiri.

## Rilis dan pemeriksaan lokal

| Lingkungan | Deployment dari Git | CI |
| --- | --- | --- |
| Preview — `codex/preview` | [READY](https://hr-rajaklana-2ycm1j445-hr-rajaklana.vercel.app), `dpl_7gwV7V6RQkkMid8BHX4j3CsTC1MU` | [39139972799 — success](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39139972799) |
| Production — `main` | [READY](https://hr-rajaklana-4m0nnx9rk-hr-rajaklana.vercel.app), `dpl_8fQ6QMoZK6g79ERcB3vdt7L3bHcH` | [39140732223 — success](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39140732223) |

Pemeriksaan lokal lulus: **285 unit test**, check **0 error/0 warning**, build, suite SQL inti dan identitas/push dengan 11 migrasi aktual, serta seluruh fixture migrasi legacy. Pengujian mencakup pembatasan aktor, kepemilikan, transaksi, biometrik/receipt, dan antrean push; pengujian lokal tidak mengirim notifikasi perangkat.

## Bukti hosted

| Pemeriksaan | Hasil |
| --- | --- |
| Preview: alur transaksi/RLS | Delapan kelompok assertion rollback lulus: penugasan harian/lampau dan outlet sementara; akses kasir/manajer dan absensi legacy; kepemilikan/pembatalan koreksi; persetujuan HR dengan absensi manual/audit; snapshot usang/persetujuan berulang; izin lampau/koreksi jam/refund idempoten; tautan dan mark-read penerima; penghitung bisnis/rollback. Sisa data sintetis: **0**. |
| Preview: API biometrik yang terdeploy | Sesi sintetis mendapat status **200**. Enrollment JPEG abu-abu 640×640 mendapat **400 `face_count`**, membuktikan decoding, model dan WASM aktual berjalan. Tidak ada wajah nyata, enrollment berhasil, atau upload gambar. Auth, karyawan, dan sesi sintetis dibersihkan. |
| Kedua worker push | Tanpa autentikasi **401**; wake yang sah **200**, `claimed=0`, `completed=0`. Ini menguji akses dan antrean kosong, bukan pengiriman ke perangkat. |
| Scheduler kedua lingkungan | `pg_net` dan `pg_cron` terpasang; `hr-push-minute` aktif dan eksekusi terbaru berhasil. |
| Catalog kedua database | RLS tabel aplikasi aktif, bucket privat, clock in legacy dicabut, clock in terverifikasi tersedia, dan grant langsung tabel privat ditolak. |
| Data API kedua lingkungan | Akses anonim ke tabel baru/RPC privat ditolak **401**. `Accept-Profile: net` ditolak **400 `PGRST106`** karena schema tidak diekspos. |
| HTTP Production | Domain utama, login, manifest, dan service worker **200**; service worker memakai `no-store`. API biometrik dan push tanpa sesi mengembalikan JSON **401 `unauthorized`**. |
| Browser Production | Form login pada domain utama tampil lengkap. Tombol pembaruan PWA **Gunakan versi terbaru** memuat login versi baru dan menghilangkan prompt. Tidak ada kredensial yang dimasukkan. |
| Konfigurasi server | Secret runtime disimpan privat/terenkripsi. Kunci VAPID dan wake secret Production/Preview terpisah. Berkas provisioning lokal berisi JSON privat, kunci mentah, dan environment Edge sementara telah dihapus; secret hosted dipertahankan. |

Fixture rollback memakai identitas sintetis dan nomor karyawan eksplisit; sequence nomor karyawan/kode outlet tidak dialokasikan. Celah sequence teknis audit/ledger/pg_net serta log audit Auth/pembatasan percobaan sintetis dapat tetap ada. Tidak ada pengujian atau mutasi data HR asli di Production.

Advisors kedua proyek tidak melaporkan **ERROR**. Peringatan [RPC `SECURITY DEFINER`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) yang disengaja dan informasi [RLS tanpa policy klien](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) tetap dicatat sesuai pembatasan akses. Metadata ekstensi `pg_net` berada di `public`, tanpa fungsi ekstensi pada schema tersebut; ekstensi tidak dapat direlokasi dan grant transport platform tetap berlaku. Batas serta penanganannya dijelaskan pada [operasional biometrik/push](biometric-push-operations.md). Peringatan [MFA](https://supabase.com/docs/guides/auth/auth-mfa) dan [perlindungan password bocor](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) yang sudah ada belum berubah.

## Bukti browser demo

- Penugasan outlet sementara → permintaan koreksi kasir → notifikasi HR → persetujuan HR → catatan kerja **8 jam**: **PASS**.
- Pencatatan izin pribadi pulang awal lampau dan koreksi jam oleh HR **14:00 → 14:30**: **PASS**.
- Tampilan ponsel **430 px** dan desktop **1280 px**: tidak ada overflow horizontal pada alur yang diperiksa.

Alur tersebut dijalankan pada demo browser; hasilnya tidak membuktikan kamera/GPS atau layanan push pada ponsel outlet.

## Batas yang belum diuji pada perangkat nyata

Kamera/GPS fisik, enrollment wajah dengan persetujuan dan peninjauan HR lain, kecocokan wajah 1:1, serta penerimaan push ketika aplikasi ditutup belum dibuktikan pada perangkat nyata. Inferensi gambar abu-abu tidak menguji kecocokan wajah atau liveness. Sistem tidak menjamin anti foto dan tetap menyediakan jalur pencatatan/koreksi manual HR.

Worker dan scheduler yang aktif belum membuktikan pengiriman end-to-end ke perangkat. Uji opt-in/penolakan izin, dukungan platform, logout/unsubscribe, GPS kedaluwarsa, dan pengingat delapan jam pada perangkat outlet melalui [panduan uji operasional](operational-pilot.md) sebelum pemakaian operasional.
