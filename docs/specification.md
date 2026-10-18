# Spesifikasi versi awal Rajaklana HR

Dokumen ini mencatat kebutuhan yang disepakati untuk operasional **Jabodetabek**. Pengelolaan lintas cabang, payroll, rekrutmen, absensi tim selain kasir, dan pengajuan jadwal mingguan belum termasuk versi awal.

## Pengguna dan organisasi

- Admin HR mengelola outlet, departemen, jabatan, karyawan, serta rekap.
- Jabatan dan hak akses dipisahkan. Ketiga supervisor dapat memperoleh akses Admin HR.
- Supervisor Penjualan & SDM mengoordinasikan semua jabatan. Head Baker menjadi atasan langsung Asisten Baker, Helper Produksi, Staf Premix, dan Stock Keeper Bahan Produksi.
- Pengajuan tim Produksi diputuskan Head Baker; pengajuan Head Baker dan jabatan lain diputuskan Supervisor Penjualan & SDM.
- Pengajuan Supervisor Penjualan & SDM diputuskan Bos Rajaklana/Manager Pusat Jogja di luar aplikasi. Admin HR lain mencatat nama pemberi keputusan dan hasilnya. Tidak ada persetujuan atau pencatatan keputusan untuk diri sendiri.

Departemen awal: Produksi; Administrasi; Penjualan & SDM; Sarana, Prasarana & Keuangan; Distribusi & Persediaan Produk. Daftar dapat diperbarui Admin HR. Jabatan mengikuti departemen yang dipilih.

## Data karyawan

Nomor karyawan berurutan `RK000001`, dibuat database, unik, tidak digunakan ulang, dan tetap ketika penempatan berubah. Seluruh hubungan kerja awal adalah Tetap. Data wajib: nama lengkap, WhatsApp, tanggal masuk, departemen, jabatan, outlet penempatan. Atasan langsung atau persetujuan eksternal ditentukan HR.

Karyawan memiliki satu penempatan utama di outlet Jabodetabek. Produksi dapat berada pada outlet yang sama dengan kasir; tidak dibuat lokasi duplikat. Outlet ditambah melalui aplikasi dengan nama, alamat, jam operasional, lokasi GPS, radius, status, dan penanda lokasi produksi.

Karyawan dapat memperbarui informasi pribadi yang diizinkan, seperti alamat dan kontak darurat. Data kerja, nama, WhatsApp, tanggal masuk, dan status dikelola HR. Karyawan nonaktif kehilangan akses tetapi riwayat tetap tersimpan. Atasan aktif harus diganti sebelum dinonaktifkan.

## Akun

- Login dengan nomor karyawan dan kata sandi; pendaftaran publik dinonaktifkan.
- HR membuat profil dahulu lalu membuat tautan aktivasi atau pemulihan kata sandi.
- Tautan dikirim **manual melalui WhatsApp**. Sistem menyiapkan teks untuk disalin, tidak mengirim pesan sendiri.
- Tautan berlaku 24 jam, satu kali pakai, dan tautan pengganti membatalkan yang lama. Membuka tautan belum menghabiskannya.
- Karyawan membuat kata sandi sendiri; minimum 10 karakter pada implementasi awal. Kata sandi disimpan oleh Supabase Auth, tidak oleh tabel HR.
- API server menerjemahkan nomor karyawan ke identitas Auth internal; tidak memerlukan email pribadi karyawan.

## Clock in/out kasir

Durasi kerja **8 jam termasuk istirahat**. Tidak ada clock istirahat. Admin HR menetapkan penugasan harian kasir selain dirinya sendiri: tanggal, outlet, shift Pagi/Sore/Middle atau libur, serta alasan. Kasir melihat penugasannya dan hanya dapat clock in pada penugasan aktif hari itu. Outlet dan shift terkunci sesuai penugasan; outlet tugas sementara tidak mengubah penempatan utama. Ini penugasan per tanggal, bukan pengajuan jadwal mingguan.

HR dapat melengkapi penugasan tanggal lampau dengan alasan minimal 5 karakter jika tanggal tidak sebelum mulai bekerja dan belum ada absensi pada tanggal tersebut. Absensi yang sudah ada diperbaiki melalui koreksi, bukan diubah lewat penugasan. Halaman penugasan menampilkan cakupan per outlet/shift, libur, belum ditugaskan, dan belum clock in; belum menghitung kebutuhan minimum staf.

Patokan shift:

| Shift | Jam awal default | Target akhir | Keterlambatan |
| --- | --- | --- | --- |
| Pagi | 07.00 WIB | 15.00 WIB | Dari jam awal outlet, dengan toleransi outlet |
| Sore | 15.00 WIB | 23.00 WIB | Dari jam awal outlet, dengan toleransi outlet |
| Middle | Clock in aktual | Clock in + 8 jam | Tidak dihitung |

Middle hanya tersedia bagi karyawan yang diizinkan HR. Jam awal Pagi/Sore, toleransi, dan jam operasional dapat diatur per outlet. Jam operasional tidak otomatis menjadi jam masuk semua kasir.

Sebelum clock in, kasir memeriksa outlet dan shift yang ditetapkan, jadwal masuk, serta target selesai 8 jam. Setelah sesi hari itu selesai, halaman menampilkan Sudah pulang dan tidak menawarkan clock in kedua. Sesi terbuka menampilkan pengingat setelah 8 jam dari clock in aktual dan tanda perlu diperiksa setelah 12 jam. Sesi yang sudah ditutup dengan durasi setidaknya 12 jam tetap diberi tanda perlu diperiksa. Tidak ada clock out otomatis atau perubahan waktu aktual untuk menghilangkan anomali.

Clock in wajib lokasi perangkat dalam radius outlet penugasan, akurasi GPS sesuai kebijakan outlet, dan selfie baru dari kamera. Hasil GPS mencantumkan waktu pengambilan dan berlaku paling lama 60 detik. Sebelum mengambil foto/konfirmasi, aplikasi memeriksa kesegarannya; GPS kedaluwarsa diperbarui, selfie lama dibatalkan, dan kasir mengambil foto baru sebelum konfirmasi. Clock out juga memerlukan hasil GPS segar tanpa selfie. Catatan waktu menggunakan waktu database pada mode live, WIB untuk tampilan. Satu sesi terbuka per kasir; clock out mendukung sesi yang melewati tengah malam.

SPV/HR dapat melihat shift, waktu aktual, selfie, jarak/akurasi lokasi, durasi, dan keterlambatan. Shift tidak diubah kasir setelah masuk. Koreksi HR memerlukan alasan, tidak untuk catatan sendiri, dan menyimpan jejak catatan asli. HR juga dapat membuat catatan manual untuk kendala lapangan dengan alasan serta sumber konfirmasi; catatan tersebut ditandai manual, bukan diklaim lolos GPS/selfie. Kasir dapat mengajukan koreksi untuk lupa/gagal masuk, lupa pulang, salah shift, atau salah jam dengan tanggal kerja, usulan waktu aktual, alasan, serta sumber konfirmasi. Pengajuan menunggu dapat dibatalkan. HR lain memberi keputusan beralasan; persetujuan menerapkan perubahan absensi dan audit secara atomik, penolakan mempertahankan catatan asli. Bukti GPS/selfie yang tidak ada tidak dianggap terverifikasi.

Catatan tanpa clock out ditandai belum lengkap. Durasi aktual serta pembanding 480 menit tetap disimpan; bagian selisih yang dijelaskan izin datang terlambat/pulang lebih awal disetujui dibedakan dari bagian yang perlu penjelasan. Izin keluar sementara ditampilkan sebagai konteks, bukan bukti bahwa jam kembali aktual sudah dilacak. Selisih durasi tidak otomatis menghasilkan lembur, payroll, atau potongan.

Keterlambatan aktual tetap disimpan. Tampilan memisahkan menit berizin dari izin datang terlambat yang disetujui dan menit tanpa izin; kelebihan dari batas jam izin tetap tanpa izin. Middle tidak menghitung keterlambatan.

Pendaftaran wajah memerlukan persetujuan karyawan serta tinjauan referensi oleh Admin HR lain. Referensi disimpan privat; server mencocokkan selfie hanya dengan referensi pribadi yang disetujui (1:1), bukan mencari identitas di seluruh karyawan. Hasil pencocokan terikat pada konteks permintaan absensi. Pemeriksaan ini bukan liveness yang kuat atau jaminan anti foto; kesalahan pencocokan/kendala perangkat tetap memerlukan jalur manual HR dengan alasan dan sumber konfirmasi. Kesiapan layanan, ambang pencocokan, dan perilaku perangkat harus diverifikasi sebelum digunakan operasional.

Absensi memerlukan koneksi. Penolakan kamera/GPS, lokasi belum disetel, radius tidak sesuai, dan upload gagal harus ditampilkan sebagai kegagalan, tanpa catatan berhasil palsu.

## Cuti dan izin

Hak tahunan 12 hari, mulai setelah **3 bulan kalender** bekerja. Tahun pertama prorata **1 hari per sisa bulan**, termasuk bulan hak mulai berlaku meskipun tanggalnya di tengah bulan. Contoh masuk 15 Juli → berhak 15 Oktober → jatah 3 hari. Tahun berikutnya 12 hari; sisa hangus 31 Desember dan tidak dibawa ke tahun berikutnya.

Jenis awal: cuti tahunan, izin pribadi, dan izin sakit. Izin mendukung sehari penuh, datang terlambat, keluar sementara, dan pulang lebih awal. Karyawan mengisi tanggal/jam, alasan, serta lampiran opsional. Syarat tambahan dapat diminta oleh atasan dengan status Perlu dilengkapi.

Sakit atau izin pribadi yang baru dikonfirmasi setelah kejadian dapat dicatat Admin HR untuk karyawan lain melalui pencatatan izin lampau. Tanggal/jam, alasan kejadian, keputusan dan sumber konfirmasi, potongan, serta nama pemberi keputusan eksternal bila berlaku wajib sesuai ketentuan. Catatan ditandai sebagai pencatatan HR dan diaudit; waktu absensi tidak diubah oleh pencatatan izin. Potongan tambahan tahun yang sudah hangus tidak diperbolehkan.

Pengajuan aktif yang sama persis diblokir. Tumpang tindih tanggal dengan pengajuan atau kehadiran lain menampilkan peringatan pada pengajuan, tinjauan, perubahan, dan koreksi; izin beberapa jam dapat berdampingan dengan kehadiran dan tidak diblokir hanya karena tanggal sama.

Atasan menyetujui, menolak, atau meminta informasi. Saat menyetujui, atasan menentukan potongan cuti (0 berarti tanpa potongan), dapat memakai pecahan 0,5 hari. Keputusan dan dampak saldo terlihat oleh karyawan. Saldo tidak boleh kurang dari nol; transaksi persetujuan tidak boleh dihitung ganda.

Hari libur mingguan tetap dicatat per karyawan selain kasir. Pada tahap sederhana ini tidak ada prasyarat jadwal mingguan: jumlah potongan final mengikuti keputusan atasan, bukan perhitungan otomatis dari daftar hari off atau jam izin.

### Perubahan tanggal dan pembatalan

- Pengajuan Menunggu atau Perlu dilengkapi: karyawan dapat mengubah tanggal, alasan, jam izin yang berlaku, serta mengganti atau menghapus lampiran lalu mengirim kembali untuk ditinjau. Lampiran PDF/JPG/PNG/WebP maksimal 5 MB. Pembatalan dapat dilakukan langsung.
- Pengajuan disetujui: perubahan/pembatalan memerlukan persetujuan ulang. Tanggal dan potongan sebelumnya tetap berlaku selama menunggu.
- Perubahan disetujui: potongan lama diganti total baru; selisih dikembalikan atau dipotong satu kali.
- Pembatalan disetujui: potongan dikembalikan ke tahun asal. Pengembalian saldo tahun kedaluwarsa hanya bersifat historis, tidak menjadi saldo tahun berikutnya.
- Pengajuan lintas tahun membebankan potongan ke tahun tanggal terkait. Alokasi per tahun harus terlihat sebelum keputusan.
- Admin HR dapat mengoreksi tanggal, jam izin yang berlaku, dan total potongan atau membatalkan pengajuan disetujui milik karyawan lain, termasuk tanggal lampau, selama tidak ada perubahan menunggu. Alasan wajib dan keputusan eksternal memerlukan nama pemberi keputusan. Koreksi menyimpan riwayat sebelum/sesudah, mengembalikan potongan lama ke tahun asal, lalu menerapkan potongan baru. Saldo tahun kedaluwarsa tidak menjadi hak tahun baru. Hak HR melihat semua pengajuan tidak mengubah kewenangan persetujuan atasan.

## Pengalaman aplikasi

SvelteKit + TypeScript, navigasi SPA, Supabase Auth/Postgres/Storage/Realtime. UI mobile mengutamakan tombol yang nyaman disentuh dan navigasi bawah; tema Neumorphism dengan kontras teks dan status yang tetap jelas. PWA menyediakan manifest, ikon, cache aset aplikasi, dan pemberitahuan versi baru.

Pembaruan data dilakukan tanpa refresh halaman dan data disinkronkan ketika aplikasi aktif kembali. Pembaruan kode diunduh di latar belakang; pengguna memilih menerapkan versi setelah menyelesaikan formulir/selfie. Penerapan versi memuat ulang aplikasi secara internal. Offline tidak berarti boleh mencatat kehadiran tanpa server.

Lonceng notifikasi menampilkan pembaruan pengajuan dengan status belum dibaca yang tersimpan pada akun dan tautan ke pengajuan terkait sesuai hak akses. Pengingat sesi terbuka 8 jam tersedia di dalam aplikasi saat aktif. Push di luar aplikasi bersifat opt-in pada browser/perangkat yang mendukung; izin yang ditolak atau platform yang tidak mendukung tetap memakai lonceng/pengingat di dalam aplikasi. Langganan perangkat dilepas saat logout. Pengingat 8 jam dari server memerlukan penjadwalan, konfigurasi pengiriman, dan pengujian hosted; adanya kode bukan bukti pengiriman perangkat telah berhasil.

Selfie/lampiran berada di bucket privat dengan akses terbatas dan URL sementara. Service worker tidak menyimpan API, data pribadi, atau foto privat ke cache. GPS browser dan selfie tetap merupakan bukti untuk pemeriksaan SPV. Pencocokan wajah privat 1:1 menambah pemeriksaan identitas, tanpa menjamin anti pemalsuan lokasi, liveness, atau pencegahan foto. Cache offline tidak menjadi tempat penyimpanan bukti privat.

## Status implementasi dan batas uji

Repositori memiliki frontend, mode demo lokal, migrasi database, dan Edge Function `hr-api`. Mode demo menggunakan data fiktif browser dan bukan penyimpanan operasional. Snapshot Production/Preview terdahulu mencatat deployment serta login/Dashboard awal; hal tersebut tidak membuktikan perubahan kasir terbaru sudah siap hosted. Rincian dan batas bukti hosted mengikuti [laporan verifikasi hosted](hosted-verification.md). Fitur yang ditambahkan setelah snapshot laporan tersebut tetap memerlukan migrasi/deployment serta pengujian hosted tersendiri. Bukti perubahan kasir 18 Oktober dan pemeriksaan yang masih menunggu dicatat pada [validasi kasir terbaru](cashier-validation-2026-10-18.md); jumlah tes versi lama tidak dipakai sebagai bukti semua perubahan baru.

Hal yang perlu diselesaikan sebelum peluncuran: data outlet/karyawan asli, koordinat/radius outlet, kebijakan penyimpanan selfie, pemantauan kapasitas Supabase, pengujian kamera/GPS pada ponsel outlet, alur lintas akun, dan hosting sesuai penggunaan bisnis. Pembuatan dokumen kontrak, impor Excel massal, perubahan data kerja terjadwal, dan pemrosesan transaksi lintas cabang belum menjadi fitur lengkap versi ini.
