import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const DEMO_PASSWORD = 'DemoRajaklana123!';

async function login(page: Page, role: 'Admin HR' | 'Head Baker' | 'Kasir' = 'Admin HR') {
  await page.goto('/login');
  await expect(page.getByText('Data contoh, tanpa koneksi Supabase.')).toBeVisible();
  await page.getByRole('button', { name: role, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('Mode demo', { exact: true })).toBeVisible();
}

async function switchUser(page: Page, id: string) {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
  await page.locator('a.account').click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole('combobox', { name: 'Akun contoh', exact: true }).selectOption(id);
  await expect(page.getByRole('combobox', { name: 'Akun contoh', exact: true })).toHaveValue(id);
}

function dateAfter(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function submitLeave(page: Page, reason: string, start = dateAfter(3), end = dateAfter(5)) {
  await page.goto('/leave');
  await page.getByRole('button', { name: 'Buat pengajuan', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tanggal mulai', { exact: true }).fill(start);
  await dialog.getByLabel('Tanggal selesai', { exact: true }).fill(end);
  await dialog.getByLabel('Alasan', { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Kirim pengajuan', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button').filter({ hasText: reason })).toBeVisible();
}

async function openRequest(page: Page, reason: string, review = false) {
  await page.goto('/leave');
  if (review) await page.getByRole('tab', { name: /Persetujuan tim/ }).click();
  await page.getByRole('button').filter({ hasText: reason }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function expectBalance(page: Page, days: number) {
  await page.goto('/leave');
  await expect(page.locator('.metric').filter({ hasText: 'Saldo cuti Anda' }).getByText(`${days} hari`, { exact: true })).toBeVisible();
}

test.describe('Demo frontend — not hosted Supabase integration', () => {
  const errors = new Map<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const failures: string[] = [];
    errors.set(page, failures);
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Network-only failures (e.g. external fonts in a restricted environment)
      // are recorded by browser/network QA, not treated as JavaScript failures.
      if (/Failed to load resource|ERR_(?:NAME_NOT_RESOLVED|CONNECTION|INTERNET|NETWORK|CERT)/.test(message.text())) return;
      failures.push(message.text());
    });
  });

  test.afterEach(async ({ page }) => {
    expect(errors.get(page), 'No runtime JavaScript errors').toEqual([]);
  });

  test('desktop navigation stays inside SPA and preserves the signed-in account', async ({ page }) => {
    await login(page);
    await page.evaluate(() => { (window as unknown as { testNavigationMarker: string }).testNavigationMarker = 'same-document'; });
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    for (const [label, route, title] of [
      ['Karyawan', '/employees', 'Data karyawan'],
      ['Organisasi', '/organization', 'Organisasi & outlet'],
      ['Cuti & izin', '/leave', 'Cuti & izin'],
      ['Kehadiran', '/attendance', 'Masuk & pulang'],
      ['Profil saya', '/profile', 'Profil & informasi kerja'],
    ]) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { testNavigationMarker: string }).testNavigationMarker)).toBe('same-document');
    }
  });

  test('mobile cashier navigation is usable and restricted employee pages stay protected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'Kasir');
    const nav = page.getByRole('navigation', { name: 'Navigasi ponsel' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Kehadiran', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Pengajuan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cuti & izin', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/employees');
    await expect(page.getByText('Akses khusus Admin HR', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tambah karyawan', exact: true })).toHaveCount(0);
  });

  test('outlet, department, position and employee can be created and maintained through forms', async ({ page }) => {
    await login(page);
    await page.goto('/organization');
    await page.getByRole('button', { name: 'Tambah outlet', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama outlet', { exact: true }).fill('Outlet Uji E2E');
    await dialog.getByLabel('Alamat', { exact: true }).fill('Alamat pengujian browser');
    await dialog.getByLabel('Jam buka', { exact: true }).fill('08:00');
    await dialog.getByLabel('Jam tutup', { exact: true }).fill('22:00');
    await dialog.getByLabel('Latitude', { exact: true }).fill('-6.2');
    await dialog.getByLabel('Longitude', { exact: true }).fill('106.816666');
    await dialog.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(dialog).toBeHidden();
    let outlet = page.locator('article').filter({ hasText: 'Outlet Uji E2E' });
    await expect(outlet.getByText('08:00–22:00 WIB', { exact: true })).toBeVisible();
    await outlet.getByRole('button', { name: 'Kelola', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Nama outlet', { exact: true }).fill('Outlet Uji E2E Revisi');
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Outlet Uji E2E Revisi', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: /Departemen/ }).click();
    await page.getByRole('button', { name: 'Tambah departemen', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama departemen', { exact: true }).fill('Departemen Uji');
    await dialog.getByLabel('Kode departemen', { exact: true }).fill('UJI');
    await dialog.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Departemen Uji', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Jabatan/ }).click();
    await page.getByRole('button', { name: 'Tambah jabatan', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama jabatan', { exact: true }).fill('Staf Uji');
    await dialog.getByRole('combobox', { name: 'Departemen', exact: true }).selectOption({ label: 'Departemen Uji' });
    await dialog.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();

    await page.goto('/employees');
    await page.getByRole('button', { name: 'Tambah karyawan', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama lengkap', { exact: true }).fill('Karyawan Uji E2E');
    await dialog.getByLabel('Nomor WhatsApp', { exact: true }).fill('081234567899');
    await dialog.getByLabel('Tanggal masuk', { exact: true }).fill('2025-01-01');
    await dialog.getByRole('combobox', { name: 'Departemen', exact: true }).selectOption({ label: 'Departemen Uji' });
    await dialog.getByRole('combobox', { name: 'Jabatan', exact: true }).selectOption({ label: 'Staf Uji' });
    await dialog.getByRole('combobox', { name: 'Penempatan', exact: true }).selectOption({ label: 'Outlet Uji E2E Revisi' });
    await dialog.getByRole('combobox', { name: 'Atasan langsung', exact: true }).selectOption({ label: 'Alya Pratama' });
    await dialog.getByRole('button', { name: 'Simpan karyawan', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Cari karyawan', { exact: true }).fill('Karyawan Uji E2E');
    const row = page.getByRole('row').filter({ hasText: 'Karyawan Uji E2E' });
    await expect(row).toContainText('RK000007');
    await expect(row).toContainText('Outlet Uji E2E Revisi');
    await page.getByRole('button', { name: 'Lihat profil Karyawan Uji E2E', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit data', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nama lengkap', { exact: true }).fill('Karyawan Uji Revisi');
    await dialog.getByText('Informasi pribadi & status', { exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Status karyawan', exact: true }).selectOption('inactive');
    await dialog.getByLabel('Tanggal keluar', { exact: true }).fill(dateAfter(0));
    await dialog.getByLabel('Alasan keluar', { exact: true }).fill('Selesai pengujian');
    await dialog.getByRole('button', { name: 'Simpan karyawan', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Cari karyawan', { exact: true }).fill('Karyawan Uji Revisi');
    await page.getByRole('combobox', { name: 'Filter status karyawan', exact: true }).selectOption('inactive');
    await expect(page.getByRole('row').filter({ hasText: 'Karyawan Uji Revisi' })).toContainText('RK000007');

    await page.goto('/organization');
    outlet = page.locator('article').filter({ hasText: 'Outlet Uji E2E Revisi' });
    await outlet.getByRole('button', { name: 'Kelola', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Outlet aktif', { exact: true }).uncheck();
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(outlet.getByText('Nonaktif', { exact: true })).toBeVisible();
  });

  test('leave approval, date change and cancellation adjust balance only after decisions', async ({ page }) => {
    await login(page, 'Kasir');
    await expectBalance(page, 12);
    const reason = 'Cuti untuk uji perubahan dan pembatalan';
    await submitLeave(page, reason);
    await openRequest(page, reason);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Simpan keputusan' })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByText('Berikan keputusan')).toHaveCount(0);

    await switchUser(page, 'employee-3');
    await page.goto('/leave');
    await page.getByRole('tab', { name: /Persetujuan tim/ }).click();
    await expect(page.getByRole('button').filter({ hasText: reason })).toHaveCount(0);

    await switchUser(page, 'employee-1');
    await openRequest(page, reason, true);
    await page.getByRole('dialog').getByLabel('Jumlah potongan cuti (hari)', { exact: true }).fill('3');
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan keputusan', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await switchUser(page, 'employee-4');
    await expectBalance(page, 9);
    await openRequest(page, reason);
    await page.getByRole('dialog').getByRole('button', { name: 'Ubah tanggal', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Tanggal mulai', { exact: true }).fill(dateAfter(7));
    await page.getByRole('dialog').getByLabel('Tanggal selesai', { exact: true }).fill(dateAfter(8));
    await page.getByRole('dialog').getByLabel('Alasan perubahan', { exact: true }).fill('Perubahan tanggal pengujian');
    await page.getByRole('dialog').getByRole('button', { name: 'Kirim', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expectBalance(page, 9);
    await expect(page.getByText('Perubahan tanggal menunggu keputusan', { exact: true })).toBeVisible();

    await switchUser(page, 'employee-1');
    await openRequest(page, reason, true);
    await page.getByRole('dialog').getByLabel('Jumlah potongan cuti (hari)', { exact: true }).fill('2');
    await page.getByRole('dialog').getByRole('button', { name: 'Setujui perubahan', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await switchUser(page, 'employee-4');
    await expectBalance(page, 10);
    await openRequest(page, reason);
    await expect(page.getByRole('dialog').getByText('2 hari', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Batalkan pengajuan', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Alasan pembatalan', { exact: true }).fill('Tidak jadi mengambil cuti');
    await page.getByRole('dialog').getByRole('button', { name: 'Kirim', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expectBalance(page, 10);
    await expect(page.getByText('Pembatalan menunggu keputusan', { exact: true })).toBeVisible();
    await switchUser(page, 'employee-1');
    await openRequest(page, reason, true);
    await page.getByRole('dialog').getByRole('button', { name: 'Setujui pembatalan', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await switchUser(page, 'employee-4');
    await expectBalance(page, 12);
    await expect(page.getByRole('button').filter({ hasText: reason })).toContainText('Dibatalkan');
  });

  test('Admin HR cannot approve own request and another admin records external decision', async ({ page }) => {
    await login(page);
    const reason = 'Pengajuan supervisor untuk persetujuan eksternal';
    await submitLeave(page, reason, dateAfter(2), dateAfter(2));
    await openRequest(page, reason);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Simpan keputusan', exact: true })).toHaveCount(0);
    await switchUser(page, 'employee-2');
    await openRequest(page, reason, true);
    await page.getByRole('dialog').getByLabel('Nama pemberi keputusan', { exact: true }).fill('Manager Pusat Jogja — pengujian');
    await page.getByRole('dialog').getByLabel('Jumlah potongan cuti (hari)', { exact: true }).fill('0');
    await page.getByRole('dialog').getByRole('button', { name: 'Simpan keputusan', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await switchUser(page, 'employee-1');
    await openRequest(page, reason);
    await expect(page.getByRole('dialog').getByText('Manager Pusat Jogja — pengujian', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Tanpa potong cuti', { exact: true })).toBeVisible();
  });

  test('cashier attendance requires inside GPS and new camera selfie; clock out checks location again', async ({ page, context }) => {
    // Test-only browser camera: this host's Edge fake camera ends before it
    // emits frames. A canvas video stream exercises the app's real preview,
    // drawImage, JPEG capture and selfie validation without a physical camera.
    // This script is never imported by src or bundled into production.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 640;
          const context = canvas.getContext('2d')!;
          const draw = () => {
            context.fillStyle = '#cfdac9'; context.fillRect(0, 0, 640, 640);
            context.fillStyle = '#314c38'; context.beginPath(); context.arc(320, 245, 90, 0, Math.PI * 2); context.fill();
            context.fillRect(190, 345, 260, 210);
            context.fillStyle = '#ffffff'; context.font = '24px sans-serif'; context.fillText('TEST CAMERA ONLY', 185, 600);
            requestAnimationFrame(draw);
          };
          draw();
          return canvas.captureStream(15);
        },
      });
    });
    await login(page, 'Kasir');
    await page.goto('/attendance');
    await context.setGeolocation({ latitude: -6.3, longitude: 106.9, accuracy: 10 });
    await page.getByRole('button', { name: 'Clock in · Masuk', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Lokasi belum memenuhi syarat', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi clock in', exact: true })).toBeDisabled();
    await context.setGeolocation({ latitude: -6.2, longitude: 106.816666, accuracy: 10 });
    await page.getByRole('dialog').getByRole('button', { name: 'Periksa ulang lokasi', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Lokasi sesuai', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi clock in', exact: true })).toBeDisabled();
    await page.getByRole('dialog').getByLabel(/Middle/).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Buka kamera', exact: true }).click();
    await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Ambil selfie', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Selfie siap', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Ambil ulang', exact: true }).click();
    await expect.poll(() => page.getByLabel('Pratinjau kamera selfie').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Ambil selfie', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Selfie siap', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi clock in', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clock out · Pulang', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock in · Masuk', exact: true })).toHaveCount(0);
    await context.setGeolocation({ latitude: -6.3, longitude: 106.9, accuracy: 10 });
    await page.getByRole('button', { name: 'Clock out · Pulang', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Lokasi belum memenuhi syarat', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi clock out', exact: true })).toBeDisabled();
    await context.setGeolocation({ latitude: -6.2, longitude: 106.816666, accuracy: 10 });
    await page.getByRole('dialog').getByRole('button', { name: 'Periksa ulang lokasi', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Lokasi sesuai', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Selfie saat masuk', { exact: true })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi clock out', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'Middle' })).toHaveCount(1);
    await switchUser(page, 'employee-1');
    await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Kehadiran', exact: true }).click();
    await page.getByRole('button', { name: /Lihat catatan Nadia Putri/ }).click();
    await expect(page.getByRole('dialog').getByRole('img', { name: 'Selfie masuk Nadia Putri', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Tidak dihitung untuk Middle', { exact: true })).toBeVisible();
  });

  test('employee number login checks the password instead of silently entering demo', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled();
    await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000004');
    await page.getByLabel('Kata sandi', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Nomor karyawan atau kata sandi tidak sesuai');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Kata sandi', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('HR manual attendance is auditable, exported as unverified and cannot be self-corrected', async ({ page }, testInfo) => {
    await login(page);
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Catat absensi manual', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Kasir', exact: true }).selectOption('employee-4');
    await dialog.getByRole('combobox', { name: 'Shift', exact: true }).selectOption('morning');
    await dialog.getByLabel('Clock in (WIB)', { exact: true }).fill(`${dateAfter(-1)}T07:10`);
    await dialog.getByLabel('Clock out (WIB)', { exact: true }).fill(`${dateAfter(-1)}T15:10`);
    await dialog.getByLabel('Alasan dan sumber konfirmasi', { exact: true }).fill('GPS gagal; dikonfirmasi SPV melalui WhatsApp — pengujian');
    await dialog.getByRole('button', { name: 'Simpan absensi manual', exact: true }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row').filter({ hasText: 'Nadia Putri' });
    await expect(row).toContainText('Manual HR');
    await expect(row).toContainText('GPS/selfie tidak diverifikasi');
    await expect(row).toContainText('10 menit');
    await expect(row).toContainText('8 jam');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click();
    const download = await downloadPromise;
    const csvPath = testInfo.outputPath('manual-attendance.csv');
    await download.saveAs(csvPath);
    const csv = await readFile(csvPath, 'utf8');
    expect(csv).toContain('Manual HR');
    expect(csv).toContain('Tidak diverifikasi GPS maupun selfie');
    expect(csv).toContain('GPS gagal; dikonfirmasi SPV');
    await page.getByRole('tab', { name: 'Riwayat perubahan', exact: true }).click();
    await expect(page.locator('.audit-row').filter({ hasText: 'attendance_manual' })).toContainText('GPS gagal');

    await page.goto('/employees');
    await page.getByRole('button', { name: 'Lihat profil Nadia Putri', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit data', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Akses Admin HR', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Simpan karyawan', exact: true }).click();
    await expect(dialog).toBeHidden();
    await switchUser(page, 'employee-4');
    await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('link', { name: 'Rekap & riwayat', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Koreksi absensi Nadia Putri', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Catat absensi manual', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Kasir', exact: true }).locator('option[value="employee-4"]')).toHaveCount(0);
  });

  test('manual WhatsApp reset token changes the demo password and cannot be reused', async ({ page }) => {
    await login(page);
    await page.goto('/employees');
    await page.getByRole('button', { name: 'Lihat profil Nadia Putri', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tautan pemulihan', exact: true }).click();
    const message = await page.getByLabel('Pesan undangan WhatsApp', { exact: true }).inputValue();
    expect(message).toContain('DEMO: hanya bekerja pada browser yang sama');
    const url = message.match(/https?:\/\/\S+\/activate#token=[0-9a-f-]+/)?.[0];
    expect(url).toBeTruthy();
    await page.getByRole('dialog').getByRole('button', { name: 'Tutup', exact: true }).click();
    await page.locator('a.account').click();
    await page.locator('main').getByRole('button', { name: 'Keluar akun', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(url!);
    await expect(page.getByRole('heading', { name: 'Buat kata sandi baru', exact: true })).toBeVisible();
    await page.getByLabel('Kata sandi baru', { exact: true }).fill('NewDemoPassword123!');
    await page.getByLabel('Konfirmasi kata sandi', { exact: true }).fill('NewDemoPassword123!');
    await page.getByRole('button', { name: 'Simpan kata sandi', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Akun siap digunakan', exact: true })).toBeVisible();
    await page.goto('/login');
    await page.getByLabel('Nomor karyawan', { exact: true }).fill('RK000004');
    await page.getByLabel('Kata sandi', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Nomor karyawan atau kata sandi tidak sesuai');
    await page.getByLabel('Kata sandi', { exact: true }).fill('NewDemoPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto(url!);
    await expect(page.getByRole('alert')).toContainText('Tautan tidak berlaku');
    await expect(page.getByRole('button', { name: 'Simpan kata sandi', exact: true })).toHaveCount(0);
  });

  test('production PWA installs a shell cache, excludes dynamic responses and opens offline', async ({ page, context }, testInfo) => {
    test.skip(process.env.E2E_PWA !== '1', 'Service workers run on production builds; set E2E_PWA=1 with a preview URL.');
    await login(page, 'Kasir');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const manifestResponse = await page.request.get(manifestHref!);
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) {
      const response = await page.request.get(icon.src);
      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toContain('image/');
      expect((await response.body()).length).toBeGreaterThan(100);
    }
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { active: registration.active?.state, scope: registration.scope };
    });
    expect(worker.active).toBe('activated');
    expect(worker.scope).toBe(new URL('/', page.url()).href);
    await context.route('**/private-cache-proof', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ confidential: 'test-only response' }) }));
    expect(await page.evaluate(async () => (await fetch('/private-cache-proof')).json())).toEqual({ confidential: 'test-only response' });
    const cachedPaths = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith('rajaklana-shell-'));
      return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    });
    expect(cachedPaths).toContain('/200.html');
    expect(cachedPaths.some((path) => path.includes('/_app/'))).toBe(true);
    expect(cachedPaths).not.toContain('/private-cache-proof');
    expect(cachedPaths).not.toContain('/service-worker.js');
    expect(cachedPaths.every((path) => path.startsWith('/_app/') || path.startsWith('/icons/') || ['/200.html', '/icon.svg', '/manifest.webmanifest'].includes(path))).toBe(true);
    const cacheDiagnostics = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name), keys = await cache.keys();
        const startup = keys.find((request) => request.url.includes('/entry/start.'));
        if (!startup) { result.push({ name, startup: null, keys: keys.map((request) => request.url) }); continue; }
        const response = await cache.match(startup);
        result.push({ name, startup: startup.url, storedRequestHeaders: Object.fromEntries(startup.headers), responseHeaders: response ? Object.fromEntries(response.headers) : null,
          matchesString: !!await cache.match(startup.url), matchesOrigin: !!await cache.match(new Request(startup.url, { headers: { Origin: location.origin } })),
          matchesOriginIgnoringVary: !!await cache.match(new Request(startup.url, { headers: { Origin: location.origin } }), { ignoreVary: true }) });
      }
      return { controller: navigator.serviceWorker.controller?.scriptURL, result };
    });
    await testInfo.attach('pwa-cache-diagnostics', { body: JSON.stringify(cacheDiagnostics, null, 2), contentType: 'application/json' });
    await context.setOffline(true);
    await page.goto('/leave?offline-shell-check=1');
    await expect(page.getByRole('heading', { name: 'Cuti & izin', exact: true })).toBeVisible();
    await expect(page.getByText('Offline', { exact: true })).toBeVisible();
    await context.setOffline(false);
  });

  test('visual QA captures desktop dashboard and mobile attendance', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'test-results/screenshots/dashboard-desktop.png', fullPage: true });
    await switchUser(page, 'employee-4');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'Navigasi ponsel' }).getByRole('link', { name: 'Kehadiran', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Masuk & pulang', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/attendance-mobile.png', fullPage: true });
  });
});
