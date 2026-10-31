# Panduan, goal dan milestone penutupan empat temuan audit autentikator

Tanggal: 31 Oktober 2026. Target pelaksana: agent implementasi berikutnya.

Status dokumen: rencana implementasi. Penulisan panduan ini belum memperbaiki kode, menjalankan gate aplikasi, melakukan cleanup Auth, atau merilis deployment.

## 1. Goal, prioritas dan acuan

Goal: tutup **ARA-01–ARA-04** dari [audit ulang 30 Oktober](audit-ulang-tiga-temuan-autentikator-2026-10-30.md) dengan perbaikan yang dapat direproduksi dan gate aktif. Login seluruh role tetap menggunakan nomor karyawan dan kata sandi; MFA aplikasi tidak diaktifkan kembali.

Hasil yang dituju:

1. Pembaruan Realtime dan pemulihan channel tetap bekerja setelah rotasi token akun yang sama, sambil mempertahankan form, kamera dan draft.
2. Probe final menolak pelemahan semantik policy, command, grants dan rantai helper sesi, termasuk empat mutation yang lolos pada audit.
3. Seluruh acceptance sesi, Storage, browser, operator network, historical25 dan populated25→26 memiliki assertion yang benar dan dijalankan CI.
4. CLI cleanup benar-benar berjalan pada Windows serta Linux, default aman, dan tidak melaporkan sukses tanpa pekerjaan/validasi yang semestinya.

Urutan acuan saat terjadi perbedaan:

1. Keputusan pengguna dan dokumen ini untuk penutupan empat temuan terbaru.
2. [Audit ulang](audit-ulang-tiga-temuan-autentikator-2026-10-30.md) untuk penyebab, reproduksi dan batas bukti.
3. [Panduan tiga temuan sebelumnya](guide-penutupan-tiga-temuan-autentikator-2026-10-30.md) untuk invariant/acceptance yang masih berlaku.
4. [Panduan penghapusan autentikator](guide-penghapusan-autentikator-2026-10-29.md) untuk keputusan password-only.
5. Dokumen progres lama sebagai histori, **bukan bukti penutupan acceptance yang dibuka kembali oleh audit**.

ARA-01 berprioritas P1. ARA-02, ARA-03 dan ARA-04 berprioritas P2. Jangan menganggap temuan gate verifikasi sebagai bukti telah terjadi kebocoran hosted; audit menemukan kelemahan tes/probe pada database disposable.

## 2. Baseline, scope dan wewenang

Snapshot berikut berasal dari workspace/audit; verifikasi lagi ketika mulai eksekusi:

| Komponen | Baseline yang diketahui |
| --- | --- |
| Repository / branch | `yoga12-rgb/hr-rajaklana-jkt` / `codex/preview` |
| HEAD yang diaudit | `ca17c925a2ee50a0b91c82c036f3636d424b1877` |
| Worktree saat penulisan | Dokumen audit ulang belum tracked; pertahankan dan tinjau sebelum staging |
| CodeGraph | `.codegraph/` tidak ada; jika muncul, ikuti AGENTS.md sebelum pencarian source |
| Supabase Preview | `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf` |
| History hosted saat audit | 26 migration, latest `20261030033256 / retire_application_authenticator` |
| Migration26 lokal | `20261030031318_retire_application_authenticator.sql`; timestamp berbeda adalah mapping yang diketahui |
| Kontrak policy | 29 tabel public + `storage.objects`, restrictive `privileged_mfa_session`, command `*`, pemeriksaan `private.session_allowed()` |
| Preview frontend | `https://hr-rajaklana-jkt-preview.vercel.app` |
| Gate historis | 37 file / 467 unit test lulus; angka tersebut bukan target jumlah setelah perbaikan |

Tugas saat ini hanya menyusun panduan. Ketika pengguna memerintahkan **eksekusi dokumen ini**, scope implementasi mencakup perbaikan lokal, commit/push `codex/preview`, CI dan deployment Preview yang identitasnya cocok. Production dan `main` berada di luar scope. Jangan meminta ulang keputusan password-only atau meminta secrets melalui chat.

Empat temuan ini terutama menyangkut state, probe, fixture, CLI dan pengujian. Jangan membuat migration sekadar untuk mengubah tes. Jangan edit migration yang sudah applied, replay migration26, repair history, downgrade/reset hosted, menghapus audit/data operasional, atau menjalankan `db push` generik yang mengabaikan mapping versi. Jika ditemukan kebutuhan perubahan SQL aplikasi yang nyata, buat migration maju melalui CLI setelah memverifikasi baseline dan rencana dampaknya.

Gunakan skill Supabase untuk pekerjaan Auth/RLS/Storage/database, dan skill Vercel yang relevan ketika memeriksa/merilis deployment atau mengakses Preview yang terproteksi. Ikuti versi CLI/SDK yang benar-benar terpasang. Jangan menggunakan service key sebagai pengganti sesi pengguna pada uji workflow.

## 3. Invariant yang tidak boleh berubah

- JWT upstream, live session, active employee/account dan binding `session.user_id=auth.uid()` tetap diperiksa. `session_id` harus valid, ada, dan `not_after` belum terlewati.
- `aal1` tanpa faktor cukup untuk semua role sesuai haknya; legacy `aal2` sah tetap kompatibel. Faktor/AAL tidak menjadi sumber privilege.
- Role, capability, outlet/team scope, larangan self-approval, RLS dan privasi Storage tetap berlaku.
- Revalidasi token akun yang sama menjaga mount UI, tetapi aksi protected baru ditahan sampai akses terbaru sah. Context denied/malformed/error, account switch dan logout tetap fail-closed.
- Kegagalan refresh data sementara pada sesi yang sudah tervalidasi tidak boleh kembali memicu logout/unmount. Bedakan dari kegagalan validasi Auth.
- Respons akun/token/generasi lama tidak dapat mempublikasikan data, membuat ulang channel, atau menyimpan draft sebagai akun baru.
- Transaksi atomik, version/baseline/revision checks, audit, history, receipts serta **key dan payload asli replay** tetap dipertahankan.
- Draft/recovery terisolasi per akun dan proyek. Rotasi token tidak membuat operation key baru untuk attempt ambigu.
- Biometrik absensi, GPS, radius/akurasi, selfie dan freshness capture tetap aktif. Tes kamera tidak boleh mematikan pemeriksaan tersebut.
- Recovery aplikasi tetap HTTP410 dan RPC tombstone. Alat operator tidak dihubungkan kembali ke UI/Edge sebagai recovery MFA.
- Mutation grants/claims/session dan penghapusan objek fixture hanya pada database lokal disposable. Jangan merusak hosted untuk membuktikan probe.

## 4. Urutan milestone dan checkpoint

Saat eksekusi dimulai, buat `docs/progres-penutupan-empat-temuan-autentikator-2026-10-31.md`. Jalankan milestone berurutan. Checkpoint adalah catatan yang dapat ditinjau, bukan kewajiban berhenti meminta konfirmasi setelah setiap tahap.

| Milestone | Fokus | Output / syarat lanjut |
| --- | --- | --- |
| AUR-00 | Baseline dan reproduksi | Inventory source/history, empat reproduksi, matriks acceptance→test→command; status lama dikoreksi |
| AUR-01 | ARA-01: lifecycle Realtime | Event + reconnect setelah rotasi berfungsi; stale account/channel tetap ditolak; UI tidak di-reset |
| AUR-02 | ARA-02: probe semantik | Kontrak final dan mutation gates lengkap; baseline sehat aman diulang |
| AUR-03 | ARA-03: sesi/Storage/API/network/historical25 | Fixture benar, negative cases tepat, operator network dan historical25 aktif dalam gate |
| AUR-04 | ARA-03/01: browser rotasi dan replay | Form/camera/mount + perubahan Realtime + persist/reload/retry terbukti pada live-mock |
| AUR-05 | ARA-03: upgrade populated | Snapshot recovery/receipt/audit lengkap; seluruh jalur upgrade final diuji |
| AUR-06 | ARA-04: CLI Windows/Linux | Entrypoint portabel, subprocess tests, dry-run dan manifest retry aman |
| AUR-07 | Integrasi gate dan CI | Seluruh harness wajib terhubung dan lulus; JSON browser tanpa skipped/flaky |
| AUR-08 | Rilis Preview dan hosted | SHA/CI/deployment/ref cocok, probe read-only dan smoke yang tersedia tercatat |
| AUR-09 | Penutupan dan handoff | Acceptance per temuan terbukti, koreksi progres, residual hosted/perangkat terpisah |

Jangan menunda semua pekerjaan lokal karena uji perangkat/offline ditunda pengguna. Selesaikan yang mandiri dahulu; minta login pengguna hanya jika benar-benar dibutuhkan untuk sisa workflow hosted, tanpa meminta credential.

## 5. AUR-00 — baseline dan reproduksi

1. Catat branch, HEAD, worktree, remote dan file existing. Baca audit serta source terkait. Tes reproduksi sementara audit sebelumnya sudah dihapus; implementasi berikutnya harus membuat regresi terpelihara yang masuk Git/CI.
2. Bandingkan perubahan baru jika HEAD telah bergerak. Jangan menghapus perbaikan agent lain atau memaksakan snapshot lama.
3. Inventaris 26 ordered migration names/versions dan mapping hosted. Verifikasi identitas Preview sebelum query remote; gunakan katalog baca-saja, bukan dump employee/session/secrets.
4. Reproduksi ARA-01: init→SUBSCRIBED→token baru untuk user/AAL sama→revalidasi selesai→emit UPDATE→tunggu debounce; baseline tidak melakukan read tambahan. Uji pula aal2→aal1. Cegah polling/focus/manual refresh menyamarkan kegagalan.
5. Reproduksi empat mutation ARA-02 dengan probe asli: Storage `OR 1=1`, policy `FOR UPDATE` saja, grant helper mentah kepada authenticated, dan `session_allowed()` selalu true. Baseline audit menerima semuanya; hasil yang dituju adalah penolakan spesifik.
6. Reproduksi ARA-03: jalankan harness MFA historis langsung; baseline menerapkan26 lalu gagal pada probe25 sebelum operator network berjalan. Inventaris tes Storage/sesi yang tertinggal serta judul “no factor” dengan faktor verified.
7. Reproduksi ARA-04 di Windows: `node supabase/deployment/cleanup-auth-factors.mjs --help` keluar0/output kosong. Simpan stdout/stderr/exit, jangan menyimpulkan berhasil hanya dari exit0.
8. Tambahkan addendum pada progres lama bahwa ARA-01–04 membuka kembali penutupan terkait. Pertahankan hasil historis dan referensinya; jangan menulis ulang seolah tes yang hilang pernah dijalankan.

Checkpoint: penyebab, expected/actual, source SHA dan command reproduksi dicatat. Reproduksi red boleh gagal; gate penutupan harus kemudian green tanpa menghapus assertion.

## 6. AUR-01 — pulihkan Realtime tanpa menghilangkan guard

Peta source: `src/lib/state/app.ts`, `src/lib/state/realtime-recovery.test.ts`, `src/lib/types.ts`, `src/routes/(app)/+layout.svelte`, serta lifecycle SDK yang terpasang.

Penyebab baseline: rotasi token menaikkan `authRevision`, channel dipertahankan berdasarkan userId, tetapi callback masih memegang revision lama. Early return pada `createRealtimeChannel()` membuat callback event/status selamanya stale terhadap revision baru.

Pilih desain yang eksplisit dan dokumentasikan alasan:

- Pisahkan revision request/token dari generasi subscription/identitas akun, sehingga channel sah tidak terikat revision token yang sudah usang; atau
- Ganti channel dengan instance baru setelah context token terbaru sah, dengan cleanup/generation guard yang menjaga satu instance aktif dan UI tetap mounted.

Jangan menghapus guard revision/account dari semua callback. Jangan sekadar mengubah angka revision pada callback lama tanpa memikirkan event akun lama, timer retry, removeChannel yang tertunda, dan dua rotasi berurutan. Jangan subscribe ulang instance terminal SDK yang hanya boleh join sekali.

Tes unit wajib:

| Skenario | Bukti wajib |
| --- | --- |
| aal1→aal1 token-only, user tetap | UPDATE nyata pada callback memicu read setelah debounce, tanpa polling/manual refresh |
| Legacy aal2→aal1 sah | UI tetap mounted, event tetap dikonsumsi, tidak ada syarat faktor |
| Token berubah melalui callback dan dideteksi `refreshNow()` tanpa event | Kedua jalur memulihkan data/channel sesuai generasi terbaru |
| Dua rotasi, context/response tertunda atau terbalik | Tidak ada stale publish, state revalidasi tidak macet |
| CLOSED/TIMED_OUT sesudah rotasi | Status koneksi berubah; backoff mengganti instance dan menerima event kembali |
| Offline→online, focus/visibility sesudah rotasi | Recovery bekerja; event channel lama tetap diabaikan |
| A→B/logout ketika fetch/timer/remove tertunda | Data/channel A dibersihkan; callback/timer A tidak membuat channel atau data A untuk B |
| Context denied/malformed/error, inactive/revoked | Cabut akses; protected read/write baru tidak terjadi |
| Refresh data sementara gagal setelah context sah | Form/draft bertahan, error/retry terlihat; tidak logout seperti regresi `469a12a` |

Hitung subscribe/remove/channel aktif, bukan hanya `initialized=true`. Setelah rotasi, kirim event kemudian buktikan data berubah. Assert negative channel lama **tidak** memicu read setelah diganti/logout. Gunakan fake timer/event barrier yang dikendalikan, bukan sleep panjang atau kebetulan timer60 detik.

Checkpoint: red→green ARA-01, daftar channel/generation assertions, akun yang diuji, dan bukti mount lanjutan dari AUR-04.

## 7. AUR-02 — perketat probe dan negative tests

Peta source: `supabase/deployment/verify-authenticator-removed-preview.sql`, `supabase/tests/authenticator-removal.mjs`, helper migration25/26 sebagai acuan immutable, dan probe25 historis yang tetap terpisah.

### 7.1 Kontrak yang wajib diperiksa

- Probe final `BEGIN READ ONLY`, transaksi diakhiri jelas, tanpa fixtures/claims/audit/config/migration mutation.
- Ordered names lengkap dari ekspektasi ter-review independen, bukan daftar yang dibentuk dari database sasaran. Periksa mapping versi lokal/hosted yang diketahui; drift baru harus ditinjau. Jumlah26 atau batas `>=` saja tidak cukup sebagai identitas history.
- Seluruh29 tabel public dan Storage ada, RLS aktif, policy restrictive dengan nama yang benar, **`polcmd='*'`**, target role sesuai kontrak tepat, USING dan WITH CHECK sama-sama menegakkan sesi.
- Gunakan pemeriksaan bentuk ekspresi yang diizinkan secara ketat. Bentuk katalog aktual `(SELECT private.session_allowed())` dapat berbeda whitespace/alias dari source; dukung variasi yang sudah ditinjau dan diuji. Jangan hanya mencari substring lalu memblokir kata `true`: `OR 1=1`, `COALESCE(...,true)`, CASE, negasi atau disjungsi dapat mengubah makna.
- Rantai `raw_employee_id→session_access_context→session_allowed→employee_id/require_employee→require_hr` serta wrapper `auth_access_context` tetap mengandung validasi yang diwajibkan. Cek SECURITY DEFINER/search_path dan definisi/kontrak yang independen. Teks nama function dalam komentar bukan dependency yang sah. Strict source fingerprint/allowlist atau inspeksi terstruktur boleh dipakai jika batas variasinya didokumentasikan dan diuji pada lokal/hosted.
- Guard yang `SELECT true` atau context `allowed=true` tanpa validasi tidak boleh lolos. Behavioral test pada baseline bersih tidak menggantikan deteksi helper yang dilemahkan dalam mutation.
- Hak authenticated yang memang diperlukan: `private.employee_id()`, `private.session_allowed()` dan `public.auth_access_context()`. Helper internal `raw_employee_id`, `session_access_context`, `require_employee`, `require_hr` tidak dibuka langsung kepada authenticated. Anon/PUBLIC tidak mendapat akses helper tersebut. Periksa privilege efektif, termasuk pewarisan; pertahankan hak internal/service yang memang sesuai kontrak ter-review.
- ACL11 tabel operasional tetap SELECT/RPC-only untuk authenticated; anon tidak mendapat hak. Workflow private/account-token/roster batch/recovery tetap tertutup, RLS aktif.
- Kedua RPC recovery retired tidak callable PUBLIC/anon/authenticated/service_role dan definisi tombstone tidak kembali menjadi jalur faktor aktif. Context final selalu password-only sesuai invariant.

### 7.2 Mutation matrix minimum

Gunakan disposable DB independen atau restore yang terkontrol. Satu mutation harus sudah aktif sebelum probe dijalankan; error setup/transaction aborted tidak boleh dihitung sebagai deteksi.

| Kelompok | Mutation wajib |
| --- | --- |
| Semantik Storage | Literal true, `session_allowed() OR true`, `session_allowed() OR 1=1`, dan bentuk ekuivalen always-allow yang berisi nama helper |
| Policy | Hilang, RLS disabled, permissive, `FOR UPDATE` saja, target role salah/lebih luas, USING/WITH CHECK hilang atau dilemahkan |
| ACL operasional/private | INSERT authenticated pada `shift_handovers`, akses anon, privilege workflow private yang tidak diizinkan |
| Helper | Grant raw helper ke authenticated; `session_allowed()` selalu true; context selalu allowed sambil mempertahankan teks `requires_mfa`; rantai helper putus/komentar decoy |
| Recovery | Grant setiap role tak diizinkan pada kedua RPC, grant PUBLIC/inherited, tombstone aktif kembali |
| History | Nama salah dengan count tetap, urutan salah, migration ekstra/hilang, versi/mapping di luar kontrak |

Setiap kasus: baseline sehat→mutation→probe ditolak dengan alasan spesifik→restore/drop fixture→baseline lulus lagi. Tes baseline probe dua kali dan snapshot katalog sebelum/sesudah identik. Karena probe mengelola transaksinya sendiri, jangan mengandalkan nested BEGIN/COMMIT yang merusak isolasi test.

Checkpoint: tabel setiap mutation dengan expected/actual/alasan; empat mutation audit sebelumnya semuanya red→green. Jangan mengubah policy hosted untuk tes ini.

## 8. AUR-03 — pulihkan gate sesi, Storage, API, operator dan historical25

Pisahkan tiga kontrak: **historical25**, **final password-only26**, dan **operator managed-network lokal**. Semua harness wajib masuk command aggregate yang dijalankan CI.

### 8.1 Historical25 dan fixture final

- Batasi `mfa-enforcement.mjs` dan probe25 tepat sampai `privileged_account_mfa_enforcement`, berdasarkan nama/versi ter-review dengan assertion batas, bukan menerapkan semua migration dari folder.
- Historical25 boleh menggunakan verified factor/aal2 secara eksplisit. Jangan memaksa expectation MFA itu ke final26 atau menghilangkannya agar lolos.
- `fixtureSession` final default aal1 tanpa faktor. Buktikan SQL count faktor0. Session UUID berbeda dari Auth user UUID; jangan membuat binding benar hanya karena ID sama.
- Fixture browser `no factor` harus benar-benar tanpa faktor. Fixture legacy verified dipisah secara eksplisit; tidak boleh memakai objek yang sama lalu hanya mengganti judul tes.
- Pindahkan atau adaptasikan regresi sesi/Storage yang masih relevan ke final26; jangan berhenti hanya karena harness historis sudah hijau.

### 8.2 Matriks sesi dan API

Untuk setiap negative case, mulai dari positive case yang terbukti sah, set **seluruh claims dan session fixture** yang tepat, lalu ubah hanya kondisi yang ditargetkan. Reset role/claims antar kasus.

| Kasus | Cara membuktikan kondisi yang benar |
| --- | --- |
| Missing/malformed session_id | Field absen atau format rusak, dengan employee/account lain tetap aktif |
| Session row hilang | Claims berisi UUID sah yang tidak ada |
| User mismatch | Buat userB dan sesiB nyata; JWT userA menunjuk sesiB; assert sesiB benar-benar ada dan ownerB berbeda |
| Expired `not_after` | Claims menunjuk sesiA yang sebelumnya sah; ubah sesiA menjadi expired dan assert owner/ID sama. Jangan meninggalkan claims UUID yang hilang dari test sebelumnya |
| Revoked session | Hapus/revoke sesiA lokal, token claims tetap menunjuk sesiA |
| Inactive/disabled/binding salah | Ubah kondisi akun/employee yang tepat; session lain tetap sah |
| Legacy aal2/factor absent/unverified/deleted | Session hidup tetap diizinkan; pencabutan session diuji terpisah |
| Context null/rusak/error/metadata palsu | UI/server fail-closed sebelum protected reads/service work |

Admin HR, SPV sesuai capability, Head Baker/approver dan kasir aal1 diuji dengan izin/scopenya. Aksi HR oleh kasir, outlet/team lain dan self-approval harus ditolak tanpa row/audit sukses baru. Handler API asli tetap menguji `getUser→user-context→employee binding→service work`; mock HTTP410 saja bukan bukti Edge asli tidak memanggil list/delete factor.

### 8.3 Storage

Seed objek selfie dan issue-photo dengan ID/bucket/path tepat pada DB disposable. Jalankan sebagai authenticated, bukan role bypass RLS.

1. Sesi pemilik sah: operasi yang diizinkan benar-benar berhasil. Cross-account dan referenced evidence tetap ditolak/immutable.
2. Session revoked/hilang/expired, inactive dan disabled: ulangi SELECT/INSERT/DELETE; objek tepat tetap ada dan tidak ada insert baru.
3. Sertakan `DELETE FROM storage.objects` tanpa WHERE dan tanpa RETURNING agar predicate cleanup issue-photo tidak terlindung secara kebetulan oleh SELECT policy.
4. Setelah DELETE, reset role lalu hitung/periksa ID objek spesifik. DELETE0 row tanpa error adalah denial yang sah; `assert.rejects` saja tidak cukup.
5. Recovery fixture positive kembali untuk membuktikan denial berasal dari kondisi sesi, bukan policy/fixture yang sejak awal rusak.

### 8.4 Managed-network operator

Gunakan fixture schema `net`, tanpa HTTP keluar. Pulihkan regresi operator dari harness lama ke gate aktif:

- Default PUBLIC grants direproduksi.
- Non-owner ditolak sebelum ACL berubah; snapshot sebelum/sesudah identik.
- Owner lokal sah menjalankan operator; anon/authenticated kehilangan akses.
- Service hanya mempertahankan akses yang sebelumnya efektif, owner-only function tidak tiba-tiba terbuka.
- `private.wake_push_worker()` tetap dapat memanggil dependency fixture dan invocation tercatat lokal.
- Inventory read-only tidak memutasi grants.

Ini menutup cakupan tes operator; bukan izin menjalankan managed-owner procedure pada hosted. Jangan mengubah owner/role hosted untuk mengakalinya atau memakai hosted postgres sebagai managed owner.

Checkpoint: acceptance→test→command CI untuk setiap baris. Log harus membedakan historical25, final26, Storage dan operator; kata “semua lulus” tanpa wiring bukan bukti.

## 9. AUR-04 — live-mock browser yang menguji rotasi sebenarnya

Tambahkan skenario terpelihara di `tests/live-*.spec.ts`, memakai client/SDK Auth aplikasi terhadap backend terisolasi. Jangan mengubah store langsung sebagai pengganti event/rotasi SDK.

- Bentuk token fixture berbeda dengan user/AAL sama dan counter refresh yang dapat diamati. Jalankan SDK refreshSession atau alur rotasi SDK yang sesuai; jangan mengembalikan token identik dari `/auth/v1/token`.
- Tahan response context agar frame revalidasi teramati; gunakan barrier request/resolution, lalu lepaskan secara deterministik.
- Form cuti dan form karyawan: isi field, buka dialog, catat URL/node mount marker sebelum rotasi. Saat context tertunda dan sesudah sah, dialog/input/node tetap sama; protected save baru ditahan selama validasi.
- Absensi: perangkat kamera palsu Playwright, stream aktif, capture selfie, rotasi dalam umur capture sah. Buktikan track/modal/preview/selfie tetap ada dan tidak memicu onDestroy/close. Kendalikan waktu/freshness dan GPS dengan benar; izin/freshness tetap ditolak jika memang invalid.
- Sesudah rotasi, kirim perubahan Realtime yang benar-benar melewati channel/SDK yang digunakan aplikasi; buktikan pembaruan UI tanpa reload/focus/polling60 detik. Jika memakai fixture transport WebSocket, dokumentasikan boundary yang diuji. `dispatchEvent` untuk focus atau mutasi store tidak membuktikan channel berfungsi.
- Uji terminal/reconnect sesudah rotasi serta A→B/logout dengan delayed response/event; data/dialog/draft A tidak muncul sebagai B.
- Roster, follow-up dan konfigurasi: persist pending attempt→rotasi→reload→retry. Assert request body dan operation key persis asli, receipt/result sesuai, write/audit sekali. Conflict review tetap menjaga draft dan baru membuat key baru sesudah server memastikan attempt lama tidak tersimpan.

Tes terarah boleh membantu red→green. Gate final tetap menjalankan **semua** live-mock, bukan hanya filter satu skenario. Bukti kamera demo tidak menggantikan kamera live-mock yang mengalami rotasi JWT.

Checkpoint: artifact/traces dan assertion mount/input/stream/Realtime/replay, disertai akun, env fixture, source SHA dan stats. Pisahkan uji lokal dari perangkat nyata.

## 10. AUR-05 — integritas upgrade dan populated history

Peta source: `supabase/tests/followup-upgrade-compatibility.mjs`, migration25/26 immutable, `preflight-followup-off-compatibility.sql`, `preflight-supervisor-operational-hardening.sql`.

| Jalur fixture lokal | Acceptance |
| --- | --- |
| Fresh final26 | Semua migration, probe final dan behavior password-only lulus |
| Historical25 tepat | Probe/behavior MFA historis lulus; berhenti sebelum26 |
| Populated25→26 | Isi recovery/receipt/audit/data bisnis sebelum/sesudah26 identik |
| 24→25→26 | Forward-only, checkpoint25 terpisah, final aal1 tanpa faktor dan legacy aal2 sah |
| 18→final26 | Lanjut setelah checkpoint25; preflight hardening pada batas21 sebelum22; final password-only diuji, bukan berhenti18→25 |
| Historical12→13→final26 | Reproduksi CHECK failure sebelum14 tanpa preflight; preflight Libur pada13 sebelum14, hardening pada21 sebelum22; lanjut sampai26 |
| Hosted Preview aktual26 | Katalog/probe read-only; tidak downgrade/reset untuk merekonstruksi jalur di atas |

Uji preflight refusal di luar baseline dan idempotensi pada batas yang tepat, tanpa rewrite/delete data. Historical12/13 memiliki kegagalan sebelum migration baru sempat berjalan; jangan berharap migration26 memperbaiki urutan lama secara retroaktif.

### Snapshot populated25 yang wajib nonkosong

1. Recovery rows status nyata `pending`, `failed`, `completed`, dengan actor/target/request key, Auth linkage, reason, factor_ids sintetis, created/completed timestamps yang sesuai constraints. Jangan memakai status `authorized` yang tidak ada di schema.
2. Audit authorization/completion terkait, serta kasus terbuka/selesai, roster, employee/roles, konfigurasi dan revision yang relevan.
3. Receipts representatif pada tabel yang terkait workflow ini: `private.spv_followup_receipts`, `private.supervisor_configuration_receipts`, `private.supervisor_planning_receipts`, `private.outlet_issue_receipts`, `private.shift_handover_receipts`, `private.shift_exchange_receipts`, serta `public.cashier_roster_batches`. Catat payload/fingerprint/hash/key/result/actor/timestamp sesuai schema aktual. Jika tabel penting lain ikut invariant fixture, inventaris dan sertakan.

Gunakan RPC historis yang sah bila memungkinkan; insert fixture langsung boleh untuk record khusus tetapi harus memenuhi constraints dan memodelkan actor/Auth target secara konsisten. Assert jumlah/status/nonkosong **sebelum** mengambil snapshot supaya `null==null` atau array kosong tidak dianggap bukti.

Ambil JSON deterministik berurutan berdasarkan key stabil; jalankan migration26 saja; bandingkan **seluruh isi** snapshot immutable. Pending/failed tidak boleh berubah menjadi completed. Setelah26 buktikan final context password-only dengan session sah; receipt replay tetap mengembalikan hasil/key asli setelah upgrade. Jangan hanya menghitung row atau memeriksa tabel ada.

Checkpoint: log per jalur final, daftar tabel/kolom snapshot, status yang benar-benar ditanam, bukti nonkosong dan equality. Perbaiki klaim progres lama `pending/failed/completed` yang sebelumnya hanya ditopang fixture failed.

## 11. AUR-06 — perbaiki CLI dan uji proses sebenarnya

Peta source: `supabase/deployment/cleanup-auth-factors.mjs`, `cleanup-auth-factors.test.mjs`, `package.json`, CI.

- Deteksi direct invocation dengan konversi path portabel, misalnya `pathToFileURL(resolve(process.argv[1])).href`, dengan guard argv. Jangan membuat `file://` manual; path Windows/spasi/non-ASCII/karakter URL harus diperlakukan sebagai path.
- Import modul tidak menjalankan `main()` atau I/O CLI. Direct invocation benar-benar memanggilnya.
- Pertahankan CLI default dry-run. Jalur `--execute` yang saat ini sengaja membutuhkan adapter eksplisit boleh tetap ditolak dengan exit nonzero/pesan yang jelas. Jangan menambah koneksi hosted/cleanup nyata hanya untuk membuat tes execute sukses.
- API embedding/provider test menggunakan fake Auth Admin terarah. Adapter nyata, bila diperlukan dalam scope yang diotorisasi, hanya memakai Auth Admin API resmi; tidak SQL DELETE managed Auth.
- Manifest memakai project/user/factor/key asli. Validasi target/linkage/fingerprint dan TOTP-only, tolak perubahan target/payload, jangan menyapu faktor baru di luar manifest atau akun orphan/shared yang belum dipetakan.
- Dry-run tidak delete. Partial/ambiguous delete→re-list ID asli→retry manifest yang sama; observed absence dilaporkan jujur. Perubahan manifest/result harus tersimpan atomik dan dapat dimuat ulang; tidak menyimpan/mencetak secret.

Subprocess tests memakai `process.execPath` dan array argument tanpa shell, bukan hanya import function:

| Kasus | Expected |
| --- | --- |
| `--help` Windows/Linux | Exit0, usage nonkosong, tanpa provider/delete/persist |
| Import modul | Tidak ada output/I/O/eksekusi main |
| Path script/manifest dengan spasi dan non-ASCII | Invocation benar, hasil/validasi teramati |
| Manifest valid, tanpa execute | Dry-run benar-benar berjalan, result tersimpan, factor/key/target tetap sama, delete0 |
| File hilang, JSON rusak, manifest/linkage/fingerprint/target salah | Pesan relevan + exit nonzero, tanpa perubahan/delete |
| `--execute` tanpa adapter sesuai kontrak CLI | Ditolak eksplisit nonzero; bukan diam-diam exit0 |
| Provider fake partial error/timeout sesudah delete | Tidak klaim sukses palsu; reload/retry memakai manifest/ID asli, faktor baru tidak tersapu |

Jalankan subprocess yang relevan di runner Windows dan Linux, atau tambah job Windows terarah untuk harness CLI yang diperlukan. Gate Linux saja tidak membuktikan perbaikan Windows; simulasi string URL saja juga tidak menggantikan direct invocation di Windows.

Snapshot hosted sebelumnya0 faktor; jangan enroll/hapus faktor nyata untuk merekonstruksi bukti lama. Tidak ada kebutuhan secret untuk milestone ini.

## 12. AUR-07 — gate lokal dan CI

Wire seluruh harness historical25, final26, probe-mutation, sesi/Storage, network operator, cleanup subprocess dan upgrade ke scripts terpelihara yang dijalankan CI. Nama harness boleh berubah; perintah di progres harus cocok dengan yang benar-benar dijalankan. Perbarui komentar/log yang menyebut coverage yang belum aktif.

Jalankan pada source akhir:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
node supabase/deployment/verify-readiness-preview.test.mjs
npm.cmd run build
npm.cmd audit --audit-level=moderate
git diff --check
```

Jika ada harness wajib di script terpisah, jalankan eksplisit lalu hubungkan ke CI sebelum status selesai. Jangan menganggap test skipped, log buatan, error setup, atau assertion yang dihapus sebagai keberhasilan. Gunakan mekanisme eskalasi normal bila sandbox/binary/jaringan menghalangi; catat penyebab dan hasil retry. Advisory4 low sebelumnya adalah hasil historis, verifikasi ulang tanpa `audit fix --force` atau menurunkan threshold untuk menyembunyikan masalah.

### Live-mock terisolasi

Server pada port bebas milik task:

```powershell
$env:PUBLIC_APP_ENV='preview'
$env:PUBLIC_SUPABASE_URL='http://127.0.0.1:54329'
$env:PUBLIC_SUPABASE_ANON_KEY='sb_publishable_isolated_audit_mock'
npm.cmd run dev -- --port 5198 --strictPort
```

Runner setelah server siap:

```powershell
$env:E2E_LIVE_SUPABASE_MOCK='1'
$env:E2E_PWA=''
$env:E2E_BASE_URL='http://127.0.0.1:5198'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/aur-live.json'
npm.cmd run test:e2e -- 'live-.*\.spec\.ts' --reporter=line,json --forbid-only --retries=0 --output=test-results/aur-live
```

### Demo/PWA production build terpisah

Gunakan env bersih sebelum build; hentikan hanya server fixture milik task jika perlu memakai port yang sama:

```powershell
$env:PUBLIC_APP_ENV='development'
$env:PUBLIC_SUPABASE_URL=''
$env:PUBLIC_SUPABASE_ANON_KEY=''
npm.cmd run build
npm.cmd run preview -- --port 5198 --strictPort
```

Runner terpisah:

```powershell
$env:E2E_LIVE_SUPABASE_MOCK=''
$env:E2E_PWA='1'
$env:E2E_BASE_URL='http://127.0.0.1:5198'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/aur-demo-pwa.json'
npm.cmd run test:e2e -- tests/demo.spec.ts --reporter=line,json --forbid-only --retries=0 --output=test-results/aur-demo-pwa
```

Gunakan Chromium di CI; Windows lokal boleh Edge yang tersedia. Jalankan seluruh kelompok wajib dan validasi JSON: `expected>0`, `skipped=0`, `unexpected=0`, `flaky=0`. Pertahankan checker yang menolak incomplete result. Jangan menjalankan kelompok demo pada build yang masih mengandung URL mock.

PWA lokal membuktikan controller/cache shell, pengecualian data dinamis dan offline shell. Update/tab lama/perangkat nyata dilaporkan terpisah. CLI Windows yang diperlukan dapat diuji mandiri tanpa meminta perangkat pengguna.

## 13. AUR-08 — commit, Preview dan hosted

Setelah milestone lokal lulus dan eksekusi panduan diotorisasi:

1. Review diff/staged files, branch/remote dan target project/team Vercel. Sertakan audit/panduan task yang belum tracked bila tepat; jangan stage manifest/secrets/file unrelated.
2. Verifikasi ulang ref/nama/organisasi Supabase Preview dan history aktual. Pada baseline26 jangan menjalankan preflight13/21 atau replay migration26. Catat mapping yang benar.
3. Commit/push hanya `codex/preview`. Cocokkan SHA CI dan source deployment, alias/environment serta server API yang dirilis. Semua job wajib, termasuk CLI Windows bila ditambahkan, harus selesai sukses.
4. Jalankan probe final yang sudah diperketat pada hosted dalam transaksi read-only. Mutation tests tetap lokal. Catat hasil katalog/advisor dan masalah owner-managed secara terpisah.
5. Smoke mandiri: route/aset/env ref, recovery410 dari handler yang benar, history/grants/policy/helper katalog; gunakan mekanisme Vercel resmi jika terproteksi. Response200 halaman proteksi/login Vercel tidak membuktikan aplikasi terbuka; periksa konten/tujuan yang sebenarnya.
6. Jika sesi pengguna tersedia, verifikasi workflow form/Realtime/reload sesuai role. Jika belum ada, selesaikan seluruh pekerjaan mandiri lalu minta login di aplikasi. Jangan mengambil credential dari chat atau memakai admin/service key untuk menyamar sebagai workflow user.
7. Cocokkan bukti ke source akhir setelah semua edit. Dokumentasi yang dipush belakangan dapat memicu CI/deployment baru; catat jelas SHA kode yang diuji dan SHA dokumentasi/HEAD terakhir tanpa mengklaim keduanya identik sebelum diperiksa.

Deployment READY hanya menutup rilis. Workflow hosted harus mempunyai assertion API/data/UI aktual. Bila bug implementasi ini muncul pada hosted, perbaiki maju; jangan rollback ke UI MFA lama yang dapat mengunci akun setelah faktor dihapus.

## 14. AUR-09 — penutupan dan handoff jujur

| Temuan | Syarat penutupan |
| --- | --- |
| ARA-01 | Token-only dan legacy refresh tetap mengonsumsi event; reconnect/terminal/race/account isolation lulus; form/camera/replay live-mock terjaga; rilis/status hosted jelas |
| ARA-02 | Semua mutation wajib ditolak dengan alasan tepat; baseline aman diulang; command/expr/helper/grants/history lengkap; katalog Preview sesuai |
| ARA-03 | Semua acceptance punya assertion dan command CI aktif; fixture tanpa faktor benar; mismatch/expiry/Storage tepat; network/historical25/final26/upgrade/receipt equality lengkap; browser rotasi benar |
| ARA-04 | CLI actual process Windows/Linux terbukti; help/dry-run/error/execute terbatas/import/reload-retry benar; tidak ada cleanup faktor nyata |

Gunakan tabel progres per milestone:

`ID | status lokal | SHA/ref | file/perubahan | command/env | expected/pass/fail/skipped/flaky | artifact | hosted/deployment | dampak data/Auth/audit | sisa/sebab`.

Pada laporan akhir pisahkan minimal:

- Implementasi dan gate lokal.
- CI dan deployment Preview dengan SHA/URL/run.
- Katalog hosted serta workflow akun hosted yang benar-benar diuji.
- Operator/cleanup Auth sintetis dan bukti historis yang tersedia.
- Perangkat nyata/PVR-02 yang ditunda.

Status residual yang tidak otomatis tertutup:

- AUTH-06 effective TOTP toggle Preview: perlu verifikasi scoped tersendiri; endpoint publik settings bukan bukti field yang tidak diekspos.
- AUTH-04 histori cleanup: nol faktor adalah observed absence, bukan bukti freeze/drain/manifest masa lalu. Jangan merekonstruksi histori sebagai fakta.
- Managed pg_net hosted: owner/support procedure terpisah; lulus fixture operator tidak sama dengan ACL hosted sudah ditutup.
- iPhone/iPad, offline/update/tab lama dan workflow lintas role hosted tetap terbuka jika belum diuji. Jangan meminta uji perangkat yang ditunda sebagai syarat menyelesaikan semua lokal.

Tambahkan koreksi pada progres lama yang mengklaim form/camera, network, semantic probe, atau `pending/failed/completed` telah terbukti padahal belum. Pertahankan histori keberhasilan tes lama sebagai histori. Pernyataan task selesai harus merujuk acceptance, bukan jumlah tes atau satu status “semua selesai”. Tidak ada klaim Production ready dari panduan ini.

## 15. Prompt eksekusi untuk agent berikutnya

> Kerjakan `docs/guide-penutupan-empat-temuan-autentikator-2026-10-31.md` dengan teliti. Mulai AUR-00 dan jalankan milestone berurutan. Tutup ARA-01 dengan Realtime/reconnect yang tetap bekerja sesudah token-only rotation tanpa unmount UI atau melemahkan account/session guards. Tutup ARA-02 dengan probe semantik dan mutation tests yang menolak empat bypass audit serta variasi command/helper/grant/history. Lengkapi gate ARA-03: historical25 bounded, final password-only, mismatch/expiry fixture yang nyata, revoked-session Storage, network operator, browser form/kamera/Realtime/persist-reload-retry, dan snapshot populated25→26 termasuk seluruh status recovery serta receipts. Perbaiki ARA-04 melalui entrypoint CLI portabel dan subprocess tests Windows/Linux, dengan default dry-run dan manifest/key/ID asli retry. Pertahankan transaksi atomik, baseline/version checks, RLS, biometrik absensi, audit/riwayat, original replay payload dan draft per akun/proyek. Jangan edit migration applied atau reset/hapus data. Bedakan Preview baseline26 dari historical12/13 serta batas21 yang membutuhkan preflight. Target hanya `codex/preview` dan Supabase Preview setelah identitas diverifikasi; Production/main di luar scope. Jalankan seluruh gate lokal/live-mock/demo-PWA/CI dan catat bukti tiap checkpoint pada dokumen progres baru. Kerjakan mandiri sebelum meminta login pengguna yang memang diperlukan; jangan meminta secrets. Pertahankan PVR-02/perangkat yang ditunda dan laporkan lokal, deployment, workflow hosted, cleanup/operator serta perangkat secara terpisah. Tes skipped atau deployment READY bukan bukti workflow lulus.
