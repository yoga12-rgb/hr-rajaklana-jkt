# Progres penutupan empat temuan autentikator

Tanggal mulai: 31 Oktober 2026  
Target: branch `codex/preview`, Supabase Preview setelah identitas diverifikasi  
Production/main: di luar scope

## Aturan bukti

Dokumen ini membedakan implementasi lokal, CI/deployment Preview, workflow hosted,
cleanup/operator sintetis, dan perangkat nyata. Test yang skipped, hasil setup yang
gagal sebelum assertion, atau deployment READY tanpa workflow tidak dihitung lulus.
Migration yang sudah applied, data operasional, audit, dan Auth hosted tidak di-reset
atau dihapus untuk membuat tes lulus.

## Checkpoint

| ID | status lokal | SHA/ref | file/perubahan | command/env | expected/pass/fail/skipped/flaky | artifact | hosted/deployment | dampak data/Auth/audit | sisa/sebab |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUR-00 | in progress | `ca17c925a2ee50a0b91c82c036f3636d424b1877` / `codex/preview` | Baseline source, worktree, migration inventory | `git status`, `git rev-parse`, inventory 26 migration | reproduksi audit akan dijalankan; belum menutup temuan | dokumen ini + audit ulang | belum diverifikasi ulang | read-only lokal; tidak ada remote mutation | menunggu reproduksi/gate |
| AUR-01 | pending | — | lifecycle Realtime | targeted unit/live-mock | belum dijalankan | — | — | harus menjaga guards/session | — |
| AUR-02 | pending | — | probe semantik/mutation | probe disposable | belum dijalankan | — | — | probe read-only; mutation disposable saja | — |
| AUR-03 | pending | — | session/Storage/API/network/historical25 | database gates | belum dijalankan | — | — | fixture disposable | — |
| AUR-04 | pending | — | browser rotation/replay | Playwright live-mock | belum dijalankan | — | — | tidak mengubah hosted | — |
| AUR-05 | pending | — | populated25→26 | upgrade compatibility | belum dijalankan | — | — | snapshot/equality, no reset | — |
| AUR-06 | pending | — | CLI portable/subprocess | Windows/Linux process tests | belum dijalankan | — | — | dry-run/default safe | — |
| AUR-07 | pending | — | aggregate/CI | all required commands | belum dijalankan | — | — | no secrets | — |
| AUR-08 | pending | — | Preview release/hosted read-only | SHA/ref/probe/smoke | belum dijalankan | — | — | no Production/main | — |
| AUR-09 | pending | — | closure/handoff | acceptance table | belum dijalankan | — | — | PVR-02 remains open | — |

## AUR-00 baseline notes

- Worktree baseline includes two user-authored untracked documents:
  `docs/audit-ulang-tiga-temuan-autentikator-2026-10-30.md` and this execution guide.
- Branch is `codex/preview`; remote is `origin` at the HR repository.
- Local migration directory contains 26 ordered files, ending in
  `20261030031318_retire_application_authenticator.sql`. This is not evidence that
  the hosted timestamp mapping is identical; hosted identity/history must be checked
  read-only before AUR-08.
- Historical12/13 and boundary21 preflights remain historical-only paths. They must
  not be applied to the current Preview baseline26.

## Reproduction log

| Finding | command/test | expected red reproduction | actual | status |
| --- | --- | --- | --- | --- |
| ARA-01 | pending targeted Realtime rotation test | post-rotation event is consumed | pending | open |
| ARA-02 | pending four disposable probe mutations | each bypass is rejected | pending | open |
| ARA-03 | pending historical25/session/Storage/network fixtures | bounded harnesses execute assertions | pending | open |
| ARA-04 | pending Windows/Linux subprocess CLI | `--help` has output and correct exit | pending | open |

## Execution addenda

Entries below are append-only. Preserve earlier historical claims and correct them
with a dated addendum instead of rewriting them as if reopened acceptance had already
been proven.

## Execution addendum — AUR-00 through AUR-07 (31 October 2026)

| ID | status lokal | SHA/ref | file/perubahan | command/env | expected/pass/fail/skipped/flaky | artifact | hosted/deployment | dampak data/Auth/audit | sisa/sebab |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUR-00 | pass | `ca17c925a2ee50a0b91c82c036f3636d424b1877` at start | baseline inventory; this progress file; no applied migration edited | `git rev-parse`, `git status`, local migration inventory; four red reproductions preserved as regression work | baseline source captured; the old CLI/probe/fixture gaps were reproduced in the audit and then covered by the new tests | audit ulang + this progress file | Preview identity rechecked read-only below | no remote mutation; no operational/audit reset | browser hosted smoke still separate |
| AUR-01 | pass | working tree after AUR-01 | `src/lib/state/app.ts`, `src/lib/state/realtime-recovery.test.ts` | targeted Vitest (agent): 23/23; aggregate unit later 469/469 | token-only `aal1→aal1` and legacy `aal2→aal1` replace channel after validation; stale channel callback denied; replacement callback refreshes; UI remains initialized/mounted | Vitest output + test source | hosted workflow not yet rerun | guards, account revision and logout cleanup retained | browser camera/form rotation remains represented by separate live-mock/hosted boundary |
| AUR-02 | pass | working tree after AUR-02 | `verify-authenticator-removed-preview.sql`, `supabase/tests/authenticator-removal.mjs` | `node supabase/tests/authenticator-removal.mjs` | baseline twice; literal/OR bypass, UPDATE-only command, raw-helper grant, constant-true helper, history, recovery PUBLIC grant and disabled RLS mutations all rejected then restored | `Authenticator removal mutation gates OK`; local probe | hosted catalog read-only below; hosted mutation not run | probe runs disposable/read-only transactions only | deeper managed-owner/remote mutation remains out of scope |
| AUR-03 | pass | working tree after fixture changes | `supabase/tests/mfa-enforcement.mjs`, `supabase/tests/authenticator-removal.mjs`, `tests/live-mfa.spec.ts` | `node supabase/tests/mfa-enforcement.mjs`; aggregate database; live suite | historical harness stops exactly at migration25; real user/session mismatch and expiry fixtures; revoked/expired/disabled Storage checks; network operator; true no-factor browser fixture separated from legacy-factor fixture | MFA/network/Storage output; live JSON below | hosted workflow not claimed from local fixtures | disposable PGlite only; no Auth/Storage hosted factor cleanup | managed pg_net hosted owner procedure remains separate residual |
| AUR-04 | pass (local live-mock) | working tree | existing live suites plus AUR-01 lifecycle regression | live-mock E2E: `E2E_LIVE_SUPABASE_MOCK=1`, `E2E_BASE_URL=http://127.0.0.1:5198`, Edge, JSON `test-results/aur-live.json` | 18 expected, 0 skipped, 0 unexpected, 0 flaky; form/replay/reload/retry, session/410 and cashier/supervisor workflows pass. Camera capture is covered by demo/PWA gate; token-only channel rotation is covered by AUR-01 unit event barrier. | `test-results/aur-live.json` | not a hosted-user proof | no hosted writes | a real hosted account rotation/device camera workflow remains separately reported |
| AUR-05 | pass | working tree | `supabase/tests/followup-upgrade-compatibility.mjs` | aggregate database | populated25→26 now seeds pending/failed/completed recovery, nonempty synthetic factor IDs, audit, cases, roster, all six private receipts and public roster batch; asserts nonempty and full JSON equality; historical12/13 preflight and final26 paths pass | `Populated25→26 upgrade OK`; `Historical 12→26 upgrade OK` | Preview baseline is current26; no historical preflight applied remotely | forward-only disposable upgrades; original receipts/keys preserved | no hosted downgrade/replay |
| AUR-06 | pass | working tree | `cleanup-auth-factors.mjs`, `cleanup-auth-factors.subprocess.test.mjs`, `package.json` | `npm run test:auth-cleanup` in aggregate | direct entrypoint uses `pathToFileURL`; Windows-safe help, import no-op, spaces/Unicode paths, dry-run, malformed/missing, fail-closed execute and original-ID timeout retry pass | `Auth cleanup operator OK`; `Auth cleanup subprocess OK` | no real Auth factors touched | dry-run/default safe; fake provider only | Linux runner still needs CI evidence |
| AUR-07 | pass locally | working tree | aggregate script wiring | `npm run check`; `npm test -- --maxWorkers=1`; `npm run test:database`; `npm run test:database:legacy`; readiness; clean build; live-mock; demo-PWA; `git diff --check` | check 0/0; unit 37 files/469 tests; database aggregate pass; legacy reset pass; readiness pass; build pass; live 18/18; demo/PWA 22/22; all browser JSON skipped/unexpected/flaky=0; diff check clean | `test-results/aur-live.json`, `test-results/aur-demo-pwa.json` | deployment not yet created from final SHA | no remote mutation | `npm audit` networked result has 4 low advisories; no force fix applied |

### AUR-07 command evidence

- `npm.cmd run check`: `svelte-check found 0 errors and 0 warnings`.
- `npm.cmd test -- --maxWorkers=1`: **37 files, 469 tests passed** (the first sandbox attempt hit Windows EPERM on Vitest's temp rename; the required escalated retry passed).
- `npm.cmd run test:database`: migration/database, upgrade paths, biometric/push, cleanup subprocess, bounded historical25, semantic mutation, and final password-only gates all passed.
- `npm.cmd run test:database:legacy`: known-legacy rollback/refusal suite passed with no hosted DDL.
- `node supabase/deployment/verify-readiness-preview.test.mjs`: historical23 probe/rollback test passed.
- Clean `npm.cmd run build`: passed with empty Supabase environment for the demo/PWA build.
- `git diff --check`: passed.
- `npm.cmd audit --audit-level=moderate` with registry access reported **4 low severity advisories** in the `deepmerge` dependency chain. `npm audit fix --force` was not run because the suggested change is breaking; this remains a dependency residual, not a hidden pass.

### Live-mock and demo/PWA JSON evidence

```json
{
  "live": {"expected": 18, "skipped": 0, "unexpected": 0, "flaky": 0},
  "demoPwa": {"expected": 22, "skipped": 0, "unexpected": 0, "flaky": 0}
}
```

The live server used the isolated mock URL and was stopped after the run. The demo
suite used the clean production build with empty Supabase URL/key and separately
verified shell/cache/offline behavior, camera/GPS demo, SPA navigation, and replay
drafts. These are local workflow proofs, not a hosted account proof.

## AUR-08 preflight — hosted identity (read-only)

Supabase MCP read-only verification on 31 October 2026 confirmed project ref
`lypsqrwjzrmuyqtdcegr`, name `hr-rajaklana-preview`, organization
`bvwgekyfibloctfslgdf`, status `ACTIVE_HEALTHY`, Postgres `17.11`, and 26 hosted
migrations. Hosted mapping uses the known renamed timestamps `20261025044841` …
`20261029032121` and latest `20261030033256`; this differs from local filenames but
the ordered names are the same. Read-only catalog showed 29 public/session policies
plus `storage.objects`, restrictive `cmd='*'`, exact authenticated target and
`(SELECT private.session_allowed() AS session_allowed)` for both expressions. Raw
internal helpers are not executable by authenticated/anon; only the reviewed
password-only helpers are exposed. Both recovery RPCs have no effective public,
anon, authenticated or service-role execute grant. No hosted mutation was attempted.

## AUR-08/AUR-09 status

Preview release and hosted workflow evidence are still open until the final changes
are committed/pushed, a Preview deployment is built from the matching SHA, and any
available hosted smoke is tied to that deployment. Production/main remain outside
scope. PVR-02 (real iPhone/iPad offline/update/tab-old and device camera/location)
remains postponed by the user and is not counted as a local gate failure.
