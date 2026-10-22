# Audit hasil pekerjaan terakhir — 22 Oktober 2026

> Pembaruan penutupan 22 Oktober: A22-01 telah diperbaiki dan kedua regresi navigasi notifikasi lulus pada browser live-mock. Rincian implementasi, temuan tambahan A22-02, serta batas bukti lokal/Preview/hosted/perangkat dicatat di [laporan penutupan](penutupan-temuan-audit-2026-10-22.md). Isi di bawah mempertahankan hasil audit sebelum patch sebagai bukti historis.

## Lingkup dan kesimpulan

Branch `codex/preview`, HEAD `53c08ccbe194ea421419bf40717fdb9ed066abdf`. Implementasi terakhir berada di commit `77f81a1`; commit `be7d5c6` dan `53c08cc` memperbarui dokumentasi. Acuan: [audit ulang 21 Oktober](audit-ulang-hasil-perbaikan-tahap-a-2026-10-21.md). `.codegraph/` tidak ada dan tidak dibuat.

Perbaikan W01–W03 bekerja untuk skenario yang sudah diuji. Audit ini menemukan **satu masalah P2 yang masih terbuka pada isolasi recovery antar-minggu**: respons simpan dari minggu A dapat menghapus pending attempt milik minggu B setelah scope planner berubah. Reproduksi mengeksekusi fungsi source aktual dalam VM; alur browser penuh belum bisa diulang karena kendala lingkungan/persetujuan yang dijelaskan di bagian pengujian.

Tidak ada kode aplikasi, migration, deployment, atau data remote yang diubah dalam audit ini. SQL remote hanya SELECT pada catalog dan fixture sintetis yang sudah ada. Laporan ini merupakan berkas baru; harness reproduksi berada di folder ignored `.vercel/audit-oct22/`.

## A22-01 — P2: hasil simpan minggu A menghapus pending recovery minggu B

Lokasi utama: [CashierWeeklyPlanner.svelte:195](../src/lib/components/CashierWeeklyPlanner.svelte#L195). Jalur sukses mempunyai akar yang sama di [baris 144–157](../src/lib/components/CashierWeeklyPlanner.svelte#L144). Scope berubah melalui [baris 25–26](../src/lib/components/CashierWeeklyPlanner.svelte#L25) dan callback navigasi [baris 49–51](../src/lib/components/CashierWeeklyPlanner.svelte#L49).

`save()` menangkap attempt A sebelum `await`, tetapi penyelesaiannya memakai `pendingAttempt`, `drafts`, dan `activeDraftStorageKey` yang mutable. Jika navigasi mengaktifkan minggu B saat RPC A masih berjalan, ketiga nilai itu sudah berasal dari storage B. Respons sukses memanggil `clearAttemptedDrafts(attemptA)` yang selalu menetapkan `pendingAttempt = null` dan memanggil `persistDraft()` pada key aktif B. Cabang penolakan baseline pasti yang ditambahkan pada patch terakhir melakukan hal yang sama pada baris 195–196. Hasilnya, key/payload ambigu B hilang meskipun respons yang baru diterima hanya menjelaskan attempt A.

Tombol navigasi minggu memang disabled selama `saving`, tetapi navigasi di luar tombol itu tetap tersedia. [NotificationCenter.svelte:49](../src/lib/components/NotificationCenter.svelte#L49) dapat melakukan `goto('/assignments?week=...')`, sedangkan page assignments tetap merender planner pada view mingguan yang sama. Callback `afterNavigate` tidak memeriksa `saving` atau identitas operasi yang masih berjalan. Ini merupakan race scope yang sudah ada pada jalur sukses; cabang baru penolakan baseline mengikuti pola mutable yang sama.

### Reproduksi source aktual

Fixture menggunakan satu admin, satu kasir, dua key storage berbeda, dan masing-masing satu draft serta pending attempt yang sah. Minggu A adalah `2026-10-26`, minggu B `2026-11-02`.

1. Aktifkan scope A dan jalankan `save()` dengan promise RPC ditahan.
2. Jalankan callback `afterNavigate` aktual menuju B, lalu aktivasi key B seperti reactive statement Svelte. Pending B berhasil dimuat sebelum respons A selesai.
3. Selesaikan RPC A dengan respons sukses. Ulangi fixture yang sama dengan penolakan `P0001`, HTTP 400, dan pesan baseline yang tepat; refresh memperlihatkan source A yang berubah.
4. Baca kembali storage B dan A setelah handler async selesai.

Hasil kedua varian:

```json
{"mode":"success","weekAfterCompletion":"2026-11-02","B_pending_before":"valid UUID","B_pending_after":null,"B_draft_count":1,"A_still_pending":true}
{"mode":"baseline-conflict","weekAfterCompletion":"2026-11-02","B_pending_before":"valid UUID","B_pending_after":null,"B_draft_count":1,"A_still_pending":true}
```

Expected: hasil A diselesaikan hanya pada scope A; pending/key/payload B tetap persis sama. Actual: draft B masih ada, tetapi pending B telah ditulis ulang menjadi null, sementara pending A tetap berada pada storage lamanya. Ini menghilangkan jalur replay key asli B dan dapat membuat UI mencoba transaksi pengganti sebelum hasil attempt B dipastikan. Audit tidak membuktikan duplikasi data backend terjadi; dampak terkonfirmasi adalah kehilangan recovery attempt yang tidak terkait.

Perintah reproduksi:

```powershell
node .vercel/audit-oct22/planner-scope-repro.mjs
```

Harness membaca source `CashierWeeklyPlanner.svelte`, membuang deklarasi import/reactive untuk lingkungan VM tanpa renderer, dan menjalankan fungsi save/persistence serta callback navigasi tanpa mengubah tubuh fungsinya. Helper draft, classifier error, dan rekonsiliasi juga berasal dari source aktual. Reactive aktivasi storage dijalankan eksplisit setelah navigasi. Ini bukti eksekusi fungsi source, **belum** bukti E2E browser terhadap navigasi notifikasi.

### Alur perbaikan yang disarankan

Tangkap identitas operasi sebelum await: akun, minggu, storage key, generation, dan idempotency key. Setelah await, hasil hanya boleh mengubah state UI jika scope dan attempt aktif masih sama. Jika scope telah berganti, rekonsiliasi storage asal dengan membandingkan key attempt yang tersimpan; jangan memakai state B untuk menulis storage A dan jangan menghapus pending B. Resolusi baseline juga harus memakai source akun yang sesuai dengan operasi asal.

Tambahkan regresi browser yang berpindah A→B lewat navigasi yang benar-benar tersedia saat RPC ditahan. Uji respons sukses dan baseline rejection, B yang sudah memiliki pending ambigu, reload kedua minggu, kegagalan persist, serta pergantian akun. Pending B harus identik dan hanya attempt A yang diselesaikan sesuai bukti server.

## Hasil pemeriksaan perbaikan sebelumnya

| Area | Hasil audit sekarang |
| --- | --- |
| W01, klasifikasi baseline dan replay pada scope yang tetap | Pasangan SQLSTATE/status/pesan dibatasi dengan tepat; payload/key replay tetap diteruskan. Penolakan baseline yang belum memperoleh refresh terbaru tetap menahan pending. Masalah A22-01 berada pada pergantian scope selama operasi berjalan. |
| W02, Auth startup | Listener kini dipasang sebelum fetch pertama; init bersamaan memakai satu promise. Tes terarah `realtime-recovery.test.ts` 10/10 lulus dan suite penuh lulus. Tidak ditemukan defect baru terkonfirmasi pada perbaikan startup. |
| W03, konteks kasus assignment demo | Helper menyelaraskan tanggal/outlet/karyawan/shift pada kasus assignment terbuka; single/batch mengaudit perubahan dan mempertahankan snapshot completed. Tes `cashier-workflows.test.ts` 21/21 lulus. Tidak ditemukan defect baru. |

Fixture W03 menggunakan case key `assignment:<id>` sedangkan pembentuk key aktual untuk sinyal memakai `missing_clockin:<id>`. Karena helper memakai `sourceType`/`sourceId`, ini tidak membuktikan bug helper, tetapi tes tersebut belum membuktikan penggabungan sinyal/kasus pada panel UI. Saat menambah regresi UI, gunakan pembentuk key aktual.

## Verifikasi pada audit ini

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `npm.cmd run check` | Lulus, 0 error / 0 warning |
| `npm.cmd test -- --maxWorkers=1` | Lulus, 25 file / 361 tes; pengulangan memakai TEMP/TMP dalam workspace |
| `npm.cmd run test:database` | Lulus; 17 migration, RPC/RLS/audit, biometric/push |
| Upgrade Preview lokal 15→17 | Lulus |
| Upgrade historis lokal 13→17 | Kegagalan tanpa preflight direproduksi, preflight terbatas dijalankan dua kali, lalu migration 14–17 lulus |
| `npm.cmd run test:database:legacy` | Lulus, termasuk refusal/rollback; tanpa hosted DDL |
| `npm.cmd run build` | Lulus, mode demo lokal dengan URL/key Supabase dikosongkan |
| Reproduksi A22-01 source VM | Dua varian mengonfirmasi pending B hilang; ini keberhasilan reproduksi bug, bukan tes penerimaan |
| Live-mock browser eksplisit, 7 tes | Percobaan gagal pada peluncuran browser sandbox sebelum assertion aplikasi. Server audit untuk browser di luar sandbox tidak berhasil dijalankan karena pemeriksaan persetujuan otomatis mencapai batas penggunaan. Tidak dihitung sebagai alur lulus atau skipped. |
| Demo E2E penuh / PWA desktop | Tidak diulang; bukti pengujian sebelumnya tetap historis |
| Hosted login/workflow / iPhone/iPad-PWA | Tidak dijalankan |
| `git diff --check` | Lulus |

Percobaan unit pertama mengalami EPERM rename cache di temp sandbox dan tidak menjalankan tes. Pengulangan dengan TEMP/TMP di `.vercel/audit-oct22/` menjalankan seluruh 361 tes dan lulus. Browser menghadapi crash named-pipe sandbox; peluncuran server uji yang memerlukan eskalasi tidak dieksekusi karena automatic approval review gagal akibat kuota. Ini batas verifikasi lingkungan, bukan hasil penolakan keamanan terhadap aplikasi. Server Vite khusus audit pada port 5197 sudah dihentikan.

## Pemeriksaan Preview read-only

Supabase terverifikasi sebagai `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, region `ap-southeast-2`, status `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.003`. Ada 17 migration; terakhir `20261021154511_cashier_followup_context_locking`.

Kedua helper `private.sync_roster_followup_context` dan `private.sync_spv_followup_source_context` memiliki `FOR UPDATE OF f`, bukan security definer, dan tidak memiliki EXECUTE langsung bagi anon/authenticated. Ini pemeriksaan catalog, bukan uji concurrency helper aktual.

Fixture sintetis `audit_v05_20261021` berisi dua assignment, dua follow-up, satu audit event, dan nol note dengan marker sementara `v05-%`. Anon/authenticated tidak memiliki USAGE schema. Audit ini tidak mengubah fixture. Bukti sebelumnya tentang dua sesi berlaku pada trigger fixture yang meniru pola migration; **pemanggilan langsung kedua helper production dengan dua sesi belum terbukti**. Harness concurrency terpelihara untuk mengulang bukti fixture tersebut belum tersedia di source yang ikut commit.

Alias `hr-rajaklana-jkt-preview.vercel.app` sekarang menunjuk deployment Git `dpl_ALuGHMyGQVBqBEgTDiwzY5J46xDk`, status `READY`, target Preview, branch `codex/preview`, SHA `53c08ccbe194ea421419bf40717fdb9ed066abdf`. Source cocok dengan HEAD yang diaudit; selisih dari commit implementasi `77f81a1` hanya dokumentasi. Tidak ada deployment baru dibuat oleh audit ini.

Hosted workflow dan iPhone/PWA tetap pending. Metadata Ready maupun source VM tidak dipakai untuk menyatakan login, operasi kasir, kamera/GPS, offline/resume, atau push pada perangkat telah lulus.

## Kesimpulan tindak lanjut

Perbaiki A22-01 dengan resolusi async yang terikat scope asal, kemudian ulangi regresi navigasi in-flight di browser. W02/W03 tidak perlu dibuka kembali berdasarkan hasil audit ini. Pertahankan catatan batas V05, hosted, dan perangkat sampai masing-masing memiliki bukti langsung. Production, branch `main`, migration terpasang, data operasional, dan audit remote tidak berubah.
