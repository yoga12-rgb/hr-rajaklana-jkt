# Panduan penutupan celah audit PWA dan migrasi

Tanggal acuan: **26 Oktober 2026**. Dokumen ini adalah handoff untuk agent implementasi berikutnya. Lanjutkan [panduan tiga temuan supervisor](guide-penutupan-tiga-temuan-supervisor-2026-10-25.md) dan [progresnya](progres-supervisor-2026-10-23.md); jangan mengganti riwayat atau menaikkan status pengujian lama tanpa bukti baru.

## Tujuan, target, dan batas selesai

Target source hanya branch **`codex/preview`** pada `yoga12-rgb/hr-rajaklana-jkt`; target hosted hanya Vercel Preview proyek **`hr-rajaklana-jkt`** dan, jika perlu pemeriksaan baca saja, Supabase Preview **`lypsqrwjzrmuyqtdcegr`**. Verifikasi identitas aktual sebelum tindakan remote. **Production dan `main` di luar cakupan.** Tidak ada perubahan schema yang diperlukan untuk empat celah ini: jangan mengedit migration yang telah diterapkan, menjalankan `db push`, reset, `migration repair`, atau menghapus audit/data operasional demi meluluskan tes.

| ID | Celah audit 26 Oktober | Syarat penutupan |
| --- | --- | --- |
| C-01 — identitas shell PWA | Respons HTML login/SSO dari origin yang sama, status 200 dan tanpa redirect, diterima oleh `validatePwaResponse(..., 'shell')`. | Tes negatif gagal sebelum perbaikan lalu lulus; HTML bukan aplikasi tidak pernah masuk `/200.html`; shell aplikasi build nyata tetap dapat dipasang dan dibuka offline. |
| C-02 — cache instalasi parsial | `install` menyimpan aset satu per satu; kegagalan berikutnya meninggalkan cache versi baru yang tidak lengkap. | Kegagalan aset maupun shell menolak instalasi dan membersihkan cache percobaan; cache worker aktif lama serta data pengguna tetap utuh. |
| C-03 — urutan upgrade di README | Contoh `db push` untuk semua migration tertunda tidak menunjukkan preflight sebelum m14 dan antara m21–m22. | README memuat matriks baseline dan prosedur bertahap yang dapat dijalankan atau secara eksplisit menghentikan operator bila mekanisme tahap belum terverifikasi. Fixture 13→23 dan 18→23 membuktikan urutan dan penolakan aman. |
| C-04 — jejak rilis terakhir | Progres menyebut source terbaru telah dirilis tetapi rincian berhenti sebelum HEAD `4fefac2`. | Klaim status diikat ke SHA, CI run, deployment ID, dan alias yang benar; setiap commit sesudahnya diverifikasi tanpa menyebut `Ready` sebagai bukti workflow browser. |

**Batas terpisah:** T-01/PVR-02 pada browser Preview terlindungi dan iPhone/iPad belum lulus. Bukti HTTP 200, build lokal, dan deployment `Ready` tidak menggantikan registrasi worker, controller, offline, atau pembaruan lintas versi pada browser hosted. SPV-11 login → tindakan → Realtime sesi kedua → audit juga tetap gate tersendiri.

## Aturan pelaksanaan

1. Mulai dengan branch, SHA, `git status`, remote, dan daftar perubahan pengguna. Jangan menimpa worktree yang belum bersih. Jika `.codegraph/` ada, gunakan CodeGraph sebelum `rg`/membaca source; jika tidak ada, gunakan `rg`.
2. Pertahankan transaksi atomik, baseline/revision checks, key **dan payload asli** pada replay, RLS/otorisasi, riwayat kasus, serta isolasi recovery draft per akun. Perubahan PWA/dokumentasi tidak boleh mengubah kontrak operasional tersebut.
3. Jangan mencetak atau menyimpan secret, cookie, header OIDC, token, URL bertanda tangan, selfie, ataupun data HR pada log/artefak. Sanitasi hasil HTTP dan tangkapan layar. Jangan meminta pengguna mengirim secret.
4. Kerjakan reproduksi dan implementasi lokal lebih dulu, checkpoint setelah setiap milestone. Pengguna menunda uji offline/perangkat nyata; lanjutkan seluruh pekerjaan mandiri dan beri status `menunggu` untuk bukti yang membutuhkan browser/perangkatnya.
5. Push hanya ke `codex/preview` setelah gate lokal. Cocokkan SHA akhir dengan CI dan deployment Preview. Jangan mengubah Deployment Protection atau membuat bypass publik untuk membuat tes terlihat lulus.

## M0 — bekukan baseline dan reproduksi

**Baca:** [validator PWA](../src/lib/pwa-cache-validation.ts), [tes validator](../src/lib/pwa-cache-validation.test.ts), [service worker](../src/service-worker.ts), [layout pembaruan](../src/routes/+layout.svelte), [app shell](../src/app.html), [tes PWA browser](../tests/demo.spec.ts), [README](../README.md), dua [preflight](../supabase/deployment/preflight-followup-off-compatibility.sql) dan [hardening](../supabase/deployment/preflight-supervisor-operational-hardening.sql), serta [harness upgrade](../supabase/tests/followup-upgrade-compatibility.mjs).

- Baseline audit: branch/remote HEAD `4fefac2`, 23 migration source sampai `20261024233053_supervisor_configuration_concurrency.sql`; Supabase Preview sudah m23. Verifikasi ulang, sebab fakta ini bertanggal.
- Catat hasil reproduksi C-01: `Response` berisi HTML login, `Content-Type: text/html`, status 200, URL `/` pada origin yang sama, `redirected=false` sekarang menghasilkan `{ ok: true }`. Sertakan variasi URL asli dan variasi HTML SSO yang redirect. Reproduksi ini membuktikan celah validasi, **bukan** bahwa Vercel saat ini mengirim respons demikian.
- Periksa tes yang ada: tes shell negatif hanya memakai redirect; browser PWA yang ada membuktikan instalasi lokal berhasil. Tambahkan tes yang gagal sebelum mengubah implementasi untuk C-01 dan C-02.
- Untuk C-03, cocokkan urutan **nama dan versi** source dengan history target; history yang dibuat konektor dapat memakai timestamp deployment berbeda dari filename. Supabase CLI `migration list` membandingkan timestamp, sehingga jangan otomatis menjalankan `migration repair` untuk menyamakan tampilan.
- Untuk C-04, bukti audit saat ini: CI `4fefac2` pada [run 40281940082](https://github.com/yoga12-rgb/hr-rajaklana-jkt/actions/runs/40281940082) berhasil; Vercel alias `hr-rajaklana-jkt-preview.vercel.app` menunjuk deployment `dpl_FfzJTU33pcVDTwA9qNq6Kf2eSKbo`, `Ready`. Verifikasi ulang dari sumber remote sebelum mencatatnya sebagai fakta kini.

**Checkpoint M0:** tabel empat celah berisi SHA, reproduksi, bukti yang telah ada, dan bukti yang masih kosong. Jangan mengubah remote.

## M1 — tutup identitas shell PWA (C-01)

1. Tambahkan tes unit yang membedakan shell aplikasi build dari HTML login/SSO **same-origin 200 tanpa redirect**. Tes harus memeriksa bahwa respons tersebut ditolak walaupun MIME `text/html` benar. Tetap uji respons redirect/cross-origin, MIME salah, aset JS/CSS yang ternyata HTML, dan shell aplikasi valid.
2. Tambahkan penanda identitas aplikasi yang stabil pada shell atau validasi identitas lain yang dapat dibuktikan dari artefak build; jangan hanya mengandalkan `response.ok`, origin, MIME, judul halaman, atau `Response.url`. Jika membaca body respons, gunakan salinan agar body asli tetap dapat disimpan ke cache. Pemeriksaan harus sesuai dengan `/` dan fallback `/200.html` pada build statis yang nyata.
3. Pastikan aset immutable benar-benar berasal dari resource yang diminta dan bertipe benar; tangani redirect atau rewrite yang mengantar ke halaman login. Jangan cache respons privat/API, media bertanda tangan, atau data HR. Jangan memaksa cache shell jika validasi gagal.
4. Uji pada build produksi lokal: worker dapat `activated`, mengontrol halaman setelah reload, cache berisi shell **aplikasi**, dan navigasi offline menampilkan shell tersebut. Data HR tetap membutuhkan jaringan.

**Penerimaan M1:** tes negatif C-01 merah pada baseline, hijau setelah fix; HTML SSO same-origin dan redirect tidak tersimpan sebagai `/200.html`; tes positif shell build nyata dan tes PWA lokal lulus. Catat hasil serta batasnya di progres.

## M2 — buat instalasi cache aman saat gagal (C-02)

1. Reproduksi dua kegagalan pada level `install`, bukan hanya menguji helper validasi: aset immutable JS/CSS/ikon menjadi HTML atau gagal diunduh; lalu shell root menjadi HTML SSO setelah beberapa aset sukses. Mock `fetch` dan Cache Storage secara deterministik atau pakai harness service worker setara.
2. Saat instalasi gagal, tolak worker baru dan hapus hanya cache percobaan versi baru yang belum selesai. Jangan menghapus cache worker lama yang aktif, cache lain, ataupun data aplikasi. Jika memakai cache sementara/staging, buktikan promosi hanya terjadi setelah semua respons tervalidasi.
3. Uji retry sesudah kegagalan: respons kemudian valid, instalasi berhasil, shell benar tersimpan, dan cache parsial lama tidak tertinggal. Uji `activate` tetap membersihkan versi lama **setelah** versi baru lengkap; pembaruan tidak memaksa reload saat pengguna sedang mengisi formulir/selfie.

**Penerimaan M2:** tes install-level untuk dua kegagalan, preservasi cache lama, pembersihan cache percobaan, dan retry berhasil. Jelaskan mengapa implementasi tidak menghapus cache aktif bila nama cache versi berbenturan.

## M3 — perbaiki runbook migrasi di README (C-03)

Tugas ini **dokumentasi dan fixture lokal**. Preview aktual sudah m23; tidak ada alasan menerapkan preflight atau DDL pada proyek hosted untuk menutup C-03. Periksa ulang dokumentasi/`--help` CLI yang benar sebelum menulis contoh perintah. [`db push`](https://supabase.com/docs/reference/cli/supabase-db-push) menerapkan semua migration tertunda secara berurutan dan `--dry-run` hanya menampilkan daftar; satu `db push` langsung tidak menyediakan jeda untuk preflight di tengah. [`migration list`](https://supabase.com/docs/reference/cli/supabase-migration-list) hanya membandingkan timestamp, sehingga riwayat konektor perlu pemeriksaan nama/urutan tambahan.

| Baseline yang benar-benar ditemukan | Urutan wajib pada fixture | Perlakuan pada proyek hosted dalam tugas ini |
| --- | --- | --- |
| Preview sudah m23 | Verifikasi nama/urutan 1–23; tidak ada migration tertunda. | Baca saja; jangan jalankan preflight 13 atau 21, `db push`, atau repair. |
| Preview historis m18 | Terapkan m19–m21; jalankan [preflight m22](../supabase/deployment/preflight-supervisor-operational-hardening.sql) pada history **tepat 1–21**; lalu m22–m23. Preflight menolak duplikasi aktif tanpa mengubah baris. | Hanya prosedur/fixture lokal sampai target, mekanisme bertahap, dan data riil ditinjau secara khusus. |
| Basis historis m13 | Jalankan [preflight sebelum m14](../supabase/deployment/preflight-followup-off-compatibility.sql) pada history **tepat 1–13**; lalu m14–m21; jalankan preflight m22 pada history tepat 1–21; baru m22–m23. | Jangan menerapkan ke Preview m23; jangan menandai migration sebagai applied tanpa SQL yang benar-benar berjalan. |
| Baseline lain, nama/urutan berbeda, atau drift | Hentikan prosedur; identifikasi perbedaan dan reproduksi pada salinan/fixture lokal. | Tidak ada perintah write otomatis. |

Perbarui [README §Siapkan Supabase](../README.md) agar contoh `db push` generik tidak tampak dapat dijalankan untuk semua baseline. Berikan jalur yang *benar-benar dapat dieksekusi dan sudah diuji* untuk penerapan bertahap, atau tulis secara eksplisit bahwa operator harus berhenti dan memakai runbook yang diverifikasi sebelum write. Jangan menyarankan pemotongan/mengedit migration yang telah diterapkan, reset data, atau `migration repair` sebagai jalan pintas. Tautkan kedua file preflight, jelaskan kondisi history masing-masing dan sifat preflight m22 yang baca saja. Pisahkan source 23 migration dari status Preview dan Production.

Perluas atau jalankan [harness upgrade](../supabase/tests/followup-upgrade-compatibility.mjs) untuk membuktikan: m14 gagal pada fixture 13 sebelum preflight; preflight historis idempoten dan mempertahankan kasus; preflight m22 menolak duplikasi tanpa mutasi; m19–21 mendahului preflight m22; 13→23 dan 18→23 selesai tanpa menghapus riwayat. `--dry-run` saja tidak membuktikan urutan preflight. Tidak perlu migration baru untuk memperbaiki teks README.

**Penerimaan M3:** pembaca README dapat menentukan jalur dari history aktual, menemukan kedua preflight dan titik berhentinya, serta tidak terdorong menjalankan satu `db push` pada baseline 13/18. Fixture lulus; tidak ada tindakan SQL hosted.

## M4 — regresi, bukti rilis, dan status hosted (C-04 serta T-01)

Jalankan setelah M1–M3 dan catat pass/fail/skip, SHA, target, serta log yang telah disanitasi. Jalankan tes reproduksi terarah terlebih dahulu, lalu gate yang wajib:

```powershell
npm.cmd run check
npm.cmd test -- --maxWorkers=1
npm.cmd run test:database
npm.cmd run test:database:legacy
node supabase/deployment/verify-readiness-preview.test.mjs
npm.cmd run build
git diff --check
```

Jalankan PWA pada **build produksi lokal** dengan `E2E_PWA=1` dan live-mock supervisor dengan `E2E_LIVE_SUPABASE_MOCK=1` secara **eksplisit**, memakai environment/port terisolasi dan langkah pada [guide supervisor §9.2–9.3](guide-goal-milestone-supervisor-2026-10-23.md#92-demo-browser-dan-pwa-lokal). Live-mock harus mencakup persist → reload → retry dengan key/payload asli, konflik dan isolasi draft per akun. Tes yang skipped bukan bukti lulus. Jangan mengulang seluruh suite hanya untuk mengisi angka bila tidak ada perubahan baru setelah gate lulus.

Setelah gate lokal lulus, commit/push perubahan logis hanya pada `codex/preview`. Verifikasi CI untuk **SHA kode yang dirilis**, deployment ID, target project, alias Preview, dan HTTP smoke secara terpisah. Perbarui [progres supervisor](progres-supervisor-2026-10-23.md) dengan SHA dan bukti yang tepat; jika ada commit dokumentasi susulan, verifikasi juga CI/deployment-nya dan hindari klaim `source terbaru` tanpa SHA eksplisit. Bukti audit untuk `4fefac2` dapat dicatat sebagai riwayat; perubahan baru memerlukan bukti baru.

Pada browser biasa yang telah lolos Vercel Authentication di **alias Preview yang sama**, bedakan request halaman, fetch biasa untuk worker, dan request internal `register`. Buktikan respons registrasi tanpa redirect, `activated`, scope, controller setelah reload, shell aplikasi offline, lalu update dua versi A→B pada alias tersebut dengan worker `waiting`/banner dan aktivasi setelah formulir/selfie selesai. Bila sesi browser yang sah tidak tersedia, tulis `hosted browser: menunggu`; jangan mengubah proteksi atau mengklaim T-01 tertutup dari HTTP 200. Pengguna menunda uji iPhone/iPad, sehingga status perangkat tetap `terbuka` sampai ada tes nyata. SPV-11 dua identitas tetap baris terpisah.

| ID | Implementasi lokal | CI/deployment Preview | Browser hosted | iPhone/iPad | Keputusan akhir |
| --- | --- | --- | --- | --- | --- |
| C-01 shell | Reproduksi dan tes negatif/positif; PWA build lokal | SHA, CI, deployment, HTTP smoke | Registrasi, controller, shell offline, update A→B | Ditunda pengguna | Isi sesuai bukti |
| C-02 cache parsial | Install gagal/cleanup/retry serta cache lama utuh | Source SHA yang sama | Regresi update bila tersedia | Ditunda pengguna | Isi sesuai bukti |
| C-03 README | Matriks baseline dan fixture upgrade | Tidak ada DB write; dokumen pada commit yang diverifikasi | Tidak berlaku untuk teks | Tidak berlaku | Isi sesuai bukti |
| C-04 jejak rilis | Progres berisi SHA/ID akurat | CI/deploy final diverifikasi | Jangan disimpulkan dari `Ready` | Status tetap eksplisit | Isi sesuai bukti |

**Selesai secara lokal** bila C-01–C-04 memenuhi tes dan review di atas. **T-01 selesai hosted** hanya setelah bukti browser Preview mencakup registrasi, controller, offline, dan update dua versi. **PVR-02 selesai** hanya setelah uji perangkat nyata yang pengguna saat ini tunda. Laporkan ketiganya secara terpisah dalam handoff final.
