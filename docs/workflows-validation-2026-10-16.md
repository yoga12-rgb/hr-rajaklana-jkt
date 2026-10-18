# Validasi alur kerja — 16–18 Oktober 2026

Dokumen ini mencatat enam perbaikan alur kerja yang dirilis pada 18 Oktober 2026. Snapshot kode yang diperiksa adalah `fe50a5e06958facdd86ca763c833fb48b3027e11`. Production dan Preview READY, CI keduanya lulus, serta sembilan migrasi sesuai source telah diterapkan pada kedua database. Snapshot hosted sebelumnya tetap tersedia pada [laporan 13 Oktober](hosted-verification.md). Commit dokumentasi berikutnya tidak mengubah snapshot bukti ini.

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

Catalog kedua lingkungan memastikan RLS inbox aktif, hanya SELECT penerima diberikan ke `authenticated`, tidak ada akses `anon` atau mutasi tabel langsung, ketiga RPC baru memakai otorisasi internal dan `search_path` kosong, serta tabel terdaftar pada `supabase_realtime`. HTTP Data API kedua lingkungan menolak tabel inbox dan ketiga RPC baru tanpa login dengan 401/42501. Tidak ada uji mutasi data operasional pada Production.

Advisor kedua proyek tidak melaporkan ERROR. Catatan [SECURITY DEFINER terautentikasi](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) sesuai rancangan RPC dengan pemeriksaan aktor/role/owner yang diuji. Catatan konfigurasi [MFA](https://supabase.com/docs/guides/auth/auth-mfa), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), serta [tabel token tanpa policy klien](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) tetap ada; perubahan ini tidak mengubah pengaturan Auth atau memberi akses klien ke tabel token.

## Snapshot rilis dan hosted — 18 Oktober 2026

URL immutable berikut mengidentifikasi build yang diperiksa. Alias dapat berubah pada rilis selanjutnya; kolom ini tetap menjadi bukti snapshot kode di atas.

| Bukti | Preview | Production |
| --- | --- | --- |
| SHA snapshot rilis yang diperiksa | `fe50a5e06958facdd86ca763c833fb48b3027e11` | Sama |
| Riwayat sembilan migrasi sesuai source | Lulus; versi/nama sesuai source | Lulus; versi/nama sesuai source |
| Edge Function `hr-api` untuk snapshot ini | Tidak berubah; fitur baru memakai RPC database | Tidak berubah; fitur baru memakai RPC database |
| Deployment frontend, ID/URL immutable, status | READY, source Git, `dpl_G4JJRpKYd42VGbPi69esw6fqpi56`; [build Preview](https://hr-rajaklana-36d37puf3-hr-rajaklana.vercel.app) | READY, source Git, target Production, `dpl_13nBsZjiuYQQahwSo41rV59BryLY`; [build Production](https://hr-rajaklana-jt8yqo7zv-hr-rajaklana.vercel.app) |
| Alias dan lingkungan | `hr-rajaklana-jkt-preview.vercel.app`, branch `codex/preview`; proteksi Vercel tetap aktif | `hr-rajaklana-jkt.vercel.app`, branch `main` |
| CI pada SHA snapshot rilis | [39095572916 — success](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39095572916) | [39095745396 — success](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/39095745396) |
| HTTP frontend | `/login` build immutable 200 lewat `vercel curl`; shell aplikasi dan manifest tersedia | `/login` alias utama 200; shell aplikasi dan manifest tersedia |
| Alur hosted lintas akun, saldo/audit, notifikasi | Delapan assertion RPC/role asli lulus dengan rollback; UI lintas akun belum tuntas | Catalog/grant/publication/advisor dan penolakan akses anonim lulus; tidak membuat data uji Production |

Laporan hosted 13 Oktober mencatat tujuh migrasi dan rilis kode `db42cbc`; status tersebut merupakan snapshot lama. Penerapan 18 Oktober menambah `20261016063305` dan `20261016063418` pada kedua lingkungan tanpa menghapus data HR atau mengubah akun Auth.

## Batas pengujian perangkat

- Kamera dan GPS ponsel nyata, radius/akurasi di outlet, serta koneksi terputus belum diuji untuk pembaruan ini.
- Pemasangan, pembaruan service worker, dan perilaku PWA pada ponsel nyata belum diuji untuk pembaruan ini.
- Pengingat 8 jam hanya berjalan di dalam aplikasi yang terbuka/aktif; tidak ada klaim notifikasi ketika browser/PWA ditutup.
- Tidak ada integrasi push eksternal atau notifikasi OS pada source ini; pengiriman push saat aplikasi tertutup tidak diuji dan belum menjadi fitur.
- RLS/notifikasi dan status dibaca diuji melalui role database hosted dengan rollback; pengiriman realtime pada dua browser/perangkat, URL lampiran privat baru, serta UI perubahan hak akses belum diuji menyeluruh pada rilis ini.

Gunakan data fiktif pada Preview untuk pengujian perangkat dan lintas akun berikutnya. Jangan menganggap pemeriksaan HTTP atau RPC sebagai bukti semua alur UI/perangkat berjalan tanpa kendala.
