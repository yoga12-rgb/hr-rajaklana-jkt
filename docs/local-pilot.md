# Uji pendaftaran karyawan di aplikasi lokal

Gunakan data contoh selama aplikasi masih menampilkan **Mode demo**. Data, akun, dan tautan demo hanya tersedia pada browser serta alamat aplikasi yang sama. Pengujian ini tidak mengirim WhatsApp atau menghubungkan Supabase.

1. Masuk melalui tombol **Admin HR** di halaman login.
2. Pada **Organisasi**, pilih satu outlet contoh. Periksa nama, jam operasional, jam shift, koordinat, dan radius. Lokasi yang belum lengkap juga terlihat pada **Persiapan tim** di Beranda.
3. Pada **Karyawan**, pilih **Tambah karyawan**. Isi nama dan WhatsApp contoh, tanggal masuk, departemen, jabatan, serta penempatan. Pilih atasan yang akun dan status karyawannya aktif. Untuk jabatan yang diputuskan Bos/Manager Pusat, gunakan persetujuan eksternal.
4. Simpan. Nomor karyawan dibuat otomatis; jangan mengisi nomor sendiri. Buka profil karyawan tersebut dan pilih **Buat tautan aktivasi**.
5. Periksa pesan undangan dan nomor karyawan. **Salin pesan** menyiapkan teks untuk pengiriman manual. Dalam demo, buka tautan dari pesan di browser yang sama; mengirimnya ke ponsel lain belum menguji aktivasi nyata.
6. Pada halaman aktivasi, karyawan membuat kata sandi sendiri dan mengulanginya pada kolom konfirmasi. Setelah berhasil, pilih **Masuk dengan akun ini**. Sesi HR yang lama akan diakhiri dan nomor karyawan terisi pada halaman masuk.
7. Masuk dengan kata sandi yang baru dibuat. Pastikan Profil menampilkan karyawan yang baru diaktifkan, bukan akun HR sebelumnya. Coba ajukan izin dan periksa keputusan melalui akun atasan contoh.

Hasil yang diharapkan: status akun berubah dari **Belum diundang** → **Menunggu aktivasi** → **Aktif**. Tautan yang sudah dipakai, diganti, atau melewati 24 jam ditolak. Karyawan yang dinonaktifkan tidak dapat menggunakan tautan yang pernah diterbitkan.

Setelah Supabase tersedia, ulangi pada dua perangkat berbeda untuk memeriksa aktivasi WhatsApp, penyimpanan bersama, dan akses tiap peran. Kamera, GPS, serta pemasangan PWA perlu diuji pada ponsel outlet melalui HTTPS.
