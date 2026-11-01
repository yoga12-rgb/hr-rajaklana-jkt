# Indikator proses aplikasi — 1 November 2026

Permintaan: tampilkan loading saat tombol login diklik dan pada fitur yang memerlukan proses, agar pengguna mengetahui bahwa aplikasi sedang bekerja.

## Implementasi

- Spinner seragam melalui `aria-busy` pada tombol yang sedang menjalankan aksi. Tombol yang hanya dinonaktifkan karena validasi tidak dianggap sedang memproses.
- Label menjelaskan proses yang berjalan, misalnya Memeriksa akun, Menyimpan, Mengirim, Mengunggah foto, Memeriksa lokasi, dan Memeriksa hasil.
- Login menahan submit ganda, termasuk event submit melalui Enter, sampai autentikasi dan pemuatan akun selesai. Kegagalan mengembalikan tombol ke keadaan siap dicoba kembali.
- Pengajuan/keputusan cuti dan koreksi, jadwal harian/mingguan, perencanaan, tindak lanjut SPV, operasional outlet, dan penyimpanan data karyawan/organisasi/profil memakai indikator sesuai aksinya.
- Proses kamera, selfie, GPS, dan referensi wajah tetap menggunakan validasi semula. Notifikasi, tautan undangan, clipboard, keluar akun, dan pembaruan PWA juga memberikan umpan balik.
- Tombol keputusan berpasangan dan save/retry membedakan aksi yang sedang berjalan. Replay mingguan menampilkan loading saat pemeriksaan sesi sebelum mengulang payload/key asli; hasil async tetap diperiksa menurut akun dan scope asalnya.
- Gerak spinner berhenti ketika perangkat meminta reduced motion; teks proses tetap tampil. Login menyertakan pengumuman status bagi pembaca layar.

Tidak ada perubahan store/API/backend, migration, paket, data, RLS, atau aturan bisnis. Tidak ada jeda buatan agar loading tampak lebih lama.

## Bukti validasi lokal

Artefak sintetis yang diabaikan Git: `.codex-test-tmp/loading-ux-20261101/`.

| Pemeriksaan | Hasil |
| --- | --- |
| Svelte/TypeScript | PASS — 0 error, 0 warning |
| Unit | PASS — 474 tes, 37 berkas |
| Build SPA/PWA | PASS |
| Login dengan respons ditahan, gagal lalu retry | PASS; spinner, disabled, submit ganda, pemuatan akun, reduced motion, dan lebar ponsel diperiksa |
| Screenshot login ponsel 390 × 844 | PASS — spinner dan teks terlihat, tidak ada overflow horizontal |
| Semua live-mock | PASS — 27 tes, 0 skipped/flaky/unexpected; checker BR01–BR11 lulus |
| Semua demo/PWA | PASS — 22 tes, 0 skipped/flaky/unexpected; checker PWA/kamera/GPS lulus |
| Whitespace diff | PASS |

Tes tambahan berada di `tests/live-mfa.spec.ts` (nama historis suite password-only); tidak menambahkan autentikator. Tes roster yang menahan respons juga memeriksa spinner pada tombol simpan serta kontrol lain yang dinonaktifkan tanpa indikator proses palsu.

Run live-mock awal tidak dipakai sebagai bukti kelulusan: Vite mendeteksi HTML rekaman tes dan hasil build lalu memuat ulang halaman. Run berikutnya memindahkan artefak ke direktori temp di luar proyek. Satu fixture lama masih gagal karena hanya memberi 503 sekali; SDK mengulang GET dan berhasil membaca commit, sehingga aplikasi sah menyelesaikan rekonsiliasi. Fixture diperbaiki untuk menolak semua read selama rekonsiliasi, menunggu tombol retry siap, memeriksa attempt asli di penyimpanan, lalu memulihkan jaringan sebelum reload. Tes terarah setelah perbaikan lulus; suite lengkap dijalankan lagi. Assertion key/payload asli dan jumlah commit dipertahankan.

Pengujian kamera lokal menggunakan fixture video sintetis 640 × 640 yang sudah tersedia karena perangkat kamera palsu Edge native menghasilkan frame 2 × 2. Validasi kamera/GPS/biometrik aplikasi tidak dilemahkan.

## Publikasi dan batas bukti

- Implementasi lokal dan regresi browser: selesai, lulus.
- Preview/Production: perubahan ini belum dipublikasikan pada saat dokumen dibuat.
- Workflow hosted dengan akun nyata: belum diuji untuk perubahan ini.
- iPhone/PWA/perangkat nyata dan uji offline yang sebelumnya ditunda: tetap belum dibuktikan. Hasil browser lokal tidak menggantikan uji perangkat.
