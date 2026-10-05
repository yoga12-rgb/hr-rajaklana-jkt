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

Durasi kerja **8 jam termasuk istirahat**. Tidak ada clock istirahat. Kasir memilih shift saat masuk:

| Shift | Jam awal default | Target akhir | Keterlambatan |
| --- | --- | --- | --- |
| Pagi | 07.00 WIB | 15.00 WIB | Dari jam awal outlet, dengan toleransi outlet |
| Sore | 15.00 WIB | 23.00 WIB | Dari jam awal outlet, dengan toleransi outlet |
| Middle | Clock in aktual | Clock in + 8 jam | Tidak dihitung |

Middle hanya tersedia bagi karyawan yang diizinkan HR. Jam awal Pagi/Sore, toleransi, dan jam operasional dapat diatur per outlet. Jam operasional tidak otomatis menjadi jam masuk semua kasir.

Clock in wajib lokasi perangkat dalam radius outlet, akurasi GPS memadai, dan selfie baru dari kamera. Clock out memeriksa lokasi lagi tanpa selfie. Catatan waktu menggunakan waktu database pada mode live, WIB untuk tampilan. Satu sesi terbuka per kasir; clock out mendukung sesi yang melewati tengah malam.

SPV/HR dapat melihat shift, waktu aktual, selfie, jarak/akurasi lokasi, durasi, dan keterlambatan. Shift tidak diubah kasir setelah masuk. Koreksi HR memerlukan alasan, tidak untuk catatan sendiri, dan menyimpan jejak catatan asli. HR juga dapat membuat catatan manual untuk kendala lapangan dengan alasan serta sumber konfirmasi; catatan tersebut ditandai manual, bukan diklaim lolos GPS/selfie. Catatan tanpa clock out ditandai belum lengkap. Selisih durasi tidak otomatis menghasilkan lembur atau potongan.

Absensi memerlukan koneksi. Penolakan kamera/GPS, lokasi belum disetel, radius tidak sesuai, dan upload gagal harus ditampilkan sebagai kegagalan, tanpa catatan berhasil palsu.

## Cuti dan izin

Hak tahunan 12 hari, mulai setelah **3 bulan kalender** bekerja. Tahun pertama prorata **1 hari per sisa bulan**, termasuk bulan hak mulai berlaku meskipun tanggalnya di tengah bulan. Contoh masuk 15 Juli → berhak 15 Oktober → jatah 3 hari. Tahun berikutnya 12 hari; sisa hangus 31 Desember dan tidak dibawa ke tahun berikutnya.

Jenis awal: cuti tahunan, izin pribadi, dan izin sakit. Izin mendukung sehari penuh, datang terlambat, keluar sementara, dan pulang lebih awal. Karyawan mengisi tanggal/jam, alasan, serta lampiran opsional. Syarat tambahan dapat diminta oleh atasan dengan status Perlu dilengkapi.

Atasan menyetujui, menolak, atau meminta informasi. Saat menyetujui, atasan menentukan potongan cuti (0 berarti tanpa potongan), dapat memakai pecahan 0,5 hari. Keputusan dan dampak saldo terlihat oleh karyawan. Saldo tidak boleh kurang dari nol; transaksi persetujuan tidak boleh dihitung ganda.

Hari libur mingguan tetap dicatat per karyawan selain kasir. Pada tahap sederhana ini tidak ada prasyarat jadwal mingguan: jumlah potongan final mengikuti keputusan atasan, bukan perhitungan otomatis dari daftar hari off atau jam izin.

### Perubahan tanggal dan pembatalan

- Pengajuan belum disetujui: karyawan dapat mengubah tanggal atau membatalkan langsung.
- Pengajuan disetujui: perubahan/pembatalan memerlukan persetujuan ulang. Tanggal dan potongan sebelumnya tetap berlaku selama menunggu.
- Perubahan disetujui: potongan lama diganti total baru; selisih dikembalikan atau dipotong satu kali.
- Pembatalan disetujui: potongan dikembalikan ke tahun asal. Pengembalian saldo tahun kedaluwarsa hanya bersifat historis, tidak menjadi saldo tahun berikutnya.
- Pengajuan lintas tahun membebankan potongan ke tahun tanggal terkait. Alokasi per tahun harus terlihat sebelum keputusan.

## Pengalaman aplikasi

SvelteKit + TypeScript, navigasi SPA, Supabase Auth/Postgres/Storage/Realtime. UI mobile mengutamakan tombol yang nyaman disentuh dan navigasi bawah; tema Neumorphism dengan kontras teks dan status yang tetap jelas. PWA menyediakan manifest, ikon, cache aset aplikasi, dan pemberitahuan versi baru.

Pembaruan data dilakukan tanpa refresh halaman dan data disinkronkan ketika aplikasi aktif kembali. Pembaruan kode diunduh di latar belakang; pengguna memilih menerapkan versi setelah menyelesaikan formulir/selfie. Penerapan versi memuat ulang aplikasi secara internal. Offline tidak berarti boleh mencatat kehadiran tanpa server.

Selfie/lampiran berada di bucket privat dengan akses terbatas dan URL sementara. Service worker tidak menyimpan API, data pribadi, atau foto privat ke cache. GPS browser dan selfie adalah bukti untuk pemeriksaan SPV; keduanya bukan pengenalan wajah atau jaminan anti pemalsuan lokasi.

## Status implementasi dan batas uji

Repositori memiliki frontend, mode demo lokal, migrasi database, dan Edge Function `hr-api`. Mode demo menggunakan data fiktif browser dan bukan penyimpanan operasional. Koneksi, deployment, dan uji menyeluruh pada proyek Supabase hosted masih perlu dilakukan sebelum pemakaian produksi.

Hal yang perlu diselesaikan sebelum peluncuran: data outlet/karyawan asli, admin awal, koordinat/radius outlet, kebijakan penyimpanan selfie, pemantauan kapasitas Supabase, pengujian kamera/GPS pada ponsel outlet, dan hosting sesuai penggunaan bisnis. Pembuatan dokumen kontrak, impor Excel massal, perubahan data kerja terjadwal, dan pemrosesan transaksi lintas cabang belum menjadi fitur lengkap versi ini.
