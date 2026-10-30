# Progres penutupan tiga temuan autentikator

Tanggal eksekusi: 30 Oktober 2026
Target: branch `codex/preview`, Supabase Preview `lypsqrwjzrmuyqtdcegr` setelah identitas diverifikasi. Production dan `main` tidak disentuh.

Dokumen ini mencatat bukti eksekusi panduan [guide-penutupan-tiga-temuan-autentikator-2026-10-30.md](guide-penutupan-tiga-temuan-autentikator-2026-10-30.md). Tidak ada migration yang sudah applied diedit, tidak ada reset/penghapusan audit atau data operasional, dan tidak ada secret yang ditulis ke repository.

## Ringkasan status

| Milestone | Status | Bukti utama | Sisa |
| --- | --- | --- | --- |
| ARF-00 | selesai lokal | Reproduksi AR-01 baseline, mutation baseline AR-02, inventory fixture AR-03 | Hosted catalog perlu probe ulang setelah rilis |
| ARF-01 | selesai lokal | same-account token rotation mempertahankan `initialized/user`, form/camera contract tetap mounted; race/account switch tetap fail-closed | Smoke sesi pengguna nyata di Preview belum dilakukan pada turn ini |
| ARF-02 | selesai lokal | Probe read-only final + mutation gates ACL, RLS, Storage, history, inherited PUBLIC recovery grant | Hosted probe read-only menunggu SHA rilis |
| ARF-03 | selesai lokal | fixture default aal1 tanpa faktor, session UUID berbeda, legacy aal2 eksplisit, session mismatch/malformed/revoked, suite Storage/API existing | Role workflow hosted belum diuji dengan akun nyata |
| ARF-04 | selesai lokal | operator network, cleanup manifest/dry-run/retry, populated25→26 equality, 18→25, actual24→26, 12→26 preflight | Managed pg_net owner hosted tetap temuan terpisah |
| ARF-05 | selesai lokal | check, unit, database, legacy, historical23, build, audit, demo/PWA, live-mock; semua browser gate tanpa skip/flaky | CI remote menunggu push |
| ARF-06 | menunggu rilis | Source siap dan target sudah dibatasi | Push/CI/Preview probe perlu dilakukan sesudah commit |
| ARF-07 | terbuka sebagian | Tiga temuan memiliki perubahan dan bukti lokal | Hosted/device/PVR-02 dan AUTH-06/AUTH-04 historis tetap dipisahkan |

## ARF-00 — baseline dan reproduksi

- Branch tetap `codex/preview`; HEAD awal `4cafee36d4586e98e3753060b49eaee2a7582418`.
- Baseline lokal berisi 26 migration; migration retirement lokal `20261030031318_retire_application_authenticator.sql`. Tidak ada file migration applied yang diubah.
- Preview yang menjadi sasaran: project `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`. Mapping timestamp hosted yang berbeda dari lokal tetap diperlakukan sebagai mapping, bukan diperbaiki.
- Reproduksi AR-01 di `src/lib/state/realtime-recovery.test.ts` sebelumnya menghasilkan `initialized=false,user=null` saat token akun sama berubah. Reproduksi sekarang dipertahankan sebagai tes red/green dan memeriksa state saat pembacaan employee ditunda.
- Baseline AR-02 sebelumnya menerima grant INSERT operasional, policy employees hilang, predicate Storage `true`, dan nama migration salah dengan jumlah tetap26. Semua skenario dipindahkan menjadi mutation gate pada harness authenticator-removal.
- AR-03 menginventaris default fixture lama aal2/factor dan caller upgrade historis yang membutuhkan MFA eksplisit.

## ARF-01 — state sesi

Perubahan:

- Menambahkan status internal `sessionValidating` dan guard action saat sesi live sedang diverifikasi.
- Token akun yang sama hanya menaikkan generation/revision dan memperbarui context; `clearLiveState` tidak dipanggil sehingga shell, form, draft dan kamera tidak di-unmount.
- Pergantian akun, logout, revoked/malformed/inactive context tetap membersihkan data/channel secara fail-closed.
- Respons token/generation lama tetap diabaikan dan validasi server tetap berjalan sebelum protected read/write.

Bukti:

```text
npm.cmd test -- src/lib/state/realtime-recovery.test.ts --maxWorkers=1
21 tests passed
```

Tes baru memastikan `initialized=true`, user tetap sama dan `sessionValidating=true` selama delayed employee read, lalu kembali false setelah context terbaru sah.

## ARF-02 — probe final dan mutation gate

`supabase/deployment/verify-authenticator-removed-preview.sql` sekarang:

- memakai `BEGIN READ ONLY` dan ordered 26-name history contract;
- memeriksa helper chain, definer/search_path, tidak adanya `employee_requires_mfa`, dan recovery RPC efektif untuk anon/authenticated/service_role;
- memeriksa 29 public table + Storage RLS, restrictive target authenticated, predicate `session_allowed()` dan menolak predicate always-true/permissive;
- memeriksa ACL SELECT/RPC 11 tabel operasional dan privasi workflow tables;
- mempertahankan tabel recovery historis.

Mutation gate aktif di `supabase/tests/authenticator-removal.mjs` dan dipulihkan setelah setiap skenario:

1. authenticated INSERT pada `shift_handovers`;
2. policy `employees` dihapus;
3. policy Storage diubah menjadi `true`;
4. migration foundation diganti dengan count tetap26;
5. grant recovery melalui PUBLIC;
6. RLS employees dinonaktifkan.

Hasil:

```text
Authenticator removal mutation gates OK: ACL, policy, Storage, ordered history, inherited PUBLIC grant and disabled RLS are all rejected and restored
```

## ARF-03 — fixture, sesi, Storage dan API

- `fixtureSession` default sekarang aal1 tanpa faktor dan memakai session UUID baru yang berbeda dari Auth user UUID.
- Baseline historical25 yang memang membutuhkan aal2/faktor memilih `fixtureSession(...,'authenticated','aal2')` secara eksplisit.
- Tes final membuktikan legacy aal2 tetap sah, faktor unverified/deleted tidak menjadi sumber izin, malformed/mismatch/expired session ditolak, dan context tidak memerlukan faktor.
- Suite `database.mjs`, `biometric-push.mjs`, live-mock API dan browser mempertahankan ownership/RLS, selfie/biometric, Storage evidence immutability, transaction/version checks, original key/payload replay dan account isolation.

Bukti fixture:

```text
final fixtureSession is password-only and does not create a factor
session UUID must not equal Auth user UUID
```

## ARF-04 — operator dan upgrade

Operator:

- `supabase/deployment/cleanup-auth-factors.mjs` default dry-run, manifest strict project/user/linkage/fingerprint, hanya TOTP yang sudah dipetakan, tidak menyimpan credential.
- Execute memakai provider yang diinjeksi, delete memakai factor ID asli, partial failure menjadi `failed`, retry melaporkan `already_absent` tanpa sweeping faktor baru.
- `cleanup-auth-factors.test.mjs` lulus untuk dry-run, execute, reload manifest, linkage/fingerprint mismatch dan retry.

Upgrade:

```text
Preview 18→25 upgrade OK
Actual Preview 24→26 upgrade OK
Populated25→26 upgrade OK: recovery/audit/case/roster snapshot equality
Historical 12→26 upgrade OK: migration 13 boundary, preflight, 14–26
```

Populated25→26 membandingkan isi deterministik recovery (`pending/failed/completed`), audit, case, roster, employees dan roles sebelum/sesudah migration26; tidak hanya count.

## ARF-05 — gate yang dijalankan

| Gate | Hasil |
| --- | --- |
| `npm.cmd run check` | 0 error, 0 warning |
| `npm.cmd test -- --maxWorkers=1` | 37 file, 467 test passed |
| `npm.cmd run test:database` | pass: migration/RLS/API/Storage/biometric/push/operator/cleanup/upgrade |
| `npm.cmd run test:database:legacy` | pass; known legacy reset terisolasi |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | pass historical23 rollback/equality |
| `npm.cmd run build` | pass SPA/PWA production build |
| `npm.cmd audit --audit-level=moderate` | command selesai; 4 low transitive dependency advisories, tidak diperbaiki dengan breaking `--force` |
| Demo/PWA browser | 22 passed, 0 skipped/unexpected/flaky |
| Live-mock browser | 18 passed, 0 skipped/unexpected/flaky |

Demo/PWA dijalankan pada production build lokal dengan URL/key Supabase kosong. Live-mock dijalankan terpisah pada dev server dengan `PUBLIC_SUPABASE_URL=http://127.0.0.1:54329` dan key fixture; tidak ada hosted credential.

## ARF-06 — rilis Preview (checkpoint berikutnya)

Sebelum push, verifikasi ulang branch/ref/project/target team dan review staged diff. Push hanya `codex/preview`; jangan replay migration26 atau menjalankan preflight historis pada Preview baseline26. Setelah CI selesai, catat SHA, run, deployment URL/ref dan jalankan probe final hosted `READ ONLY`.

## ARF-07 — status dan item terbuka

Tiga temuan dapat ditutup pada level implementasi lokal setelah SHA rilis dan hosted probe cocok. Status yang tidak boleh digabung:

- Hosted user workflow/role/Storage nyata: belum diklaim pada checkpoint ini.
- PVR-02 iPhone/iPad, offline/update/tab lama: ditunda pengguna dan tetap terbuka.
- AUTH-06 effective TOTP toggle Preview: perlu verifikasi scoped terpisah; endpoint `/auth/v1/settings` bukan bukti.
- AUTH-04 cleanup historis: observed absence tidak sama dengan bukti freeze/drain/manifest masa lalu.
- Managed pg_net hosted ACL: tetap temuan owner-managed terpisah.

Tidak ada status “Production ready” dari dokumen ini.
