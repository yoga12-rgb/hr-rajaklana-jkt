# Penutupan temuan audit — 22 Oktober 2026

## Lingkup

Branch `codex/preview`, baseline `53c08ccbe194ea421419bf40717fdb9ed066abdf`. Acuan awal: [audit hasil pekerjaan terakhir](audit-hasil-pekerjaan-terakhir-2026-10-22.md), A22-01/P2. Pemeriksaan lanjutan isolasi akun menemukan A22-02/P2 dan turut memperbaikinya. Production dan `main` di luar cakupan.

Tidak ada perubahan migration, DDL remote, RLS, otorisasi RPC, data operasional, atau riwayat audit. Validasi baseline transaksi baru dan payload/key asli replay tetap dipertahankan. Tidak ada data direset untuk meluluskan pengujian.

## A22-01 — respons simpan melintasi minggu/akun

Status implementasi: **ditutup secara lokal**; bukti browser live-mock mencakup sukses dan penolakan baseline pasti. Ini belum merupakan bukti workflow Supabase hosted atau perangkat iPhone.

- Operasi simpan menangkap akun, generation akun, minggu, key storage asal, dan generation planner sebelum await. Feedback dan penanda proses hanya berubah pada operasi/scope yang masih sesuai.
- Penyelesaian memakai record storage asal terbaru. Pemeriksaan identitas pending mencakup idempotency key, fingerprint, serta minggu; attempt pengganti tidak boleh dihapus. Snapshot memori yang berbeda dari storage tidak dipakai untuk menimpa data yang lebih baru.
- Sukses hanya membersihkan sel dengan nilai dan baseline yang cocok. Perubahan baru, draft yang perlu review, serta alasan baru dipertahankan. Penolakan baseline pasti hanya melepas pending setelah refresh akun asal membuktikan source berubah; draft/alasan tetap untuk review.
- Kegagalan read/parse/write storage mempertahankan pending. Tidak ada fallback yang menulis snapshot lama. Pengamat hanya diberitahu setelah persist berhasil; remount dalam window yang sama ikut disinkronkan supaya navigasi berikutnya tidak menghidupkan kembali pending lama.
- Rekonsiliasi tidak memakai jadwal akun lain. Pergantian A→B→A selama refresh juga terdeteksi. Callback replay yang telah diselesaikan request lain tidak mengeluarkan pesan retry/storage error yang sudah tidak relevan.
- Parser attempt mempertahankan bentuk dan urutan properti payload yang telah divalidasi. Sebelumnya rekonstruksi properti dapat mengubah fingerprint setelah persist/reload berikutnya. Regresi tiga siklus membuktikan payload, fingerprint, dan key tetap sama.

Source utama: `src/lib/components/CashierWeeklyPlanner.svelte`, `src/lib/cashier-spv-drafts.ts`. Tidak ada perubahan signature RPC maupun classifier penolakan baseline.

### Bukti reproduksi dan penerimaan

Audit awal menahan RPC A, menjalankan callback navigasi ke B dengan pending sendiri, lalu menyelesaikan A. Sukses maupun penolakan baseline menghapus pending B dan meninggalkan pending A. Bukti awal tersebut tetap tercatat di laporan audit; harness ignored historis bukan tes penerimaan patch.

Tes terpelihara sekarang:

- `src/lib/cashier-spv-drafts.test.ts`: 29 tes, termasuk CAS identitas, replacement, storage read/write/remove gagal, record rusak/hilang, draft terbaru, listener/remount, dan tiga siklus persist/reload.
- `src/lib/cashier-roster-scope.test.ts`: 17 tes menjalankan handler source aktual dalam VM. Hanya import/deklarasi reactive dibuang; aktivasi scope dijalankan eksplisit. Meliputi A→B, A→B→A, remount, dua request bersamaan, replacement, akun berubah sebelum/selama refresh, gagal persist lalu retry key/body sama, serta callback sukses/401/network setelah attempt sudah selesai.
- `tests/live-cashier-roster-ambiguous.spec.ts`: 9 tes browser live-mock, tanpa skipped. Dua regresi baru membuat pending B lewat transport failure yang belum commit, menahan simpan A, membuka notifikasi asli ke B saat A berjalan, lalu melepas sukses/penolakan baseline A. Storage B dibandingkan byte-identik, kedua minggu direload, dan B direplay dengan key/body asli hingga satu commit untuk attempt B.

VM membuktikan handler dan lifecycle lokal; browser membuktikan renderer, navigasi notifikasi, persistence, reload, retry, serta pemanggilan SDK ke REST mock. Keduanya tidak menggunakan DB Supabase hosted.

## A22-02 — logout background A menghapus login B

Status implementasi: **ditutup secara lokal**. Pemeriksaan source/SDK aktual `@supabase/supabase-js@2.117.2` mereproduksi logout otomatis akun A yang ditunda, disusul `SIGNED_IN` B; saat logout A selesai SDK menghapus sesi B dan memancarkan `SIGNED_OUT`. Ini terpisah dari startup listener/initPromise yang sudah diperbaiki sebelumnya.

`refreshNow()` sekarang menolak akun hilang/nonaktif dengan `clearLiveState` dan revision guard, tanpa menjalankan `auth.signOut()` sebagai efek validasi background. Akses aplikasi tetap ditolak, data akun dibersihkan, dan RLS/RPC tetap berlaku. Logout atas permintaan pengguna tetap berjalan. Mengganti logout menjadi scope local tidak akan menyelesaikan race penghapusan sesi browser setelah await.

Regresi terpelihara `src/lib/state/realtime-recovery.test.ts` berisi 14 tes: 10 tes sebelumnya, dua penolakan akun missing/inactive, pergantian login setelah validasi A tertunda dengan mock cleanup SDK yang dapat menghapus B, serta logout eksplisit. Reproduksi SDK aktual adalah pemeriksaan lokal; regresi otomatis menggunakan client mock, bukan hosted Auth.

Rujukan semantik SDK: [Supabase signOut](https://supabase.com/docs/reference/javascript/auth-signout), [Signing out](https://supabase.com/docs/guides/auth/signout). Index changelog `.md` tidak dapat diambil melalui web tool (content-type tidak didukung) dan koneksi shell sandbox gagal DNS; panduan/signature signOut diverifikasi melalui MCP dokumentasi serta source SDK terpasang. Tidak ada fitur/API Supabase baru ditambahkan.

## Milestone dan verifikasi

| Milestone | Bukti/status |
| --- | --- |
| Q0 identitas/baseline | Branch `codex/preview`; `.codegraph/` tidak ada. Supabase diverifikasi read-only sebagai `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, org `bvwgekyfibloctfslgdf`, ACTIVE_HEALTHY, PG17.11.0.003. Vercel project `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`, account `team_S1Sn08iaksD0GQF4kk49kTkH`, alias Preview dan source branch terverifikasi. |
| Q1 resolusi scope asal | Implementasi dan regresi helper/handler selesai. |
| Q2 replay/reload/failure | Selesai; fingerprint asli dan storage failure tercakup. |
| Q3 browser live-mock | **9/9 lulus**, termasuk dua regresi A22-01 melalui notifikasi asli. Server dan Edge di luar sandbox memakai backend REST mock lokal saja. |
| Q4 isolasi sesi Auth | Selesai; targeted **14/14 lulus**, penolakan akun dan logout eksplisit dipertahankan. |
| Q5 check/unit/build/integrasi | Hasil final dicatat di bawah. |
| Q6 deployment Preview | Menunggu commit/push dan pemeriksaan source deployment final. |
| Q7 hosted/perangkat | Belum diuji; terpisah dari status deployment/local. |

Perintah live-mock eksplisit:

```powershell
$env:PUBLIC_APP_ENV='development'
$env:PUBLIC_SUPABASE_URL='http://127.0.0.1:54329'
$env:PUBLIC_SUPABASE_ANON_KEY='sb_publishable_abcdefghijklmnopqrstuvwxyz'
npm.cmd run dev -- --port 5197 --strictPort
# proses terpisah, workspace TEMP/TMP .vercel/fix-a22/tmp
$env:E2E_LIVE_SUPABASE_MOCK='1'
$env:E2E_BASE_URL='http://127.0.0.1:5197'
npx.cmd playwright test tests/live-cashier-roster-ambiguous.spec.ts --reporter=line
```

Server khusus live-mock dihentikan setelah suite selesai. Hambatan approval kuota pada audit sebelumnya tidak lagi terjadi; server/browser pada pengujian patch mendapat persetujuan eskalasi dan berjalan. Bukti audit lama yang gagal launch tidak ditulis ulang sebagai lulus.

| Pemeriksaan final | Hasil |
| --- | --- |
| Svelte/TypeScript | Lulus, 0 error / 0 warning; diulang setelah patch final. |
| Unit penuh | Lulus **26 file / 401 tes** setelah A22-02. TEMP/TMP berada di folder ignored workspace untuk menghindari EPERM cache sandbox. |
| Database/integrasi lokal | Lulus; 17 migration, RPC/RLS/audit, biometric/push. |
| Upgrade Preview 15→17 lokal | Lulus. |
| Upgrade historis 13→17 lokal | Kegagalan tanpa preflight direproduksi; preflight terbatas dijalankan dua kali, lalu migration 14–17 lulus. Ini berbeda dari upgrade Preview. |
| Known-legacy refusal/rollback | Lulus; harness lokal, tidak ada hosted DDL. |
| Build demo SPA/PWA | Lulus; `PUBLIC_APP_ENV=development`, URL/key Supabase kosong, adapter static dan service worker dibangun. |
| Demo browser/PWA desktop | Lulus **20/20**, tanpa skipped; build lokal port 5198, `E2E_PWA=1`, cache shell/dynamic exclusion/offline dijalankan. Viewport ponsel di Edge adalah emulasi, bukan bukti iPhone. |
| Live-mock | Lulus **9/9**, termasuk persist/reload/retry; no skipped. |
| Hosted business workflow | Belum dijalankan. |
| iPhone/iPad-PWA | Belum dijalankan. |

`npm.cmd run check`, `npm.cmd test -- --maxWorkers=1`, `npm.cmd run test:database`, `npm.cmd run test:database:legacy`, `npm.cmd run build`, serta `git diff --check` lulus. Demo E2E dijalankan dengan `E2E_BASE_URL=http://127.0.0.1:5198 E2E_PWA=1 npx.cmd playwright test tests/demo.spec.ts --reporter=line`. Server build demo juga dihentikan setelah tes selesai.

## Batas bukti yang tetap terbuka

Tidak ada klaim login/workflow hosted, kamera/GPS, push, atau offline/resume iPhone lulus. Deployment Ready dan inspeksi bundle hanya membuktikan rilis/source, bukan alur bisnis. Batas V05 dari audit sebelumnya juga tetap: bukti dua sesi terdahulu memakai trigger fixture sintetis; concurrency kedua helper aktual pada tabel public belum dibuktikan oleh pekerjaan ini dan tidak ditutup dengan tes unit/PGlite.

Production, `main`, dan data/audit operasional remote tetap di luar tindakan patch.
