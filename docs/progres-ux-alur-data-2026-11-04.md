# UX dan alur data — 4 November 2026

Baseline rilis: `53393484877bd932fc55dfc14f7b68b5805aa0f0`. Branch pekerjaan: `codex/ux-data-flow-20261104`, checkout `D:\aplikasi-web\rajaklana-hr\.codex-test-tmp\face-release`. Checkout utama memiliki pekerjaan lain yang belum dirilis dan tidak ditimpa.

## Checkpoint

1. **Notifikasi:** tujuan internal diikat ke jenis notifikasi/ID dan daftar route/query yang sah. Notifikasi SPV/operasi tidak lagi jatuh ke Beranda. Navigasi tidak menunggu RPC penandaan dibaca; pending dan kegagalan tetap terlihat dan terikat akun. Patch lokal dilakukan setelah RPC berhasil, hanya untuk ID yang diketahui saat permintaan dimulai. Watermark menolak snapshot yang mendahului patch.
2. **Absensi:** lease dalam memori per proyek/akun mempertahankan pending/stage/hasil melalui navigasi SPA. Menutup formulir tidak mengklaim membatalkan transaksi server. Pengiriman ganda ditahan, respons akun lama dibuang, dan detail menggunakan ID dengan turunan catatan terbaru. Respons transport yang ambigu memicu pembacaan status, mempertahankan keterangan ketidakpastian, dan tidak dikirim ulang otomatis.
3. **Media:** bootstrap/refresh tidak membuat seluruh signed URL. Gambar dimuat ketika terlihat, tautan lampiran ketika detailnya terlihat, memakai bucket privat/RLS yang sama. Signing bersamaan digabung per bucket, maksimal 25 path per batch. Cache hanya dalam memori per scope, maksimal 128 entri, 120 detik; signed URL tetap 300 detik. Ada timeout, error, retry, pembaruan URL, serta pemeriksaan scope sebelum dan sesudah await/cache hit. Tidak ada URL privat yang dipersistenkan.
4. **Pemuatan berdasarkan kebutuhan:** konteks Dashboard dan halaman nonoperasional memuat 31 hari terakhir, semua sesi terbuka, sesi yang baru ditutup, sesi lama ≥12 jam, serta tanggal kasus SPV yang masih terbuka. Riwayat audit awal dibatasi 100 terbaru. Halaman operasional memuat konteks historis lengkap sebelum tindakan diizinkan, mempertahankan validasi konflik/penugasan lama. Navigasi dan respons lama dibatasi revision tampilan. Data pengajuan/penugasan serta saldo yang masih diperlukan pemeriksaan bisnis tetap lengkap; tidak dipotong sembarang tanggal.
5. **Rekap:** filter tanggal/outlet/pencarian dilakukan server, 25 catatan per halaman dengan urutan stabil timestamp+ID, mempertahankan presisi mikrodetik PostgreSQL. Pengayaan alasan koreksi/lampiran dilakukan untuk catatan halaman terkait. CSV berjalan melewati seluruh halaman filter dan dibatalkan tanpa unduhan parsial saat scope/filter/revision berubah atau halaman gagal. Ringkasan diberi label halaman, tidak dinyatakan sebagai total seluruh periode. Batas `created_at` menahan sisipan baru; pembacaan lintas halaman bukan snapshot MVCC dan tidak diklaim atomik.
6. **Sinkronisasi dan pengukuran:** event Realtime digabung dan memuat kelompok data terdampak. Setiap pass tetap memvalidasi konteks live dan membaca identitas/role/organisasi segar; perubahan scope/role/token memaksa pemuatan lengkap. Notifikasi saja tidak membangunkan query halaman operasional lewat `dataRevision`. Pengukuran lokal dibatasi 100 sampel berisi label tahap tetap, durasi, dan hasil, tanpa kredensial, lokasi, foto, URL, ID karyawan, atau payload. Tidak ada layanan berbayar/telemetri eksternal baru.

## Temuan selama implementasi

- Navigasi ke modul baru semula berpotensi melepas komponen notifikasi dan menghilangkan kegagalan RPC yang masih berjalan. Header kini mempertahankan komponen setelah konteks awal pernah lengkap; penandaan yang sudah dikonfirmasi tetap dapat diterapkan selama pemuatan modul, dengan guard sesi/akun aktif tetap berlaku.
- Pembatasan riwayat awal semula dapat menyembunyikan sesi selesai ≥12 jam yang sudah lama. Filter diperluas untuk mempertahankan seluruh sesi tersebut dan tanggal kasus SPV terbuka.
- Respons query rekap yang semula sah dapat tiba setelah role HR dicabut tanpa event Realtime lebih dahulu. Pemeriksaan live dan role server segar ditambahkan pada batas publikasi; reproduksi dipertahankan.
- Review akhir menemukan reset filter rekap masih mengosongkan tanggal, padahal kontrak query mewajibkan rentang valid. Reset kini mengembalikan awal bulan–hari ini; reproduksi browser ditambahkan.
- Mode query baru tidak boleh meniadakan koreksi catatan historis di luar cache awal. Tindakan koreksi mengambil catatan melalui RLS dan memvalidasi ulang akses bila ID belum ada dalam konteks lokal.

## Bukti dan gate

- Checkpoint unit gabungan awal: 569 tes lulus, sebelum seluruh tambahan rekap/guard akhir; bukan hasil gate final.
- Checkpoint `check`: 0 error, 0 warning setelah integrasi UI awal.
- 18 tes query rekap, 12 tes scoped refresh, dan reproduksi pencabutan role pada publikasi: lulus pada checkpoint masing-masing.
- Lima kasus browser UX absensi telah lulus pada checkpoint agen; gate final akan mengikat seluruh suite ke fingerprint sumber terakhir.
- Gate lokal final **PASS**: check 0 error/0 warning; 594 tes pada 48 file; suite database, legacy, historical-readiness, checker kelengkapan browser, helper evidence, audit dependency dan build. Manifest `release-local-2026-11-04T04-59-40-312Z`; fingerprint sumber tetap `9c79b0ec02297dd96edcd19141f80ef5249b7f8004bc2173c519f9d2dbd4b921`. Audit dependency: 4 low yang sudah ada, 0 moderate/high/critical; dependency tidak diubah.
- Browser SDK final **49/49 PASS**, 0 skipped/flaky/unexpected, seluruh kontrak lama dan UX baru diperiksa oleh checker independen. Run `2026-11-04T05-03-35-982Z-live-mock-6cd82479-2678-4399-8a9f-d79977d79917`; fingerprint sebelum/sesudah cocok dengan gate lokal.
- Demo-PWA final **24/24 PASS**, 0 skipped/flaky/unexpected. Run `2026-11-04T05-09-54-384Z-demo-pwa-34abf458-6763-4612-93d7-7cca9c4a97dc`; fingerprint cocok. Shell offline browser sintetis desktop tidak menutup PVR-02 perangkat nyata.
- Ringkasan hash log dan acceptance tiap kasus: `docs/evidence/ux-alur-data-2026-11-04.json`.
- CI dan deployment Preview/Production: **PENDING** pada checkpoint sebelum publikasi commit ini. Hasil operator setelah rilis ditambahkan ke dokumen bernama sama di checkout utama.
- Workflow hosted dengan akun nyata: **NOT RUN**. Perangkat nyata/iPhone/PVR-02: **DEFERRED** sesuai keputusan sebelumnya.
- Tidak ada migration, perubahan policy/grant/RLS, penghapusan data, atau cleanup Auth yang dibutuhkan untuk perubahan ini.

Status final dan identitas deployment dicatat setelah semua gate selesai; READY atau tes skipped tidak dianggap bukti workflow lulus.

## Batas hasil

Optimasi mengurangi query/signing yang tidak perlu dan memisahkan proses latar dari konfirmasi transaksi. Belum ada pengukuran latensi Production atau p95 perangkat pengguna, sehingga tidak ada klaim angka percepatan. Cache data hanya boleh digunakan setelah konteks live/identitas/role segar tervalidasi; cache bukan sumber otorisasi. Riwayat yang dibutuhkan validasi bisnis tetap dimuat sebelum tindakan operasional. Batas sisipan rekap bukan snapshot atomik lintas halaman; perubahan yang teramati menghentikan ekspor.

Gate awal yang gagal saat penyesuaian selector, path import, dan konteks jaringan fixture dipertahankan sebagai checkpoint diagnostik dan tidak dihitung lulus. Gate final di atas menggantikannya; tidak ada skenario yang di-skip agar lolos. Residual managed pg_net tetap OPEN dan PVR-02 tetap DEFERRED di luar cakupan optimasi ini.
