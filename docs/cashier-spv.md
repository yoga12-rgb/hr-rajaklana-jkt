# Panduan pemantauan kasir dan jadwal mingguan

Panduan ini menjelaskan fitur Tahap A untuk Admin HR Rajaklana Jabodetabek. Akses mengikuti role `Admin HR` yang diberikan pada akun; jabatan Supervisor saja tidak otomatis membuka menu pengelolaan ini.

## Panel pemantauan di Beranda

Panel **Pemantauan kasir** merangkum kondisi outlet untuk tanggal yang dipilih. Gunakan filter outlet untuk melihat satu outlet atau seluruh outlet aktif.

Setiap kartu shift membedakan empat hal: kebutuhan minimum, jumlah kasir yang dijadwalkan, jumlah kasir yang tersedia setelah memperhitungkan cuti sehari penuh, dan jumlah absensi aktual. Label **Belum diatur** berarti target minimum belum dibuat. Angka **0** berarti outlet memang tidak membutuhkan kasir pada slot itu. Izin sebagian jam tetap tampil sebagai hal yang perlu ditinjau; aplikasi tidak mengurangi kasir secara otomatis untuk seluruh shift.

Daftar status menunjukkan siapa yang dijadwalkan, sedang bekerja, sudah clock out, belum waktunya masuk, belum memiliki jadwal, sedang cuti, atau membutuhkan pemeriksaan. Shift Middle fleksibel, jadi tidak ditandai terlambat hanya karena belum clock in pada jam tertentu. Hari libur tetap menjadi informasi, bukan jadwal otomatis. Ketiadaan clock in meminta konfirmasi langsung dan tidak membuat status alpa.

Kasus tindak lanjut dibuat hanya ketika sumbernya memang perlu diperiksa, misalnya jadwal berbenturan dengan cuti yang disetujui, sesi terbuka, keterlambatan di luar izin, koreksi kehadiran menunggu, atau jadwal belum tersedia pada hari kerja. Kasus dapat dibuka ke halaman sumber, diberi Admin HR penanggung jawab, dicatat, lalu diselesaikan dengan catatan hasil. Jika kondisi yang sama muncul kembali, kasus lama dibuka kembali dan riwayatnya tetap tersimpan.

Menyelesaikan kasus hanya memperbarui catatan tindak lanjut. Tindakan itu tidak mengubah absensi, persetujuan cuti, saldo cuti, jam kerja, atau keputusan atasan.

## Menentukan kebutuhan minimum

Di halaman **Penugasan**, pilih tampilan **Mingguan** lalu buka bagian **Kebutuhan minimum kasir**.

1. Pilih outlet, hari dalam minggu, shift, jumlah minimum (0–100), dan tanggal mulai berlaku.
2. Simpan. Tanggal berlaku harus hari ini atau mendatang.
3. Untuk mengubah target pada masa depan, buat baris dengan tanggal berlaku baru agar konfigurasi sebelumnya tetap menjelaskan periode lama.

Kebutuhan yang belum diatur tidak dianggap nol. Pengaturan ini hanya memberi indikator kekurangan; tidak mengubah jadwal atau keputusan operasional secara otomatis.

## Menyusun dan menyalin jadwal

Grid menampilkan tujuh hari mulai Senin dalam waktu kerja WIB. Sel lampau hanya untuk dibaca. Pilih shift dan outlet pada setiap sel yang ingin diubah; jadwal yang tidak disentuh tidak ikut disimpan. Pilihan kosong berarti belum ditugaskan. Mengosongkan jadwal aktif mengajukan pembatalan dan meminta alasan. Jadwal yang dibatalkan dapat diaktifkan kembali melalui pilihan shift.

Tombol **Pratinjau salin minggu sebelumnya** hanya mengisi sel target yang belum pernah memiliki jadwal. Target yang sudah terisi atau dibatalkan dilewati; sumber yang sudah tidak memenuhi aturan masuk daftar konflik. Meninjau pratinjau dan menerapkannya ke grid belum menyimpan data. Perubahan baru tersimpan setelah alasan diisi dan tombol **Simpan jadwal mingguan** ditekan.

Satu penyimpanan dapat memuat beberapa kasir dan hari. Server memeriksa semua perubahan dan menolak seluruh batch bila satu baris tidak valid, ada absensi pada tanggal itu, snapshot jadwal telah berubah, atau shift berbenturan dengan cuti penuh yang disetujui. Jadwal harian tetap dapat dibuka dari tautan tanggal pada panel. Kasir akan menerima satu pemberitahuan jadwal mingguan per batch, bukan pemberitahuan terpisah untuk setiap harinya.

Perubahan shift, outlet, alasan, dan percobaan simpan disimpan sebagai draft pada browser untuk akun dan minggu yang sedang dipilih. Minggu yang dipilih juga dipertahankan pada alamat halaman. Draft ada di perangkat/browser yang sama dan belum menjadi jadwal bersama sampai penyimpanan terkonfirmasi. Jika browser menolak penyimpanan lokal, aplikasi menampilkan peringatan agar jadwal disimpan sebelum halaman ditutup.

Jika jadwal server berubah saat draft terbuka, baris **Tinjau ... sel sebelum menyimpan** menampilkan nilai draft dan jadwal terbaru beserta dua pilihan. **Gunakan jadwal terbaru** membuang draft pada sel itu saja. **Terapkan kembali draft saya** mempertahankan pilihan Anda dengan menjadikan jadwal terbaru sebagai baseline; sel lain tetap perlu ditinjau sendiri.

Jika respons simpan hilang dan aplikasi belum dapat memastikan hasilnya, draft menyimpan percobaan yang sama, termasuk payload dan kunci retry. Setelah reload, masuk kembali ke **Penugasan → Mingguan** pada akun dan minggu yang sama lalu tekan **Ulangi percobaan simpan sebelumnya**. Aplikasi mengirim ulang transaksi asli ke server agar server memeriksa idempotensi. Jangan mengganti atau mengirim batch baru sebelum percobaan itu selesai. Simpanan baru tetap diperiksa terhadap versi jadwal yang menjadi baseline; replay lama hanya boleh dikonfirmasi dengan payload/key yang persis sama.

## Konteks kasus roster

Kasus roster terbuka mengikuti outlet penugasan kasir yang aktif. Jika belum ada penugasan aktif, kasus memakai outlet utama karyawan. Perubahan outlet utama tidak memindahkan kasus selama penugasan aktif di outlet lain masih berlaku; saat penugasan dibatalkan, kasus mengikuti outlet utama yang berlaku.

Mengubah shift ke **Libur** memperbarui konteks kasus terbuka, tetapi tidak menutup kasus otomatis. SPV tetap dapat mencatat tindak lanjut dan menyelesaikannya setelah pemeriksaan. Riwayat, penanggung jawab, dan catatan tetap tersimpan. Kasus yang sudah selesai mempertahankan snapshot penyelesaiannya sampai dibuka kembali melalui tindakan yang sah.

## Batas pemakaian dan lingkungan

Fitur tidak menghitung payroll, membuat alpa, mengubah keputusan cuti/izin, mengisi jadwal libur tetap otomatis, atau melakukan clock out otomatis. Perubahan jam/absensi tetap melalui alur koreksi yang berlaku.

Demo lokal tersimpan di browser dan terpisah dari Supabase. Preview menggunakan basis data uji yang berbeda dari Production. Uji perangkat/iPhone dan skenario pengguna yang belum dilakukan harus tetap dianggap belum diuji sampai diperiksa pada perangkat tersebut.
