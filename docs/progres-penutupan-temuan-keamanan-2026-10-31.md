# Progres penutupan temuan keamanan — 31 Oktober 2026

Status keseluruhan: **sedang dikerjakan; belum dinyatakan aman atau siap rilis**.

## Baseline eksekusi

| Item | Hasil verifikasi |
| --- | --- |
| Branch / HEAD awal | `codex/preview` / `e2e5e2a61ee8a1d5627c9eb07a656714175ea3c9` |
| Worktree awal | Hanya dua dokumen audit/panduan AS31 untracked; dipertahankan |
| Production / main | Di luar cakupan |
| Supabase Preview | Ref yang diketahui `lypsqrwjzrmuyqtdcegr`; wajib diverifikasi ulang sebelum remote |
| Migration applied | Tidak diubah |
| Hosted data / cleanup faktor | Tidak dihapus/diubah; cleanup nyata tidak dijalankan |
| PVR-02 / perangkat | Ditunda; belum diuji |

## Milestone dan checkpoint

| Milestone | Status | Bukti / catatan |
| --- | --- | --- |
| SEC31-00 — baseline dan reproduksi | PASS | Branch `codex/preview`, HEAD awal `e2e5e2a61ee8a1d5627c9eb07a656714175ea3c9`; dokumen audit/panduan untracked dipertahankan. AS31-01 race direproduksi sebelum fix: tiga rotasi ketika removal tertahan hanya menghasilkan satu channel. Probe mutation dan cleanup receipt memiliki fixture regression lokal; tidak ada hosted mutation. |
| SEC31-01 — AS31-01 Realtime rotation | PASS (unit + live-mock) | `realtime-recovery.test.ts`: 25/25. Rotasi1/2/3 dengan removal tertahan/reject membuat channel terbaru satu-satunya aktif dan event memicu read. Browser SDK: form/kamera/selfie bertahan; delayed removal, terminal close/reconnect dan latest event lulus tanpa polling/focus. Aksi tetap tertahan sampai context tervalidasi; preview cuti tidak meruntuhkan route. |
| SEC31-02 — AS31-02 probe/helper/history | PASS (disposable26); hosted PENDING | Probe memeriksa source allowlist independen tujuh helper, pasangan version/name lokal26 dan Preview26. Mutation `IS NOT NULL`, negasi/always-allow, decoy/comment, expiry/context, role guard, ACL/policy/recovery/RLS dan version mapping ditolak serta dipulihkan. Hosted probe baru hanya read-only setelah deployment. |
| SEC31-03 — AS31-03 receipt cleanup | PASS (Windows lokal); Linux CI PENDING | Dry-run tidak mengubah receipt; completed/failed/partial observations terpelihara; reload/retry memakai manifest/key/factor IDs asli. Write failure/stale writer fail-closed. Faktor nyata tidak dibersihkan. Linux subprocess menunggu CI. |
| SEC31-04 — AS31-04 provider/target/key | PASS (fake provider) | Uji menolak expected envelope hilang, provider ref berbeda, operation key/plan berubah dan faktor ID/type/linkage tidak cocok sebelum list/delete. Save memakai lock dan optimistic revision. Tidak ada faktor nyata dibersihkan. |
| SEC31-05 — AS31-05 Storage final26 | PASS (disposable26) | `authenticator-removal.mjs`: revoked-session SELECT/INSERT/DELETE ditolak dan object/row tetap; sesi valid positive control dapat mengakses object sendiri. Hosted tidak disentuh. |
| SEC31-06 — AS31-05 upgrade/replay | PASS (fixture disposable) | `followup-upgrade-compatibility.mjs`: 18→26 bounded/preflight, actual hosted-style24→26, populated25→26 membandingkan snapshot/linkage recovery serta tujuh RPC receipts sebelum/sesudah. Replay original key/payload diterima sekali pada password-only aal1; payload berbeda ditolak. Historical12/13 dan batas21 tetap preflight fixture terpisah; bukan upgrade Preview. |
| SEC31-07 — AS31-05 browser SDK | PASS (live-mock) | Browser memakai SDK Auth aplikasi untuk rotasi, context gate dan multi-tab WebSocket fixture. Cuti/karyawan mempertahankan node/input; aksi ditolak saat validasi. Kamera live, selfie Blob/preview, Realtime replacement/reconnect, pending replay → rotate → reload → retry exact payload/key lulus. Belum ekuivalen Hosted Realtime/perangkat. |
| SEC31-08 — seluruh gate | PARTIAL PASS; GitHub Linux CI PENDING | Windows lokal: `npm ci`, check0/0, Vitest37/471, database aggregate, legacy harness, historical23 readiness probe, build, live-mock20/20 dan demo-PWA22/22 (skipped0). Browser JSON checker mencari acceptance title dan menolak skip/flaky/unexpected. Windows subprocess test lulus; Linux baru terbukti setelah workflow GitHub selesai. npm audit moderate gate exit0; empat advisory low `deepmerge` tetap. |
| SEC31-09 — Preview/hosted/operator | IN PROGRESS | Supabase identity/history diverifikasi read-only (ref `lypsqrwjzrmuyqtdcegr`, migration26). Vercel project/source branch diverifikasi lewat project link dan CLI read-only; MCP project detail/deployment list menolak (404/403), CLI fallback berhasil. Push/deployment dan hosted read-only probe pending. Cleanup Auth nyata dilarang. Managed `pg_net` owner belum tersedia: inventory/handoff; status OPEN. |
| SEC31-10 — laporan akhir | PENDING | Hasil lokal, deployment, hosted, operator/cleanup dan perangkat dilaporkan terpisah. |

## Catatan perbedaan bukti

- Baseline hosted Preview yang diketahui adalah migration26. Historical12/13 dan batas21 adalah skenario fixture terpisah dan memerlukan preflight yang sesuai; keduanya bukan bukti upgrade Preview aktual.
- Deployment `READY`, tes skipped, maupun probe read-only tidak membuktikan hosted workflow berhasil.
- Tidak ada kredensial atau secret yang diminta/disimpan dalam dokumen ini.

## Catatan eksekusi sementara — 31 Oktober 2026

- Supabase MCP mengonfirmasi kembali Preview `hr-rajaklana-preview`, ref
  `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, status
  `ACTIVE_HEALTHY`, Postgres17.11. Hosted history terdiri dari 26 pasangan; versi
  supervisor hosted mulai `20261025044841`, MFA `20261029032121`, retirement
  `20261030033256`. Belum ada query mutation hosted.
- Upaya Vitest pertama mendapat EPERM pada temp rename di sandbox Windows. Dengan
  `TEMP/TMP` diarahkan ke folder task lokal, reproduksi merah dan regression unit
  berjalan nyata; kegagalan awal bukan dihitung sebagai bug aplikasi.
- SEC31-01 menghapus gate global replacement-pending yang menolak request revision
  baru. Channel lama langsung kehilangan ownership/generation; channel baru dibuat
  hanya dari refresh yang revision-nya masih terbaru/tervalidasi. Completion removal
  lama tidak dapat mengganti channel aktif.
- SEC31-02 helper allowlist dan version/name mapping diverifikasi pada fixture lokal.
  Hosted probe versi baru belum dikirim/dijalankan; hasil lama tetap berstatus historis.
- Cleanup operator hanya memakai faktor sintetis dan fake provider. No real Auth
  factor cleanup, no storage/database reset, no applied migration edit.

### Ringkasan gate lokal terbaru

| Gate | Bukti |
| --- | --- |
| `npm.cmd ci` | Sukses setelah menghentikan server dev yang mengunci binding Windows dan menjalankan clean install di luar blokir DNS sandbox; 186 paket ditambahkan dari lockfile. |
| `npm.cmd run check` | 0 error, 0 warning. |
| `npm.cmd test -- --maxWorkers=1` | 37 file, 471/471 lulus. |
| `npm.cmd run test:database` | Exit 0. Termasuk disposable migration/ACL/RLS/Storage, populated25→26 tujuh receipt RPC, historical18/12/13 preflight, final26, recovery, biometrik/push, operator cleanup Windows, Auth-only/password-only. Tidak ada hosted mutation. |
| `npm.cmd run test:database:legacy` | Exit 0; reset refusal/rollback fixture local; harness menegaskan tidak menjalankan hosted DDL. |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | Exit 0; historical23 probe dua kali, rollback snapshot setara, missing-safe-fixture fail-closed. |
| `npm.cmd run build` | Exit 0; PWA shell/service worker terbangun dari env demo kosong. |
| `npm.cmd audit --audit-level=moderate` | Exit 0 sesudah akses registry; 0 moderate/high/critical, 4 low `deepmerge` di chain Svelte/Vite. `--force` menawarkan downgrade breaking dan tidak dijalankan. |
| Live browser | Full live-mock suite20/20, 0 skipped/flaky/unexpected; kemudian skenario SEC31 follow-up terbaru dijalankan ulang sendiri dan lulus sesudah rotasi ditambahkan saat receipt pending. Report checker memverifikasi acceptance titles. |
| Demo PWA browser | 22/22, 0 skipped/flaky/unexpected; kamera/GPS clock-in dan production PWA offline-shell test lulus. Report checker memverifikasi dua acceptance title. |

### Managed pg_net handoff — draft tidak dikirim

- Scope: Supabase Preview ref `lypsqrwjzrmuyqtdcegr`; Production/main tetap di luar.
- Audit sebelumnya mencatat schema `net` dengan effective `USAGE` untuk anon/authenticated dan 12 function dengan effective `EXECUTE`; extension owner `supabase_admin`. SQL hosted read-only inventory dijalankan kembali setelah deployment sebelum handoff difinalkan.
- Pelaksana yang diperlukan: Supabase managed database owner/platform support yang berwenang sebagai `supabase_admin` atau superuser platform. Jangan mengganti owner, memberi membership atau memakai `service_role` sebagai pengganti owner.
- Runbook yang sudah ada: `supabase/deployment/inspect-network-extension-access.sql` (inventory read-only) dan `supabase/deployment/restrict-network-extension-managed-owner.sql` (operator procedure; bukan migration). Saya tidak menjalankan procedure ini melalui akun biasa.
- After-state: anon/authenticated kehilangan `net` `USAGE/CREATE` dan `EXECUTE` efektif atas semua function; `service_role` mempertahankan exactly existing schema privileges/function execute; pemilik `private.wake_push_worker()` tetap punya `USAGE` dan `EXECUTE` tepat pada `net.http_post(text,jsonb,jsonb,jsonb,integer)`; internal push worker diuji melalui jalur terkendali; tidak ada arbitrary HTTP probe atau antrean yang disapu.
- Handoff/status: **OPEN — managed owner diperlukan** sampai ada owner yang sah, before/after ACL, worker sehat dan inventory ulang pasca-extension upgrade. Ini belum tiket dan belum dikirim ke pihak luar.
