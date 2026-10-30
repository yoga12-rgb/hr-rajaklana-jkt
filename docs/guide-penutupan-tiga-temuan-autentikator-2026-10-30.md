# Panduan, goal dan milestone penutupan tiga temuan penghapusan autentikator

Tanggal: 30 Oktober 2026. Target pembaca: agent implementasi berikutnya.

Dokumen ini adalah rencana perbaikan **AR-01, AR-02 dan AR-03** dari [audit 30 Oktober](audit-penghapusan-autentikator-2026-10-30.md). Penyusunan panduan ini belum memperbaiki aplikasi atau menjalankan deployment. Tidak ada milestone implementasi yang dinyatakan selesai di sini.

## 1. Goal dan acuan

Hasil yang dituju: login nomor karyawan dan kata sandi tetap berlaku bagi semua role; rotasi token untuk akun yang sama tidak menutup formulir/kamera; pelemahan kontrol akses ditolak oleh probe; dan gate aktif membuktikan keamanan sesi, Storage, operator serta integritas upgrade pada hasil akhir password-only.

Acuan implementasi:

1. Dokumen ini untuk tiga temuan audit terbaru.
2. [Audit penghapusan autentikator](audit-penghapusan-autentikator-2026-10-30.md) untuk reproduksi dan batas bukti.
3. [Panduan penghapusan autentikator](guide-penghapusan-autentikator-2026-10-29.md) untuk keputusan produk dan invariant yang tetap berlaku.
4. [Progres penghapusan](progres-penghapusan-autentikator-2026-10-29.md) sebagai catatan historis eksekusi, bukan bukti bahwa seluruh acceptance sudah terpenuhi.

MFA aplikasi tetap dihapus. Jangan menambah OTP opsional, enrollment, kewajiban aal2 atau recovery faktor kembali untuk membuat tes hijau. Biometrik/GPS/selfie absensi adalah fitur terpisah yang dipertahankan.

## 2. Scope, baseline dan otorisasi

| Komponen | Snapshot saat audit; verifikasi kembali ketika mulai eksekusi |
| --- | --- |
| Repo/branch | `yoga12-rgb/hr-rajaklana-jkt`, `codex/preview` |
| SHA | `4cafee36d4586e98e3753060b49eaee2a7582418`; implementasi penghapusan pada `bef0260` |
| Worktree | File audit terbaru belum tracked saat panduan dibuat; pertahankan dokumen/pekerjaan yang sudah ada |
| CodeGraph | `.codegraph/` tidak ada; jika muncul, ikuti AGENTS.md sebelum pencarian source |
| Supabase Preview | `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf` |
| Baseline hosted sekarang | 26 migration; terakhir `20261030033256 retire_application_authenticator` |
| File lokal migration26 | `20261030031318_retire_application_authenticator.sql`; timestamp berbeda dari hosted adalah mapping yang diketahui |
| Restrictive policy | 29 tabel public + `storage.objects`, nama `privileged_mfa_session`, memakai `private.session_allowed()` |
| Auth/recovery | Snapshot 0 faktor dan 0 recovery record; endpoint `recover_mfa` HTTP410; tidak membuktikan toggle TOTP efektif sudah nonaktif |
| Preview frontend | `https://hr-rajaklana-jkt-preview.vercel.app`; audit menunjuk deployment `dpl_7mMg6BdyopNFGL4nTFjQVEcTgeaU`, source SHA sama |
| CI audit | Run `40999912878` success; angka historis unit 37 file/466 test, bukan target jumlah setelah perbaikan |

Task penulisan panduan hanya menghasilkan dokumen. Saat pengguna kemudian memerintahkan **eksekusi panduan ini**, kerjakan perbaikan lokal, commit/push dan verifikasi rilis hanya pada `codex/preview`/Preview yang cocok identitasnya. Production dan `main` tetap di luar cakupan. Jangan meminta ulang keputusan produk yang sudah jelas, dan jangan meminta password/token/OTP/seed/service key melalui chat.

Ketiga temuan terutama memerlukan perubahan state, probe dan tes; jangan membuat migration tanpa kebutuhan perubahan schema/guard yang nyata. **Jangan edit migration yang sudah applied**, termasuk migration25 dan26. Jika membutuhkan perubahan SQL aplikasi, buat migration maju via CLI setelah memeriksa baseline; jangan menebak nomor final. Pada Preview26 jangan mengulang migration26, menjalankan preflight13/21, `db reset`, repair history atau `db push` generik yang mengabaikan mapping versi.

## 3. Invariant yang wajib dipertahankan

- JWT upstream diverifikasi; akun terhubung dan aktif, `session_id` UUID valid, session ada, milik user yang sama dan belum melewati `not_after`.
- Role/capability/outlet/team scope, RLS dan pembatas self-approval tetap berlaku. `aal1` tanpa faktor cukup; `aal2` lama diterima jika sesi sah. Faktor/AAL bukan sumber izin.
- Konteks rusak, error, revoked atau inactive gagal tertutup; tidak ada protected reads/service work sebelum context sah. Jangan memakai `user_metadata`, unsigned JWT atau service-role query sebagai identitas pengguna.
- Transaksi atomik, baseline/version/revision checks, audit/riwayat, receipt dan **key serta payload asli replay** tetap utuh. Penyegaran token tidak membuat operation key baru bagi attempt yang hasilnya ambigu.
- Pergantian A→B/logout menghapus memori/channel A segera; respons/token terlambat A tidak dapat dipublikasi atau dipersist sebagai sesi/draft B. Draft tetap terisolasi per akun dan proyek.
- Restrictive policy tidak dihapus, dilemahkan menjadi permissive, atau diberi predikat selalu benar. Tabel private/recovery/account-token tetap tertutup.
- Recovery aplikasi tetap HTTP410/RPC retired. Alat cleanup operator tidak boleh dihubungkan kembali ke UI/Edge sebagai layanan recovery.
- Tidak ada penghapusan audit/data operasional untuk membuat tes lulus. SQL yang sengaja memalsukan claims, menghapus fixture session, atau melemahkan grant hanya boleh pada database lokal disposable, tidak pada hosted.

## 4. Peta pekerjaan dan urutan milestone

Jalankan berurutan dan tulis checkpoint yang dapat ditinjau pada `docs/progres-penutupan-tiga-temuan-autentikator-2026-10-30.md` ketika implementasi dimulai. Checkpoint adalah bukti pekerjaan, bukan kewajiban berhenti meminta konfirmasi pada setiap tahap.

| Milestone | Temuan/tujuan | Output minimum | Syarat melanjutkan |
| --- | --- | --- | --- |
| ARF-00 | Baseline dan reproduksi | Inventory source/history, reproduksi AR-01/02, matriks cakupan AR-03 | Penyebab dan expected behavior tercatat; belum ada mutasi remote |
| ARF-01 | AR-01: state sesi | Rotasi token tidak membongkar UI; account switch/denial tetap tertutup | Unit race/session lulus dan bukti mount/form browser tersedia |
| ARF-02 | AR-02: probe final | Kontrak katalog final lengkap + mutation tests | Seluruh pelemahan wajib ditolak, baseline sehat lulus berulang |
| ARF-03 | AR-03: fixture dan sesi/Storage | Fixture final tanpa faktor; regresi role/sesi/Storage/API aktif | Valid positive + negative cases lulus dengan bukti row/object |
| ARF-04 | AR-03: operator dan upgrade | Operator tests, historical25 bounded, populated25→26,18→final | Snapshot history/audit/receipt identik; operator retry terarah lulus |
| ARF-05 | Gate gabungan/CI | Suite wajib, live-mock, demo/PWA, wiring CI | Seluruh kelompok wajib lulus tanpa skipped/flaky; source sama |
| ARF-06 | Rilis dan verifikasi Preview | Commit/CI/deployment/ref/probe cocok; uji hosted yang tersedia | Tidak mencampur hasil deployment dengan hasil workflow |
| ARF-07 | Penutupan dan handoff | Status tiap acceptance + sisa AUTH/perangkat yang jujur | AR-01/02/03 memiliki bukti penutupan; sisa lama dilaporkan terpisah |

## 5. ARF-00 — baseline dan reproduksi sebelum perbaikan

1. Baca audit dan peta source di bawah. Catat branch/SHA/status/remote, perbedaan existing, nama/urutan/versi migration serta mapping lokal↔hosted. Snapshot di §2 bukan izin menganggap remote belum berubah.
2. Untuk akses remote, verifikasi ref/nama/organisasi Preview. Gunakan query katalog baca-saja, advisor dan metadata Auth terbatas; jangan dump data karyawan atau secrets. Tidak perlu mutasi remote untuk mereproduksi tiga temuan.
3. Reproduksi AR-01 dari `src/lib/state/realtime-recovery.test.ts`: init akun sah; rotasi access token sambil user sama; kirim `TOKEN_REFRESHED`; tangkap state **sebelum** refresh selesai, bukan hanya setelahnya. Baseline sekarang menghasilkan `initialized=false,user=null`. Uji pula jalur `refreshNow()` yang mendapati token berubah tanpa callback.
4. Reproduksi AR-02 di PGlite: baseline sehat → satu pelemahan → jalankan probe → pulihkan/drop fixture → skenario berikutnya. Baseline sekarang menerima empat pelemahan audit. `.vercel/audit-auth-retirement-probe.mjs` tersedia hanya di workspace ini, diabaikan Git dan tidak dapat diandalkan pada clone/CI agent lain. Pindahkan skenarionya ke harness terpelihara tanpa dynamic source rewriting.
5. Inventaris tes AR-03 yang hilang dari gate, faktor yang dibuat helper default, test browser berjudul tanpa faktor padahal memakai legacy factor, serta kasus upgrade yang berhenti sebelum final. Petakan setiap invariant ke test/path/perintah; jangan hanya membandingkan jumlah tes.

Peta source utama:

| Area | Lokasi |
| --- | --- |
| State/init/rotasi/publikasi/channel | `src/lib/state/app.ts`, `src/lib/types.ts`, `src/lib/state/client.ts`, `src/lib/auth-session-storage.ts` |
| Mount halaman dan local form/camera | `src/routes/(app)/+layout.svelte`, `leave/+page.svelte`, `employees/+page.svelte`, `attendance/+page.svelte` |
| Validasi context/API | `src/lib/auth-mfa.ts` (parser kompatibilitas), `server/security.mjs`, API biometric/push |
| Unit state/race/API | `src/lib/state/realtime-recovery.test.ts`, `src/lib/auth-session-storage.test.ts`, `src/lib/server-mfa-boundary.test.ts`, suite API existing |
| Probe final/historis | `supabase/deployment/verify-authenticator-removed-preview.sql`, `verify-mfa-readiness-preview.sql`, `verify-readiness-preview.test.mjs` |
| Fixture/harness | `supabase/tests/auth-session-fixture.mjs`, `authenticator-removal.mjs`, `mfa-enforcement.mjs`, `followup-upgrade-compatibility.mjs`, `database.mjs`, `biometric-push.mjs` |
| Operator network | `supabase/deployment/restrict-network-extension-managed-owner.sql`, `inspect-network-extension-access.sql` |
| Browser/CI | `tests/live-mfa.spec.ts`, `live-mfa-recovery.spec.ts`, `live-*.spec.ts`, `demo.spec.ts`, `package.json`, `.github/workflows/ci.yml` |

Nama path di dalam route group pada tabel merujuk direktori `src/routes/(app)/`. Tidak semua file harus diubah; batasi diff sesuai penyebab.

## 6. ARF-01 — perbaikan refresh yang menjaga UI dan otorisasi

Pisahkan **identitas akun tervalidasi**, **generasi/token request**, dan **status revalidasi akses**. Nama/type implementasi bebas; kontrak berikut wajib.

| Keadaan | Perilaku wajib |
| --- | --- |
| Startup/restored session belum tervalidasi | UI protected belum dibuka; tidak menampilkan cache akun lama |
| Token berubah, user sama dan sebelumnya tervalidasi | Invalidate pembacaan generasi lama; revalidasi context terbaru; pertahankan mount dan input lokal selama pemeriksaan |
| Context terbaru sah | Publikasikan hanya hasil untuk token/generasi/user yang masih cocok; UI tidak di-reset |
| User berubah/logout | Segera cabut akses UI/data/channel akun lama; jangan menunggu fetch lama selesai |
| Context denied/malformed/error saat revalidasi | Cabut akses dan bersihkan data sensitif; tidak mempertahankan hak/cache lama sebagai fallback |
| Dua refresh berurutan/respons terbalik | Respons generasi lama diabaikan; tidak ada loading permanen atau stale publish |

Langkah implementasi:

1. Tinjau seluruh pemanggil `clearLiveState`, bukan hanya callback Auth. Perbaiki jalur perubahan token pada awal `refreshNow()`, sesudah context, dan sebelum `app.set` agar tidak melakukan reset UI yang sama secara tersembunyi.
2. Pertahankan `authRevision`/generasi serta perbandingan token dan user pada batas async. Jangan sekadar menghapus checks tersebut. Jangan percaya event name saja: `SIGNED_IN` untuk user sama juga dapat membawa token baru.
3. Pertahankan form/draft/kamera untuk akun yang sama. Jika menambah status revalidasi, jangan gunakan status itu sebagai kondisi yang meng-unmount slot. UI boleh menandai penyambungan/pemeriksaan, tanpa mengganti identitas tervalidasi menjadi logout sementara.
4. Selama akses token baru belum tervalidasi, cegah aksi protected baru di batas action/client dan server yang relevan; tombol disabled saja tidak cukup. Aksi yang sudah dikirim dan ambigu tetap memakai receipt/key/payload asli. Jangan menaikkan privilege berdasarkan role cache selama revalidasi.
5. Saat penolakan atau pergantian akun terbukti, bersihkan memori/channel dan tutup kamera sesuai perilaku keamanan existing. Draft akun lama tidak dipindahkan atau dihapus massal dari storage.
6. Tinjau lifecycle Realtime supaya rotasi sah tidak menimbulkan subscription ganda, timer bocor, atau balasan channel lama yang menimpa state. SDK boleh memperbarui kredensial channel; jika harus mengganti channel, form tetap mounted dan generation guard tetap berlaku.

Tes penutup AR-01:

- Unit: same-user aal1→aal1; legacy aal2→aal1 dengan live session sah; token berubah tanpa event; startup token berubah; context delayed; dua rotasi respons terbalik; error/revoked/inactive; A→B ketika respons A terlambat; B tidak di-signOut oleh cleanup A. Masukkan satu skenario benar-benar token-only: level dan user tetap sama.
- Live-mock browser: isi form cuti dan form karyawan, rotasikan sesi melalui SDK Auth nyata terhadap backend mock, tunda context agar frame revalidasi teramati, lalu buktikan dialog/input/URL/mount marker tetap sama. Jangan hanya mengecek state akhir atau `app.initialized=true` setelah semua selesai.
- Absensi: buka kamera dengan perangkat palsu Playwright, ambil selfie, rotasikan token dalam umur capture yang sah; stream/preview/modal tetap ada dan tidak ada `onDestroy(close)` akibat refresh. Jam/freshness dikendalikan agar kegagalan bukan karena selfie/GPS melewati60 detik. Freshness dan lokasi tetap divalidasi ketika submit.
- Roster/kasus/konfigurasi: persist draft/pending attempt → rotasi → reload → retry; key/payload tetap sama dan tidak terjadi write ganda. Account switch tetap mengisolasi state dan draft.

Checkpoint: lampirkan red→green reproduksi, daftar kondisi uji, serta bukti browser mount/input/kamera. Unit dengan mock state saja belum menutup dampak UI.

## 7. ARF-02 — probe final yang menolak pelemahan

Pertahankan probe historis25 untuk baseline25. Perkuat probe final26; jangan mengubah migration applied atau membuat schema hosted rusak untuk menguji probe.

Kontrak probe final wajib:

- `BEGIN READ ONLY` dan akhir transaksi yang jelas; aman dijalankan berulang, tidak membuat claims/fixtures/audit/config baru.
- History **ordered names** lengkap dari foundation sampai retirement, bukan count26 atau daftar yang dibentuk dari database yang sedang diuji. Gunakan ekspektasi ter-review yang independen. Versi lokal/hosted berbeda pada beberapa migration: simpan mapping eksplisit sesuai snapshot, periksa urutan, nama unik dan latest yang diharapkan. Jangan repair history agar timestamp menjadi sama. Jika baseline benar-benar bertambah, tinjau kontrak final baru, jangan menerima semua history secara otomatis.
- Seluruh29 tabel public dalam inventory probe25 plus Storage: keberadaan tabel, RLS aktif, restrictive policy, target role authenticated, command policy yang sesuai serta `USING`/`WITH CHECK` bermakna pemeriksaan session yang sama. Predikat `true` atau `session_allowed() OR true` harus ditolak. Normalisasi ekspresi dapat digunakan; substring `session_allowed` saja tidak memadai.
- ACL24 pada11 tabel operasional tetap SELECT/RPC-only untuk authenticated; anon tidak memperoleh akses; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER yang tidak semestinya ditolak. Hak internal/service yang memang diperlukan tetap dipertahankan.
- `account_tokens`, `cashier_roster_batches`, `private.mfa_recovery_requests`: RLS dan grant tertutup tetap benar; keberadaan tabel saja bukan bukti privasi/histori terjaga.
- Rantai helper `raw_employee_id`, `session_access_context`, `session_allowed`, `employee_id`, `require_employee`, `require_hr` serta `auth_access_context`: keberadaan, security/search_path/grants internal dan dependency tetap benar. Helper khusus faktor tidak lagi menjadi otorisasi. `requires_mfa` substring tidak dapat membuktikan guard live session; kombinasikan pemeriksaan katalog dengan behavioral tests ARF-03.
- Kedua RPC recovery retired tidak callable oleh **PUBLIC/anon/authenticated/service_role**, termasuk grant yang diwariskan dari PUBLIC. Periksa seluruh kombinasi pada kedua fungsi, bukan authorize/authenticated dan complete/service_role saja. Body tombstone tidak dapat diubah menjadi jalur Auth factor aktif.
- `auth_access_context` tetap callable sesuai kontrak sempit, selalu `requires_mfa=false`, dengan denial dan allowed yang konsisten. Jangan menuntut aal2/faktor dalam probe final.

Mutation tests minimum, masing-masing dijalankan pada fixture terisolasi lalu dipulihkan dan baseline sehat diprobe ulang:

1. Grant authenticated INSERT pada `shift_handovers`.
2. Hapus restrictive policy `employees`.
3. Ubah Storage restrictive predicate menjadi `true` dan, terpisah, `session_allowed() OR true`.
4. Ubah nama migration foundation sambil count tetap26; uji urutan yang salah dan migration ekstra/hilang.
5. Disable RLS, ubah policy menjadi permissive, ubah target role atau hilangkan/lemahkan WITH CHECK.
6. Grant anon atau service_role pada authorize; grant anon atau authenticated pada complete; grant lewat PUBLIC; internal helper dibuka kepada authenticated.
7. Tambah akses pada tabel workflow private dan lemahkan rantai helper/guard. Buktikan guard yang mengembalikan `allowed=true` sambil tetap memuat teks `requires_mfa` tidak lolos gabungan probe+behavioral gate.

Gunakan assertion penolakan spesifik; error setup, missing fixture, atau transaction aborted bukan bukti bahwa kontrol yang ditargetkan terdeteksi. Jika probe mengelola transaksi sendiri, jalankan mutation pada DB disposable/fixture yang committed, lalu reset lokal dengan cara terkontrol; jangan mengandalkan nested BEGIN/COMMIT yang merusak isolasi skenario.

Checkpoint: baseline sehat lulus dua kali, semua mutation ditolak dengan alasan yang benar, snapshot katalog sebelum/sesudah probe identik. Hak `pg_net` existing dilaporkan oleh inventory terpisah; jangan mengklaim probe aplikasi otomatis menutup managed extension.

## 8. ARF-03 — fixture password-only dan regresi sesi/Storage/API

Ubah default fixture hasil akhir menjadi **aal1 tanpa faktor**. Tentukan helper/opsi historis yang eksplisit untuk baseline25. Tinjau seluruh caller `fixtureSession`, terutama yang masih mengirim argumen keempat berupa string, agar perubahan signature tidak diam-diam mengubah makna tes. Buktikan SQL count faktor untuk fixture default benar-benar0; bukan hanya mengubah claim aal.

Gunakan session UUID yang berbeda dari Auth user UUID pada fixture keamanan utama. Sediakan beberapa session untuk satu user serta session milik user lain, agar tes menguji binding `session.user_id=auth.uid()` dan rotasi session yang nyata, bukan kebetulan ID yang sama.

Pisahkan browser fixture `no factor` dengan `legacy verified factor`; test pertama tidak boleh menyertakan faktor verified/unverified. Keduanya menggunakan SDK Auth nyata dengan server fixture terisolasi. Bersihkan judul/komentar stale yang masih menyebut aal2 padahal fixture aal1, tanpa mengganti bukti historis menjadi hasil baru.

Matriks wajib pada hasil akhir:

| Skenario | Expected dan bukti |
| --- | --- |
| Admin HR, SPV sesuai tiap capability, Head Baker/approver, kasir aal1 tanpa faktor | Login/context/RPC sah sesuai hak; tidak semua role mendapat akses HR |
| Legacy aal2 sah; faktor absent/unverified/deleted dengan session tetap hidup | Tidak ditolak semata karena AAL/faktor; context sah tetap password-only |
| Session hilang, malformed/missing ID, expired/not_after, user mismatch | RPC/RLS/Storage/server menolak; row/object tidak berubah; service work tidak dilakukan |
| Employee inactive/account disabled, Auth employee binding salah | Ditolak di batas yang benar meskipun JWT belum kedaluwarsa |
| Context null/rusak/error atau metadata privilege palsu | Gagal tertutup sebelum protected reads, tidak fallback ke demo/cache lama |
| Kasir melakukan aksi HR, scope outlet lain, self-approval | Ditolak, audit bisnis tidak ditulis sebagai sukses |
| Recovery Edge/RPC retired | HTTP410 atau permission/tombstone sesuai jalur; nol list/delete factor dan nol audit recovery sukses baru |

Storage harus diuji sebagai role authenticated, bukan postgres/service-role yang bypass RLS:

1. Seed objek selfie dan foto issue sendiri yang belum direferensikan pada fixture lokal; catat ID/bucket/path tepat.
2. Pemilik aktif dengan live session sah dapat melakukan SELECT/INSERT/DELETE yang memang diizinkan policy; referenced evidence tetap immutable dan cross-account tetap ditolak.
3. Cabut/hilangkan/expire session lokal atau nonaktifkan akun; ulangi SELECT/INSERT/DELETE. Periksa objek tepat masih ada dan tidak ada insert baru. **DELETE dapat mengembalikan nol row tanpa error**; verifikasi row/object setelah reset role, bukan hanya `assert.rejects`.
4. Sertakan jalur `DELETE FROM storage.objects` tanpa WHERE/RETURNING pada fixture yang relevan agar permissive unused issue-photo predicate diuji tanpa bergantung SELECT policy. Batasi sepenuhnya ke DB disposable.
5. Pisahkan faktor dihapus dengan session tetap hidup dari session benar-benar dicabut oleh Admin API: yang pertama tetap diizinkan sesuai kontrak final; yang kedua wajib ditolak. Jangan menyisakan expectation bahwa faktor absen sendiri membatalkan login.

API server tetap `getUser` → user-scoped context → employee binding → service reads/work. Gunakan handler asli untuk tesnya dengan dependency fixture/spies. Test yang hanya `route.fulfill(410)` pada mock tidak membuktikan implementasi Edge menjalankan tombstone tanpa SDK faktor; sertakan tes handler/source terpelihara atau smoke Preview nonmutating setelah source diverifikasi.

Checkpoint: setiap baris matriks dipetakan ke test dan gate aktif. Pertahankan tes Realtime/account race yang sudah ada setelah refactor fixture.

## 9. ARF-04 — operator dan upgrade yang mempertahankan histori

### 9.1 Operator managed network

Pindahkan regresi operator yang masih relevan dari `mfa-enforcement.mjs` ke harness yang berjalan pada gate aktif. Pakai fixture `net` lokal, tanpa HTTP keluar:

- Reproduksi baseline PUBLIC schema/function grants.
- Non-owner menjalankan prosedur → ditolak sebelum ACL berubah; snapshot tetap identik.
- Owner lokal sah menjalankan prosedur → anon/authenticated kehilangan akses, service hanya mempertahankan hak yang sebelumnya sudah efektif; owner-only function tidak mendadak terbuka ke service.
- `private.wake_push_worker()` tetap dapat memanggil dependency fixture; invocation tercatat lokal. Inventory read-only tidak mengubah ACL.

Ini menutup **cakupan regresi operator AR-03**. Tidak otomatis menutup hak pg_net hosted. Jangan menjalankan prosedur managed-owner sebagai hosted postgres, mengubah owner/membuat role untuk mengakalinya, atau mengklaim perbaikan extension dari keberhasilan fixture.

### 9.2 Alat cleanup Auth dan tesnya

Sediakan modul/alat operator terpisah dari produk, default dry-run, provider Auth Admin dapat diinjeksi untuk unit/integrasi lokal. Uji sebelum mempertimbangkan pemakaian nyata:

- Target ref/identitas/proyek/linkage akun/tipo faktor dipastikan; akun orphan/shared yang belum dipetakan dan phone/WebAuthn ditolak.
- Manifest berisi operation key, project/user/factor IDs asli, fingerprint dan status tiap item; disimpan di lokasi operator diabaikan Git. Tidak memuat key/JWT/password/OTP/seed/QR dan tidak mencetak credential.
- Dry-run tidak pernah memanggil delete. Execute memakai Admin API resmi, tidak SQL DELETE managed Auth.
- Partial failure atau timeout setelah delete mungkin telah commit → re-list **ID asli**; already absent dilaporkan observed absent, bukan mengarang operator ini yang menghapusnya. Retry memakai manifest/key asli, tidak mengambil target baru dari inventory berikutnya.
- Faktor baru di luar manifest tidak ikut disapu; perubahan ref/akun/payload manifest ditolak. Permission/provider error tetap terlihat sebagai pending/error. Verified factor deletion mengharuskan verifikasi pencabutan sesi secara terpisah.
- Tes script wiring memastikan default aman ketika flag execute tidak ada, termasuk salah target, malformed manifest, retry lintas proses/reload file manifest dan hasil ambigu.

Snapshot Preview saat audit sudah0 faktor. **Jangan enroll faktor baru atau menghapus ulang akun nyata untuk merekonstruksi bukti yang hilang.** Tes alat dilakukan sintetis. Bukti cleanup lama tetap dicatat HTTP200+observed absence; freeze/drain/manifest yang tidak terdokumentasi tidak boleh dibuat seolah pernah ada. Koreksi status AUTH-04 yang terlalu luas pada dokumen progres dengan addendum yang jujur.

### 9.3 Upgrade dan snapshot equality

| Jalur lokal | Persiapan dan acceptance |
| --- | --- |
| Fresh final26 | Semua migration, default aal1 tanpa faktor, probe final + behavioral tests lulus |
| **Populated25→26** | Stop tepat25, buat histori recovery/audit/receipt/data bisnis sebelum26; jalankan26 saja; seluruh snapshot yang harus immutable identik |
| 24→25→26 | Bedakan checkpoint25 dari hasil akhir; legacy MFA tidak meninggalkan syarat faktor |
| 18→final | Migrasi modul maju; preflight operational hardening tepat pada batas21 sebelum22; lanjut sampai26 dan uji password-only |
| Historical12→13→final | Reproduksi kegagalan CHECK sebelum14 tanpa preflight; preflight Libur sebelum14, preflight hardening sebelum22; uji idempotensi/refusal di luar batas; lanjut sampai26 |
| **Preview hosted aktual26** | Hanya probe/tes kompatibilitas dan perubahan maju yang benar-benar diperlukan; jangan downgrade/reset ke25 untuk membuktikan upgrade |

Pada populated25 gunakan status schema nyata `pending`, `failed`, `completed` di `private.mfa_recovery_requests`; tidak ada status `authorized` pada baseline ini. Bentuk histori melalui RPC historis yang sah pada fixture jika memungkinkan; fixture langsung hanya untuk record khusus dan harus memenuhi FK/constraints. Rekam actor, target, request/operation key, factor_ids, reason, timestamps, audit authorization/completion, receipt hash/payload/result, kasus/roster/konfigurasi yang relevan. Perbandingan JSON/row deterministik mencakup isi, bukan count/tabel masih ada. Migration26 tidak boleh membuat pending/failed menjadi completed.

Batasi harness MFA historis dan probe25 **tepat sampai migration25**. Pertahankan expectation MFA historis di sana, jangan memaksakannya pada hasil akhir. Default helper baru tanpa faktor tidak boleh merusak fixture historis: historical test harus memilih helper/opsi verified secara eksplisit. Test historis23 tetap terpisah.

Checkpoint: seluruh jalur lulus pada fixture independen; log menyebut jalur dan invariant yang benar-benar diuji. Mapping migration dari lokal ke hosted diverifikasi tanpa mengubah history remote.

## 10. ARF-05 — gate lokal, browser, PWA dan CI

Wire semua harness baru/yang dipisahkan ke `package.json` dan workflow CI. Contoh pembagian yang dapat dipakai: test final guard/Storage, test negative probe, test operator net, test cleanup Auth, historical25 serta upgrade compatibility. Nama file boleh berbeda; tabel progres harus menunjukkan perintah aktif dan tidak boleh ada regresi penting yang hanya dapat dijalankan manual lalu dilupakan CI.

Jalankan dari source yang sama setelah perubahan akhir:

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

Jika historical25/negative probe/operator belum terintegrasi dalam `test:database`, jalankan eksplisit dan perbaiki wiring sebelum menyebut milestone lulus. Jangan mengganti target probe25 menjadi26 hanya untuk meloloskan harness. Jangan menurunkan threshold audit atau menghapus assertion sebagai solusi. Laporan sebelumnya menyebut4 low dependency transitive; verifikasi ulang dan pisahkan dari temuan aplikasi ini. Error sandbox/binary/jaringan dicatat sebagai lingkungan, lalu retry melalui mekanisme izin normal jika diperlukan; bukan ditandai lulus.

### Browser live-mock

Terminal server terisolasi:

```powershell
$env:PUBLIC_APP_ENV='preview'
$env:PUBLIC_SUPABASE_URL='http://127.0.0.1:54329'
$env:PUBLIC_SUPABASE_ANON_KEY='sb_publishable_isolated_audit_mock'
npm.cmd run dev -- --port 5198 --strictPort
```

Terminal runner, setelah server siap:

```powershell
$env:E2E_LIVE_SUPABASE_MOCK='1'
$env:E2E_PWA=''
$env:E2E_BASE_URL='http://127.0.0.1:5198'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/arf-live.json'
npm.cmd run test:e2e -- 'live-.*\.spec\.ts' --reporter=line,json --forbid-only --retries=0 --output=test-results/arf-live
```

Gunakan Chromium di CI. Windows boleh Edge yang tersedia. Pilih port lain bila dipakai pekerjaan lain, catat port/env aktual dan gunakan `--strictPort`; jangan menghentikan proses pengguna secara sembarang.

### Demo/PWA production build

Hentikan **server fixture milik task** dahulu dan pastikan port bebas. Kosongkan URL/key mock ketika build agar tidak menguji build live-mock sebagai demo:

```powershell
$env:PUBLIC_APP_ENV='development'
$env:PUBLIC_SUPABASE_URL=''
$env:PUBLIC_SUPABASE_ANON_KEY=''
npm.cmd run build
npm.cmd run preview -- --port 5198 --strictPort
```

Terminal runner:

```powershell
$env:E2E_LIVE_SUPABASE_MOCK=''
$env:E2E_PWA='1'
$env:E2E_BASE_URL='http://127.0.0.1:5198'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/arf-demo-pwa.json'
npm.cmd run test:e2e -- tests/demo.spec.ts --reporter=line,json --forbid-only --retries=0 --output=test-results/arf-demo-pwa
```

Jalankan **seluruh** kelompok wajib live-mock dan demo/PWA, bukan hanya `-g` satu test. JSON kedua kelompok harus `expected>0`, `skipped=0`, `unexpected=0`, `flaky=0`. Tes terarah yang sengaja gagal pada tahap reproduksi boleh memiliki skipped akibat filter, tetapi tidak menggantikan gate penuh. Pertahankan strict stats checker dan kedua job browser CI; perbarui komentar CI yang masih mengklaim harness MFA/net lama berjalan jika wiring sudah berubah.

PWA lokal harus membuktikan controller/cache shell, pengecualian data dinamis dan offline shell. Regresi refresh form/kamera harus ada pada **live-mock**, karena demo tidak mempunyai rotasi JWT. Jika memungkinkan, gunakan production live-mock build tambahan untuk update PWA dengan draft; laporkan bukti itu terpisah dari offline shell. Jangan menyimpulkan update/tab lama/perangkat nyata lulus dari satu tes cache lokal.

Checkpoint: source/SHA, command/env, pass/fail/skipped/flaky dan artifact tiap kelompok dicatat. Tidak perlu memaksa jumlah tes tetap466; yang wajib adalah seluruh invariant memiliki gate aktif.

## 11. ARF-06 — rilis Preview dan verifikasi hosted

Setelah ARF-01–05 lulus, saat eksekusi panduan diotorisasi:

1. Verifikasi branch/remote/target team/project Vercel dan Supabase Preview aktual, serta source yang akan dipush. Sertakan audit dan panduan yang belum tracked jika memang milik task; jangan stage file operator/secrets atau pekerjaan lain tanpa meninjau diff.
2. Perubahan probe/test/frontend tidak memerlukan replay migration. Bila ada migration maju baru, gunakan rencana eksplisit yang diverifikasi terhadap history26, tanpa mengedit applied. Catat versi hosted yang dihasilkan dan mapping ke file lokal.
3. Push hanya `codex/preview`; periksa CI **SHA aktual**, seluruh job validate+dua browser, deployment/source ref/alias/environment dan API server yang ikut dirilis. Deployment READY adalah bukti rilis, bukan workflow.
4. Jalankan probe final hosted dalam transaksi read-only sesudah identitas diverifikasi. Negative mutation tests tetap lokal. Gunakan mekanisme akses Vercel resmi bila protected; jangan mengubah proteksi untuk memudahkan tes.
5. Kerjakan smoke mandiri yang tidak memerlukan password: route/aset/env ref, recovery410, grants/policy/history/guard katalog, advisor. Jangan dump session/kunci, dan jangan membuat faktor/akun uji nyata tanpa kebutuhan/otorisasi yang jelas.
6. Gunakan sesi pengguna yang memang tersedia untuk memverifikasi form saat refresh, API/data/reload sesuai role. Jika login pengguna diperlukan, selesaikan semua pekerjaan mandiri dahulu lalu minta pengguna login di aplikasi, tanpa mengirim credential ke chat. Jangan menggunakan key admin sebagai pengganti user workflow.
7. Pertahankan status uji iPhone/iPad/offline yang ditunda. Blokir klaim workflow yang belum dibuktikan, sambil tetap melaporkan implementasi lokal dan rilis Preview yang telah selesai.

Kegagalan hosted yang teridentifikasi sebagai regresi perbaikan ini harus ditangani; jangan disamarkan sebagai `READY`. Rollback frontend ke versi MFA lama berisiko mengunci akun karena faktor telah dihapus. Utamakan perbaikan maju dengan password-only dan guard sesi tetap benar; jangan re-enroll faktor diam-diam.

## 12. ARF-07 — penutupan, sisa lama dan bukti

### Kriteria penutupan tiga temuan

| ID | Dapat ditutup bila |
| --- | --- |
| AR-01 | Token-only dan legacy-level refresh tidak membongkar UI; form/camera/replay terjaga pada live-mock; denial/account switch/race tetap tertutup; source dirilis dan status hosted dinyatakan sesuai bukti |
| AR-02 | Kontrak final sehat lulus berulang dan semua mutation gagal dengan alasan benar; probe read-only memeriksa history/policy/ACL/helper/grant lengkap; bukti lokal dan katalog Preview cocok |
| AR-03 | Fixture default tanpa faktor; seluruh role/sesi/Storage/API/operator diuji dalam gate aktif; historical25 bounded; populated25→26 dan18→final serta jalur historis preflight lulus; cleanup retry/manifest diuji; CI aktual lengkap |

Gunakan status granular `selesai lokal`, `dirilis Preview`, `terverifikasi hosted`, `terbuka/perangkat ditunda`. Bila lokal sudah selesai tetapi bukti hosted relevan belum tersedia, tulis demikian; jangan memberi satu status selesai yang menyembunyikan sisa acceptance.

### Pekerjaan existing yang tidak otomatis selesai oleh tiga perbaikan

- **AUTH-06 toggles:** source lokal sudah menonaktifkan TOTP, tetapi effective config Preview belum terverifikasi. Penutupan memerlukan update scoped/verification tersendiri. Tidak ada izin dari task penulisan panduan ini untuk broad `config push`. Jangan menerima endpoint publik `/settings` sebagai bukti toggle karena tidak mengekspos field itu pada audit.
- **AUTH-04 histori:** operator lokal dapat disiapkan dan diuji sekarang; bukti freeze/drain masa lalu yang tidak tersedia tetap missing, bukan direkonstruksi sebagai fakta. Nol faktor hanya observed absence pada waktu query.
- **Managed pg_net hosted:** cakupan tes operator wajib dipulihkan, tetapi hak hosted yang masih terbuka memerlukan managed-owner/prosedur resmi terpisah. Tidak ada panggilan HTTP keluar untuk sekadar membuktikan katalog grant.
- **PVR-02/perangkat dan workflow lintas role hosted:** tetap terbuka jika belum diuji; jangan meminta uji perangkat yang ditunda sebagai syarat menyelesaikan pengembangan lokal.
- **Dokumentasi:** tambahkan banner historis/superseded pada runbook MFA lama, tautkan keputusan password-only dan laporan terbaru. Perbarui README/kontrak/progres bila perilaku berubah; pertahankan hasil uji historis sebagai histori. Tambahkan koreksi status AUTH-04/05, jangan menulis ulangnya seolah semua bukti sudah ada saat eksekusi lama.

Template progres tiap milestone:

`ID | status lokal | SHA/ref | file/perubahan | command+env | expected/pass/fail/skipped/flaky | artifacts | target/deployment/hosted evidence | dampak data/Auth/audit | sisa dan sebab`

Definisi task implementasi selesai: tiga temuan mempunyai perbaikan dan bukti acceptance yang dapat diulang, seluruh gate aktif terhubung dan lulus, source/progres dapat ditinjau pada branch Preview, serta status rilis/hosted/perangkat dan sisa AUTH lama dilaporkan terpisah. Tidak ada klaim siap Production dari task ini.

## 13. Prompt handoff

> Kerjakan `docs/guide-penutupan-tiga-temuan-autentikator-2026-10-30.md` dengan teliti, mulai ARF-00 dan milestone berurutan. Tutup AR-01 tanpa menghapus live-session validation atau generation/token/account guards; pertahankan mount form/kamera ketika token user yang sama berotasi, tetapi account switch/denial tetap fail-closed. Kuatkan probe final dan mutation tests AR-02; pulihkan fixture password-only, regresi sesi/Storage/operator, historical25 bounded dan populated25→26 untuk AR-03. Jangan edit migration applied atau reset data/audit. Target `codex/preview` dan Supabase Preview yang identitas serta baseline aktualnya diverifikasi; Production/main di luar scope. Jalankan live-mock eksplisit termasuk persist/reload/retry, demo/PWA dan seluruh gate CI; catat bukti checkpoint pada dokumen progres. Tes skipped/Ready bukan bukti workflow. Jangan meminta secrets atau membuat faktor nyata untuk merekonstruksi bukti cleanup. Pisahkan hasil lokal, deployment Preview, hosted, operator/Auth existing dan perangkat yang ditunda; selesaikan pekerjaan mandiri sebelum meminta login pengguna yang memang diperlukan.
