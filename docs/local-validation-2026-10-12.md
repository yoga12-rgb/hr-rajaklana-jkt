# Hasil uji operasional lokal — 12 Oktober 2026

Pengujian memakai data contoh pada `http://localhost:4173`, terpisah dari data demo di `http://127.0.0.1:4173`. Tidak ada proyek Supabase hosted yang dihubungkan atau data perusahaan yang digunakan.

## Perbaikan dari hasil audit

- Koreksi absensi menolak waktu yang bertabrakan dengan sesi lain, termasuk sesi lintas tengah malam dan sesi yang masih terbuka. Penolakan tidak mengubah catatan maupun audit. Sesi yang berakhir tepat ketika sesi berikutnya dimulai tetap diperbolehkan; interval nol menit mengikuti perilaku PostgreSQL.
- Absensi baru menyimpan pengaturan awal outlet: jam shift, toleransi, koordinat, dan radius. Koreksi serta validasi clock out menggunakan pengaturan sesi tersebut. Perubahan outlet tidak menghitung ulang catatan lama. Catatan demo lama tanpa pengaturan tersimpan masih memakai outlet sebagai fallback; pengaturan historis yang hilang tidak dapat direkonstruksi.
- Menonaktifkan karyawan mencabut seluruh tautan aktivasi dan pemulihan miliknya. Mengaktifkan kembali karyawan tidak membuat tautan lama berlaku; HR perlu menerbitkan tautan baru. Tautan karyawan lain tetap berlaku.
- Detail cuti yang dibatalkan atau ditolak menampilkan **Tidak ada potongan aktif**, sehingga tidak lagi terlihat seolah menunggu penentuan potongan.

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit test | 82 pengujian pada 8 berkas lulus, termasuk 37 absensi dan 10 pendaftaran/pemulihan akun |
| Pemeriksaan Svelte/TypeScript | 0 error, 0 warning |
| Build SPA/PWA | Berhasil |
| Migrasi dan database lokal | 5 migrasi dan 14 kelompok pemeriksaan lulus memakai PGlite in-memory |
| Console browser pada alur yang diuji | Tidak ada warning/error |

Uji browser menjalankan aplikasi sebenarnya melalui UI, menggunakan akun contoh Nadia dan Alya:

- **Cuti:** pengajuan → perlu dilengkapi → kirim ulang → persetujuan 1 hari → perubahan tanggal dengan potongan 0,5 hari → pembatalan disetujui. Saldo awal 11 hari tetap saat menunggu, menjadi 10 setelah persetujuan, 10,5 setelah perubahan disetujui, lalu kembali 11 setelah pembatalan. Tanggal/potongan lama tetap selama perubahan menunggu. Karyawan tidak mendapat tombol untuk memutuskan pengajuannya sendiri.
- **Izin pribadi:** keluar sementara 10.00–12.00, pulang lebih awal 13.00, dan datang terlambat 07.30 pada tanggal terpisah berhasil dicatat serta disetujui tanpa potongan. Jam kembali sebelum jam keluar ditolak. Saldo tetap 11 hari.
- **Absensi manual:** sesi Middle 10 Oktober 23.00–11 Oktober 06.00 dan sesi Pagi 11 Oktober 07.10–15.10 tercatat sebagai **Manual HR**, tanpa verifikasi GPS/selfie. Keterlambatan Pagi 10 menit dan durasi 8 jam tampil benar.
- **Koreksi lintas tengah malam:** memperpanjang sesi Middle sampai 08.00 ditolak karena bertabrakan dengan sesi Pagi. Catatan tetap berakhir 06.00. Koreksi sampai tepat 07.10 diterima, dengan durasi 8 jam 10 menit.
- **Riwayat pengaturan:** catatan Pagi 9 Oktober 07.10 tetap menunjukkan terlambat 10 menit setelah jam Pagi outlet diubah sementara menjadi 08.00 dan jam pulang dikoreksi. Pengaturan outlet contoh dikembalikan menjadi 07.00 setelah uji.

Bukti tampilan: [penolakan koreksi](screenshots/attendance-overlap-local-2026-10-12.jpg) dan [hasil pembatalan cuti](screenshots/leave-cancel-local-2026-10-12.jpg).

## Yang masih perlu diuji setelah Supabase tersedia

PGlite meniru plumbing Auth/Storage Supabase; hasil ini belum membuktikan layanan hosted, realtime antarperangkat, atau permintaan serentak. Uji pendaftaran dan pemulihan akun di sini menggunakan unit test, bukan pembuatan kata sandi lewat browser.

Kamera/GPS ponsel nyata, unggahan selfie privat, pemasangan/pembaruan PWA pada perangkat outlet, serta sinkronisasi dua perangkat melalui HTTPS masih perlu diuji sebelum penggunaan operasional. Tidak ada backend hosted atau deployment produksi yang dibuat pada tahap ini.
