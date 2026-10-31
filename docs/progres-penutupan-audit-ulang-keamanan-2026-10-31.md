# Progres penutupan audit ulang keamanan — 31 Oktober 2026

Status: **implementasi lokal, Windows/Linux CI, deployment Preview, dan login/
Dashboard hosted terkonfirmasi PASS; perangkat nyata DEFERRED**. Dokumen ini adalah
catatan kerja untuk panduan utama. Completeness machine-readable berada di
[`evidence-sar31-acceptance-2026-10-31.json`](evidence-sar31-acceptance-2026-10-31.json).

## SAR31-00 — baseline, scope, dan reproduksi

| Item | Observasi |
| --- | --- |
| Workspace/repo | `D:\aplikasi-web\rajaklana-hr` / `yoga12-rgb/hr-rajaklana-jkt` |
| Branch/base SHA | `codex/preview` / `4374db8aaedbff187db2adb58d62293b71240a6e` |
| Remote | `origin` mengarah ke repo yang diminta; branch remote diketahui berada di baseline awal saat mulai tugas |
| Worktree awal | Empat dokumen audit/panduan untracked milik pengguna; dipertahankan dan tidak akan ikut staged |
| CodeGraph | `.codegraph/` tidak ada; tidak memakai CodeGraph |
| Toolchain | Node v24.15.0; Supabase JS 2.117.2; Playwright 1.58.x dari lock/package |
| Supabase Preview | MCP mengonfirmasi nama `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, org `bvwgekyfibloctfslgdf`, status `ACTIVE_HEALTHY` |
| History | Tepat 26 ordered migration version/name, latest `20261030033256 / retire_application_authenticator` |
| Migration source | Baseline lokal26 memakai `20261030031318_retire_application_authenticator.sql`; tidak ada migration yang diedit atau diaplikasikan |
| Production/main/data | Di luar scope; tidak ada remote DDL, reset, delete, atau repair history |
| Perangkat | PVR-02/iPhone/PWA nyata tetap DEFERRED |

Red reproductions aktif dipertahankan di unit/PGlite/operator/browser tests. Baseline
retained-UI diperbaiki setelah reproduksi transient read error menghapus shell.
Mutation `has_role` selalu-true, helper/session/literal case, dan recovery body
aktif dijalankan pada fixture disposable lalu ditolak probe dan dipulihkan. Histori
merah browser run-05 dicatat di bawah, tidak disamarkan.

## Matriks acceptance AR31

Setiap baris memakai fingerprint source file group di JSON; sumber yang tidak
berubah setelah gate tetap memakai hash group yang sama. Artifact Playwright JSON
menyimpan hasil tiap browser contract. Probe DB/operator selain itu dibuktikan
oleh test file dan output perintah; tidak ada data/receipt hosted sebagai fixture.

| Acceptance | Sumber/test | Perintah/env | Expected → actual | Source SHA256 | Artifact/status | Dampak remote/residual |
| --- | --- | --- | --- | --- | --- | --- |
| AR31-01 | `realtime-recovery.test.ts`; browser `live-supervisor-followup.spec.ts` BR08 | `npm test -- --maxWorkers=1`; live-mock Windows | UI/form tetap terpasang pada transient 503; mutasi ditolak sampai context terbaru → unit + browser pass, write counter 0 ketika gate tertutup, role cabut tercermin sesudah retry | app `a3441083…d55a41d` | `run-10/reports/live.json`; PASS_LOCAL | Ubuntu CI lulus; login/Dashboard Preview dikonfirmasi pengguna. Role revocation tetap teruji lokal, bukan pada akun hosted |
| AR31-02 | `authenticator-removal.mjs`; verifier exact helper/literal/mutation matrix | `npm run test:database`; PGlite disposable | Uppercase/literal/whitespace/negasi/decoy tidak lolos → mutation aktif ditolak, baseline restore, aggregate pass | database `0f03a44c…716c4a6` | test+probe; PASS_LOCAL | Hosted verifier read-only saja; Ubuntu CI lulus |
| AR31-03 | `authenticator-removal.mjs`; dependency `has_role(text)`, metadata/ACL, non-HR controls | `npm run test:database`; PGlite disposable | Always-true/filter/helper route ditolak → probe menolak mutation dan memulihkan fixture | database `0f03a44c…716c4a6` | test+probe; PASS_LOCAL | Tanpa hosted mutation; Ubuntu CI lulus |
| AR31-04 | `cleanup-auth-factors.subprocess.test.mjs` | `npm run test:database` → `test:auth-cleanup`; native Windows | Dua child writer pada target sama hanya memberi satu lease → subprocess pass, loser tidak melakukan provider I/O | cleanup `14bfd971…acf9d0` | subprocess test; PASS_WINDOWS | Ubuntu Linux subprocess gate lulus; NFS/distributed lock tidak didukung |
| AR31-05 | `cleanup-auth-factors.test.mjs` | `npm run test:database`; native Windows/local store | Project/user/key/ordered plan/CAS terikat; drift/truncation/path tidak mengubah receipt → pass; malformed traversal key ditolak sebelum lock/registry/provider I/O | cleanup `14bfd971…acf9d0` | operator test; PASS_LOCAL | Ubuntu Linux path/locking gate lulus; tidak ada hosted cleanup adapter |
| AR31-06 | cleanup unit + subprocess tests | `npm run test:database`; provider sintetis | partial/list/delete/persist/crash/retry mempertahankan intent/observations dan ID/key asli → pass; ambiguity tetap unknown/already_absent saat observasi | cleanup `14bfd971…acf9d0` | operator test; PASS_WINDOWS | Tidak membersihkan faktor nyata; Ubuntu CI lulus |
| AR31-07 | `authenticator-removal.mjs` Storage ownership/session cases | `npm run test:database`; fixture disposable | Positif→negatif→restored pada user/session sama dan objek tersimpan sesuai ID → pass, evidence referensi tidak berubah | database `0f03a44c…716c4a6` | DB test; PASS_LOCAL | Login/Dashboard hosted terkonfirmasi; hosted Storage policy mutation tidak dijalankan |
| AR31-08 | `followup-upgrade-compatibility.mjs` | `npm run test:database`; populated25→26 fixture | Snapshot tepat sebelum tujuh RPC replay; original key/payload/result dan seluruh bisnis/audit/receipt sama → pass; changed payload dan mutant side effect kedua ditolak | database `0f03a44c…716c4a6` | upgrade test; PASS_LOCAL | Tidak menjalankan replay/upgrade di hosted Preview |
| AR31-09 | Browser BR01–BR11; `check-browser-report.mjs`; `demo.spec.ts` | live-mock 26; demo-PWA 22; checker | SDK form/kamera/Realtime/rotasi/account/replay dan PWA shell diuji → semua contract pass, 0 skipped/flaky/unexpected | app `a3441083…d55a41d`; checker ada di hash database | `run-10/reports/live.json`, `run-11/reports/demo-pwa.json`; PASS_LOCAL | Ubuntu CI dan login/Dashboard hosted lulus; iPhone/PWA nyata tetap DEFERRED |
| AR31-10 | `authenticator-removal.mjs`; `live-mfa-recovery.spec.ts` | database aggregate + live-mock | Dua recovery RPC tombstone, metadata/ACL, SQLSTATE 0A000/no mutation, route HTTP410 → pass; tidak ada MFA API | database `0f03a44c…716c4a6` | `run-10/reports/live.json`; PASS_LOCAL | Tanpa faktor Auth nyata |

## Checkpoint berurutan

| Milestone | Status | Bukti checkpoint |
| --- | --- | --- |
| SAR31-00 | PASS | Identitas branch, toolchain, Supabase Preview, history26, scope dan reproduksi terdokumentasi; tidak ada remote mutation |
| SAR31-01 | PASS | Same-account retained shell; transient read error menutup private mutation gate; retry mengambil role terbaru; 401/403/42501 tetap fail-closed |
| SAR31-02 | PASS_LOCAL | Exact helper source contracts, dependency `has_role`, policy/ACL/history/Storage mutation gates dan dua tombstone teruji di fixture |
| SAR31-03 | PASS_WINDOWS | Canonical store, target lease, CAS, immutable envelope, path traversal rejection, append-only receipt dan subprocess contention |
| SAR31-04 | PASS_WINDOWS | C01–C08 partial/list/delete/persistence/crash/reload/retry cases memakai provider sintetis; original key/IDs dipakai ulang |
| SAR31-05 | PASS_LOCAL | Storage positive-negative-restored dengan row-set/evidence preservation |
| SAR31-06 | PASS_LOCAL | populated25→26 full snapshot sebelum tujuh replay; 18→26, 24→26 dan historical12/13→26 tetap fixture terpisah; batas21/preflight diverifikasi lokal |
| SAR31-07 | PASS_LOCAL | Live-mock26 lulus seluruh16 browser contracts; demo-PWA22 lulus dua acceptance PWA; checker negatif lulus |
| SAR31-08 | PASS (Windows + Ubuntu) | Check, unit, database, historical legacy fixture, readiness, build, audit, live-mock, PWA, diff check dan tiga job GitHub Ubuntu lulus pada SHA `7958fd46…` |
| SAR31-09 | PASS (CI/Preview/hosted login) | Commit `7958fd46d0c231a1f51e04fb872f3dca71b550dc` ada pada `codex/preview`; GitHub run41205825954 sukses di tiga job; Vercel deployment exact SHA Ready dan tiga route/aset smoke200; pengguna mengonfirmasi Dashboard terbuka setelah login |
| SAR31-10 | PASS_LOCAL/CI/Preview/hosted login | Manual review menutup path traversal key, CI tiga job pass, Preview source SHA dan smoke cocok; pengguna mengonfirmasi login Preview berhasil dan Dashboard terbuka |

## Gate dan hasil aktual

- `npm ci --prefer-offline` — PASS saat dijalankan di luar restricted sandbox,
  186 packages; `package-lock.json` tidak berubah. Proses npm sandbox awal gagal
  dengan `Exit handler never called`; hasil itu dicatat sebagai kendala runner.
- `npm run check` — PASS, 0 error dan 0 warning.
- `npm test -- --maxWorkers=1` — PASS, 37 file / 474 tes.
- `npm run test:database` — PASS pada source cleanup terakhir: migration/access/RLS/Storage,
  biometric/push, replay dan cleanup sintetis. Mencakup 18→26, Preview-style24→26,
  populated25→26 dengan tujuh RPC receipt dan historical12/13→26 dengan preflight
  terpisah; tidak mengubah migration/hosted history.
- `npm run test:auth-cleanup` melalui aggregate database — PASS pada Windows nyata,
  termasuk path dengan spasi/Unicode, hardlink/symlink fail-closed, child process,
  residual lock, target contention, retry dan no-provider-I/O pada dry-run.
- `npm run test:database:legacy` — PASS untuk fixture historical disposable yang
  memang diketahui: 13 synthetic table lama dibuang dalam transaksi test; Auth,
  Storage, public schema, extensions dan platform event trigger dipertahankan.
  Tidak ada hosted DDL.
- `node supabase/deployment/verify-readiness-preview.test.mjs` — PASS historical23,
  probe dua kali, exact full-state rollback equality, missing-fixture fail-closed.
- `npm run build` — PASS, static SPA dan service worker build dari konfigurasi PWA.
- Live-mock: 26 passed; `stats={expected:26, skipped:0, unexpected:0, flaky:0}`;
  `check-browser-report` cocokkan16 kontrak.
- Demo-PWA: 22 passed; `stats={expected:22, skipped:0, unexpected:0, flaky:0}`;
  acceptance termasuk shell offline dan kamera/GPS demo lokal.
- Checker self-test — PASS: ID hilang, expected0, skipped, failed, flaky dan suite
  salah semuanya ditolak.
- `npm audit --audit-level=moderate` — exit0; empat low finding pada rantai
  `deepmerge` melalui dependency Svelte, tanpa moderate/high/critical; tidak ada
  `--force`/mass update.
- `git diff --check` — PASS; belum ada migration file yang berubah.
- GitHub Actions run [`41205825954`](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/41205825954)
  untuk SHA `7958fd46d0c231a1f51e04fb872f3dca71b550dc` — PASS: `Check, test,
  database, build`, `Browser live-mock`, dan `Browser demo-pwa` semuanya sukses
  pada Ubuntu. Ini menutup gate Linux subprocess/CI untuk source SHA tersebut.
- Commit source `7958fd46d0c231a1f51e04fb872f3dca71b550dc` telah dipush hanya ke
  `codex/preview`; tidak ada Production/main push.
- Vercel project ID `prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`, team
  `team_S1Sn08iaksD0GQF4kk49kTkH`; deployment
  `dpl_DVh5cwhuHDfmxTJ6sdgEuKHV5kwj` di
  [`hr-rajaklana-j6ed3b8s0-hr-rajaklana.vercel.app`](https://hr-rajaklana-j6ed3b8s0-hr-rajaklana.vercel.app)
  berstatus READY. Metadata GitHub SHA/ref adalah `7958fd46…` / `codex/preview`,
  dengan branch alias `hr-rajaklana-jkt-git-codex-preview-hr-rajaklana.vercel.app`.
  Field Vercel `target` bernilai `null`; target tidak disimpulkan dari READY saja.
- Smoke memakai `vercel curl` autentik untuk exact deployment: `/login` HTTP200
  dan membawa SPA hydration entry, `/manifest.webmanifest` HTTP200 dan JSON valid,
  `/service-worker.js` HTTP200 dengan body nonkosong. Tidak ada proteksi SSO yang
  dimatikan. Artifact ada di `.codex-test-tmp/sar31/hosted-smoke/`.
- Fingerprint file source/test final: application `a3441083e10d78529f3852eb49cc15dc945ec415d9901fc28c45327c3d55a41d`,
  cleanup `14bfd9719146731419ed222aa1f788558c594cf6193a0b70923b27b8dbacf9d0`,
  database/probe `0f03a44ca900f007a46ef63d1af29cdbf942423a578e9e780d9f8240d716c4a6`,
  all changed code/test files `d94be977ac9656183da38f8985258c8bca8b05f52d1c09c3f2adf2117c7aa769`.
  Perhitungan: path relatif terurut + NUL + byte file persis + NUL.

### Kegagalan dan retry yang tetap dicatat

- Live-mock run-05: **25 pass / 1 fail**. Reproduksi menunjukkan replay roster
  langsung mencoba write ketika data read sebelumnya error dan private session
  gate masih tertutup. Diperbaiki dengan preflight `actions.refresh()` sebelum
  replay persisted attempt, sambil menjaga account check dan key/payload asli.
  Reproduksi targeted sesudah fix lulus, lalu run-10 lulus26/26.
- Browser targeted run-06/run-07: gagal setup karena browser tidak tersedia di
  sandbox dan proses elevated terisolasi dari localhost sandbox. Tidak diklaim
  sebagai gagal produk. Server dan runner kemudian dijalankan pada konteks native
  Windows yang sama; targeted pass serta run-10 full pass.
- Vitest pertama di sandbox: 37 suite gagal sebelum test load karena Vite SSR
  cache `rename` EPERM di temp sandbox. Retry di native Windows berhasil37 file /
  474 tes; hasil sandbox tetap dicatat sebagai kendala lingkungan.
- Pemeriksaan manual cleanup menemukan expected `operationKey` dipakai mentah pada
  path registry sebelum diverifikasi. Diperbaiki dengan validasi schema/target/UUID/
  fingerprint sebelum side effect dan nama registry fixed-format dari hash; test
  eksplisit membuktikan malicious traversal tidak membuat lock/registry dan tidak
  memanggil provider. Aggregate database dijalankan lagi sesudah perbaikan.

## Deployment, hosted workflow, dan residual

| Area | Hasil saat ini |
| --- | --- |
| Implementasi lokal | PASS pada gate di atas, termasuk perbaikan retry dan validasi key cleanup |
| Supabase Preview deployment/schema | Identitas serta 26 ordered migrations terverifikasi; final probe SELECT/DO dalam `BEGIN READ ONLY` selesai tanpa error dan tanpa hasil row. Tidak ada deployment/migration aplikasi |
| Vercel Preview deployment | PASS untuk source SHA `7958fd46…`; Git branch ref/alias dan route/aset smoke telah diperiksa. Vercel MCP list mengembalikan403, sehingga fallback CLI resmi dipakai pada project/team ID yang sudah diverifikasi |
| GitHub CI | PASS untuk SHA `7958fd46…`; ketiga Ubuntu job sukses. Tidak menyimpulkan workflow akun hosted dari CI |
| Hosted user workflow | PASS_USER_CONFIRMED; pada 2026-10-31 pengguna mengonfirmasi login di deployment Preview exact SHA berhasil dan Dashboard terbuka. Konfirmasi ini mencakup login/Dashboard saja, bukan hosted role-revocation atau Storage policy mutation |
| Cleanup Auth factors | Hanya tool/test sintetis. Tidak ada hosted adapter, enrollment, delete atau cleanup faktor nyata |
| Managed `pg_net` | Local operator proof pass; managed owner sah belum tersedia/terbukti, jadi handoff hosted OPEN. Tidak ada owner/membership/grant mutation |
| AUTH-04/AUTH-06 dan konfigurasi hosted | Tidak memakai ketiadaan faktor untuk menyimpulkan riwayat/config; open bila bukti managed scoped belum tersedia |
| Dependency | Empat low audit finding dicatat, bukan ditutup dengan update paksa |
| Perangkat | PVR-02 DEFERRED; demo-PWA lokal bukan iPhone/offline/update/kamera/GPS/notifikasi nyata |

## Batas fixture dan larangan yang dipatuhi

Hosted Preview yang ditemukan sudah baseline26; tidak dipakai sebagai target upgrade
historis. Historical12/13, migration13 failure boundary, boundary21 preflight,
Preview-style18→26, Preview-style24→26 dan populated25→26 dijalankan sebagai
fixture disposable terpisah. Tidak ada applied migration yang diedit, upgrade/
reset/deletion data hosted, repair history, Auth factor nyata, service-role
replacement untuk tes RLS, atau perubahan Production/main.

Semua pekerjaan implementasi serta konfirmasi login hosted yang diminta selesai:
commit source dipush ke `codex/preview`, CI Ubuntu sukses, Preview exact SHA Ready,
smoke route/aset lulus, dan pada 2026-10-31 pengguna mengonfirmasi login berhasil
serta Dashboard terbuka. Tidak ada kredensial yang diminta atau dicatat. Konfirmasi
pengguna tidak dianggap sebagai bukti hosted role-revocation, Storage policy
mutation, Auth cleanup, atau uji perangkat. Managed `pg_net` owner/handoff tetap
OPEN; PVR-02 tetap terpisah dan DEFERRED.
