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
- Deployment **`dpl_GimwcHFk2qAccs7bHnXfHDkL6Riq`** berstatus **READY**, target Preview, pada <https://hr-rajaklana-dtpbnload-hr-rajaklana.vercel.app>. Alias <https://hr-rajaklana-jkt-preview.vercel.app> dan alias Git `git-codex-preview` mengarah ke deployment Preview tersebut.
- `vercel curl` yang terautentikasi menerima **HTTP 200** untuk `/login` dan `/service-worker.js`.

Ini adalah bukti deploy/source dan HTTP smoke saja. HTTP 200 untuk script worker tidak membuktikan browser berhasil mendaftarkan worker, memperoleh controller setelah reload, bekerja offline, atau menangani update lintas versi. Bukti ini juga bukan login aplikasi, workflow pengguna, Realtime, atau uji perangkat.

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
| PVR-02/perangkat | Menunggu interaksi | Pengguna menunda uji offline/perangkat; status tetap terbuka. |

## Matriks bukti

| Milestone | Implementasi lokal | Deployment Preview | Workflow hosted | Perangkat/PWA |
| --- | --- | --- | --- | --- |
| SPV-00 | Lulus: baseline dan suite awal di atas | Database 18→23 dan Vercel deployment/HTTP smoke terverifikasi | Belum dilakukan | Tertunda; PVR-02 terbuka |
| SPV-01–03 | Database/static terbatas; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-04–07 | Database/static lulus; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-08–09 | Database/static terbatas; browser E2E belum dibuktikan | Database + deploy/HTTP smoke; frontend workflow belum diverifikasi | Belum dilakukan | Tertunda; bukan gate lokal |
| SPV-10 | Database/static lulus: upgrade, preflight, dan readiness m23; browser E2E belum dibuktikan | Database 18→23 + Vercel deployment/HTTP smoke; bukan workflow | Belum dilakukan | Tertunda; PVR-02 terbuka |
| SPV-11 | Implementasi lokal belum lengkap | Database + Vercel deployment/HTTP smoke selesai; workflow belum dilakukan | Belum dilakukan | Tertunda sampai pengguna tersedia |
