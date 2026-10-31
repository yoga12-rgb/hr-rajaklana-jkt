# Audit ulang hasil penutupan temuan autentikator

Tanggal: 30 Oktober 2026. Source: `ca17c925a2ee50a0b91c82c036f3636d424b1877`, branch `codex/preview`.

## Kesimpulan

Penutupan AR-01/AR-02/AR-03 pada laporan progres masih terlalu luas. Ada satu regresi Realtime yang ter-reproduksi, probe final masih menerima beberapa pelemahan, gate penting belum dipulihkan, dan entrypoint CLI cleanup tidak berjalan pada Windows. Karena itu status “tiga temuan tertutup” perlu ditinjau ulang.

Ini adalah pemeriksaan hasil pekerjaan, belum implementasi perbaikannya. Tes reproduksi sementara sudah dihapus kembali; kode aplikasi dan migration tidak diubah. Tidak ada mutasi hosted, perubahan Production/main, cleanup faktor nyata, commit, push atau deployment dalam audit ini.

## Ringkasan temuan

| ID | Prioritas | Temuan | Status |
| --- | --- | --- | --- |
| ARA-01 | P1 | Callback Realtime tidak berfungsi setelah rotasi token akun yang sama | Ter-reproduksi lokal |
| ARA-02 | P2 | Probe final menerima policy/guard/helper yang dilemahkan | Empat skenario ter-reproduksi pada Postgres disposable |
| ARA-03 | P2 | Acceptance regresi AR-03 dan bukti browser AR-01 belum masuk gate aktif | Terverifikasi dari wiring, source tes dan eksekusi harness historis |
| ARA-04 | P2 | CLI cleanup keluar sukses tanpa menjalankan `main()` di Windows | Ter-reproduksi melalui `--help` |

P1 berarti regresi fungsi utama yang perlu diprioritaskan. P2 pada probe dan cakupan tes berarti gate tidak cukup untuk menyatakan perbaikan lengkap; ini sendiri bukan bukti terjadi kebocoran hosted.

## ARA-01 — Realtime berhenti memproses event sesudah rotasi token

Lokasi: `src/lib/state/app.ts:382`, callback pada baris398/404, dan perubahan revision pada baris452/600.

Saat token akun yang sama berubah, `authRevision` dinaikkan tanpa membuang channel lama. Selesai refresh, `createRealtimeChannel()` langsung kembali karena `realtimeUserId` masih sama. Callback channel lama tetap memegang nilai `revision` sebelum rotasi; seluruh callback `postgres_changes` dan status channel kemudian ditolak oleh `authRevision !== revision`.

Dampak: perubahan karyawan, absensi, cuti, penugasan dan notifikasi tidak lagi memicu refresh instan. Data dapat baru berubah melalui polling60 detik ketika halaman aktif, fokus ulang, atau refresh manual. Label koneksi juga dapat tetap memakai status lama karena callback CLOSED/TIMED_OUT ikut diabaikan.

Reproduksi menggunakan fixture asli `src/lib/state/realtime-recovery.test.ts`:

1. Init akun dan emit `SUBSCRIBED`.
2. Rotasikan token dengan user **dan AAL tetap sama**, memakai nonce token baru.
3. Emit `TOKEN_REFRESHED`, tunggu revalidasi selesai.
4. Emit callback `employees` UPDATE pada channel yang dipertahankan.
5. Tunggu lebih dari debounce300 ms; jumlah pembacaan tabel tidak bertambah.

Hasil tes tambahan sementara:

```text
AUDIT: same-level token-only rotation preserves live postgres updates
expected 70 to be greater than 70
1 failed | 21 passed
```

Reproduksi lain dengan aal2→aal1 memberikan kegagalan yang sama. Tes existing21 tetap lulus, karena belum memeriksa konsumsi event setelah token benar-benar berubah.

Perbaikan yang diperlukan: pisahkan generasi subscription dari revision request/token, atau ganti channel dengan instance yang terikat pada revision baru setelah validasi sah, sambil menjaga UI tetap mounted. Tambahkan tes event dan terminal/reconnect setelah rotasi; pertahankan penolakan event akun/generasi lama.

## ARA-02 — Probe final masih menerima pelemahan kontrol sesi

Lokasi: `supabase/deployment/verify-authenticator-removed-preview.sql:54`, `:81`, `:95`.

Validasi ekspresi masih berdasarkan substring `private.session_allowed()` dan penolakan kata `true`. Probe tidak memeriksa `polcmd`; pemeriksaan grant helper hanya menolak anon, dan body `session_allowed()` sendiri tidak diverifikasi mencapai context.

Reproduksi menggunakan seluruh26 migration, history lokal asli, PGlite disposable, dan **probe final yang sama tanpa dimodifikasi**. Baseline lulus; setiap mutation di-commit lokal sebelum probe lalu dipulihkan, dan baseline diprobe ulang:

| Mutation | Hasil aktual | Expected |
| --- | --- | --- |
| Storage USING/WITH CHECK `((select private.session_allowed()) OR 1=1)` | ACCEPTED | Ditolak: sesi dapat dibypass |
| Restrictive Storage policy hanya `FOR UPDATE` | ACCEPTED | Ditolak: SELECT/INSERT/DELETE kehilangan guard tersebut |
| `GRANT EXECUTE ON private.raw_employee_id() TO authenticated` | ACCEPTED | Ditolak: helper identitas mentah harus internal |
| `private.session_allowed()` diganti function definer/search_path sama yang `SELECT true` | ACCEPTED | Ditolak: guard tidak lagi memvalidasi sesi |

Mutation6 yang ada di harness hanya mencakup subset acceptance. Ia membuktikan baseline dan enam contoh itu, bukan seluruh semantic weakening. Menjalankan behavioral tests pada baseline bersih tidak membuktikan helper yang sengaja dirusak tadi ditolak oleh gabungan gate.

Perbaikan yang diperlukan: cocokkan bentuk ekspresi/kontrak helper yang diizinkan secara ketat, periksa command policy serta role/grant setiap helper sesuai boundary-nya. Tambahkan seluruh mutation yang diwajibkan panduan, termasuk pelemahan body helper dan ekspresi selain literal `true`, dengan assertion sebab penolakan yang spesifik.

Pemeriksaan hosted terbatas tidak menemukan mutation tadi pada guard `employees`/Storage; lihat bagian hosted. Jangan menyimpulkan hosted sedang bocor dari hasil tes mutation lokal ini.

## ARA-03 — Cakupan gate belum memenuhi klaim penutupan

Lokasi utama: `package.json:31`, `tests/live-mfa.spec.ts:20`, `supabase/tests/authenticator-removal.mjs`, `supabase/tests/followup-upgrade-compatibility.mjs:272`.

Temuan konkret:

1. Regresi managed-network, revoked-session Storage DELETE tanpa WHERE/RETURNING, dan matriks sesi yang lebih lengkap masih ada pada `supabase/tests/mfa-enforcement.mjs`. Harness itu tidak dipanggil `test:database`/CI. Ketika dijalankan manual, ia menerapkan seluruh26 migration lalu berhenti pada probe25 dengan pesan `Expected exact ordered MFA Preview baseline 25; stop and inspect history`, sebelum tes network/Storage berikutnya berjalan. Operator network belum dipindah ke gate final dan harness historis belum dibatasi tepat25.
2. Test browser berjudul “admin with no factor” masih menerima user dengan faktor TOTP `verified`; fixture yang sama dipakai tes legacy. Jadi dua skenario itu belum terpisah sesuai panduan.
3. Tidak ada skenario live-mock yang merotasi sesi melalui SDK Auth sambil menahan context dan memeriksa form cuti, form karyawan, kamera/selfie atau mount marker. Tes kamera yang ada berada di demo, tanpa rotasi JWT. Tambahan satu tes state tidak membuktikan acceptance browser tersebut.
4. Tes “session/user mismatch” dalam harness final menggunakan ID sesi yang tidak pernah dibuat, sehingga membuktikan sesi hilang, bukan sesi nyata milik user lain. Tes expired berikutnya juga tidak mengembalikan claims ke ID sesi asli yang dibuat kedaluwarsa; assertion dapat tetap lulus karena ID sesi tidak ada.
5. Snapshot populated25→26 baru menanam satu recovery row `failed` dengan `factor_ids` kosong. Snapshot tidak mencakup receipt tables dan tidak menanam status `pending/completed`, meskipun dokumen progres menyebut `pending/failed/completed`. Ini belum membuktikan receipt/payload/result serta seluruh status histori dipertahankan sebagaimana acceptance.

Perbaikan yang diperlukan: petakan setiap acceptance ke assertion dan perintah CI aktif. Pisahkan historical25, final26 dan network operator fixture. Tambahkan akun/sesi nyata yang berbeda dalam fixture, objek Storage spesifik dan pemeriksaan row setelah DELETE. Lengkapi skenario browser rotasi, serta snapshot recovery/receipt populated yang benar. Koreksi status di dokumen progres sampai bukti itu tersedia.

## ARA-04 — CLI cleanup tidak berjalan pada Windows

Lokasi: `supabase/deployment/cleanup-auth-factors.mjs:97`.

Entrypoint membandingkan `import.meta.url` dengan URL yang dibentuk manual dari argv. Pada Windows:

```text
import.meta.url : file:///D:/aplikasi-web/rajaklana-hr/supabase/deployment/cleanup-auth-factors.mjs
dibentuk kode : file://D:/aplikasi-web/rajaklana-hr/supabase/deployment/cleanup-auth-factors.mjs
```

Nilainya berbeda sehingga `main()` tidak pernah dipanggil. Perintah berikut menghasilkan output kosong dengan exit0:

```powershell
node supabase/deployment/cleanup-auth-factors.mjs --help
```

Dampak: pemanggilan CLI `--manifest=...` juga diam-diam tidak melakukan dry-run/persist/validasi, tetapi terlihat sukses. Tes existing hanya mengimpor function, sehingga masalah entrypoint tidak terdeteksi.

Perbaikan yang diperlukan: gunakan `pathToFileURL(resolve(process.argv[1])).href` dengan guard argv, serta subprocess tests untuk help, malformed manifest, dry-run, dan jalur execute yang sengaja dibatasi. Ini tidak memerlukan secret atau penghapusan faktor nyata.

## Verifikasi audit yang dijalankan

| Pemeriksaan | Hasil |
| --- | --- |
| `npm.cmd run check` | Lulus, 0 error/0 warning |
| `npm.cmd test -- --maxWorkers=1` pada source existing | Lulus,37 file/467 test |
| `npm.cmd run test:database` | Lulus seluruh harness yang memang di-wire |
| Tambahan tes Realtime token-only | Gagal sesuai ARA-01;21 existing lulus |
| Empat mutation probe tambahan | Semuanya keliru diterima sesuai ARA-02 |
| `node supabase/tests/mfa-enforcement.mjs` | Gagal pada kontrak history25 setelah seluruh26 migration |
| CLI cleanup `--help` pada Windows | Exit0/output kosong |
| `git diff --check` setelah scratch reproduksi dibersihkan | Bersih |

Eksekusi pertama unit di sandbox gagal karena EPERM rename cache SSR, sebelum tes berjalan; eksekusi melalui mekanisme eskalasi normal memberi hasil di atas. Seluruh mutation SQL hanya pada Postgres disposable lokal. Browser live-mock/PWA penuh dan workflow akun hosted tidak dijalankan ulang dalam audit ini; hasil CI historis tidak dipakai untuk menganggap acceptance baru yang hilang telah lulus.

## Hosted Preview dan batas bukti

Identitas diperiksa kembali melalui connector: `hr-rajaklana-preview`, ref `lypsqrwjzrmuyqtdcegr`, organisasi `bvwgekyfibloctfslgdf`, status `ACTIVE_HEALTHY`.

Query katalog baca-saja mengonfirmasi:

- 26 migration; latest `20261030033256`.
- `employees` dan `storage.objects` memakai guard restrictive `privileged_mfa_session`, command `*`, USING/WITH CHECK `(SELECT private.session_allowed())`.
- authenticated tidak memperoleh EXECUTE `private.raw_employee_id()`; anon tidak memperoleh EXECUTE `public.auth_access_context()`.

Ini bukti katalog terbatas; bukan verifikasi seluruh workflow/session/Storage hosted. Uji akun nyata, iPhone/iPad, PVR-02, effective TOTP toggle AUTH-06, histori cleanup AUTH-04 dan managed-owner pg_net tetap mengikuti status terbuka sebelumnya.

## Urutan perbaikan yang disarankan

1. ARA-01: pulihkan Realtime setelah rotasi token, termasuk recovery channel, tanpa unmount UI atau melemahkan account isolation.
2. ARA-02: perketat probe dan lengkapi mutation tests yang menolak semantic bypass.
3. ARA-03: pulihkan gate network/Storage/session/browser/historical25 dan lengkapi snapshot populated25→26; koreksi klaim progres.
4. ARA-04: benahi entrypoint CLI Windows dan tes prosesnya.

Setelah perbaikan, jalankan seluruh gate wajib panduan pada source akhir, verifikasi CI/deployment Preview dengan SHA yang cocok, dan laporkan workflow hosted/perangkat menurut bukti aktual.
