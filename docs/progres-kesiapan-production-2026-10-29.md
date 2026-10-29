# Progres penutupan kesiapan — 29 Oktober 2026

Acuan: [panduan 27 Oktober](guide-penutupan-temuan-kesiapan-production-2026-10-27.md). Catatan ini meneruskan checkpoint historis; hasil lama tidak membuktikan implementasi MFA yang baru. Source awal `b1ddf08057e6c7316cb075f31ad8bb3aa8ca25cb`, branch `codex/preview`. Perubahan kerja belum menjadi bagian dari SHA itu sampai commit dicatat di bawah.

## Baseline yang diperiksa ulang

Pada 29 Oktober, connector mengonfirmasi proyek **hr-rajaklana-preview**, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, `ACTIVE_HEALTHY`, Postgres17.11. Riwayat aktual mempunyai24 migration berurutan, terakhir `sensitive_operational_acl_hardening` versi hosted `20261027031129`. Alias Preview mengarah ke `dpl_J6mmB6rT4kpVCpm6epegNtKUv3Qn`, source `b1ddf08`, branch `codex/preview`. Edge `hr-api` sebelum perubahan ACTIVE v4. Production/main tidak ditulis.

## Checkpoint pekerjaan

| ID | Status checkpoint | Implementasi/bukti | Hosted dan batas bukti | Berikutnya |
| --- | --- | --- | --- | --- |
| M0 | selesai | Identitas/ref, branch/SHA, katalog Auth dan owner extension diperiksa ulang. | Preview24 terkonfirmasi; tidak membaca row HR. | Ulangi identitas tepat sebelum deployment. |
| M1 | selesai pada checkpoint terdahulu | ACL11 tabel telah diperketat migration24; tes direct-DML dan scope RPC tetap dipertahankan. | Perbaikan MFA menambah pembatas sesi, bukan memperluas SELECT/DML. | Probe terbaru sesudah deployment. |
| M2 | implementasi dan verifikasi berjalan | TOTP enrollment/challenge/cadangan, guard sesi/faktor database, server, Storage; password baru; recovery diaudit dan idempotent. | Auth Preview TOTP enroll/verify sudah diaktifkan melalui config push; advisor29 Okt tidak lagi menampilkan insufficient MFA. Ini belum membuktikan login pengguna/MFA hosted. | Suite final, migration25, Edge/frontend Preview, lalu uji pengguna berwenang. |
| M3 | inventory selesai; residual managed extension | [Inventory RPC](security-rpc-inventory-2026-10-27.md) memetakan60 RPC sebelumnya,20 fungsi service/internal, serta endpoint MFA baru. Semua keputusan memelihara role/scope bisnis. | `pg_net`0.20.4 non-relocatable, owner `supabase_admin`; actor connector `postgres` bukan owner/superuser dan tidak punya grant option. | Operator SQL khusus managed owner, bukan migration no-op yang diklaim selesai. |
| M4 | pengujian ulang berjalan | CI memiliki job browser demo-PWA dan live-mock; menolak0 tes/skipped/flaky. Penambahan regresi race akun, downgrade token, scope enrollment, dan replay recovery. | Lokal/mock tidak menutup hosted. | Catat angka final dari source yang dibekukan. |
| M5 | terbuka, perangkat ditunda | Pengerjaan mandiri dilanjutkan. | SPV-11 dua identitas, Auth/Storage nyata, PWA hosted/controller/offline/update dan iPhone belum dibuktikan untuk versi MFA. | Pengguna memasukkan password/OTP hanya di aplikasi setelah rilis Preview. |
| M6 | fixture/prosedur lokal, gerbang rilis terbuka | Upgrade baseline Preview24 dan historis12/13 dibedakan; preflight13 sebelum14, preflight21 sebelum22. [Prosedur cutover](production-cutover-plan.md). | Belum ada backup/restore Production yang dilatih atau upgrade Production. | Uji salinan aman dan keputusan paket/gate sebelum rilis. |
| M7 | NO-GO operasional penuh | Gate harus dibuktikan terpisah. | Preview pilot hanya setelah artefak kompatibel; Ready bukan bukti workflow. | Tidak merge/push main atau merilis Production pada tugas ini. |

## Koreksi inventory historis

Catatan27 Okt menyebut tidak ada fungsi **public** yang mereferensikan `net.*`. Pencarian itu tidak mencakup dependency dinamis `private.wake_push_worker()`, yang memang memanggil `net.http_post`. Karena itu kesimpulan historis “belum ada dependency aplikasi” tidak berlaku. Memindahkan atau mencabut semua akses extension secara spekulatif dapat memutus push worker.

`pg_net` tercatat terpasang di namespace extension `public`, tetapi12 routine HTTP/worker berada di schema `net`. Owner seluruh routine dan schema adalah `supabase_admin`. Query katalog menunjukkan actor `postgres` bukan anggota owner dan tidak memiliki `EXECUTE WITH GRANT OPTION`; mengeluarkan GRANT/REVOKE dari actor ini tidak cukup untuk menutup ACL. Skrip operator harus menolak sebelum mutasi jika hak tidak cukup dan memverifikasi hasil akhir. Tidak ada manipulasi role/history untuk mengatasi batas platform.

Berbeda dengan grant extension, konfigurasi hosted `supautils.policy_grants` secara eksplisit memberi `postgres` kewenangan mengelola policy `storage.objects`. Ini menjelaskan mengapa pembuatan restrictive policy Storage pada migration25 tetap didukung walaupun actor bukan pemilik tabel. Delegasi ini hanya untuk operasi policy, bukan grant routine `net`. [Dokumentasi resmi supautils](https://github.com/supabase/supautils#table-ownership-bypass).

Risiko ini tetap terbuka dengan pemilik tindak lanjut **operator organisasi/platform Supabase**. Batas akses Data API/schema serta tidak adanya public RPC penerus HTTP harus ditinjau ulang sesudah perubahan extension. Jangan menyebut grant sudah diperketat hanya karena SQL berhasil/no-op. Dukungan relokasi versi ini `false`, sehingga extension dipertahankan sementara. Referensi [advisor extension](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

Performance advisor29 Okt mencatat48 FK tanpa index pendukung,26 index belum digunakan, dan1 tabel tanpa primary key. Ini dipisahkan dari keputusan otorisasi. Tidak ada index/audit yang dihapus atau diubah berdasarkan linter semata; query plan dengan data representatif dan retensi audit belum diuji. Pemilik tindak lanjut: pemelihara database sebelum peningkatan volume operasional.

## Keamanan akun dan pemulihan

Kewajiban MFA dihitung dari data database: Admin HR, role Head Baker pemberi persetujuan, atasan karyawan aktif, serta capability supervisor selain pelapor biasa. Kasir tanpa kewenangan tersebut tetap password. Guard memperiksa signed claims dan `auth.sessions` yang terikat pada pengguna; sesi privileged juga memerlukan `aal2` dan faktor TOTP terverifikasi yang masih ada. Endpoint konteks sempit dipakai sebelum membaca data aplikasi. Tidak ada otorisasi berdasarkan `user_metadata`.

Recovery tidak memberi dispensasi MFA. Admin penolong harus `aal2`, tidak boleh memulihkan diri, dan alasan/audit dipertahankan. Snapshot ID faktor dan key/payload awal dipakai pada retry; faktor baru tidak ikut terhapus replay. Lihat [runbook MFA](mfa-rollout-recovery.md) untuk rollout dan insiden satu-satunya admin.

Leaked-password protection tetap terbuka pada Free. Minimum10 karakter, batas128, kamus kecil pola mudah ditebak, rate limit/token sekali pakai dan MFA adalah kontrol kompensasi, bukan padanan layanan password bocor. Tidak ada upgrade berbayar. [Dokumentasi password Supabase](https://supabase.com/docs/guides/auth/password-security).

## Log pengujian dan deployment final

Bagian ini diisi dari hasil final setelah perubahan kode stabil. Setiap kegagalan reproduksi, sandbox, skipped, dan keterbatasan hosted tetap dicatat, bukan diganti klaim Ready.

Checkpoint lokal final browser: `E2E_LIVE_SUPABASE_MOCK=1`, `E2E_BASE_URL=http://127.0.0.1:5198`, fake Supabase URL `http://127.0.0.1:54329`, fake publishable key fixture, `npm.cmd run test:e2e -- 'live-.*\.spec\.ts' --output=test-results/live-final --reporter=line,json --forbid-only --retries=0`. JSON `test-results/live-final-summary.json` membuktikan **25expected/0skipped/0unexpected/0flaky**,168.14detik:14 workflow/replay lama,7 MFA,4 recovery. Server fixture sudah dihentikan sebelum clean install/build. Backend ini mock terisolasi, bukan workflow hosted.

Database final: `npm.cmd run test:database` lulus dengan25 migration,83 public SECURITY DEFINER, upgrade18→25, **aktual Preview24→25**, historis12→25, biometric/push, MFA dan prosedur operator net. Tambahan regresi Storage sesudahnya juga lulus pada `node supabase/tests/mfa-enforcement.mjs`: celah DELETE foto issue sendiri tanpa restrictive policy direproduksi lokal, kemudian ditutup oleh policy; pencabutan faktor memblokir SELECT/DELETE walau JWTaal2 lama masih ada. Ini bukti policy database lokal, bukan pengujian Storage HTTP hosted.

Suite `npm.cmd run test:database:legacy` dan probe historis23 `node supabase/deployment/verify-readiness-preview.test.mjs` lulus. Probe historis tetap berhenti sebelum migration24/25 dan tidak digambarkan sebagai probe MFA terbaru. Probe terbaru25 bersifat katalog/baca-saja, diuji pada dedicated harness MFA.

Sesudah source dibekukan, `npm.cmd ci` berhasil dari lockfile yang tidak berubah; `npm.cmd run check` 0 error/0 warning; `npm.cmd test -- --maxWorkers=1` **41 file/516 tes lulus**; `npm.cmd run test:database` dan legacy/probe historis diulang dan lulus; `npm.cmd run build` berhasil, menghasilkan SPA statis beserta service worker. Build lokal memakai `PUBLIC_APP_ENV=development` dan URL/key backend kosong, sehingga tetap demo terisolasi. Build hosted harus menggunakan environment Preview sendiri.

PWA/demo final memakai `E2E_PWA=1`, `E2E_BASE_URL=http://127.0.0.1:5198`, `PLAYWRIGHT_CHANNEL=msedge`, `npm.cmd run test:e2e -- tests/demo.spec.ts --output=test-results/demo-pwa-msedge --reporter=line,json --forbid-only --retries=0`. JSON `test-results/demo-pwa-msedge-summary.json`: **22 expected/0 skipped/0 unexpected/0 flaky**,96.57 detik. Service worker `activated`, controller, cache hanya shell/aset, respons dinamis tidak dicache, dan shell offline dibuktikan pada build demo lokal. Ini tidak membuktikan PWA hosted melewati proteksi Vercel atau update versi/perangkat nyata.

- Percobaan unit awal saat penambahan regresi:39file/485tes,483lulus/2gagal. Kedua kegagalan berasal dari asumsi tes bahwa `connected` adalah status Realtime; state ini juga menandai jaringan. Assertion dikoreksi untuk menguji pembersihan data/channel, lalu wajib diulang.
- Live-mock awal mereproduksi bug form OTP Svelte: pattern HTML terinterpolasi sehingga submit tertahan. Perbaikannya dan uji ulang dicatat pada hasil final.
- Run browser yang bertabrakan pada direktori artefak sempat menghasilkan ENOENT ketika menutup trace; run gabungan itu dihentikan, proses fokus diselesaikan, lalu run final25 menggunakan direktori hasil tersendiri dan lulus tanpa retry. Tidak ada hasil proses terputus yang dihitung lulus.
- Percobaan demo/PWA dengan channel Chromium tidak dapat membuka browser karena binary Playwright belum terpasang. Proses tersebut dihentikan; uji aplikasi diulang memakai channel Microsoft Edge yang tersedia. Ini kegagalan setup browser, bukan bukti kegagalan alur. CI memasang Chromium secara eksplisit sebelum suite.
- Hambatan auto-review sebelumnya (usage limit) tidak terulang pada turn lanjutan; eksekusi melalui jalur eskalasi resmi berjalan kembali. Tidak ada bypass approval.
- Audit dependency29 Okt:0moderate/high/critical;4low pada rantai build `deepmerge`/Svelte. `npm audit fix --force` menawarkan downgrade breaking dan tidak dijalankan. Temuan low tetap dicatat untuk pemantauan versi/perbaikan upstream; bukan0vulnerability.

## Status penyerahan

Implementasi lokal, deployment Preview, workflow hosted, perangkat nyata, serta rencana/eksekusi Production harus dilaporkan terpisah pada checkpoint final. PVR-02/perangkat tetap terbuka sesuai penundaan pengguna.
