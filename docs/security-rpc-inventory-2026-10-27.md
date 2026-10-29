# Inventaris otorisasi RPC — 27 Oktober 2026

Snapshot ini menilai source migrations 1–24 pada `codex/preview` dan memisahkan tambahan MFA migration 25 di bawah. Inventaris dibuat dengan menerapkan SQL secara berurutan pada PGlite, membaca `pg_proc`/ACL hasil akhir, lalu meninjau badan fungsi dan helper yang dipanggil. Tidak ada data HR atau credential yang dibaca, dan tidak ada tindakan remote dijalankan oleh inventaris ini.

Baseline 24 menghasilkan **80 fungsi public SECURITY DEFINER**: **60** dapat dipanggil `authenticated`, **0** dapat dipanggil `anon`. Seluruhnya mempunyai `SET search_path=''`. Angka tersebut adalah daftar permukaan API yang disengaja, bukan bukti otomatis bahwa setiap fungsi aman. Setiap baris di bawah memetakan guard dan batas kepemilikan; hasil hosted dua identitas masih harus dicatat terpisah.

## Helper dan rantai otorisasi

| Singkatan | Rantai yang ditinjau | Kontrak |
| --- | --- | --- |
| E | `require_employee → employee_id → auth.uid()` | Actor diturunkan dari akun Auth yang terikat ke karyawan aktif dan account aktif. Tidak menerima actor dari body. |
| H | `require_hr → has_role('admin_hr') → employee_id`; `require_employee` | Memerlukan role database HR dan actor aktif. Role dari `user_metadata` tidak digunakan. |
| A | `assert_approver(employee) → require_employee`; cabang external → `require_hr` | Menolak pengajuan sendiri; internal harus approver yang ditetapkan, external harus HR. |
| C | `has_supervisor_capability → has_role/employee_id`, capability rows + active employee | Batas outlet dan kategori; hanya actor sendiri atau HR dapat memeriksa hak target melalui helper ini. |
| O | `outlet_issue_access → has_supervisor_capability` | Baca: reporter/creator atau capability; tulis: `issue_handle` pada outlet/kategori kasus. |
| T | `handover_access → has_role/has_supervisor_capability` | Pengirim/penerima atau HR/`handover_monitor` pada outlet. |
| S | `require_service → auth.role()='service_role'` | Hanya worker server; grant anon/authenticated dicabut. Ini bukan pengganti validasi actor pada API service-key. |

Migration MFA 25 mempertahankan badan transaksi/receipt dan mengganti dasar E/H/C/T/O: `employee_id → session_allowed → session_access_context → raw_employee_id`. Konteks memeriksa session JWT yang ditandatangani, kepemilikan `auth.sessions`, status akun, dan untuk akun berhak istimewa `aal2` beserta faktor TOTP verified yang masih terikat ke sesi. `require_employee` memberi alasan penolakan; `employee_id` menyembunyikan actor yang belum memenuhi syarat sehingga RLS dan RPC yang memakai actor langsung juga tertutup. Policy MFA restrictive mempersempit seluruh akses tabel/Storage existing.

Untuk E/H/A/C/O/T, **MFA memberi bukti faktor kedua, bukan role baru**. Kasir tetap hanya memperoleh hak kasir. Untuk S, API `authenticate()` harus memverifikasi bearer dengan `getUser`, memanggil `auth_access_context` sebagai user, lalu mencocokkan identitas sebelum operasi server. Invariant ini diuji oleh `src/lib/server-mfa-boundary.test.ts`.

## Keputusan untuk 60 RPC authenticated baseline

Kolom bukti merujuk kelompok tes perilaku pada `supabase/tests/database.mjs` atau `supabase/tests/biometric-push.mjs`. `Pertahankan` berarti fungsi adalah API aplikasi yang disengaja dan guard/scope source telah ditinjau; **bukan** klaim workflow hosted lulus. Seluruh baris tetap memerlukan verifikasi sesi hosted sesuai M5.

| # | Fungsi public | Guard dan scope yang ditinjau | Bukti lokal / keputusan |
| --- | --- | --- | --- |
| 1 | `attendance_clock_in_verified` | E; receipt milik actor, payload/objek/assignment/reference cocok, fresh capture, receipt sekali pakai; memanggil overload clock-in internal | Biometric receipt + assignment + fresh GPS; pertahankan. |
| 2 | `attendance_clock_out_fresh` | E; fresh GPS; `attendance_clock_out → require_employee`, sesi absensi sendiri dan snapshot outlet | Absensi, metadata, historical outlet; pertahankan. |
| 3 | `attendance_correct` | H; menolak koreksi diri; employee mutex, overlap, audit dan snapshot dipertahankan | Correction + overlap; pertahankan. |
| 4 | `attendance_correction_cancel` | E; hanya request milik actor yang masih pending | Operational correction ownership; pertahankan. |
| 5 | `attendance_correction_decide` | H; tidak memutus koreksi diri; `attendance_correct/attendance_record_manual` dalam transaksi yang sama | Keputusan koreksi, rollback/audit, RLS; pertahankan. |
| 6 | `attendance_correction_submit` | E; employee_id dipatok actor; record target harus miliknya; duplicate/pending dan timeline checks | Pengajuan koreksi kasir + request sendiri; pertahankan. |
| 7 | `attendance_record_manual` | H; tidak mencatat diri; jadwal/outlet/historical snapshot dan overlap | Manual attendance + reason/evidence; pertahankan. |
| 8 | `biometric_review` | H; tidak menilai diri; status pending; review dengan alasan dan audit | Biometric no self-approval; pertahankan. |
| 9 | `biometric_withdraw` | E; hanya reference milik actor; consent withdrawal dan cleanup material | Biometric withdrawal; pertahankan. |
| 10 | `cashier_assignment_plan_save_v2` | H; assignment aktif dan Middle; baseline updated_at, key/payload receipt dan jam 8 jam | Planning Middle + replay/conflict; pertahankan. |
| 11 | `cashier_assignment_save` | H; own-assignment guard, cashier aktif, outlet/shift/middle/leave dan audit | Operational workflows assignment guard; pertahankan. |
| 12 | `cashier_roster_batch_save` | H; batch actor/key, semua baseline diperiksa sebelum commit, mutex per employee dan audit | Weekly batch atomic/replay/stale; pertahankan. |
| 13 | `employee_directory` | E; hanya kolom direktori kerja yang didaftarkan; active employee rows | Directory allowlist, disabled session; pertahankan. |
| 14 | `hr_save_employee` | H; schema/kolom input allowlist, approver/position/outlet checks dan audit | Employee lifecycle + roles; pertahankan untuk kompatibilitas. |
| 15 | `hr_save_employee_with_roles` | H; memanggil `hr_save_employee`, data/peran/transisi akun satu transaksi | Atomic lifecycle rollback/reactivation; pertahankan sebagai jalur UI. |
| 16 | `hr_set_roles` | H; allowlist role, guard admin terakhir, target aktif sesuai aturan | Roles authorization + last-admin guard; pertahankan kompatibilitas. |
| 17 | `issue_account_token` | H; token hash saja, active target, activation/reset purpose, revoke token lama | Token replace/revoke/single-use; pertahankan. |
| 18 | `leave_balance` | E; target sendiri atau `admin_hr`; `allowance` membaca target yang sudah diotorisasi | Balance foreign-target rejection + entitlement; pertahankan. |
| 19 | `leave_correct` | H; menolak diri; approved only, deduction ledger delta, adjustment guard dan audit | HR correction/refund/past-year guards; pertahankan. |
| 20 | `leave_correct_hours` | H; seperti leave_correct, jam parsial divalidasi | Partial leave correction + hours/ledger; pertahankan. |
| 21 | `leave_decide` | A; lock request; status/keputusan valid; deduction dan audit atomik | Approver/own denial/atomic deduction; pertahankan. |
| 22 | `leave_decide_adjustment` | A; lock adjustment + leave; potongan/refund sekali dan alasan external | Change/cancel approval + double decision; pertahankan. |
| 23 | `leave_edit` | E; target hanya pengajuan sendiri pending/needs_info; upload milik actor | Owner-only edit, attachment privacy, audit; pertahankan. |
| 24 | `leave_record_retrospective` | H; own guard, tanggal lampau, periode/jam, external decision dan ledger | Retrospective leave + permissions/rollback; pertahankan. |
| 25 | `leave_request_cancel` | E; request sendiri; pending dibatalkan, approved future membuat adjustment, lampau ke HR | Cancel ownership + refund approval; pertahankan. |
| 26 | `leave_request_change` | E; pending memakai `leave_edit`, approved membuat adjustment; target sendiri | Change workflow + duplicated adjustment guards; pertahankan. |
| 27 | `leave_submit` | E; employee_id actor, periode/tanggal/hak tahunan dan trigger upload/duplicate | Duplicate/period/partial-day/upload; pertahankan. |
| 28 | `notifications_mark_read` | E; update dibatasi employee_id actor, optional id tidak melampaui scope | Mark one/all ownership + idempotency; pertahankan. |
| 29 | `outlet_issue_page` | Actor `employee_id`; reporter/creator atau C `issue_view/issue_handle`; outlet/category filter mempersempit | Scoped page + privacy; pertahankan. |
| 30 | `outlet_issue_submit` | Actor aktif; own reporting outlet assignment/attendance/capability; reporter lain perlu C `issue_report_for_other`; path foto milik auth.uid | Issue submit scope, photo ownership, receipt/replay; pertahankan. |
| 31 | `outlet_issue_update_v2` | Actor aktif; O `handle`; owner target capability terpisah, revision, receipt actor/key/payload | Issue role/category/outlet + conflict/replay/audit; pertahankan. |
| 32 | `push_subscribe` | E; endpoint allowlist/key validation; endpoint ownership pindah atomik saat akun berubah | Push SSRF + shared-browser isolation; pertahankan. |
| 33 | `push_subscription_status` | E; endpoint dibatasi actor dan active subscription | Own active status/inactive denial; pertahankan. |
| 34 | `push_unsubscribe` | E; hanya subscription milik actor | Push opt-in ownership; pertahankan. |
| 35 | `shift_exchange_cancel_v2` | Actor aktif; requester harus actor; pending only, revision + receipt | Cancel owner + stale revision + once audit; pertahankan. |
| 36 | `shift_exchange_decide_v2` | H; actor bukan requester/peer; snapshot kedua assignment, leave/attendance/deadline; perubahan dua pihak atomik | Peer-approved swap + role/self/stale conflicts; pertahankan. |
| 37 | `shift_exchange_expire_stale_v2` | H; hanya active request tanggal lampau; receipt mengembalikan hasil asli | Expiry replay preserving timestamp/events; pertahankan. |
| 38 | `shift_exchange_page` | Actor aktif; requester/peer sendiri atau H; pending_spv hanya H | Exchange privacy/scoped inbox; pertahankan. |
| 39 | `shift_exchange_respond_v2` | Actor aktif; hanya peer yang dipilih, pending_peer, revision + receipt | Peer ownership + exact replay/conflict; pertahankan. |
| 40 | `shift_exchange_submit` | Actor aktif harus pemilik assignment; peer cashier aktif lain; deadline, availability, own key/payload | Assignment ownership + replacement/swap/deadline + uniqueness; pertahankan. |
| 41 | `shift_handover_page` | Actor aktif; T membatasi pengirim/penerima atau HR/monitor scoped | Handover read privacy; pertahankan. |
| 42 | `shift_handover_respond_v2` | Actor aktif; hanya penerima aktif yang ditetapkan; versi yang dibaca harus cocok | Recipient-only accept/revision + receipt; pertahankan. |
| 43 | `shift_handover_save_v2` | Actor aktif; baru harus assignment pengirim sendiri; existing pengirim/HR; accepted hanya amendment HR; penerima/assignment valid | Sender/recipient, accepted amendments, version/events/replay; pertahankan. |
| 44 | `spv_followup_page` | H; filter outlet/tanggal/view/cursor dibatasi dan divalidasi | Follow-up queue pagination/filter; pertahankan. |
| 45 | `spv_followup_start` | H; case key sumber otoritatif, signal valid, source actor/context checks | Context/source validity, Libur, case history; pertahankan. |
| 46 | `spv_followup_update` | H lalu selalu `40001` meminta reload; API legacy fail-closed | Old-tab write rejection; pertahankan refusal untuk kompatibilitas. |
| 47 | `spv_followup_update_v2` | H; baseline revision, actor/key/payload receipt, owner role aktif, reason/reopen/tenggat | Follow-up conflict/replay/persist/retry/audit; pertahankan. |
| 48 | `staffing_interval_requirement_save_v2` | Actor aktif; H atau C `coverage_configure` pada scope lama dan baru; revision/key/payload | Scope move denial + no overlap/effective date + replay; pertahankan. |
| 49 | `staffing_requirement_save` | H; active outlet, shift/weekday/range valid, dated requirement | Staffing history/effective date; pertahankan kompatibilitas. |
| 50 | `supervisor_capability_save` | H; target aktif, capability allowlist, outlet/category; legacy tetap menaikkan revision | Capability scope + configuration revision; pertahankan kompatibilitas. |
| 51 | `supervisor_capability_save_v2` | H; target aktif; grant/revoke identity baseline + revision/key/payload | Configuration conflict + role escalation denial + replay; pertahankan. |
| 52 | `supervisor_interval_coverage` | Actor aktif; H atau C `summary_view/coverage_configure` pada outlet; per-person rows dibatasi HR | Coverage scope + 8-hour Middle + partial leave; pertahankan. |
| 53 | `supervisor_issue_category_page` | Actor aktif; active categories katalog pelapor; include inactive hanya H | Reporting catalogue allowlist; pertahankan. |
| 54 | `supervisor_issue_category_save` | H; code/name validation + audit/revision | Configuration writes; pertahankan kompatibilitas. |
| 55 | `supervisor_issue_category_save_v2` | H; revision/key/payload receipt, code/name validation | Configuration original-response replay + stale denial; pertahankan. |
| 56 | `supervisor_issue_route_save` | H; outlet/category aktif; penerima target `issue_handle` dalam scope | Target capability helper + routing scope; pertahankan kompatibilitas. |
| 57 | `supervisor_issue_route_save_v2` | H; target helper + baseline revision/key/payload | Routing stale conflict + changed target guard/replay; pertahankan. |
| 58 | `supervisor_operation_configuration_page` | H; response konfigurasi allowlist termasuk revisions | Configuration snapshot privilege/revision; pertahankan. |
| 59 | `supervisor_report_page` | Actor aktif; H atau summary C; employee filter non-H hanya sendiri, outlet filter authorized; coverage memakai guard 52 | Period summary privacy + scoped aggregates; pertahankan. |
| 60 | `update_my_profile` | E; id actor; hanya address/emergency/photo allowlist, upload trigger | Profile allowlist + ownership/storage; pertahankan. |

## 20 fungsi public yang bukan RPC authenticated

Pada snapshot 24 semua baris berikut mempunyai `anon EXECUTE=false` dan `authenticated EXECUTE=false`. Tiga overload attendance adalah primitive internal yang dipanggil RPC verified/fresh; sisanya service-only. Tidak menambahkan grant client agar warning hilang.

| Fungsi/signature ringkas | Jalur dan keputusan | Bukti lokal |
| --- | --- | --- |
| `attendance_clock_in(text,float8,float8,float8,text)` | E + assignment/GPS/selfie checks; internal wrapper; pertahankan deny client | Absensi + legacy bypass denial. |
| `attendance_clock_in(text,float8,float8,float8,text,timestamptz,text)` | Delegasi overload 5 arg + metadata; dipanggil verified RPC; pertahankan deny client | Metadata + biometric receipt. |
| `attendance_clock_out(float8,float8,float8)` | E + own open session/GPS; dipanggil fresh wrapper; pertahankan deny client | Fresh clock-out + legacy bypass denial. |
| `auth_rate_limit(text,integer)` | S; hashed subject, bounded attempts; pertahankan server-only | Auth/biometric rate-limiter use. |
| `biometric_cleanup_claim()` | S; cleanup queue; pertahankan server-only | Biometric cleanup ownership/private material. |
| `biometric_cleanup_complete(text)` | S; exact path cleanup acknowledgement | Biometric cleanup contract. |
| `biometric_enroll_server(uuid,text,text,jsonb)` | S; immutable employee/path/hash/descriptor association | Descriptor not client-readable; no self-approval. |
| `biometric_issue_receipt(...)` | S; employee/reference/object/payload + fresh geo/capture binding | Single-use/fresh receipt + model/object/data binding. |
| `biometric_selfie_object(uuid,text)` | S; own storage object id/path; does not trust client object id | Cross-account object rejection. |
| `biometric_server_material(uuid,boolean,boolean)` | S; descriptors only worker; API checks caller before invoking | Descriptor/private grants; API MFA boundary. |
| `biometric_stage_reference(uuid,text)` | S; stage before upload; cleanup candidate | Enrollment stage/upload order. |
| `bootstrap_admin(uuid,text,text,text)` | S; first-admin guard, deterministic employee number and Auth linkage | Bootstrap/retry/linkage. |
| `claim_account_token(text,uuid)` | S; hash, exclusive claim lease | Claim/idempotent finish/single-use. |
| `finish_account_token(uuid,uuid,uuid)` | S; exact token/claim/Auth linkage and idempotent receipt | Correct identity, expiry/replaced-token rejection. |
| `inspect_account_token(text)` | S; valid hash/expiry only, narrow response | Unknown/used/expired token handling. |
| `push_claim(integer)` | S; exclusive lease, opt-in active recipients and unread queue only | Worker lease/result binding/retry. |
| `push_complete(uuid,uuid,integer)` | S; result bound exact claim lease, 410 disables endpoint | Lease ownership + 410 + retry. |
| `push_configure_worker(text,text)` | S; exact Supabase worker URL, wake-only secret | Worker URL allowlist/SSRF. |
| `release_account_token(uuid,uuid)` | S; exact token/claim pair; cannot unconsume | Token lease ownership. |
| `reserve_employee_number()` | S; dedicated next number; no public enrollment | Bootstrap reserved identity. |

## `pg_net`: dependency correction and decision

Pernyataan sebelumnya “tidak ada function public yang mereferensikan `net`” tidak membuktikan bahwa aplikasi tidak memiliki dependency. `private.wake_push_worker()` pada migration `20261018045909_biometric_push_verification.sql` memakai dynamic `net.http_post`. Ia dipanggil `private.enqueue_notification_push()` (trigger notifications) dan `private.dispatch_push_tick()`; fungsi kedua juga menjalankan dispatch follow-up jatuh tempo. Menghapus atau memindahkan fungsi extension tanpa memeriksa rantai ini dapat menghentikan wakeup push walaupun badan RPC public tidak memuat teks `net.`.

Metadata Preview yang dibaca pada 29 Oktober menunjukkan `pg_net 0.20.4`, `extrelocatable=false`, extension namespace `public`, dan routine berada di `net`. Pemilik schema serta seluruh 12 routine adalah `supabase_admin`. Aktor connector `postgres` bukan superuser, bukan anggota pemilik, dan tidak mempunyai `EXECUTE WITH GRANT OPTION`; ia tidak dapat mencabut default PUBLIC secara aman. `anon`/`authenticated` masih memiliki USAGE schema serta EXECUTE efektif pada 12 routine. **Temuan grant extension hosted tetap terbuka.** Jangan menjalankan relokasi atau menandai migration no-op sebagai penutupan.

Prosedur terpisah [restrict-network-extension-managed-owner.sql](../supabase/deployment/restrict-network-extension-managed-owner.sql) memerlukan pemilik terkelola/platform support, memeriksa hak pemilik sebelum perubahan, mencabut akses public/anon/authenticated, mempertahankan hak service yang sebelumnya ada serta dependency pemilik `wake_push_worker`, dan gagal atomik bila ACL tidak dapat dicapai. File ini bukan migration aplikasi dan tidak menulis migration history. Harness MFA lokal membuktikan penolakan aktor nonpemilik tanpa perubahan ACL, lalu perilaku hardening dengan operator berwenang; hasil lokal tersebut **tidak** membuktikan hardening hosted sudah dijalankan. [Inventory baca-saja](../supabase/deployment/inspect-network-extension-access.sql) disediakan untuk verifikasi operator dan setelah pembaruan extension yang dapat mengembalikan grant PUBLIC.

Akses ke helper wake/config/delivery aplikasi sudah dicabut dari anon/authenticated. Wake HTTP memakai credential khusus wake-only; service-role key dan VAPID private key tidak dimasukkan ke antrean HTTP. Helper menangani kegagalan wake agar delivery antrean dapat retry dan transaksi HR tetap atomik. Keputusan sementara: pertahankan extension agar push tetap bekerja; pemilik tindak lanjut adalah administrator organisasi Supabase/platform support sebelum rilis operasional penuh. Warning lokasi extension dan grant hosted tetap dicatat, dengan peninjauan ulang setelah eksekusi terkelola dan setiap upgrade extension.

## Additions from MFA migration 25

| API | Guard / intended surface | Evidence required |
| --- | --- | --- |
| `auth_access_context()` | Authenticated; returns narrow own actor id, required MFA, current level, allowed/reason. Does not expose role list, sessions, factor ids/seeds or directory. Allowed at aal1 so user can enroll/challenge. | Dedicated MFA DB tests, API boundary tests, frontend challenge/reload/account-switch tests; hosted TOTP enrollment pending until recorded. |
| `auth_mfa_recovery_authorize(uuid,uuid,text)` | H after MFA; other active privileged employee only, immutable factor-id snapshot, actor/key/payload + audit; own recovery refused. | Dedicated MFA DB recovery replay/self-denial tests; actual Admin API factor deletion and re-enrollment still need hosted proof. |
| `auth_mfa_recovery_complete(uuid,boolean)` | Finalisasi service-only terikat request recovery yang diotorisasi; tidak memberikan akses HR aal1. | Kontrak finalisasi diuji pada DB MFA; pemanggil service harus memeriksa ulang otorisasi sebelum menghapus faktor. |

Inventaris source ini tidak dengan sendirinya menaikkan status menjadi “M3 lulus”. Guard source 60 API baseline sudah ditinjau; kontrol MFA dan hasil regresi gabungan harus ditinjau, remote ACL/ref diverifikasi, dan tes hosted dengan sesi nyata diselesaikan sebelum gerbang rilis operasional ditutup.
