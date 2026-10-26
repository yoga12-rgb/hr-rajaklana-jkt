# Progres implementasi peningkatan supervisor

Tanggal mulai: **23 Oktober 2026**
Branch sasaran: **`codex/preview`**
Baseline source: **`2eb741b678c0fb36b998873f8b879fdb99eaf8f8`**
Cakupan remote: **Supabase Preview `lypsqrwjzrmuyqtdcegr` dan Vercel Preview saja**. Production dan `main` tidak termasuk.

Dokumen ini mencatat bukti pelaksanaan [guide-goal-milestone-supervisor-2026-10-23.md](guide-goal-milestone-supervisor-2026-10-23.md). Status lokal, deployment, workflow hosted, dan perangkat nyata dipisahkan agar satu jenis bukti tidak dianggap membuktikan jenis lain.

## SPV-00 — baseline dan rancangan

Status: **Lokal lulus**

Commit dan branch:

- Branch `codex/preview`, HEAD awal `2eb741b678c0fb36b998873f8b879fdb99eaf8f8`.
- Perubahan awal hanya dokumen guide yang belum dilacak; tidak ada source atau migration existing yang diubah.

Perubahan perilaku: belum ada pada checkpoint ini.

### Baseline aktual

- `.codegraph/` tidak ada, sehingga penelusuran memakai `rg` dan pembacaan source langsung.
- Supabase CLI **2.111.0**; sintaks `supabase migration new <name>` telah diverifikasi dari help CLI aktual.
- Terdapat **18 migration** forward, terakhir `20261022170000_close_readiness_audit_findings.sql`.
- State Admin saat baseline mengambil seluruh `spv_followups` melalui pembacaan tabel berhalaman internal lalu panel menyaring `workDate` terpilih. Ini menjelaskan mengapa kasus tersimpan kemarin tidak menjadi backlog utama hari ini dan mengapa solusi harus memakai endpoint backlog terbatas, bukan memperluas bootstrap tanpa batas.
- `spv_followup_update` baseline mengunci baris tetapi belum menerima expected revision. Dua Admin yang membaca snapshot sama dapat menyimpan berurutan tanpa konflik yang terlihat.
- Shift Middle baseline tidak mempunyai jam rencana. Domain dengan benar menandainya fleksibel dan tidak mengarang batas masuk; cakupan interval belum dapat dihitung.
- Kontrak yang dipertahankan: row lock transaksi roster, baseline `id`/`updated_at`, receipt idempotensi, replay key dan payload asli, audit, RLS, sinkronisasi konteks kasus, nilai shift `off`, serta draft per akun/minggu.

### Matriks aktor dan kemampuan sasaran

| Aktor | HR follow-up | Kendala outlet | Serah terima | Tukar/pengganti | Cakupan & ringkasan | Konfigurasi |
| --- | --- | --- | --- | --- | --- | --- |
| Kasir aktif | Hanya konteks milik sendiri yang memang diekspos | Buat dan baca laporan sendiri | Buat/kirim milik sendiri; terima yang ditujukan | Buat, respons, baca permintaan terkait | Jadwal/cakupan minimum yang relevan tanpa PII | Tidak |
| Admin HR aktif | Baca/tangani seluruh kasus HR sesuai aturan existing | Baca/tangani sesuai scope; fallback antrian tanpa PIC | Pantau dan tetapkan penerima sah | Putuskan jika bukan peserta | Baca detail HR dan ekspor | Kelola capability, routing, interval |
| Petugas operasional ber-capability | Tidak memperoleh data HR | Baca/tangani hanya irisan capability, outlet, kategori | Hanya dokumen yang ditujukan | Tidak memutus roster | Ringkasan operasional yang tidak membuka PII HR | Hanya jika capability eksplisit |
| Head baker | Hak existing tetap | Tidak bertambah otomatis | Hanya bila menjadi pihak sah | Tidak bertambah otomatis | Sesuai hak existing | Tidak bertambah otomatis |
| Akun nonaktif / anonim | Ditolak | Ditolak | Ditolak | Ditolak | Ditolak | Ditolak |

### Rancangan migration forward-only

1. **Supervisor follow-up queue**: tambah `revision` monoton dan `due_at`, endpoint backlog berfilter/pagination/total, mutasi optimistic concurrency, receipt idempotensi, audit dan outbox atomik.
2. **Supervisor operations**: capability per akun/outlet/kategori, kategori/routing dinamis, laporan kendala beserta event, serah terima terversi, dan permintaan tukar/pengganti dengan receipt serta transaksi jadwal atomik.
3. **Supervisor planning and reports**: kebutuhan interval bertanggal efektif, snapshot jam rencana penugasan, fungsi cakupan interval, dan agregat periode/drill-down aman.

Migration yang sudah diterapkan tidak akan diedit. Upgrade Preview memakai baseline aktual **18→N**. Fixture historis **13→N** tetap menjalankan preflight sebelum migration 14 yang dapat gagal; migration baru tidak dipakai untuk menyamarkan kegagalan tersebut.

### Kompatibilitas deployment

- Database ditambah secara additive lebih dahulu: kolom lama tetap punya default, fungsi baseline tetap tersedia selama frontend transisi, dan RPC baru mempunyai nama/parameter eksplisit.
- Frontend baru mendeteksi kontrak baru melalui RPC dan tidak memerlukan bootstrap HR penuh untuk role operasional.
- Penghapusan kontrak lama tidak termasuk rilis ini. Realtime menambah tabel baru setelah RLS/grants diuji.
- Mutasi baru memakai expected revision atau baseline row, key idempotensi, dan request hash. Replay key sama/body berbeda ditolak; key/body asli dipertahankan pada recovery lokal.

### Pemeriksaan baseline

Waktu: 23 Oktober 2026, Asia/Jakarta.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm.cmd run check` | Lulus, 0 error / 0 warning. |
| `npm.cmd test -- --maxWorkers=1` | Lulus di luar sandbox setelah cache sementara Windows ditolak sandbox; 29 file, **418 tes lulus**. |
| `npm.cmd run test:database` | Lulus; fresh migrations 1–18, database workflow, upgrade Preview 17→18, historical 13→18 dengan preflight, biometric dan push. |
| `npm.cmd run test:database:legacy` | Lulus; refusal/rollback dan known-legacy reset hanya pada fixture PGlite. Tidak ada hosted DDL. |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | Lulus; probe dua kali, rollback equality, dan fail-closed fixture. Probe ini masih baseline tepat 18 dan wajib diganti secara sadar saat N bertambah. |

Konflik/risiko/keterbatasan yang tersisa:

- PVR-02 dan uji iPhone/iPad nyata tetap **terbuka/ditunda pengguna**. Tidak menghambat implementasi lokal, tetapi tidak boleh dilaporkan lulus.
- Bukti hosted dua identitas berbeda belum ada dan akan dipisahkan dari tes lokal/live-mock.
- Pengiriman pengingat lewat scheduler dapat terlambat; backlog/label overdue harus tetap benar tanpa bergantung pada push.

Langkah berikutnya: SPV-01 sampai SPV-03 sebagai checkpoint Tahap A, lalu suite terarah dan live-mock persist/reload/retry.

## Checkpoint implementasi 25 Oktober 2026 — m23 dan verifikasi lokal terbatas

Status: **Database/static lokal, database Preview, serta deployment/HTTP smoke Vercel Preview lulus untuk m23; browser live E2E, workflow pengguna hosted, dan perangkat belum dibuktikan.**

Checkpoint ini mencakup lima migration baru yang semuanya forward-only dan belum mengganti migration lama:

| Migration | Cakupan |
| --- | --- |
| `20261023080451_supervisor_followup_queue.sql` | Backlog follow-up berhalaman, `revision`, tenggat, receipt replay, dan audit/notifikasi atomik. |
| `20261023181824_supervisor_operations.sql` | Capability/routing terlingkup, kendala outlet, serah-terima, serta tukar/pengganti shift. |
| `20261023183130_supervisor_planning_reports.sql` | Kebutuhan interval, snapshot jam rencana, cakupan, dan ringkasan yang dapat ditelusuri. |
| `20261024110000_supervisor_operational_hardening.sql` | Hardening otorisasi/scope, Realtime, riwayat respons, guard absensi/cuti termasuk replacement, pembatalan serta expiry pertukaran. |
| `20261024233053_supervisor_configuration_concurrency.sql` | Konfigurasi kategori/routing/capability berversi, receipt privat, recovery per akun, validasi recipient target-only, dan guard kelayakan replacement. |

### Perilaku yang telah diimplementasikan di worktree

- Follow-up, kendala, serah-terima, penukaran, konfigurasi interval, dan konfigurasi supervisor memakai transaksi RPC, audit/event, serta recovery key/payload per akun. Draft/pending konfigurasi kategori, route, dan capability terisolasi menurut akun dan tidak menggantikan request yang belum pasti.
- Kendala baru tidak lagi diarahkan ke penanggung jawab yang capability `issue_handle`-nya sudah dicabut. Snapshot rute dipertahankan, tetapi ownership baru dikosongkan agar dapat ditugaskan ulang secara sah. Validasi route/PIC menilai capability akun target dalam scope outlet/kategori, bukan authority Admin HR yang sedang mengonfigurasi.
- Serah-terima yang dikirim harus memiliki penerima aktif dan berpenugasan; respons penerima menaikkan versi serta mencatat snapshot versi yang benar-benar dikonfirmasi.
- Kebutuhan interval mengunci record lama sebelum menguji scope, menuntut revision non-null pada update, memeriksa scope lama dan tujuan, menserialkan overlap, serta tidak membolehkan penulisan ulang interval yang sudah berlaku. Replay receipt yang sama tetap dapat mengembalikan hasil awal sesudah revisi berikutnya, tetapi otorisasi scope selalu diperiksa ulang sebelum receipt dibaca.
- Cakupan interval dapat dibaca oleh `coverage_configure` dalam scope-nya tanpa membocorkan identitas karyawan; identitas tetap untuk Admin HR.
- Perencanaan Middle tidak dapat mengubah jam sesudah absensi, termasuk catatan absensi legacy yang tidak memiliki `assignment_id`.
- Pertukaran memakai deadline snapshot jam rencana saat tersedia, memeriksa absensi/cuti penuh/Middle saat submit dan keputusan, dan trigger availability mengunci serta memeriksa cuti penuh kedua pihak untuk swap maupun replacement pada submit/final decision. Untuk replacement, calon juga diperiksa ulang terhadap akun aktif, `can_clock`, izin Middle bila diperlukan, absensi, dan cuti penuh ketika submit maupun tepat sebelum keputusan final. Indeks mencegah permintaan aktif yang tumpang tindih. Cancel oleh pengusul serta expiry eksplisit oleh Admin HR menyimpan receipt, event, audit, dan notifikasi; retry expiry menerima hasil `{expired_count, as_of}` awal yang sama.
- Publication `supabase_realtime` ditambah secara idempoten untuk `outlet_issues`, `shift_handovers`, `shift_exchange_requests`, dan `staffing_interval_requirements`. Klien melakukan fetch ulang yang melindungi draft/pending, bukan merge callback Realtime secara buta.
- Preflight khusus hardening berjalan setelah migration 19–21 dan sebelum m22: data aktif ganda membuatnya fail-closed tanpa mutasi; pada data bersih ia dapat diulang lalu m22 diterapkan. Guard yang sama ada pada m22 sehingga push satu langkah juga tidak dapat diam-diam mengubah riwayat untuk memenuhi indeks unik.
- Konfigurasi m23 membaca snapshot dengan revision dari server. Update kategori/route dan pencabutan capability memerlukan baseline revision; pembuatan baru tidak membawa baseline lama. Receipt privat mengembalikan key/payload asli secara deterministik, sedangkan save legacy masih menaikkan revision agar klien v2 tidak dapat menimpa perubahan lama tanpa konflik.

### Bukti lokal yang sudah tersedia pada checkpoint

| Pemeriksaan | Hasil tercatat | Batas bukti |
| --- | --- | --- |
| `npm.cmd run check` | Lulus, 0 error/0 warning. | Pemeriksaan lokal; bukan deployment atau workflow hosted. |
| `npm.cmd test -- --maxWorkers=1 --reporter=dot` | Lulus di luar sandbox Windows: **33 file, 433 tes**. | Sandbox awal menolak rename cache Vite (`EPERM`) sebelum test dimulai; hasil di luar sandbox adalah hasil valid. Bukan browser/hosted. |
| `npm.cmd run build` | Lulus; build SSR, client, dan service worker selesai. | Artefak lokal, bukan bukti controller/offline atau deployment. |
| `npm.cmd run test:database` | Lulus sampai m23, mencakup RLS/RPC/audit, revision/receipt konfigurasi, validasi recipient target, dan kelayakan replacement. | PGlite lokal; tidak menjalankan DDL/ubah data hosted. |
| `node supabase/tests/followup-upgrade-compatibility.mjs` | Lulus untuk upgrade Preview **18→23** dan historis **13→23** dengan preflight historis sebelum migration lama. | Fixture lokal, bukan bukti target hosted. |
| `preflight-supervisor-operational-hardening.sql` melalui harness upgrade | Duplikat pengajuan aktif direproduksi dan ditolak tanpa mutasi; setelah fixture bersih, preflight berulang lulus lalu m22 diterapkan. | Preflight m22 berbeda dari preflight historis 13-migration. |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | Lulus: probe dua kali, rollback equality, dan fail-closed fixture; probe sudah menargetkan migration 23. | Harness PGlite; bukan `db push` atau workflow pengguna Preview. |
| Live-mock browser Operations/Planning | **2/2 lulus**: response-loss → reload → retry key/payload asli menghasilkan satu commit; conflict refresh eksternal mempertahankan edit lokal. | Browser lokal + REST mock; bukan Supabase/Vercel hosted, Realtime dua akun, atau perangkat. |
| Browser live E2E hosted | **Belum dijalankan/dibuktikan untuk checkpoint m23.** | Bukti live-mock lokal di atas tidak dapat menggantikannya. |

Gate database/static untuk m23 telah ditutup oleh suite di atas. Deployment database Preview di bawah menambah bukti schema/RPC hosted, tetapi bukan kelulusan frontend/browser: hasil `Ready` deployment atau tes yang di-skip tidak dapat menggantikan live E2E, alur login/action/Realtime hosted, atau pengujian perangkat.

### Deployment database Preview — 25 Oktober 2026

Target diverifikasi sebelum write: proyek Supabase Preview **`hr-rajaklana-preview`**, ref **`lypsqrwjzrmuyqtdcegr`**. Production dan `main` tidak disentuh.

Migration diterapkan secara forward-only dari history 18 ke 23. Connector managed mencatat versi remote berikut; versi ini adalah penanda history remote, bukan nama file source lokal:

| Migration source | Versi tercatat di Preview |
| --- | --- |
| m19 `20261023080451_supervisor_followup_queue.sql` | `20261025044841` |
| m20 `20261023181824_supervisor_operations.sql` | `20261025044859` |
| m21 `20261023183130_supervisor_planning_reports.sql` | `20261025044910` |
| m22 `20261024110000_supervisor_operational_hardening.sql` | `20261025045641` |
| m23 `20261024233053_supervisor_configuration_concurrency.sql` | `20261025050057` |

- Preflight hardening setelah state 1–21 **lulus** sebelum m22 diterapkan.
- Probe readiness Preview setelah history 18→23 **PASS**.
- Semua perubahan tetap additive/forward-only. Tidak ada reset dan tidak ada data operasional atau riwayat audit yang dihapus untuk membuat deployment atau probe lulus.
- Bukti ini hanya mencakup database target dan probe; **bukan** deploy Vercel/frontend, login browser, workflow hosted, Realtime dua sesi, atau perangkat/PWA.

### Deployment Vercel Preview dan HTTP smoke — 25 Oktober 2026

- Branch **`codex/preview`** pada commit **`3278545e00f06e4c9f2fb113ca8b195e998389e8`** telah dipush.
- Target Vercel diverifikasi sebagai project **`hr-rajaklana/hr-rajaklana-jkt`** dengan project ID **`prj_gI60oWK0qyBOl5J4RB9yRw4mWhGb`**.
- Deployment **`dpl_GimwcHFk2qAccs7bHnXfHDkL6Riq`** berstatus **READY**, target Preview, pada <https://hr-rajaklana-dtpbnload-hr-rajaklana.vercel.app>. Alias branch Preview yang diverifikasi adalah <https://hr-rajaklana-jkt-preview.vercel.app> dan alias Git `git-codex-preview`; keduanya dapat berpindah ke deployment berikutnya dari branch yang sama.
- `vercel curl` yang terautentikasi menerima **HTTP 200** untuk `/login` dan `/service-worker.js`.

Ini adalah bukti deploy/source dan HTTP smoke saja. HTTP 200 untuk script worker tidak membuktikan browser berhasil mendaftarkan worker, memperoleh controller setelah reload, bekerja offline, atau menangani update lintas versi. Bukti ini juga bukan login aplikasi, workflow pengguna, Realtime, atau uji perangkat.

### Penguatan dependency dan verifikasi PWA — 25 Oktober 2026

Status: **lokal lulus; PWA hosted dan perangkat nyata tetap terbuka.**

- Audit dependency menemukan pembaruan patch yang kompatibel lalu menaikkan `vite` dari `8.3.2` ke `8.3.5` serta `vitest` dari `4.1.11` ke `4.1.12` (termasuk `@vitest/mocker`). Tidak digunakan `npm audit fix --force` atau pembaruan mayor.
- Sesudah pembaruan, `npm.cmd audit` dan `npm.cmd audit --omit=dev --audit-level=moderate` keduanya menghasilkan **0 kerentanan**.
- Regresi lokal sesudah pembaruan lulus: `npm.cmd run check` (0 error/0 warning), `npm.cmd test -- --maxWorkers=1 --reporter=dot` (**33 file, 433 tes**), `npm.cmd run test:database` (fresh m1–m23, Preview 18→23, historis 13→23 dengan preflight), serta `npm.cmd run build` (SSR, client, dan service worker).
- Uji browser pada build produksi lokal dengan `E2E_PWA=1` lulus **1/1**. Worker menjadi aktif/controller, manifest dan ikon diperiksa, cache hanya berisi shell publik (respons dinamis tidak ikut cache), dan navigasi tetap membuka shell saat koneksi disimulasikan offline. Percobaan awal dari sandbox terminal terisolasi berhenti sebelum request browser akibat localhost tidak dapat dijangkau lintas sandbox; rerun server preview dan browser pada konteks jaringan yang sama lulus. Ini bukan kegagalan assertion aplikasi.
- Pemeriksaan browser hosted pada alias Preview memakai header OIDC sementara dari CLI dapat membuka `/login` dengan HTTP 200, tetapi bootstrap `navigator.serviceWorker.register('/service-worker.js', { type: 'module' })` ditolak dengan `SecurityError`; tidak ada registration atau controller. Header tersebut cukup untuk request halaman, tetapi tidak menjadi bukti bahwa fetch worker melewati Deployment Protection. Tidak ada token, kata sandi, atau data akun disimpan/dicetak.
- Deployment otomatis untuk commit kode dependency **`f84bd87`** berstatus **READY** sebagai `dpl_3bndhyqMm1uMk1WdvnKok3vWQ6EW` di <https://hr-rajaklana-k5poyzy87-hr-rajaklana.vercel.app>. Log build menjalankan `npm ci`, melaporkan **0 kerentanan**, lalu `svelte-check` 0 error/0 warning dan build Vite `8.3.5` selesai. Alias branch dapat berpindah pada deployment sesudahnya, sehingga URL unik ini adalah bukti historis deployment tersebut.

Dengan demikian, build dan kontrak PWA lokal tervalidasi, tetapi **PVR-02 tidak ditutup**: belum ada bukti worker/controller pada sesi browser pengguna hosted, offline/update lintas versi hosted, atau iPhone/iPad/PWA terpasang. Mengubah Deployment Protection atau membuka bypass publik tidak dilakukan karena itu keputusan keamanan di luar cakupan rilis ini.

### Risiko/limit yang masih terbuka

- Browser live E2E untuk Operations/Planning/konfigurasi m23 belum tersedia sebagai bukti checkpoint ini; persist/reload/retry UI dan konflik dua tab tidak dinyatakan lulus dari hasil database.
- Database Supabase Preview sudah berada pada history 18→23 dan deployment/HTTP smoke Vercel Preview telah tercatat di atas. CI serta alur aplikasi sesudah deployment belum menjadi bukti checkpoint ini.
- Workflow login dua akun, tindakan aplikasi, Realtime hosted, dan browser live E2E belum dibuktikan.
- PVR-02/offline, controller service worker, update lintas versi, dan iPhone/iPad tetap **terbuka**. HTTP 200 worker dari `vercel curl` tidak menutupnya.

## Status milestone

| Milestone | Status | Catatan checkpoint |
| --- | --- | --- |
| SPV-00 | Lokal lulus | Baseline, gap, matriks akses, migration plan, kompatibilitas, dan suite awal tercatat. |
| SPV-01 | Lokal terbatas | Beranda tindakan dan navigasi supervisor tersedia; browser E2E/hosted belum diuji untuk checkpoint m23. |
| SPV-02 | Lokal database/static lulus | Backlog, tenggat, pagination, konflik versioned, dan recovery tersedia; browser E2E belum dibuktikan. |
| SPV-03 | Lokal database/static lulus | Reminder/receipt follow-up tersedia; workflow browser/hosted belum diuji. |
| SPV-04 | Lokal database/static lulus | Capability/routing kini memakai m23 revision/receipt v2 dan target-only scope guard; browser E2E belum dibuktikan. |
| SPV-05 | Lokal database/static lulus | Kendala outlet, route revalidation, private evidence, dan recovery tersedia; browser E2E belum dibuktikan. |
| SPV-06 | Lokal database/static lulus | Serah-terima versi/replay tersedia; browser/hosted belum diuji. |
| SPV-07 | Lokal database/static lulus | Tukar/pengganti, cancel/expiry, replacement eligibility, dan replay diuji database; browser E2E belum dibuktikan. |
| SPV-08 | Lokal database/static lulus | Interval/snapshot Middle/cakupan serta recovery tersedia; browser E2E belum dibuktikan. |
| SPV-09 | Lokal terbatas | Ringkasan/drill-down tersedia; cross-period browser/hosted verification belum dilakukan. |
| SPV-10 | Preview terbatas lulus | Upgrade/preflight/readiness database serta Vercel deploy/HTTP smoke m23 lulus; browser E2E belum dibuktikan. |
| SPV-11 | Dikerjakan | Database dan Vercel Preview selesai untuk deployment/smoke; workflow pengguna, Realtime, dan handoff rilis belum dilakukan. |
| PVR-02/perangkat | Lokal browser lulus; hosted/perangkat terbuka | Build produksi lokal membuktikan worker, cache shell, dan offline. Browser hosted ber-header OIDC menerima `SecurityError` saat registrasi worker; pengguna masih menunda uji offline/perangkat nyata. |

## Penutupan tiga temuan supervisor — checkpoint 26 Oktober 2026

Status pelaksanaan: **P1, P2, dan hardening lokal P3 selesai; deployment Preview dan browser hosted menunggu commit/rilis dan sesi browser yang benar-benar lolos proteksi. PVR-02/iPhone/iPad tetap terbuka.** Target tetap branch `codex/preview`; Production dan `main` tidak disentuh.

### P0 — baseline aktual

- Branch/HEAD saat mulai: `codex/preview` / `0f99829504ec70b7a6371f9902a639bc3eb2cd5d`; worktree bersih sebelum perubahan.
- Source memiliki **23 migration**, terakhir `20261024233053_supervisor_configuration_concurrency.sql`. Tidak ada migration yang diedit atau ditambah.
- Target yang dirujuk tetap Supabase Preview `hr-rajaklana-preview` / `lypsqrwjzrmuyqtdcegr` dan Vercel project `hr-rajaklana-jkt`. Identitas source lokal diperiksa melalui `.vercel/project.json`; pemeriksaan CLI hosted pada runner ini terhambat resolusi DNS, sehingga tidak dipakai sebagai bukti browser.
- T-01 dicatat sesuai audit: HTTP shell/worker dan `Ready` deployment bukan bukti registrasi; percobaan hosted sebelumnya menerima `SecurityError` karena script worker berada di balik redirect. Tidak ada proteksi yang dinonaktifkan atau bypass baru.

### P1 — README migrasi (T-03)

- `README.md` kini menyebut keadaan source saat ini sebagai 23 migration dan nama terakhir yang diverifikasi, serta menegaskan bahwa hitungan itu bukan status Production.
- Snapshot tujuh/dua belas migration tetap disebut sebagai catatan bertanggal. Preview 18→23 dipisahkan dari fixture historis 13→23 yang memerlukan preflight sebelum migration lama.
- Contoh CLI kini meminta verifikasi target, `migration list`, dry-run, dan preflight sebelum perintah write. Tidak ada SQL/DDL atau `db push` hosted yang dijalankan untuk perubahan dokumentasi.

### P2 — Panduan dalam aplikasi (T-02)

- `src/routes/(app)/guide/+page.svelte` sekarang menjelaskan bahwa hanya Admin HR aktif yang mengelola `/supervisor`, termasuk jalur ponsel **Beranda → Buka semua**.
- Copy mencakup lima tab antrean, filter outlet/tanggal, pagination, kasus lintas tanggal, detail sumber, PIC/tenggat WIB, alasan perubahan, catatan penyelesaian, riwayat, dua pilihan konflik, serta retry hasil belum pasti tanpa membuat pengajuan baru.
- Copy akses HR dipisahkan dari kendala outlet, serah terima, tukar shift, dan perencanaan yang sudah ada; tidak ada capability baru yang diberikan kepada kasir.

### P3 — hardening PWA yang dapat dibuktikan lokal (T-01)

- `src/service-worker.ts` tidak lagi memakai `cache.addAll` tanpa pemeriksaan. Setiap aset dan shell diperiksa sebagai respons same-origin, tidak redirect, bukan HTML untuk aset, serta mempunyai MIME yang sesuai sebelum masuk cache.
- `src/lib/pwa-cache-validation.ts` dan tesnya mereproduksi aset JavaScript yang berisi halaman SSO, shell yang redirect ke origin Vercel, respons MIME salah, serta shell aplikasi yang valid. Respons privat/API tidak masuk cache.
- Uji browser build produksi lokal dengan `E2E_PWA=1`, `E2E_BASE_URL=http://127.0.0.1:5198`: **1/1 lulus**. Worker aktif, controller tersedia, cache shell publik valid, respons dinamis tidak tercache, dan navigasi offline membuka shell.
- Browser hosted Preview belum diulang pada sesi pengguna yang telah menyelesaikan Vercel Authentication untuk alias branch yang sama. Karena itu belum ada klaim `activated/controller/offline/update` hosted; status PVR-02 tetap terbuka. Uji iPhone/iPad juga tetap ditunda.

### P4 — regresi lokal dan bukti terpisah

| Pemeriksaan | Hasil | Batas bukti |
| --- | --- | --- |
| `npm.cmd run check` | Lulus, 0 error/0 warning | Source lokal |
| `npm.cmd test -- --maxWorkers=1 --reporter=dot` | Lulus, **34 file / 437 test** | Unit/domain lokal; cache Vitest dijalankan di konteks Windows yang diizinkan |
| `npm.cmd run test:database` | Lulus: fresh 1–23, Preview 18→23, historis 13→23 dengan preflight, biometric/push | PGlite/fixture; bukan DDL hosted baru |
| `npm.cmd run test:database:legacy` | Lulus: known-legacy reset/refusal/rollback fixture | Tidak menjalankan reset hosted |
| `node supabase/deployment/verify-readiness-preview.test.mjs` | Lulus: probe dua kali, rollback equality, fail-closed fixture | Harness lokal |
| Live-mock supervisor eksplisit pada `PUBLIC_APP_ENV=preview`, URL mock `http://127.0.0.1:54329`, port 5183 | **3/3 lulus**: follow-up, operations, planning; persist/reload/retry key-payload asli dan konflik draft | Browser lokal + REST interception, bukan Supabase/Vercel hosted atau dua akun Realtime |
| `npm.cmd run build` | Lulus: SSR, client, dan service worker | Artefak lokal |
| PWA build lokal | **1/1 lulus** seperti P3 | Bukan browser hosted/iPhone |
| `git diff --check` | Lulus | Tidak ada whitespace error |

| Temuan | Implementasi lokal | Deployment Preview | Workflow hosted | iPhone/iPad | Status |
| --- | --- | --- | --- | --- | --- |
| T-01 PWA | Hardening + tes negatif + PWA 1/1 lulus | `dpl_5Q8yg5X51tDE5zwnzxp5JgKrCMgQ` Ready; HTTP smoke 200 untuk shell/worker/manifest | Menunggu browser authenticated; bukti lama tetap SecurityError | Ditunda pengguna | Terbuka terbatas |
| T-02 Panduan | Copy dan tautan `/supervisor` selesai; check + QA desktop/mobile lulus | Termuat pada deployment Ready yang sama | Belum diuji dengan akun hosted | Tidak diperlukan untuk copy | Lokal lulus; hosted copy belum ditinjau |
| T-03 README | 23 source migration, snapshot historis dan preflight dibedakan | Termuat pada deployment Ready yang sama | Tidak berlaku untuk teks | Tidak berlaku | Lokal lulus |

Perubahan di atas tidak menyentuh transaksi atomik, baseline/version checks, replay key/payload, RLS, riwayat kasus, atau isolasi draft per akun. Commit/push, CI, dan deployment Preview dicatat di bawah; langkah lanjutan yang masih diperlukan hanyalah—bila sesi browser pengguna tersedia—melakukan T-01 hosted dan mencatat hasilnya tanpa menyimpan token/cookie/URL bertanda tangan.

### Bukti remote setelah push

- Commit `ebab65bb47888ad3d806e2779640835b89a71eb2` berhasil dipush ke `yoga12-rgb/hr-rajaklana-jkt` pada branch `codex/preview`.
- GitHub Actions CI untuk SHA tersebut selesai **success**: <https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/40281196710>.
- Vercel Preview project `hr-rajaklana-jkt` menghasilkan deployment **`dpl_5Q8yg5X51tDE5zwnzxp5JgKrCMgQ`**, status **READY**, URL unik `https://hr-rajaklana-2vwpuodby-hr-rajaklana.vercel.app`, alias branch `https://hr-rajaklana-jkt-preview.vercel.app` dan alias Git `hr-rajaklana-jkt-git-codex-preview-hr-rajaklana.vercel.app`. Metadata deployment menunjuk repo `yoga12-rgb/hr-rajaklana-jkt`, ref `codex/preview`, dan SHA yang sama.
- `vercel curl` terautentikasi menerima HTTP **200** untuk `/login` (`text/html`), `/service-worker.js` (`application/javascript`, `Cache-Control: no-cache`), dan `/manifest.webmanifest` (`application/manifest+json`), tanpa redirect pada smoke request. Ini hanya bukti HTTP/artefak; belum membuktikan request internal `register`, `activated/controller`, offline shell, update lintas versi, atau iPhone/iPad.
- Tidak ada tindakan Supabase remote pada checkpoint ini karena source tidak mengubah schema. Identitas Preview tetap `hr-rajaklana-preview` / `lypsqrwjzrmuyqtdcegr`; Production/main tidak disentuh.

Dokumentasi checkpoint kemudian dipush sebagai commit `31ad65a4f1830f796607b8ac90387e839e11cf38`. CI-nya selesai **success** pada run <https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/40281408877>. Deployment dokumentasi tersebut juga **READY** sebagai `dpl_Ao5V6n5oVDckf2D9yzi5dAw6JYak` dengan alias Preview yang sama; smoke worker pada alias itu tetap HTTP 200 JavaScript tanpa redirect. Deployment kode `ebab65b` dan deployment dokumentasi `31ad65a` sama-sama tercatat, sedangkan hasil browser hosted/PVR-02 tetap tidak dinaikkan statusnya oleh smoke ini.

## Matriks bukti

| Milestone | Implementasi lokal | Deployment Preview | Workflow hosted | Perangkat/PWA |
| --- | --- | --- | --- | --- |
| SPV-00 | Lulus: baseline dan suite awal di atas | Database 18→23 dan Vercel deployment/HTTP smoke terverifikasi | Belum dilakukan | Tertunda; PVR-02 terbuka |
| SPV-01–03 | Database/static terbatas; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-04–07 | Database/static lulus; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-08–09 | Database/static terbatas; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-10 | Database/static lulus: upgrade, preflight, dan readiness m23; browser E2E belum dibuktikan | Database 18→23 + Vercel deployment/HTTP smoke; bukan workflow | Belum dilakukan | Tertunda; PVR-02 terbuka |
| SPV-11 | Implementasi lokal belum lengkap | Database + Vercel deployment/HTTP smoke selesai; workflow belum dilakukan | Belum dilakukan | Tertunda sampai pengguna tersedia |
