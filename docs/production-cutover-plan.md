# Rencana upgrade dan cutover Production

Dokumen persiapan; bukan izin menjalankan perubahan pada Production/main. Target implementasi tugas sekarang hanya Preview. Rilis operasional memerlukan hasil hosted/perangkat, backup teruji, paket yang sesuai, dan keputusan pengguna. Baseline Production historis12 tidak disamakan dengan Preview aktual24.

## Persiapan dan latihan pemulihan

Verifikasi ref Production dari metadata proyek dan URL environment tanpa mengeluarkan secret. Cocokkan seluruh urutan **versi/nama**12 migration, definisi fungsi/policy/kolom, extension/owner, Auth/Storage dan frontend lama. Hentikan rencana jika baseline berbeda; jangan repair/reset history supaya cocok.

Operator berwenang menyiapkan backup terenkripsi di luar Git serta restore rehearsal pada salinan aman yang disetujui. Backup harus mencakup schema/data/roles yang sesuai, riwayat `supabase_migrations`, Auth, perubahan policy Storage, konfigurasi layanan/Edge, serta **byte objek Storage**. Dump database/metadata bucket saja tidak memulihkan foto. Kredensial koneksi tetap di pengelola secret/terminal operator; tidak di chat, argumen tersalin, log, atau dokumen.

Rehearsal harus mencatat checksum/ukuran artefak, waktu pemulihan, jumlah/identitas fixture sintetis, FK dan audit/receipt sebelum-sesudah, login ulang, akses foto privat, Realtime, serta TOTP pada proyek salinan. Saat memulihkan Auth ke host berbeda, tangani refresh session secara resmi; jangan menyalin token sebagai cara login. Simpan hasil rehearsal tanpa row HR/seed/foto. **Belum ada rehearsal Production yang dinyatakan lulus dalam tugas ini.**

Referensi: [Backup/restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [restore dan objek Storage](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

## Penerapan schema bertahap

CLI yang diperiksa29 Okt: Supabase2.111.0. `db push --dry-run` menampilkan seluruh migration tertunda; CLI tidak memiliki opsi berhenti pada versi tertentu. Karena timestamp connector berbeda dari filename source, jangan memakai `db push` generik atau `--include-all` pada history ini. Jalur yang dipersiapkan adalah **apply satu migration pada satu waktu** melalui connector berwenang dengan nama dan SQL file source yang sudah direview; setelah setiap tahap, baca ulang history dan katalog. Simpan versi hosted yang benar-benar dihasilkan. Preflight tidak menandai history sebagai applied.

| Checkpoint | Tindakan pada salinan latihan lebih dahulu | Gerbang berhenti |
| --- | --- | --- |
| Baseline12 | Verifikasi urutan/nama persis dan backup/restoration siap. | Drift, backup tidak dapat dipulihkan, atau akun uji tidak siap. |
| Migration13 | Terapkan `cashier_spv_weekly_roster` saja. | Jangan lanjut langsung ke14. |
| Preflight13 | Jalankan `supabase/deployment/preflight-followup-off-compatibility.sql` hanya setelah history persis13; ulangi untuk membuktikan idempotensi. | Constraint/backfill Libur gagal tanpa preflight; file memeriksa versi13 persis. Jika connector menghasilkan versi13 berbeda, jangan repair history/ubah file lama; siapkan preflight baru yang memvalidasi seluruh nama/definisi pada baseline tersebut. |
| Migration14–21 | Terapkan berurutan, satu per satu: audit repairs, repair log index, context consistency/locking, readiness findings, followup queue, operations, planning reports. | Error/konflik schema, audit/receipt hilang, atau test bisnis gagal. |
| Preflight21 | Jalankan `preflight-supervisor-operational-hardening.sql`; memeriksa dua jenis duplikasi exchange aktif secara baca-saja: assignment pemohon dan pasangan karyawan/tanggal. | Selesaikan duplikasi melalui aksi bisnis normal dengan audit; jangan hapus row agar indeks lulus. Preflight ini tidak memeriksa duplikasi serah-terima. |
| Migration22–24 | Operational hardening, configuration concurrency, sensitive ACL. | Verifikasi baseline/version, replay key/payload asli, SELECT/RLS dan direct DML denial. |
| Migration25 | Aktifkan TOTP Auth, siapkan frontend/server+Edge kompatibel, terapkan privileged MFA enforcement dalam jendela terkontrol. | `auth.sessions`/factor schema atau hak managed Storage berbeda; jangan melemahkan guard. |
| Final | Probe katalog yang sesuai target, advisor, role/scope, alur hosted dan audit. | Ready bukan bukti workflow; tidak ada cutover jika gate wajib terbuka. |

Baseline Preview24 langsung menuju25 dan **tidak menjalankan preflight13/21 lagi**. Harness lokal menguji jalur Preview aktual, upgrade18, serta12→13→preflight14→21→preflight22→final secara terpisah. Pemeliharaan `pg_net` yang dimiliki platform memerlukan operator managed-owner dan tidak boleh dicampur menjadi migration aplikasi no-op. Lihat progres29 Okt untuk residualnya.

## Frontend lama, staging dan domain

Pastikan semua CI wajib pada SHA yang akan dirilis lulus: validate, Browser demo-pwa, Browser live-mock, serta bukti hosted/perangkat yang diwajibkan. Vercel Git integration saat ini membangun independen dari CI. Karena `main` otomatis mengarah ke domain Production, **jangan push/merge main sebelum konfigurasi gate/rilis manual yang disetujui benar-benar ada**.

Dengan Vercel CLI54.11.1, opsi staging yang diperiksa adalah `vercel deploy --prod --skip-domain`. Ini rencana untuk operator rilis setelah izin dan gate tersedia; tidak dijalankan pada tugas ini. Bangun dengan environment Production, uji deployment Production yang belum diberi domain, lalu promosikan **deployment Production yang sama**. Jangan menganggap promosi build Preview memakai artefak/config yang sama. [Staging/promosi Vercel](https://vercel.com/docs/deployments/promoting-a-deployment), [Deployment Checks](https://vercel.com/docs/deployment-checks).

Urutan jendela rilis: pembekuan transaksi terencana → backup diverifikasi → staged frontend/server siap → konfigurasi TOTP dan schema/Edge kompatibel → smoke berwenang pada staged deployment → assignment domain → smoke domain → pemantauan. Tab lama dapat ditolak setelah MFA diwajibkan; pengguna menerima pembaruan/muat ulang dan verifikasi kembali. Tidak ada jalur bypass untuk menghidupkan tab lama.

Rollback Vercel tidak mengembalikan schema/Auth/data. Jika schema sudah commit, pilih perbaikan maju atau restore teruji pada target pemulihan yang disetujui; jangan menurunkan policy/version checks. Pertahankan audit dan key/payload request ambigu. Catat kapan transaksi dibuka kembali dan bagaimana data setelah backup direkonsiliasi.

## Keputusan yang masih diperlukan

Paket Supabase/hosting komersial, leaked-password protection atau risiko residual yang diterima, rehearsal backup nyata, gate deployment, pemilik insiden, dan hasil hosted/perangkat tetap merupakan gerbang sebelum GO. Tidak ada upgrade paket, proyek baru berbayar, merge main, migration, atau deployment Production yang dilakukan oleh dokumen ini.
