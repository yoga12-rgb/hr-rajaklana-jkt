# Face verification and device notifications

This release adds server-side face matching and opt-in Web Push to the existing SPA. It does not introduce a paid face API or disable Preview deployment protection.

## Face verification contract

- The employee explicitly consents and captures a reference through the front-camera UI at `/face-verification`. The API checks image decoding, resolution, single-face detection, framing, exposure, sharpness and head angle, then saves a pending reference in the private `biometric-references` bucket.
- Another active Admin HR reviews the picture against the employee's identity. Self-approval is rejected in Postgres. Metadata is visible to its owner and HR; descriptors and private image paths are accessible only through narrow service RPCs. Browser status responses never contain descriptors. Only another HR receives a two-minute signed review image URL.
- `/api/biometric` validates the Bearer session with Supabase `getUser`, checks the active employee and same-origin request, downloads the uploaded attendance selfie, and runs inference on the server. The browser never supplies a trusted descriptor, match score or reference employee ID.
- The runtime is `@vladmandic/face-api@1.7.15`, TensorFlow.js and its WASM backend `4.22.0`, and `sharp@0.35.5`. Only face detection, landmarks and recognition are used; age, gender and emotion are not collected. The package's MIT license is copied to `server/face-model-LICENSE.txt`; upstream provenance is <https://github.com/vladmandic/face-api>. `server/face-model-manifest.json` pins SHA-256 for all six used model files, and inference refuses changed files. The matching cutoff is Euclidean distance `0.48`; it requires field validation with real consenting employees before general operation.
- A successful match issues a short-lived, single-use server receipt bound to the exact employee, approved reference, Storage object UUID, original uploaded byte hash, location and capture instant, selfie instant, assignment, outlet and shift. Object identity is obtained before downloading bytes and rechecked at issuance to prevent replacing a file between inference and receipt creation. Storage deletion is blocked while a receipt or attendance uses the selfie. Receipt consumption rechecks the assignment, reference approval and recent capture before creating attendance; legacy client clock-in RPC grants are revoked. Clock out uses a separate freshness-enforcing wrapper.
- Capture timestamps are device-reported. Freshness checks reject stale coordinates and accidental reuse; browser GPS and camera inputs are not tamper-proof hardware attestations. Face matching does not prove liveness or guarantee rejection of printed/displayed photos. Failed matching produces a retry/help message and no automatic penalty. HR manual attendance remains available with an audit reason.
- Withdrawing consent revokes active references and removes all descriptors immediately. Private photo deletion is attempted immediately and queued for retry if Storage fails. Rejected/replaced reference material is purged after 30 days by the scheduled worker. Minimal reference/audit metadata remains so historical attendance does not lose its audit link; historical attendance selfies follow the existing evidence policy.
- Reference uploads are staged in the cleanup queue before uploading. Successful enrollment removes the staged entry atomically. Explicit or ambiguous enrollment failures leave a ten-minute cleanup grace period, and the worker removes only files with no committed reference material. This prevents orphaned photos without deleting a successfully committed reference after a lost response.

## Required server configuration

Keep separate keys and configuration for Production and Preview. Never place a service key, private VAPID key or worker credential in `PUBLIC_*`, source control, browser storage or logs.

Vercel Node Functions require:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | The environment's own Supabase project URL |
| `SUPABASE_ANON_KEY` | Public API key used with the verified employee's Bearer JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Storage/reference/receipt operations |
| `VAPID_PUBLIC_KEY` | Public Web Push application key returned by authenticated configuration API |

Supabase `push-dispatch` requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_WORKER_SECRET` and a valid `PUSH_CONTACT` such as `mailto:rajaklanajombang@gmail.com`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to its Edge runtime. Generate a distinct VAPID pair and a random worker secret of at least 32 characters per environment. Rotate by updating both worker secrets and configuration together; a VAPID key change requires browsers to subscribe again.

Deploy `supabase/functions/push-dispatch/index.ts` with JWT verification disabled **only for that worker**. The handler requires the dedicated `x-hr-push-wake` credential and compares fixed-size digests; it cannot accept arbitrary recipients or messages. Other functions keep their existing authentication.

After applying the migration, configure each environment through a service-authenticated call to:

```text
push_configure_worker(
  p_url = https://<that-project-ref>.supabase.co/functions/v1/push-dispatch,
  p_wake_secret = <that-environment's worker secret>
)
```

Do not substitute a Vercel URL or another environment's project. The RPC restricts the hostname/path. The migration enables hosted `pg_net`/`pg_cron` when available and schedules `hr-push-minute` each minute. Verify both extensions and that job after migration. PGlite tests intentionally have neither extension and exercise the same queue/RPC logic without making network requests.

The configuration is in a private, unexposed table with no client or direct service-role grants. The webhook uses a dedicated wake-only secret. `pg_net` queues HTTP headers, so a service-role or VAPID private key must never be placed in those headers. Possession of the wake credential alone can only request dispatch of legitimate queued notifications; it cannot read HR data or create a message.

Hosted `pg_net` transport tables retain Supabase's platform grants. They belong to `supabase_admin`; a `REVOKE` run as `postgres` can finish with a warning and leave access unchanged. No application migration claims to restrict those grants. Keep `net` outside the Data API's exposed schemas, give direct database login only to trusted operators/services, and treat queued request headers as readable by any database login. See [Supabase's pg_net privilege constraints](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16).

Do not drop/recreate or attempt to relocate the nonrelocatable extension to address an advisor warning: recreation restores the platform grants and removes unsent requests and stored responses. The application boundary is the unexposed `net` schema and the limited wake credential; privileged database access remains trusted.

## Delivery behavior

Employees opt in using the button in the notification inbox. No permission prompt appears automatically. Supported browsers use their HTTPS push services for Chrome/Firefox/Apple/Windows; endpoint host allowlists reject arbitrary/private targets, userinfo, custom ports and fragments. The subscription belongs to the current active employee. A shared browser switching accounts clears the old recipient queue before rebinding the endpoint. Logout attempts server unsubscribe and always unsubscribes the browser device even if the server is unavailable.

On iPhone/iPad (iOS/iPadOS 16.4+), open the app from its Home Screen icon. In Safari choose Share → Add to Home Screen; enable Open as Web App if offered, then open the new icon and log in. A browser tab shows installation instructions instead of an inactive activation button. Read-only readiness checks finish within eight seconds and expose a retry when configuration, the active service worker, or the network is unavailable. Opt-in calls `PushManager.subscribe()` directly from the click, using the prepared worker and public key, to preserve the browser's user activation.

The “active” state requires both browser permission and `push_subscription_status(endpoint)` confirmation for the current active employee. That authenticated boolean RPC never returns endpoint owners or subscription keys, and grants no direct table access. Apply migration `20261018162525_push_subscription_status.sql` before deploying this client. Permission prompts that finish after an account change cannot register under the new account. Unit tests cover iPhone/iPad tab versus Home Screen detection, deadlines, account ownership, direct click activation, and failed/late opt-in cleanup; real iPhone delivery remains a separate pilot check.

New notifications create durable per-device outbox rows in the same transaction. The worker claims rows with `SKIP LOCKED`, a random lease token, a 90-second lease and bounded exponential retries. Completion must present that exact claim token. HTTP 404/410 disables an expired subscription; temporary delivery/transport failures retry, and abandoned worker leases become available again. At-least-once push transport can repeat a delivery; a fixed notification tag collapses duplicates on the device. Items already read before claiming are skipped. The inbox remains the authoritative history.

Every minute, open attendance reaching eight hours receives one inbox reminder and, when opted in, a generic device notification. The job rechecks open attendance after taking the employee lock and never sets clock-out automatically. No precise-to-the-second delivery is promised: operating systems, browser power saving and network availability can delay or suppress push. On iPhone/iPad, supported system versions require installation to the Home Screen before opting in.

Both the worker and service worker use a fixed generic title/body and same-origin `/dashboard` destination. Employee names, leave decisions, reasons, dates, biometric scores, URLs containing credentials and other HR details are never shown on the lock screen.

## Verification

- `npm test` includes real model inference using the pinned dependency's public bundled demo samples in memory: a transformed same-person image matches; a different person, multiple people, blank/broken and blurred images are rejected. No sample is enrolled or uploaded.
- API handler tests exercise session/role boundaries and verify that only a successful server comparison can request a receipt.
- `npm run test:database` runs existing migration/business tests and `supabase/tests/biometric-push.mjs`: real PostgreSQL grants/RLS, prohibited legacy bypass, other-HR review, receipt data/reference/object binding, expiry, ownership, single-use consumption, freshness and consent withdrawal; push ownership, SSRF allowlist, queue triggers, leases, retry, invalid endpoint disable, read suppression and shared-browser isolation.
- Worker delivery unit tests use fictional endpoints and injected senders. They do not send device notifications to actual employees.
- Before broad operation, test enrollment/review/clock in using consenting real employees, real outlet GPS, a supported phone, and explicit push opt-in. Closed-app receipt on that phone must be checked separately from successful server queue/delivery tests.

Dependency audit at implementation time reported three moderate advisories through TensorFlow.js's command-line `argparse`/`sprintf-js` chain; no patched compatible upstream release was available. The request path does not call that command-line formatter or accept format strings. Versions remain pinned; revisit upstream updates rather than downgrading TensorFlow to an incompatible release automatically.
