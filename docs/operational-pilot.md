# Uji operasional: alur kasir, cuti, dan izin

Ini panduan uji, bukan pernyataan seluruh langkah sudah lulus. Gunakan akun/data contoh pada Mode demo dan tetap pada browser serta alamat yang sama. Pergantian akun tersedia di **Profil → Akun contoh** hanya untuk karyawan dan akun yang aktif. Data demo tidak tersinkron antarperangkat. Lihat [bukti dan pekerjaan validasi yang masih menunggu](cashier-validation-2026-10-18.md).

## Penugasan dan kehadiran

1. Sebagai HR, periksa satu outlet contoh: koordinat/radius, batas akurasi, jam Pagi/Sore, dan toleransi. Buka **Penugasan harian** dari sidebar atau Profil; pilih kasir selain diri sendiri, tanggal, outlet, shift/libur, dan alasan. Middle mengikuti izin karyawan. Coba outlet sementara: penempatan utama tidak berubah. Periksa cakupan per outlet/shift dan status belum clock in.
2. Coba tanpa penugasan, libur, dan penugasan dibatalkan: kasir tidak dapat clock in. Penugasan aktif mengunci outlet dan shift pada Kehadiran. HR boleh melengkapi tanggal lampau jika tidak sebelum mulai bekerja, belum ada absensi, dan alasan minimal 5 karakter. Jika absensi sudah ada, gunakan koreksi.
3. Sebagai kasir yang ditugaskan, periksa ringkasan shift dan target 8 jam termasuk istirahat. Izinkan GPS/kamera dan ambil selfie baru. Konfirmasi dan pastikan pesan berhasil serta catatan muncul. GPS berlaku paling lama 60 detik: modal yang kedaluwarsa harus memperbarui GPS dan membatalkan selfie lama. Foto baru wajib sebelum konfirmasi.
4. Coba lokasi di luar radius, GPS kurang akurat, kamera/lokasi ditolak, dan upload gagal: tidak boleh ada keberhasilan palsu. Clock out memeriksa GPS segar dan memakai lokasi historis sesi. Setelah selesai, tampilkan Sudah pulang tanpa clock in kedua pada tanggal kerja yang sama. Coba lintas tengah malam.
5. Periksa pengingat sesi terbuka 8 jam dan tanda perlu diperiksa 12 jam. Sesi panjang yang sudah ditutup tetap ditandai. Tidak ada clock out otomatis atau pemotongan waktu aktual.
6. Setujui izin datang terlambat/pulang lebih awal; periksa menit aktual, bagian berizin, serta sisa yang perlu penjelasan. Kelebihan batas izin masih tanpa izin. Durasi mentah dan pembanding 480 menit tetap terlihat, tanpa potongan payroll otomatis. Izin keluar sementara hanya konteks; jam kembali aktual belum dilacak terpisah.

## Koreksi absensi

1. Kasir mencoba **Ajukan koreksi absensi** untuk lupa/gagal masuk, lupa pulang, salah shift, dan salah jam. Isi tanggal kerja, usulan waktu aktual yang sudah terjadi, alasan, serta sumber konfirmasi. Pulang kosong hanya jika masih bekerja. Pengajuan menunggu dapat dibatalkan; catatan asli tetap berlaku.
2. HR lain membuka **Rekap → Pengajuan koreksi absensi kasir**, membandingkan usulan dengan catatan asli dan sumber konfirmasi, lalu menyetujui/menolak dengan alasan. Persetujuan memperbarui absensi dan audit secara utuh; penolakan mempertahankan catatan lama. HR tidak memutus pengajuan sendiri.
3. Uji rentang sesi bertabrakan: harus ditolak tanpa perubahan sebagian. Waktu akhir tepat sama dengan awal sesi berikutnya diperbolehkan. Untuk kendala kamera/GPS, pencatatan manual HR tetap memerlukan alasan/sumber dan tanda tanpa verifikasi GPS/selfie.

## Cuti, jam izin, dan pencatatan lampau

1. Ajukan cuti mendatang sebagai kasir. Saldo awal **B** tetap selama menunggu; persetujuan potongan 1 hari menjadi B−1. Perubahan disetujui menjadi total 0,5 menghasilkan B−0,5. Pembatalan disetujui mengembalikan potongan ke tahun asal; tahun hangus tidak menjadi saldo baru.
2. Pada Menunggu/Perlu dilengkapi, perbaiki tanggal, alasan, jam izin, dan ganti/hapus lampiran PDF/JPG/PNG/WebP maksimal 5 MB. Kirim ulang; keputusan lama harus direset. Duplikat persis ditolak; tumpang tindih berbeda menampilkan konteks untuk ditinjau.
3. HR mengoreksi pengajuan disetujui milik orang lain: tanggal, jam datang/pulang atau interval keluar/kembali, potongan, alasan, serta pemberi keputusan eksternal jika berlaku. Periksa jam valid, alokasi per tahun, dan audit sebelum/sesudah. Kewenangan HR melihat tim tidak otomatis menjadi kewenangan persetujuan internal semua pemohon.
4. HR memakai **Catat sakit / izin lampau** untuk karyawan lain, mengisi tanggal lampau, cakupan/jam, alasan, keputusan dan sumber konfirmasi, potongan, serta nama pemberi keputusan eksternal bila berlaku. Catatan harus jelas sebagai pencatatan HR; tidak mengubah jam absensi. Tambahan potongan tahun hangus harus ditolak.
5. Periksa keputusan tim Produksi oleh Head Baker, keputusan jabatan lain oleh atasan yang ditetapkan, serta keputusan eksternal yang dicatat HR lain. Tidak ada persetujuan atau pencatatan keputusan untuk diri sendiri.

## Wajah dan notifikasi perangkat

- Buka **Profil → Verifikasi wajah**, baca persetujuan, lalu daftarkan referensi. HR lain meninjau; referensi disimpan privat. Uji kebutuhan daftar ulang dan pencocokan server 1:1 pada selfie masuk. Ini belum merupakan liveness kuat atau jaminan anti foto. Kegagalan/mismatch tidak otomatis menjadi pelanggaran atau potongan; gunakan konfirmasi dan jalur manual HR.
- Buka lonceng untuk pengajuan, keputusan, penugasan, dan koreksi. Pastikan tautan sesuai akun, status dibaca persisten, dan akun lain tidak dapat membaca/menandai inbox pengguna lain.
- Push bersifat opt-in pada browser/perangkat yang mendukung. Uji izin diterima, ditolak, platform tanpa dukungan, dan logout yang melepas langganan. Lonceng/pengingat dalam aplikasi tetap tersedia. Pengingat 8 jam di luar aplikasi memerlukan scheduler/pengirim server aktif; keberadaan komponen bukan bukti pengiriman telah berhasil.
- Pada iPhone/iPad iOS/iPadOS 16.4+, buka Safari → Bagikan → Tambah ke Layar Utama. Aktifkan **Buka sebagai App Web** jika muncul. Buka ikon tersebut, login, lalu lonceng → **Aktifkan notifikasi perangkat** → Izinkan. Tab Safari menampilkan petunjuk pemasangan. Pemeriksaan yang gagal menyediakan **Periksa ulang**; status Aktif baru muncul setelah langganan akun dikonfirmasi server. Tutup aplikasi tanpa logout untuk menguji penerimaan push.

## Batas bukti dan uji perangkat

Mode demo serta helper lokal tidak membuktikan layanan hosted, kualitas pencocokan wajah, atau pengiriman push. [Laporan hosted terdahulu](hosted-verification.md) hanya berlaku untuk snapshot yang disebut di sana. Setelah migrasi/config/deployment terbaru diverifikasi, ulangi alur inti pada dua akun/perangkat melalui HTTPS, termasuk GPS/kamera nyata di ponsel outlet, koneksi buruk, lintas tengah malam, aplikasi tertutup, izin push, pemasangan, dan pembaruan PWA.

Catat akun uji, langkah, hasil aktual/harapan, perangkat/browser, dan waktu WIB tanpa data pribadi. Tandai setiap langkah **belum diuji**, **lulus**, atau **gagal** sesuai hasil nyata. [Uji lokal 12 Oktober](local-validation-2026-10-12.md) tetap menjadi riwayat versi lama, bukan bukti semua perubahan ini.
