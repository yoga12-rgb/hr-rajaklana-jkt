const retryGuidance = 'Belum ada konfirmasi dari server. Draft tetap tersimpan. Periksa koneksi, lalu tekan Simpan jadwal mingguan lagi; permintaan yang sama memakai kunci yang sama agar jadwal tidak dibuat dua kali.';

export function cashierRosterSaveErrorMessage(error: unknown): string {
  const details = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown } : null;
  const message = typeof details?.message === 'string' ? details.message : error instanceof Error ? error.message : '';
  const hasServerCode = typeof details?.code === 'string' && details.code.length > 0;
  const status = typeof details?.status === 'number' ? details.status : null;
  const uncertainResponse = status === 0 || [408, 500, 502, 503, 504].includes(status ?? -1);
  const transportFailure = /failed to fetch|fetch failed|networkerror|network request failed|network (?:error|connection)|connection (?:was )?(?:lost|reset|refused)|timed out|timeout|service unavailable|bad gateway|gateway (?:error|timeout)|\bERR_(?:NETWORK|CONNECTION|INTERNET)\b/i.test(message);

  if (!hasServerCode && (uncertainResponse || transportFailure)) return retryGuidance;
  return message || 'Batch jadwal belum tersimpan.';
}
