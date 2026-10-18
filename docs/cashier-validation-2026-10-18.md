# Catatan validasi perubahan kasir — 18 Oktober 2026

Status dokumen: pemeriksaan lokal integrasi lulus; verifikasi hosted dan perangkat belum seluruhnya selesai. Kode yang tersedia dibedakan dari perilaku yang sudah diuji. Snapshot hosted dan jumlah tes versi lama tidak membuktikan seluruh perubahan terbaru.

## Bukti lokal yang sudah tersedia

| Area | Bukti | Batas bukti |
| --- | --- | --- |
| GPS dan status/durasi absensi | 15 pengujian fokus `attendance-geo.test.ts` dan `attendance-status.test.ts` lulus pada tahap implementasi UI | Fungsi murni; bukan GPS/kamera perangkat atau RPC hosted |
| Suite lokal, tipe, dan build | Penanggung jawab integrasi mengonfirmasi 285 test, check 0 error/0 warning, build, dan database 11 migrasi lulus | Bukti lokal; bukan kelulusan seluruh layanan/perangkat hosted |
| Penugasan, koreksi absensi, izin lampau, dan koreksi jam izin | Fixture rollback lokal menerapkan seluruh 11 migrasi aktual dan lulus 8 kelompok pemeriksaan alur/hak aktor | PGlite lokal; eksekusi Preview dan interaksi browser belum dibuktikan oleh fixture ini |
| API wajah dan push | 38 pengujian handler aktual `api-handlers.test.ts` lulus dengan autentikasi, ekstraksi wajah, dan klien RPC tiruan | Memeriksa validasi, pembatasan identitas, kegagalan, dan kontrak RPC; bukan inferensi wajah, Supabase hosted, atau pengiriman push nyata |
| Browser alur penugasan dan koreksi | Penanggung jawab integrasi mengonfirmasi penugasan outlet sementara → permintaan kasir → notifikasi HR → persetujuan HR lulus | Tidak mencakup clock in biometrik dengan kamera/GPS perangkat fisik |
| Browser izin lampau dan koreksi jam | Penanggung jawab integrasi mengonfirmasi pencatatan izin pribadi pulang awal dan perubahan jam HR 14:00 → 14:30 lulus | Bukan pengujian semua jenis/periode izin atau seluruh kegagalan lintas akun |
| Wajah dan push pada perangkat | Komponen/API/kontrak tersedia untuk verifikasi integrasi akhir | Belum membuktikan kualitas pencocokan, anti foto, dukungan ponsel, pengiriman push, atau kesiapan hosted |

Pemeriksaan tipe selama integrasi pernah menemukan error pada modul server baru; pemeriksaan integrasi lokal berikutnya dikonfirmasi lulus seperti tabel di atas. Pengujian layanan hosted dan perangkat dicatat terpisah.

Perubahan meliputi penugasan harian wajib, GPS segar maksimal 60 detik yang terikat pada selfie, status selesai tanpa clock in kedua, penanda sesi panjang setelah ditutup, penjelasan durasi dengan izin, permintaan koreksi kasir dan keputusan HR, pencatatan izin lampau, serta koreksi jam izin. Navigasi menautkan Penugasan harian dan Verifikasi wajah; penugasan tidak menambah item navigasi bawah.

## Fixture rollback yang siap ditinjau

Fixture diabaikan Git pada `.vercel/cashier-preview-smoke.sql`; pelaksana lokalnya `.vercel/cashier-preview-smoke-local.mjs`. Perintah `node .vercel/cashier-preview-smoke-local.mjs` lulus setelah menerapkan 11 migrasi aktual. Delapan kelompok pemeriksaan mencakup penugasan harian/lampau dan outlet sementara; RLS kasir/manajer serta absensi manual lama; kepemilikan/pembatalan permintaan koreksi; persetujuan HR beserta absensi manual dan audit; penolakan snapshot usang/persetujuan berulang; izin sakit lampau dengan koreksi jam dan pengembalian potongan yang idempoten; tautan kotak masuk dan mark-read penerima; serta penghitung bisnis dan rollback.

Fixture memakai tiga akun/karyawan sintetis dengan ID dan nomor eksplisit, memeriksa benturan sebelum menulis, dan berjalan dalam satu transaksi `BEGIN` sampai `ROLLBACK`. Uji lokal memastikan jumlah baris Auth, bisnis, audit, notifikasi, dan outbox kembali persis ke kondisi awal; sequence nomor karyawan/kode outlet tidak berubah. Sequence teknis audit/ledger/pg_net dapat meninggalkan celah walau transaksi dibatalkan. Notifikasi sementara dapat ditujukan ke HR yang dikonfigurasi, tetapi harus tetap tidak committed. Menurut [dokumentasi pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), permintaan HTTP dimulai setelah transaksi committed; perilaku pengirim hosted belum dieksekusi oleh pemeriksaan lokal ini.

Belum ada eksekusi hosted oleh pembuat fixture. Jalankan seluruh SQL pada satu koneksi Preview saja setelah ditinjau; jangan mengeksekusi sebagian lalu melakukan commit. Fixture ini sengaja tidak melakukan clock in dengan bukti biometrik nyata dan bukan bukti kualitas kamera/GPS, pencocokan wajah, push perangkat, atau scheduler.

Smoke script API yang diabaikan Git disiapkan pada `.vercel/preview-api-smoke.mjs`, dengan target tetap proyek Preview dan transport proteksi deployment yang diberikan operator. Script menggunakan Auth/karyawan sintetis yang harus dihapus dan diverifikasi tidak ada di blok `finally`; tidak mengirim push atau wajah nyata. Sintaks/ekspor script dan penolakan `face_count` untuk JPEG abu-abu 640×640 telah diperiksa lokal memakai inferensi WASM aktual. Script belum dijalankan pada hosted oleh pembuatnya. Pengujian hosted tersebut memerlukan hak baca/tulis/hapus fixture yang tersedia; tidak ada penambahan grant oleh script. Log audit Auth dan bucket pembatasan percobaan sintetis dapat tertinggal sebagai jejak teknis.

## Pemeriksaan yang masih menunggu bukti

| Pemeriksaan | Status saat dokumen dibuat |
| --- | --- |
| Suite lokal keseluruhan dan build setelah integrasi | Lulus: 285 test, check 0 error/0 warning, build, dan database 11 migrasi; ulang bila kode berubah |
| Browser E2E penugasan → masuk → pulang → koreksi → keputusan | Penugasan/permintaan/notifikasi/keputusan lulus; masuk/pulang dengan kamera/GPS nyata masih menunggu |
| Migrasi dan endpoint terbaru pada Preview terisolasi | Menunggu verifikasi oleh penanggung jawab deployment |
| RLS, hak aktor, audit, dan saldo pada layanan hosted | Menunggu verifikasi hosted; tes lokal bukan pengganti |
| Kamera/GPS nyata pada ponsel outlet, termasuk modal terbuka >60 detik | Belum diverifikasi pada perangkat fisik |
| Pendaftaran wajah dengan persetujuan dan tinjauan HR lain; pencocokan privat 1:1 | Menunggu pengujian layanan dan perangkat |
| Batas kualitas/mismatch serta jalur manual HR | Menunggu pengujian layanan dan operasional |
| Push opt-in/ditolak/tidak didukung; unsubscribe saat logout | Menunggu pengujian browser/perangkat |
| Scheduler/pengirim server pengingat 8 jam saat aplikasi tertutup | Menunggu konfigurasi dan bukti pengiriman hosted |

## Skenario penerimaan

1. Tanpa penugasan atau saat libur, kasir tidak dapat clock in. Outlet tugas sementara tidak mengganti penempatan utama. HR tidak menetapkan dirinya sendiri. Penugasan lampau memerlukan alasan minimal 5 karakter, tanggal tidak sebelum mulai bekerja, dan belum ada absensi.
2. Modal lama tidak dapat mengonfirmasi GPS kedaluwarsa. GPS diperbarui dan selfie lama dibatalkan; foto baru wajib. Clock out memakai GPS segar dan lokasi historis sesi.
3. Sesi terbuka mencapai pengingat 8 jam dan tanda perlu diperiksa 12 jam. Sesi panjang yang ditutup tetap ditandai; waktu aktual tidak dipotong atau ditutup otomatis.
4. Usulan koreksi dapat dibatalkan saat menunggu dan tidak mengubah absensi sebelum keputusan. HR lain memberi keputusan beralasan; persetujuan tidak meninggalkan perubahan sebagian.
5. Durasi aktual dan pembanding 480 menit tetap terlihat. Bagian berizin dan perlu penjelasan dipisahkan. Izin keluar sementara bukan pelacakan jam kembali aktual. Tidak ada keputusan payroll otomatis.
6. Izin sakit/pribadi lampau serta koreksi jam izin menyimpan sumber keputusan, pemberi keputusan eksternal bila berlaku, dan audit. Potongan tahun hangus tidak ditambah/dipindah ke tahun baru.
7. Referensi wajah memerlukan persetujuan serta tinjauan HR lain. Pencocokan server hanya 1:1 dan terikat konteks absensi. Kegagalan memakai proses HR, tanpa klaim liveness kuat atau jaminan anti foto.
8. Push hanya atas pilihan pengguna pada platform yang mendukung; penolakan tetap menyediakan lonceng/in-app. Logout melepas langganan. Bukti pengiriman server dan perangkat dicatat terpisah.

Gunakan [panduan uji operasional](operational-pilot.md) untuk pelaksanaan. Isi hasil nyata dan waktu verifikasi sebelum memakai perubahan sebagai acuan operasional Production. Jangan memasukkan foto, token, kata sandi, atau data karyawan asli ke laporan.
