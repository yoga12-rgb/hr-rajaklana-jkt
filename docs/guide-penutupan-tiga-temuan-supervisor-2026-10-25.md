# Panduan penutupan tiga temuan audit supervisor

Tanggal acuan: **25 Oktober 2026**. Pelaksana berikutnya: agent implementasi.
Target source dan deployment: **`codex/preview`**, Supabase Preview **`lypsqrwjzrmuyqtdcegr`**, dan Vercel Preview proyek **`hr-rajaklana-jkt`**. Production dan `main` di luar cakupan.

Panduan ini menutup tiga temuan dari audit ulang setelah commit `67bf61d`: (1) PWA pada Preview terlindungi belum terbukti, (2) Panduan dalam aplikasi belum menjelaskan tindak lanjut supervisor, dan (3) README masih menyebut jumlah migrasi lama. Ini kelanjutan [guide supervisor](guide-goal-milestone-supervisor-2026-10-23.md) dan [progres supervisor](progres-supervisor-2026-10-23.md), bukan pengganti riwayat auditnya.

## Tujuan dan batas selesai

| ID | Hasil yang diminta | Batas bukti |
| --- | --- | --- |
| T-01 — PWA Preview | Kondisi pemicu redirect pada registrasi worker diidentifikasi dan keterbatasan otomasi dicatat; solusi yang aman diuji pada browser Preview yang benar-benar lolos Vercel Authentication. Worker aktif, mengontrol halaman setelah reload, menyimpan shell aplikasi yang benar, dan berfungsi saat navigasi offline. Pembaruan lintas versi diuji terpisah. | HTTP 200 dari `vercel curl`, browser lokal, atau `Ready` deployment saja tidak menutup T-01. Uji iPhone/iPad masih ditunda dan dicatat terbuka. |
| T-02 — Panduan supervisor | Halaman Panduan menjelaskan akses dan langkah tindak lanjut kasus lintas tanggal, penetapan PIC/tenggat, konflik, retry hasil tak pasti, penyelesaian, dan riwayat sesuai UI yang ada. | Copy harus cocok dengan perilaku akun Admin HR; tidak menjanjikan hak kepada kasir atau petugas lain. |
| T-03 — README migrasi | Bagian migrasi membedakan keadaan source terkini dari snapshot historis, menyebut hitungan/nama terakhir yang diverifikasi, dan tidak menyiratkan seluruh migration sudah ada di Production. | Koreksi dokumentasi tidak menjalankan migration atau DDL. |

Status keseluruhan baru dapat disebut selesai untuk ketiga temuan ketika bukti browser hosted T-01, QA T-02, dan konsistensi T-03 lulus. **PVR-02 perangkat nyata** tetap terbuka sampai pengguna bersedia menguji iPhone/iPad; jangan menyatakan kesiapan operasional penuh dari desktop saja. Alur SPV-11 login → tindakan → Realtime sesi kedua → audit juga tetap dilaporkan sebagai gate tersendiri, bukan disamarkan sebagai bagian dari tiga perbaikan dokumentasi ini.

## Aturan kerja bersama

1. Mulai dari `git status`, branch, SHA, dan target remote aktual. Jika `.codegraph/` ada, gunakan CodeGraph sebelum pencarian source; bila tidak ada, gunakan `rg`. Jangan menimpa perubahan pengguna.
2. Pertahankan transaksi atomik, baseline/revision checks, key dan payload asli replay, RLS, riwayat kasus, serta isolasi draft per akun. Tiga temuan ini tidak memerlukan perubahan schema; jangan mengedit migration yang sudah diterapkan atau membuat migration baru untuk merapikan dokumentasi.
3. Sebelum tindakan remote, verifikasi kembali organisasi, ref, branch, project ID, alias, environment, dan daftar migration aktual. Jangan memakai nama proyek yang mirip sebagai satu-satunya bukti target. Jangan menjalankan reset atau menghapus audit/data operasional.
4. Jangan mencetak, menyimpan dalam artefak uji, atau meminta kata sandi, cookie, token OIDC, URL bertanda tangan, atau secret Supabase/Vercel. Sanitasi query string dan header autentikasi dari log serta tangkapan layar.
5. Kerjakan semua pemeriksaan lokal dan read-only yang dapat dilakukan mandiri. Pengguna menunda uji perangkat/offline fisik; hanya minta interaksi ketika langkah browser pengguna benar-benar diperlukan. Catat status `belum diuji` bila tidak tersedia, bukan `lulus`.
6. Commit perubahan logis dan push hanya ke `codex/preview` setelah gate lokal. Verifikasi CI, SHA deployment Preview, alias, dan hasil hosted secara terpisah. Jangan promosi ke Production.

## Milestone P0 — baseline yang dapat ditinjau

**Tujuan:** membekukan fakta awal agar diagnosis dan hasil perbaikan tidak tertukar.

- Catat branch/HEAD dan worktree, jumlah serta file migration terakhir (`rg --files supabase/migrations`), status CI dan deployment Preview, serta identitas Supabase Preview. Baseline audit: 23 migration source, terakhir `20261024233053_supervisor_configuration_concurrency.sql`; verifikasi ulang karena source dapat berubah.
- Baca [service worker](../src/service-worker.ts), [layout pendaftaran/update](../src/routes/+layout.svelte), [rewrite Vercel](../vercel.json), [uji PWA lokal](../tests/demo.spec.ts), [halaman follow-up](<../src/routes/(app)/supervisor/+page.svelte>), [Panduan UI](<../src/routes/(app)/guide/+page.svelte>), dan [README](../README.md). Baca juga progres supervisor agar hasil historis tidak dilaporkan sebagai hasil uji baru.
- Catat bukti T-01 saat audit: halaman `/login` dapat menerima HTTP 200 dengan header OIDC sementara, tetapi `navigator.serviceWorker.register('/service-worker.js', { type: 'module' })` menghasilkan `SecurityError` bahwa script berada di balik redirect. GET tanpa autentikasi ke script menghasilkan 302 menuju host `vercel.com`, path `/sso-api`; fetch biasa yang terautentikasi dapat menghasilkan 200 JavaScript. Tujuan request internal registrasi worker belum tertangkap langsung. Perlakukan hubungan redirect tersebut dengan Vercel Authentication sebagai hipotesis kuat, bukan fakta yang sudah membuktikan pengalaman browser pengguna.

**Checkpoint P0:** tabel baseline tiga temuan, SHA/target, serta batas bukti dicatat di [progres supervisor](progres-supervisor-2026-10-23.md) atau dokumen progres lanjutan yang menaut ke sana. Tidak ada mutasi remote pada milestone ini.

## Milestone P1 — perbaiki README migrasi (T-03)

**Tujuan:** pembaca dapat membedakan source saat ini, Preview, dan riwayat Production.

1. Perbaiki paragraf [Siapkan Supabase](../README.md) yang saat audit menyebut `Source berisi dua belas migrasi` dan m12 sebagai migration terakhir. Hitung ulang source pada saat edit; sebut nama migration terakhir dari daftar nyata. Jelaskan bahwa uraian tujuh/dua belas migration sebelumnya adalah **snapshot bertanggal**, bukan keadaan source terkini.
2. Nyatakan status Preview terbaru hanya berdasarkan bukti yang diverifikasi. Riwayat connector Preview dapat memakai versi remote yang berbeda dari timestamp nama file source; cocokkan **urutan dan nama migration**. Jangan menyamakan hitungan source dengan status Production tanpa memeriksanya.
3. Tinjau contoh `supabase db push` generik pada bagian yang sama. Arahkan operator untuk memverifikasi ref/branch dan `--dry-run` serta preflight yang relevan sebelum write; jangan membuat contoh tampak sebagai perintah aman untuk sembarang Production. Upgrade historis dari baseline 13 migration memerlukan preflight sebelum migration lama yang dapat gagal; upgrade Preview dari baseline aktual adalah jalur berbeda.
4. Tidak perlu mengubah SQL atau menjalankan `db push` untuk T-03.

**Penerimaan:** pencarian teks lama tidak menemukan klaim keadaan terkini `12 migration`/`m12 terakhir`; jumlah dan nama terakhir cocok dengan `supabase/migrations`; fakta historis tetap diberi tanggal; tidak ada pernyataan bahwa Production telah menerima m19–m23 tanpa bukti. Review diff dokumentasi dan jalankan `git diff --check`.

## Milestone P2 — lengkapi Panduan dalam aplikasi (T-02)

**Tujuan:** Admin HR dapat menyelesaikan kasus tindak lanjut tanpa menebak jalur menu atau arti status.

Perbarui bagian **Operasi supervisor** di [halaman Panduan](<../src/routes/(app)/guide/+page.svelte>) berdasarkan kontrol aktual pada [halaman Tindak lanjut](<../src/routes/(app)/supervisor/+page.svelte>). Copy yang dibutuhkan:

1. Sebut **Admin HR aktif** sebagai pemegang akses tindak lanjut. Pada ponsel, arahkan dari **Beranda → Buka semua** atau tautan yang benar menuju `/supervisor`; jangan menyebut Bottom Navbar jika menu tersebut tidak ada di sana.
2. Jelaskan tab **Semua belum selesai**, **Tugas saya**, **Belum ada PIC**, **Lewat tenggat**, dan **Riwayat**; filter outlet/tanggal serta **Muat berikutnya**. Kasus terbuka dari tanggal lampau tetap muncul walau sinyal sumber berubah, sampai keputusan eksplisit tersimpan.
3. Langkah kasus: pilih kasus → periksa tanggal kerja dan sumber → tentukan status, PIC dan tenggat WIB → isi catatan; perubahan PIC/tenggat perlu alasan → simpan dengan pemeriksaan revisi. Penyelesaian perlu catatan penyelesaian; riwayat dapat ditinjau setelahnya.
4. Jika aplikasi menampilkan **Data berubah di sesi lain**, jelaskan kedua pilihan secara benar: **Gunakan data server** membuang draft lokal, sedangkan **Pertahankan draft & pakai revisi terbaru** meminta pengguna meninjau perubahan sebelum menyimpan. Jangan menjanjikan penyimpanan otomatis saat konflik.
5. Jika hasil permintaan belum pasti, arahkan ke **Coba lagi permintaan yang sama**; jangan membuat pengajuan baru atau mengosongkan draft. Teks untuk pengguna cukup memakai label aksi, tanpa istilah teknis key/payload.
6. Pertahankan penjelasan kendala outlet, serah terima, tukar shift, dan perencanaan yang sudah ada. Pisahkan akses Admin HR untuk follow-up dari capability operasional agar halaman panduan tidak memperluas hak secara tersirat.

**Penerimaan:** setiap langkah cocok dengan label/tindakan UI; tautan bekerja pada desktop dan ponsel; kasir tidak diberi janji akses HR; copy ringkas dan terbaca pada lebar ponsel. Jalankan `npm.cmd run check`, tinjau `/guide` secara visual di desktop dan viewport ponsel, lalu ikuti tautan `/supervisor` dengan akun demo Admin HR. Tidak perlu test unit yang hanya memeriksa keberadaan string copy; tambahkan test browser hanya bila menemukan risiko navigasi/akses nyata.

## Milestone P3 — diagnosis dan perbaikan PWA Preview (T-01)

**Tujuan:** menentukan titik redirect yang dialami registrasi worker dan memastikan shell offline adalah aplikasi, bukan halaman Vercel SSO.

### P3.1 Diagnosis tanpa mengubah proteksi

1. Verifikasi project Vercel dan deployment Preview yang tepat. Periksa `/login`, `/service-worker.js`, `/manifest.webmanifest`, ikon, dan `/200.html` dengan `vercel curl` hanya sebagai smoke HTTP. Rekam status, `Content-Type`, origin/path final, dan ada/tidaknya redirect. Jangan menyimpan body HTML login Vercel, cookie, query, atau token.
2. Pada **browser biasa yang sudah menyelesaikan Vercel Authentication untuk alias Preview yang sama**, muat `/login`, lalu amati hasil `navigator.serviceWorker.register`, `navigator.serviceWorker.getRegistrations()`, `navigator.serviceWorker.controller`, Network/Console dan response worker. Cookie autentikasi Vercel terikat URL; sesi pada URL deployment unik tidak otomatis membuktikan alias branch. Gunakan satu origin yang konsisten.
3. Bandingkan tiga hal yang berbeda: request halaman, fetch biasa ke script, dan request internal saat `register`. Respons internal tanpa redirect adalah **syarat perlu**, belum cukup untuk membuktikan worker terpasang; periksa pula MIME, scope, kebijakan browser, dan hasil `install`/precache. Jika masih gagal, rekam pesan error lengkap dan tujuan redirect yang sudah disanitasi, lalu tinjau route serta pengaturan Deployment Protection. Hindari mengulang request identik tanpa informasi baru.
4. Jangan mematikan Deployment Protection, menambah domain publik/exception, atau membuat bypass jangka panjang demi meluluskan tes. Jika solusi memang memerlukan perubahan kontrol akses, siapkan proposal terpisah berisi target, dampak, dan alasan; jangan menerapkannya sebagai efek samping T-01.

### P3.2 Perbaikan dan uji yang ditentukan oleh bukti

- Bila cookie browser pengguna membuat worker terdaftar tanpa redirect, tidak perlu mengubah konfigurasi Vercel hanya karena otomasi ber-header OIDC gagal. Dokumentasikan keterbatasan metode otomasi dan lanjutkan uji browser hosted.
- Bila browser yang sah tetap menerima redirect, perbaiki titik penyebab yang sudah dibuktikan pada Preview dan tambahkan reproduksi yang gagal sebelum perbaikan. Jangan menganggap `vercel curl` 200 sebagai hasil browser.
- Uji negatif pada proses `install`: [service worker](../src/service-worker.ts) saat ini melakukan `cache.addAll` untuk aset, lalu mengambil `/` dan hanya memeriksa `ok` serta `Content-Type: text/html` sebelum menyimpannya sebagai `/200.html`. Reproduksi respons HTML hasil redirect SSO untuk **root** dan sedikitnya satu aset immutable JS/CSS/ikon. Pastikan halaman SSO tidak tersimpan sebagai shell maupun aset offline; bila tidak dapat memperoleh aset aplikasi yang benar, instalasi harus gagal secara jelas. Jika tes ini gagal, tambahkan validasi respons yang relevan (tujuan akhir/origin, MIME, dan identitas shell/aset) dan uji ulang. Jangan cache respons privat atau API.
- Jalankan build produksi lokal dan uji PWA eksplisit dengan `E2E_PWA=1`: manifest/ikon, worker aktif, controller, cache hanya shell publik, dan navigasi offline. Tes lokal adalah gate implementasi, bukan bukti hosted.
- Pada browser Preview yang sah, buktikan secara terpisah: script worker 200 JavaScript **tanpa redirect pada registrasi**, state `activated`, scope yang benar, controller setelah reload, dan shell aplikasi tampil saat navigasi offline. Untuk update, pertahankan sesi pada **alias Preview yang sama** dari versi A ke deployment versi B; buktikan worker baru `waiting`/banner pembaruan, selesaikan formulir atau selfie yang sedang berjalan, lalu aktifkan versi B. Reload biasa tanpa bukti dua versi tidak cukup. Data HR tetap membutuhkan internet.

**Checkpoint P3:** simpan hasil per kondisi (lokal, HTTP Preview, browser hosted, update lintas versi) di progres. Jika akses browser pengguna belum tersedia, akhiri pekerjaan mandiri dengan `browser hosted: menunggu`, bukan `lulus`. Uji iPhone/iPad tetap baris terpisah sesuai penundaan pengguna.

## Milestone P4 — regresi, Preview, dan serah terima

**Tujuan:** tiga perubahan dapat ditinjau dan ditelusuri dari commit sampai bukti yang memang tersedia.

- Untuk perubahan copy/README: `git diff --check`, `npm.cmd run check`, QA panduan desktop/ponsel, dan verifikasi jumlah migration source. Untuk perubahan service worker atau konfigurasi PWA: tambahkan reproduksi terarah, `npm.cmd run build`, uji PWA build produksi eksplisit, serta jalankan suite regresi wajib pada [guide supervisor §9](guide-goal-milestone-supervisor-2026-10-23.md#9-panduan-pemeriksaan-untuk-pelaksana): unit, database fresh/upgrade Preview/historis, legacy, readiness, dan live-mock supervisor dengan persist/reload/retry. Tunggu dev server benar-benar `ready` sebelum Playwright; jalankan satu proses Playwright pada satu `test-results` agar artefak tidak bertabrakan.
- Perintah dasar gate lokal dari root repo adalah:

  ```powershell
  npm.cmd run check
  npm.cmd test -- --maxWorkers=1
  npm.cmd run test:database
  npm.cmd run test:database:legacy
  node supabase/deployment/verify-readiness-preview.test.mjs
  npm.cmd run build
  git diff --check
  ```

  Jalankan PWA build lokal dan live-mock dengan env terisolasi serta flag eksplisit seperti [guide supervisor §9.2–9.3](guide-goal-milestone-supervisor-2026-10-23.md#92-demo-browser-dan-pwa-lokal). Catat jumlah tes lulus/gagal/skip; `npm.cmd run test:e2e` tanpa flag tidak membuktikan dua skenario itu berjalan.
- Tinjau apakah ada migration baru. Secara normal jawabannya **tidak ada**. Jika ada kebutuhan yang sungguh terpisah, hentikan perluasan dan lakukan review target/preflight sesuai guide utama sebelum DDL Preview.
- Commit logis pada `codex/preview`, push sesuai cakupan, verifikasi [CI](../.github/workflows/ci.yml) untuk SHA final, deployment ID dan alias Preview, serta HTTP/browser evidence. Deployment `Ready` dan tes yang `skipped` tidak dihitung sebagai alur lulus.
- Perbarui [progres supervisor](progres-supervisor-2026-10-23.md) dengan tabel penutupan di bawah. Tulis implementasi lokal, deployment Preview, workflow hosted, dan perangkat nyata secara terpisah. Jangan mengubah status SPV-11/PVR-02 melebihi bukti yang diperoleh.

| Temuan | Perubahan dan commit | Tes lokal | CI/deploy Preview | Browser hosted | iPhone/iPad | Status akhir |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 PWA | … | … | … | … | Ditunda/bukti aktual | Terbuka/lulus terbatas/lulus sesuai bukti |
| T-02 Panduan | … | … | … | … | Tidak diperlukan untuk copy | Terbuka/lulus |
| T-03 README | … | … | … | Tidak diperlukan untuk teks | Tidak diperlukan | Terbuka/lulus |

## Handoff untuk agent pelaksana

Kerjakan P0 → P1 → P2 → P3 → P4 secara berurutan, dengan checkpoint yang dapat ditinjau setelah setiap milestone. Tiga temuan adalah cakupan tugas; jangan memperluas ke Production atau mengubah data untuk membuat hasil uji terlihat lulus. Bila browser Vercel yang sudah login belum dapat diakses, selesaikan README, Panduan, hardening PWA yang terbukti perlu, serta seluruh tes lokal terlebih dahulu. Laporkan syarat konkret untuk menutup browser hosted dan iPhone/iPad tanpa meminta pengguna mengirim rahasia.

Rujukan platform: [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication), [akses deployment terlindungi via CLI](https://vercel.com/docs/cli/curl), dan [dokumentasi migrasi Supabase](https://supabase.com/docs/reference/cli/supabase-db-push).
