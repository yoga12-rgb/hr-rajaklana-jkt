# MFA TOTP: penerapan Preview dan pemulihan akses

Runbook ini mendampingi [panduan kesiapan Production](guide-penutupan-temuan-kesiapan-production-2026-10-27.md). Sasaran penerapan saat ini hanya branch `codex/preview` dan Supabase Preview `lypsqrwjzrmuyqtdcegr`. Dokumen ini **tidak mengizinkan penerapan ke Production atau main**. Periksa identitas aktual proyek dan deployment sebelum setiap tindakan remote.

## Kebijakan akses

MFA wajib bagi Admin HR, Head Baker yang memiliki peran persetujuan, atasan yang ditetapkan untuk karyawan aktif, dan pemegang capability supervisor selain `issue_report`. Keputusan berasal dari data role/penugasan di database, bukan metadata yang dapat diedit pengguna. Kasir biasa dan pelapor masalah tanpa kewenangan lain tetap dapat menggunakan password.

Password benar menghasilkan sesi `aal1`. Akun wajib MFA hanya dapat membuka proses pendaftaran/verifikasi TOTP dan endpoint konteks akses yang sempit; akses data HR, RPC bisnis, Storage, dan API yang menggunakan service key ditolak sampai sesi `aal2` sah. Pendaftaran faktor tanpa verifikasi kode belum cukup. Database memeriksa session yang masih hidup serta faktor TOTP terverifikasi yang terikat pada session tersebut. JWT lama tidak dapat mempertahankan akses setelah session/faktor dicabut.

Minimal password baru adalah 10 karakter; batas 128 karakter serta penolakan beberapa pola mudah ditebak berlaku pada bootstrap, aktivasi, dan reset. Password login yang sudah ada tidak dinormalisasi atau ditolak hanya karena pemeriksaan password baru. Kamus lokal ini **bukan** pemeriksaan seluruh password bocor. Warning leaked-password protection tetap terbuka pada Supabase Free; keputusan paket/risiko untuk go-live harus dicatat tersendiri.

## Urutan rollout Preview

1. Catat SHA, branch, status worktree, ref/URL Supabase, deployment/alias Vercel, dan riwayat migration aktual berdasarkan nama/urutan. Jangan memakai hitungan migration saja untuk menganggap schema kompatibel. Jangan reset, repair history, atau menghapus row/audit.
2. Jalankan check, unit, database/upgrade historis, legacy, build, dependency audit, dan browser live-mock/PWA eksplisit. Probe katalog terbaru harus lulus pada baseline akhir lokal. Suite historical 13 bukan pengganti jalur upgrade Preview aktual; jalur historis menjalankan preflight pada batas yang tepat sebelum migration lama.
3. Pastikan TOTP enroll/verify di konfigurasi Auth Preview aktif. Jangan menonaktifkan MFA/menurunkan pemeriksaan sesi demi meloloskan tes. Jaga minimal satu admin uji yang dapat menyelesaikan enrollment dan rencana penolong sebelum uji recovery.
4. Siapkan artefak frontend/server, Edge `hr-api`, dan migration maju yang telah diuji. Terapkan sebagai satu jendela perubahan terkontrol: SQL baru, Edge Function, frontend/server, lalu verifikasi alias/SHA/ref. Jika platform mendukung deployment bertahap tanpa assignment alias, bangun artefak terlebih dahulu lalu arahkan alias setelah schema dan Edge kompatibel. Jangan membiarkan kombinasi versi sementara dianggap workflow lulus.
5. Tab versi lama akan kehilangan akses data setelah enforcement aktif. Pengguna perlu menerima update/muat ulang dan login/verifikasi kembali. Kegagalan versi sementara harus fail-closed; jangan memberi jalur bypass untuk tab lama. Rollback frontend saja tidak mengembalikan schema/Auth.
6. Jalankan probe katalog Preview terbaru tanpa membaca row HR atau memalsukan JWT. Verifikasi RLS/ACL, guard sesi/faktor, grant endpoint MFA, dan advisor. `pg_net` dimiliki role platform terkelola dan tidak dapat diperketat oleh role migration proyek; tindakan operator pemilik serta buktinya tetap gerbang terpisah dan terbuka sampai benar-benar dilakukan. Jangan menyatakan grant `net` sudah diperbaiki hanya dari kelulusan fixture operator. Owner/internal push tetap harus berfungsi. Status Ready tidak menutup alur hosted.
7. Pada aplikasi Preview, pengguna memasukkan password/kode sendiri. Buktikan enrollment/challenge, OTP salah→retry, reload, dua tab, akun nonaktif, perubahan akun, password reset, akses Storage, dan penolakan direct RPC/API dari `aal1`. Catat hanya hasil nonrahasia.

## Penggunaan normal

Setelah password, akun wajib MFA diarahkan ke halaman verifikasi dua langkah. Akun yang belum mempunyai TOTP terverifikasi memindai QR atau memasukkan kunci setup ke aplikasi autentikator, kemudian memasukkan kode yang berlaku. Jangan membagikan QR, kunci, atau kode. Halaman membersihkan material setup ketika ditutup, logout, atau akun berubah. OTP yang salah dapat dicoba lagi; jangan membuat faktor baru setiap kali kode salah.

Setelah faktor utama aktif, tambahkan autentikator cadangan melalui halaman keamanan akun bila diperlukan. Simpan autentikator cadangan secara terpisah. Cadangan tetap merupakan faktor TOTP; aplikasi tidak menerbitkan kumpulan recovery code. Faktor sendiri tidak boleh dianggap berhasil dicabut atau sesi aman hanya dari tampilan tombol; refresh konteks dan uji akses setelah perubahan.

## Pemulihan oleh Admin HR lain

Gunakan hanya ketika petugas kehilangan seluruh autentikator. Mengatur ulang password **tidak** menghapus atau melewati kewajiban MFA.

1. Admin HR penolong login dan menyelesaikan MFA sendiri. Konfirmasi identitas petugas melalui prosedur HR yang disepakati di luar akun yang terkunci. Jangan mengandalkan pesan dari nomor baru saja.
2. Buka profil karyawan → **Pulihkan verifikasi dua langkah**. Akun sasaran harus aktif, terhubung Auth, memerlukan MFA, dan berbeda dari admin penolong. Server/database memeriksa seluruh syarat tersebut; tombol bukan sumber otorisasi.
3. Isi alasan dan hasil konfirmasi identitas tanpa mencantumkan password, OTP, kunci TOTP, foto, atau dokumen identitas. Konfirmasikan sekali. Database menyimpan `request_id`, actor, target, alasan, dan snapshot ID faktor awal secara atomik serta menulis audit otorisasi.
4. Edge hanya menghapus ID faktor dari snapshot awal. Faktor yang didaftarkan sesudah permintaan pertama tidak boleh ikut terhapus oleh replay. Penghapusan faktor terverifikasi oleh Auth akan mengeluarkan pengguna dari seluruh sesi aktif; guard database juga memeriksa session/faktor sehingga token lama ditolak.
5. Jika koneksi terputus atau penyelesaian tertunda, gunakan **Coba lagi permintaan yang sama**. Permintaan awal disimpan sebelum pengiriman, terpisah menurut lingkungan, proyek, identitas Auth, dan karyawan admin penolong pada `sessionStorage` tab tersebut. Sesudah reload atau dialog ditutup, pilih **Lanjutkan pemulihan tersimpan**. ID/payload awal dikirim ulang; server tidak mengambil snapshot faktor baru untuk replay. Jangan mengubah alasan atau menekan pemulihan baru karena mengira kegagalan koneksi berarti operasi belum berjalan. Jika penyimpanan gagal, aplikasi memblokir pengiriman.
6. Keberhasilan baru ditampilkan setelah receipt penyelesaian mengikat ID permintaan, karyawan, dan status `completed`. Replay permintaan yang telah selesai tidak memanggil penghapusan faktor kembali. Audit otorisasi/penyelesaian masing-masing ditulis sekali.
7. Petugas login kembali dengan password lalu mendaftarkan dan memverifikasi TOTP baru. Sampai `aal2` baru sah, akses HR/SPV tetap tertutup. Periksa audit dan uji token/sesi lama ditolak; jangan menghapus audit pemulihan.

Hanya satu permintaan pemulihan yang belum dikonfirmasi disimpan untuk satu admin pada tab/lingkungan yang sama. Membuka profil sasaran lain akan menawarkan melanjutkan permintaan awal, bukan menimpanya. Logout/pergantian akun segera menutup dialog dan membuang data pemulihan dari memori; akun berikutnya tidak dapat melihat atau mengirim ulang draft akun sebelumnya. Kembali ke akun asal pada tab yang sama dapat melanjutkan permintaannya. Penyelesaian hanya menghapus draft dengan scope, ID, dan payload yang sesuai dengan receipt berhasil; respons terlambat akun lama tidak boleh membersihkan draft akun baru.

Material TOTP, password, dan token tidak dimasukkan ke draft. Alasan pemulihan tetap merupakan informasi HR, sehingga hindari rincian identitas sensitif dan gunakan perangkat tepercaya. `sessionStorage` tidak menjamin pemulihan setelah tab ditutup, data browser dihapus, atau perangkat berganti. Jika draft hilang saat hasil belum pasti, **jangan langsung membuat permintaan baru**: Admin berwenang perlu memeriksa audit/status permintaan lama melalui prosedur dukungan, lalu meninjau apakah tindakan baru diperlukan. Draft pemulihan fitur operasional lain tetap mengikuti isolasi per akun yang sudah ada.

## Jika satu-satunya Admin HR terkunci

Pemulihan diri sendiri melalui aplikasi ditolak. Jangan membuat SQL dengan klaim JWT buatan, mengubah role agar MFA tidak wajib, menonaktifkan policy, atau menaruh service key di browser.

Pemilik organisasi Supabase yang sah harus menangani insiden melalui dashboard/Auth Admin resmi, dengan akun organisasi yang terlindungi dan prosedur verifikasi identitas independen. Sebelum tindakan, verifikasi proyek Preview, identitas Auth sasaran, dan ID faktor yang benar; simpan catatan insiden berisi pihak yang memverifikasi, waktu, alasan, serta referensi perubahan **tanpa material rahasia**. Penghapusan faktor terverifikasi resmi mencabut sesi aktif. Admin yang pulih kemudian wajib login dan melakukan enrollment TOTP kembali; tidak ada dispensasi MFA sementara.

Tindakan darurat di luar aplikasi tidak menghasilkan receipt RPC pemulihan aplikasi. Jangan menyatakan sebaliknya. Hubungkan catatan insiden eksternal dengan catatan perubahan yang dapat diaudit melalui prosedur HR setelah akses pulih, dan tinjau log Auth yang relevan. Untuk operasional, siapkan admin penolong independen agar jalur darurat tidak menjadi prosedur harian.

## Bukti dan batas status

| Gerbang | Bukti yang dicatat | Tidak cukup untuk menutup |
| --- | --- | --- |
| Implementasi lokal | SHA, perintah, jumlah lulus/gagal/skipped, simulasi race/retry, fixture SQL/Auth/Storage | Membaca source saja |
| Deployment Preview | SHA deployment, alias, ref, nama/urutan migration, versi Edge, probe katalog/advisor | Status Ready saja |
| Workflow hosted | UI→Auth/API→database→reload/sesi kedua→audit dengan akun berwenang | Mock/PGlite atau HTTP 200 saja |
| Perangkat/PWA | Model/iOS/browser, izin, controller/offline/update, kamera/GPS/push/resume | Emulator desktop |

Pengguna telah menunda uji offline/perangkat. Status itu tetap terbuka tanpa menghentikan pengerjaan mandiri. Production/main tidak berubah; aplikasi belum boleh disebut siap operasional penuh hanya dari kelulusan lokal/deployment Preview.

Referensi resmi: [MFA Supabase](https://supabase.com/docs/guides/auth/auth-mfa), [admin deleteFactor dan pencabutan sesi](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor), [kebijakan password](https://supabase.com/docs/guides/auth/password-security).
