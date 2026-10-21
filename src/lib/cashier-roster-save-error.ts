const retryGuidance = 'Belum ada konfirmasi dari server. Draft tetap tersimpan. Periksa koneksi, lalu tekan Simpan jadwal mingguan lagi; permintaan yang sama memakai kunci yang sama agar jadwal tidak dibuat dua kali.';
const baselineConflictMessage = 'Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik';

/**
 * This exact database error is raised only after the RPC has checked its
 * idempotency key and found no committed result for the original payload.
 * Keep the SQLSTATE and message paired; other P0001 errors remain unresolved.
 */
export function cashierRosterSaveOutcomeIsDefiniteBaselineConflict(error: unknown): boolean {
  const details = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown } : null;
  return details?.code === 'P0001' && details?.status === 400 && details?.message === baselineConflictMessage;
}

export function cashierRosterSaveOutcomeIsUncertain(error: unknown): boolean {
  const details = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown } : null;
  const message = typeof details?.message === 'string' ? details.message : error instanceof Error ? error.message : '';
  const hasServerCode = typeof details?.code === 'string' && details.code.length > 0;
  const status = typeof details?.status === 'number' ? details.status : null;
  const uncertainResponse = status === 0 || [408, 500, 502, 503, 504].includes(status ?? -1);
  const transportFailure = /failed to fetch|fetch failed|networkerror|network request failed|network (?:error|connection)|connection (?:was )?(?:lost|reset|refused)|timed out|timeout|service unavailable|bad gateway|gateway (?:error|timeout)|\bERR_(?:NETWORK|CONNECTION|INTERNET)\b/i.test(message);

  return !hasServerCode && (uncertainResponse || transportFailure);
}

export function cashierRosterSaveErrorMessage(error: unknown): string {
  const details = error && typeof error === 'object' ? error as { message?: unknown } : null;
  const message = typeof details?.message === 'string' ? details.message : error instanceof Error ? error.message : '';
  if (cashierRosterSaveOutcomeIsUncertain(error)) return retryGuidance;
  return message || 'Batch jadwal belum tersimpan.';
}
