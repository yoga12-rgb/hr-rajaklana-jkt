# Validasi alur kerja — 16–18 Oktober 2026

Dokumen ini mencatat enam perbaikan alur kerja. Database Preview sudah menerima sembilan migrasi dan lulus uji transaksi pada 18 Oktober; frontend baru dan database Production masih menunggu rilis pada snapshot persiapan ini. Snapshot hosted sebelumnya tetap tersedia pada [laporan 13 Oktober](hosted-verification.md).

## Perilaku source

1. **Perbaikan pengajuan sebelum keputusan.** Pemilik pengajuan berstatus Menunggu atau Perlu dilengkapi dapat memperbarui tanggal, alasan, jam izin yang berlaku, serta mengganti/menghapus lampiran, lalu mengirim untuk ditinjau kembali. PDF/JPG/PNG/WebP dibatasi 5 MB. Pengajuan disetujui tetap memakai permintaan perubahan tanggal atau pembatalan dengan persetujuan ulang; tanggal dan potongan lama berlaku selama menunggu atau jika ditolak.
2. **Koreksi cuti oleh Admin HR.** HR dapat mengubah tanggal/total potongan atau membatalkan pengajuan disetujui milik karyawan lain, termasuk tanggal lampau, selama tidak ada perubahan menunggu. Alasan wajib; mode persetujuan eksternal juga memerlukan nama pemberi keputusan. Nilai sebelum/sesudah masuk audit. Potongan lama dikembalikan ke tahun asal sebelum potongan baru diterapkan; saldo tahun lampau tetap hangus. UI memperlihatkan alokasi per tahun dan tautan riwayat. Akses semua pengajuan bagi HR tidak mengubah kewenangan persetujuan atasan.
3. **Duplikat dan peringatan benturan tanggal.** Pengajuan aktif dengan pemohon, jenis, cakupan, tanggal, serta jam yang sama ditolak; mengganti alasan bukan cara membuat pengajuan yang berbeda. Status aktif mencakup Menunggu, Perlu dilengkapi, dan Disetujui. Pengajuan Ditolak/Dibatalkan dapat diajukan kembali. Tumpang tindih tanggal lainnya menampilkan peringatan pada formulir, tinjauan, perubahan, dan koreksi. Izin beberapa jam boleh berdampingan dengan kehadiran.
4. **Konfirmasi shift dan sesi terbuka.** Sebelum clock in, kasir memeriksa shift, jadwal masuk, serta target selesai 8 jam. Sesi tanpa clock out menampilkan pengingat setelah 8 jam dari masuk aktual dan tanda perlu diperiksa setelah 12 jam. Jam kerja tetap 8 jam termasuk istirahat. Aplikasi tidak mengisi clock out otomatis atau mengubah durasi menjadi lembur/potongan.
5. **Keterlambatan aktual, berizin, dan tanpa izin.** Waktu serta menit keterlambatan aktual tetap disimpan. Izin datang terlambat yang disetujui untuk tanggal kerja yang sesuai membagi menit berizin dan tanpa izin; waktu melewati batas izin dihitung tanpa izin. Saat perubahan izin masih menunggu, izin asli tetap dipakai. Middle tidak menghitung keterlambatan.
6. **Lonceng notifikasi dalam aplikasi.** Pengajuan, keputusan, kelengkapan, perubahan/pembatalan, dan koreksi menghasilkan pembaruan bagi penerima yang berhak. Status belum dibaca tersimpan pada akun. Tautan `/leave?request=<id>` membuka pengajuan sesuai hak akses; ID yang tidak tersedia tidak mengungkap isi pengajuan. Pengingat sesi 8 jam tersedia ketika aplikasi terbuka/aktif. Notifikasi OS dan push latar belakang ketika aplikasi tertutup belum tersedia.

Aturan hak cuti, prorata setelah tiga bulan kalender, saldo tidak boleh negatif, pengembalian ke tahun asal, larangan keputusan/koreksi diri sendiri, GPS/selfie wajib, dan batas akses antarperan tetap berlaku. Lihat [spesifikasi](specification.md), [panduan uji operasional](operational-pilot.md), serta panduan `/guide`.

## Pemeriksaan lokal

Hasil berikut berasal dari pemeriksaan lokal pada pekerjaan ini, dengan source yang sedang disiapkan untuk rilis:

| Pemeriksaan | Hasil | Cakupan dan batas |
| --- | --- | --- |
| `npm run check` | Lulus | Pemeriksaan Svelte/TypeScript lokal |
| `npm test` | 214 test lulus | Termasuk batas izin keterlambatan, pergantian status sesi tepat 8/12 jam, serta perilaku state terkait alur kerja |
| `npm run test:database` | Lulus; sembilan migrasi | SQL/fungsi asli dijalankan pada PGlite; mencakup edit pengajuan/jam/lampiran, duplikat, koreksi HR/audit/saldo, serta notifikasi dan akses penerimanya |
| `npm run test:database:legacy` | Lulus; 13 fixture | Penggantian schema lama, penolakan kondisi tidak sesuai, dan rollback transaksi |
| `npm run build` | Lulus | Build statis lokal; tidak menerbitkan deployment |

Source memiliki sembilan migrasi, termasuk tambahan `20261016063305_hr_leave_workflows.sql` dan `20261016063418_hr_notifications.sql`. Harness meniru plumbing Auth/Storage Supabase dalam memori. Hasilnya tidak menggantikan pengujian Auth, Storage privat, Edge Function, realtime, dan persistensi lintas perangkat pada layanan hosted.

Browser demo berhasil membuka dashboard kasir, membuat izin datang terlambat untuk 20 Oktober pukul 08.00, dan menampilkan status Menunggu. Pengujian berikutnya terhenti karena koneksi kontrol browser tidak merespons; pemeriksaan visual responsif, inbox, dan koreksi melalui UI belum tuntas. Tidak ada klaim uji browser menyeluruh atau bukti screenshot baru.

Preview hosted menjalankan RPC asli sebagai tiga identitas fiktif dengan role `authenticated`: submit/duplikat, needs-info, edit jam/alasan dan reset keputusan, approve, koreksi HR milik orang lain, pembatalan dan refund tahun asal, RLS inbox, mark-one/all idempoten, serta audit. Delapan assertion lulus. Seluruh transaksi di-rollback; pemeriksaan berikutnya memastikan nol akun Auth, karyawan, dan notifikasi fiktif tersisa. Counter nomor karyawan/outlet tidak berubah; ID teknis audit/ledger dapat memiliki gap normal setelah rollback.

Catalog Preview memastikan RLS inbox aktif, hanya SELECT penerima diberikan ke `authenticated`, tidak ada akses `anon` atau mutasi tabel langsung, ketiga RPC baru memakai otorisasi internal dan `search_path` kosong, serta tabel terdaftar pada `supabase_realtime`. HTTP Data API menolak keempat endpoint baru tanpa login dengan 401/42501. Advisor tidak melaporkan ERROR; catatan SECURITY DEFINER terautentikasi memang sesuai rancangan RPC yang diuji, sementara konfigurasi MFA/leaked-password dan tabel token tanpa policy klien merupakan catatan yang tetap ada.

## Snapshot rilis dan hosted — menunggu verifikasi

Semua kolom berikut tetap menunggu operator rilis. Gunakan SHA rilis yang diperiksa; jangan menganggap commit terbaru atau alias yang berubah sebagai bukti source yang diuji.

| Bukti | Preview | Production |
| --- | --- | --- |
| SHA snapshot rilis yang diperiksa | Menunggu | Menunggu |
| Riwayat sembilan migrasi sesuai source | Lulus; versi/nama sesuai source | Belum diterapkan/diverifikasi untuk pembaruan ini |
| Edge Function `hr-api` untuk snapshot ini | Tidak berubah; fitur baru memakai RPC database | Tidak berubah; fitur baru memakai RPC database |
| Deployment frontend, ID/URL immutable, status | Menunggu | Menunggu |
| Alias dan konfigurasi lingkungan sesuai | Menunggu | Menunggu |
| CI pada SHA snapshot rilis | Menunggu | Menunggu |
| Alur hosted lintas akun, saldo/audit, notifikasi | Delapan assertion RPC/role asli lulus dengan rollback; UI lintas akun belum tuntas | Belum diuji untuk pembaruan ini |

Laporan hosted 13 Oktober mencatat tujuh migrasi dan rilis kode `db42cbc`; status tersebut merupakan snapshot lama. Dokumen ini tidak mengubah bukti historis atau menyatakan bahwa dua migrasi/alur baru sudah tersedia di kedua lingkungan.

## Batas pengujian perangkat

- Kamera dan GPS ponsel nyata, radius/akurasi di outlet, serta koneksi terputus belum diuji untuk pembaruan ini.
- Pemasangan, pembaruan service worker, dan perilaku PWA pada ponsel nyata belum diuji untuk pembaruan ini.
- Pengingat 8 jam hanya berjalan di dalam aplikasi yang terbuka/aktif; tidak ada klaim notifikasi ketika browser/PWA ditutup.
- Tidak ada integrasi push eksternal atau notifikasi OS pada source ini; pengiriman push saat aplikasi tertutup tidak diuji dan belum menjadi fitur.
- Verifikasi lintas perangkat terhadap notifikasi belum dibaca, URL lampiran privat, serta perubahan hak akses masih menunggu layanan hosted.

Lanjutkan dengan data fiktif pada Preview terlebih dahulu. Catat hasil hosted dan SHA yang benar pada tabel rilis setelah langkah tersebut benar-benar selesai.
