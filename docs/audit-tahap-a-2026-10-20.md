# Audit Tahap A kasir dan SPV

Tanggal audit: **20 Oktober 2026 (WIB)**.

Source yang diperiksa: branch `codex/preview`, HEAD `77621e875a9aa3f1b87331baa884e72528f5ec7c`, dibandingkan baseline `94cd99326a2d34c836a8ef1a385eeebff5c126cb`. Working tree bersih saat audit dimulai. Tidak ada indeks `.codegraph/`.

**Hasil: 7 temuan terkonfirmasi — 1 P1, 5 P2, dan 1 P3.** Implementasi belum layak disebut tuntas. Prioritas pertama adalah mencegah penimpaan jadwal dari draft lama, kemudian memperbaiki pemulihan Realtime dan pengelolaan tindak lanjut.

Audit memakai inspeksi source, browser Edge dengan data demo terisolasi, SDK Supabase yang terpasang, serta database PGlite lokal dengan seluruh migration asli. Tidak ada source aplikasi, database hosted, atau deployment yang diubah. File ini adalah laporan hasil audit.

## Ringkasan temuan

| ID | Prioritas | Temuan | Lokasi utama |
| --- | --- | --- | --- |
| A01 | P1 — tinggi | Draft lama dapat menimpa perubahan SPV lain tanpa konflik | `src/lib/components/CashierWeeklyPlanner.svelte:93–94` |
| A02 | P2 — sedang | Kanal Realtime yang tertutup tidak dapat dipulihkan dengan instance yang sama | `src/lib/state/app.ts:172–184` |
| A03 | P2 — sedang | Tindak lanjut terbuka tidak dapat diselesaikan setelah sinyal sumber hilang | `src/lib/components/CashierSpvPanel.svelte:88–89` |
| A04 | P2 — sedang | Kasus tetap terikat outlet/shift lama setelah sumber dipindahkan | `supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql:264–272` |
| A05 | P2 — sedang | Notifikasi mingguan kasir membuka hari Senin, bukan jadwal yang berubah | `src/routes/(app)/assignments/+page.svelte:13–21` |
| A06 | P2 — sedang | Status HTTP RPC hilang sehingga sebagian kegagalan ambigu tidak direkonsiliasi | `src/lib/state/app.ts:118–119` |
| A07 | P3 — rendah | Server masih membuka kasus durasi yang sudah sepenuhnya dijelaskan izin | `supabase/migrations/20261019061522_cashier_spv_weekly_roster.sql:242–243` |

## A01 — Draft lama dapat menimpa perubahan SPV lain

**Bukti:** reproduksi browser Edge pada Vite demo lokal. Jadwal kasir A pada 4 Januari 2027 awalnya Pagi. Admin mengubahnya menjadi draft Sore. State kemudian diperbarui untuk menyimulasikan perubahan dari SPV lain: penugasan yang sama menjadi Middle dengan `updatedAt` baru. UI sempat menampilkan satu konflik. Setelah admin mengubah satu sel kasir lain, konflik hilang dan penyimpanan dua perubahan berhasil. Jadwal Middle tertimpa Sore.

`buildChanges()` mengambil `id` dan `expectedUpdatedAt` dari `existingFor()` saat perubahan dihitung ulang. Draft hanya menyimpan shift/outlet, sehingga versi awal saat pengguna mulai mengedit tidak dipertahankan. Setelah refresh/Realtime atau pemulihan draft, versi baru dapat ikut dikirim sebagai versi yang seolah sudah ditinjau admin.

**Dampak:** pemeriksaan versi server dapat lolos walaupun pengguna masih bekerja dari draft lama. Perubahan shift, outlet, atau pembatalan oleh SPV lain dapat tertimpa tanpa persetujuan ulang.

**Perbaikan:** simpan identitas dan versi baseline per sel ketika draft pertama dibuat, termasuk baseline kosong. Pertahankan baseline dalam penyimpanan draft dan proses salin minggu. Jika source berubah, minta pengguna meninjau konflik sebelum memperbarui baseline.

**Regresi yang diperlukan:** tab pertama menyimpan draft; tab kedua mengubah jadwal; tab pertama menerima update, mengedit sel lain atau memulihkan draft setelah reload, lalu mencoba menyimpan. Penyimpanan harus ditolak sampai konflik ditinjau dan perubahan tab kedua tetap utuh.

## A02 — Recovery kanal CLOSED memakai instance yang sudah tidak berlaku

**Bukti:** reproduksi Node tanpa koneksi jaringan memakai `@supabase/realtime-js` **2.117.2** yang terpasang. Setelah subscribe pertama, event `phx_close` dipicu pada adapter kanal. SDK melaporkan `CLOSED`, menghapus kanal dari daftar client, lalu menolak subscribe ulang pada instance yang sama:

```text
channel_status: CLOSED
remaining_registered_channels: 0
resubscribe_error: tried to join multiple times. 'join' can only be called a single time per channel instance
```

`scheduleRealtimeRejoin()` memanggil `subscribeRealtimeChannel(target)` pada instance lama. `resumeLiveConnection()` juga memanggilnya sebelum `refresh()`. Variabel `channel` tetap non-null, sehingga alur pembentukan kanal baru di refresh tidak berjalan.

**Dampak:** bila kanal masuk status terminal `CLOSED`, retry menghasilkan exception dan sinkronisasi otomatis dapat berhenti sampai halaman dimuat ulang. Fokus/online juga dapat terhenti sebelum refetch. Temuan ini khusus status `CLOSED`; penanganan transport `CHANNEL_ERROR` oleh SDK merupakan jalur berbeda.

**Perbaikan:** bentuk kanal baru beserta seluruh binding setelah kanal tertutup. Pastikan kegagalan subscribe tidak menghalangi refetch saat aplikasi kembali aktif.

**Mengapa tes lolos:** mock di `src/lib/state/realtime-recovery.test.ts:30–35` mengizinkan subscribe ulang pada instance yang sama. Ia tidak memodelkan larangan join ulang atau penghapusan kanal oleh SDK.

## A03 — Kasus terbuka menjadi riwayat tanpa kontrol penyelesaian

**Bukti:** reproduksi browser Edge demo. Kasus `missing_clockin` dibuat dan diberi penanggung jawab, lalu berstatus `in_progress`. Setelah clock in tepat waktu ditambahkan untuk menyimulasikan pembaruan source, tombol **Selesaikan** hilang. UI menampilkan kasus dalam riwayat dengan teks **Diproses · missing clockin**, tanpa tombol, sementara state kasus tetap `in_progress`.

`resolvedHistory` ditentukan hanya dari hilangnya key dalam daftar sinyal (`CashierSpvPanel.svelte:14`). Bagian riwayat pada baris 88–89 hanya menampilkan teks, termasuk untuk kasus yang masih terbuka.

**Dampak:** penyelesaian masalah operasional yang normal justru membuat SPV kehilangan akses untuk mencatat hasil dan menutup tindak lanjut. Kasus dapat tertinggal sebagai diproses tanpa jalur penyelesaian di aplikasi.

**Perbaikan:** tetap tampilkan kontrol untuk kasus `new`/`in_progress` walaupun sinyal sumber sudah hilang. Tampilkan bahwa source sudah teratasi, lalu izinkan SPV menambahkan hasil dan menyelesaikan kasus secara eksplisit.

## A04 — Outlet/shift kasus tidak mengikuti perubahan source

**Bukti:** PGlite dengan seluruh migration asli dan RPC sebagai role `authenticated`:

1. Buat penugasan lampau tanpa absensi di outlet A/Pagi.
2. Mulai kasus `missing_clockin`, lalu selesaikan.
3. Pindahkan penugasan yang sama ke outlet B/Sore melalui RPC harian.
4. Mulai kembali tindak lanjut dengan referensi source terbaru.

Penugasan menjadi B/Sore, tetapi kasus tetap A/Pagi, berstatus `new`, dan `reopened_count=1`. Query kasus untuk outlet B menghasilkan nol baris.

RPC memvalidasi source terbaru, tetapi jalur existing/reopen tidak memperbarui `outlet_id` dan `shift`. Panel memfilter kasus tersimpan berdasarkan outlet (`CashierSpvPanel.svelte:13`), lalu mencocokkannya dengan sinyal (`:65`). Akibatnya filter outlet B terus menampilkan **Mulai tindak lanjut**; menekannya kembali hanya mengembalikan kasus lama.

**Dampak:** kasus tidak dapat dikelola dari outlet yang benar dan informasi outlet/shift pada kasus menjadi keliru. Kasus yang masih terbuka ketika source dipindahkan juga terkena.

**Perbaikan:** tentukan hubungan identitas kasus dengan perubahan source, sinkronkan metadata yang relevan secara atomik pada jalur reuse/reopen, dan simpan perubahan itu dalam audit. Tambahkan regresi pindah outlet maupun shift untuk kasus terbuka dan selesai.

## A05 — Tautan notifikasi mingguan tidak menampilkan minggu milik kasir

**Bukti:** reproduksi browser Edge demo. Batch jadwal Sore untuk kasir pada Kamis/Jumat, 7–8 Januari 2027, menghasilkan tautan `/assignments?week=2027-01-04`. Saat kasir membuka tautan itu, tanggal terpilih menjadi 4 Januari; tabel menampilkan **Belum ditugaskan / Menunggu HR** dan grid mingguan tidak tersedia.

RPC mengirim notifikasi batch dengan `?week=Senin` (`20261019061522_cashier_spv_weekly_roster.sql:182–189`). Route mengubah tanggal harian menjadi nilai `week`, tetapi tampilan mingguan hanya diberikan kepada admin (`assignments/+page.svelte:49,63`). Kasir tetap difilter pada satu tanggal (`:21`).

**Dampak:** kasir yang membuka pemberitahuan tidak melihat penugasan yang berubah, dan dapat mengira belum mendapat jadwal.

**Perbaikan:** sediakan tampilan minggu yang hanya membaca jadwal akun kasir sendiri, atau arahkan notifikasi ke rincian yang benar-benar menampilkan semua tanggal perubahan. Pertahankan pembatasan data akun lain di server.

## A06 — Wrapper RPC membuang status HTTP sebenarnya

**Bukti:** SDK `createClient()` diberi fetch lokal yang mengembalikan HTTP 500 dengan JSON `{ "message": "Internal Server Error" }`. Hasil SDK mempunyai `result.status=500`, sedangkan `result.error.status` tidak ada. Wrapper aplikasi membaca properti kedua:

```text
http_status_forwarding: {"actual":500,"forwarded":null,"classifiedUncertain":false}
```

Pesan generik tersebut tidak cocok dengan regex transport di `cashier-roster-save-error.ts`. Karena status HTTP hilang, classifier menganggap hasil pasti walaupun tidak ada SQLSTATE yang memastikan rollback.

**Dampak:** pada sebagian error HTTP ambigu, planner tidak menjalankan refresh/rekonsiliasi dan tidak menampilkan arahan retry idempoten yang sudah dirancang. Draft masih dipertahankan, tetapi pengguna tidak mendapat penjelasan bahwa server mungkin telah menyimpan perubahan.

**Perbaikan:** ambil `status` dari hasil RPC top-level dan teruskan pada Error. Uji bentuk respons dari SDK, termasuk HTTP 500 generik dan penolakan SQLSTATE. Tes browser yang hanya memakai abort jaringan tidak menutup kasus respons HTTP ini.

## A07 — Kasus selisih durasi masih dibuat setelah izin menjelaskannya

**Bukti:** PGlite melalui RPC authenticated. Absensi kemarin 07.00–14.00 memiliki durasi 420 menit dan target 15.00. Izin pulang awal mulai 14.00 disetujui. `spv_followup_start('short_duration', ...)` masih membuat kasus baru karena SQL hanya memeriksa `worked_minutes < 480`. Sementara itu, `attendanceDurationReview()` di frontend menghitung selisih yang belum dijelaskan sebesar nol dan tidak menghasilkan sinyal.

**Kondisi pemicu:** tab SPV masih menampilkan sinyal durasi ketika izin baru disetujui di sesi lain; SPV menekan **Mulai** sebelum refetch. Server menerima kondisi yang sudah tidak valid. Setelah refresh kasus berpindah ke riwayat.

**Dampak:** muncul catatan tindak lanjut yang tidak lagi diperlukan. Ini tidak mengubah absensi, saldo, atau keputusan cuti; prioritasnya di bawah penimpaan jadwal dan kasus yang tidak bisa diselesaikan.

**Perbaikan:** samakan validasi ulang server dengan perhitungan selisih setelah izin yang disetujui. Uji persetujuan izin yang terjadi di antara pemunculan sinyal dan pembukaan kasus.

## Hasil pengujian audit

- `npm.cmd run check`: **0 error, 0 warning**.
- `npm.cmd test -- --maxWorkers=1`: **345/345 lulus pada 24 file**.
- `npm.cmd run test:database`: **lulus**, termasuk seluruh **13 migration**, RLS, transaksi/idempotensi batch, serta suite biometrik/push lokal.
- Reproduksi browser terarah: **A01, A03, dan A05 terbukti** pada sesi demo terisolasi. Perubahan source disimulasikan lewat store untuk mewakili data masuk dari sesi lain; ini bukan uji transport Realtime hosted.
- Reproduksi SDK terpasang: **A02 dan A06 terbukti** tanpa request ke proyek Supabase.
- Reproduksi RPC pada PGlite: **A04 dan A07 terbukti**; database hosted tidak disentuh.

Suite yang lulus tidak membatalkan temuan. Beberapa tes memodelkan helper atau mock yang berbeda dari perilaku SDK/UI sebenarnya. Regresi baru perlu menguji urutan tindakan dan bentuk respons yang memicu bug tersebut.

## Koreksi status dan urutan tindak lanjut

Dokumen milestone sendiri masih mencatat **M4 belum selesai** pada `docs/goal-milestone-kasir-spv.md:478`. Uji reconnect jaringan hosted, respons hilang setelah commit pada UI hosted, serta pemulihan dari latar iPhone/iPad masih tertunda. Status rilis Preview yang sebelumnya Ready tidak membuktikan skenario itu telah lulus.

Klaim sebelumnya bahwa M0–M5 sudah selesai sepenuhnya terlalu luas. Setelah audit ini, status yang tepat adalah **fitur telah diimplementasikan dan dirilis ke Preview, tetapi masih memerlukan perbaikan serta penyelesaian verifikasi M4**.

Urutan yang disarankan: **A01 → A02 → A03/A04 → A05/A06 → A07**, lalu ulangi pengujian integrasi dan perangkat. Tahap B tetap sebagai roadmap sampai masalah ini ditangani. Audit ini tidak menjalankan perbaikan, commit, push, atau deployment baru.
