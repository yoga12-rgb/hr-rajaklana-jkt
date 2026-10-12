# Cap foto absensi

Selfie baru dari kamera mencantumkan nama outlet, koordinat GPS enam desimal, akurasi GPS, serta tanggal dan waktu pengambilan dalam WIB hingga detik. Cap digambar pada footer JPEG; seluruh frame kamera tetap terlihat. Nama outlet berasal dari data aplikasi dan tidak hardcode.

Lokasi, nama outlet, dan waktu dikunci ketika tombol **Ambil selfie** ditekan. Pemeriksaan ulang lokasi atau pergantian outlet membuang selfie sebelumnya agar foto dan data clock in cocok. Hasil kamera/GPS atau encoding yang selesai setelah dialog ditutup tidak digunakan kembali.

`selfieCapturedAt` adalah waktu pengambilan menurut perangkat, terpisah dari `clockIn`. Pada mode live, `clock_in` tetap berasal dari database; metadata foto tidak mengubah perhitungan keterlambatan. Metadata waktu/nama outlet bertahan saat HR mengoreksi jam absensi. Catatan lama dan absensi manual boleh tidak memiliki metadata foto; tidak dibuat cap historis dengan waktu yang diasumsikan.

Pratinjau dan detail foto menampilkan gambar penuh. Di detail kehadiran tersedia **Lihat foto penuh**, waktu foto, outlet pada foto, serta GPS masuk. Foto live tetap disimpan pada bucket privat dengan URL sementara sesuai akses pengguna.

## Verifikasi lokal

Verifikasi pada 12 Oktober 2026: 112 unit test lulus; `npm run check` menghasilkan 0 error dan 0 warning; build produksi berhasil. Navigasi panduan/kehadiran dan detail absensi manual lama berjalan pada build terbaru tanpa error konsol. Pembaruan PWA berhasil diterapkan pada tab pengujian. Server aplikasi lokal diperbarui pada port 4173.

- Unit test mencakup pergantian tanggal UTC ke WIB, pukul 00.00, koordinat nol/negatif/tidak valid, nama panjang, frame portrait/landscape, footer di luar frame, dan kegagalan encoding JPEG.
- Uji absensi memeriksa metadata terpisah dari clock in, persistensi demo, pelestarian saat koreksi, validasi pasangan metadata, serta pemanggilan RPC baru dan kompatibilitas lama.
- Migrasi `202610120006_attendance_selfie_metadata.sql` menambah kolom nullable serta overload RPC 7 argumen. RPC 5 argumen dan catatan lama tetap kompatibel. Harness Postgres in-memory memeriksa metadata, validasi, ACL, dan koreksi.
- Contoh browser menggunakan fungsi `renderStampedSelfie` aplikasi yang sama, lalu encoding JPEG dengan kualitas yang sama. Kedua gambar merupakan **CONTOH UJI — BUKAN SELFIE KARYAWAN**. Tidak memakai kamera/GPS perangkat dan tidak membuat absensi. Landscape menghasilkan JPEG sekitar 29 KB; portrait sekitar 27 KB. Nama panjang dan tanggal WIB setelah tengah malam tampil lengkap.

Untuk mengulangi pemeriksaan visual:

```powershell
node node_modules/vite/bin/vite.js --config docs/selfie-watermark-preview.vite.config.ts
```

Buka `http://127.0.0.1:4174/selfie-watermark-preview.html`. Server ini hanya untuk contoh lokal dan terpisah dari aplikasi pada port 4173.

Bukti: [contoh cap](screenshots/selfie-stamp-example.jpg) dan [landscape/portrait lengkap](screenshots/selfie-stamp-validation.jpg). Kedua contoh tidak melebar ke samping pada viewport ponsel 390 piksel.

Kamera/GPS ponsel nyata serta unggahan, akses foto privat, dan RPC pada Supabase hosted masih membutuhkan uji perangkat/deployment ketika proyek Supabase tersedia. Verifikasi renderer JPEG tidak membuktikan pengambilan foto dari kamera fisik.
