const statuses: Record<string,string> = { pending:'Menunggu',needs_info:'Perlu dilengkapi',approved:'Disetujui',rejected:'Ditolak',cancelled:'Dibatalkan' };
const snapshot = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const time = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) ? value.slice(0,5) : '';

function leaveSnapshot(value: unknown): string {
  const row = snapshot(value);
  if (!row) return '';
  const parts: string[] = [], start = date(row.starts_on), end = date(row.ends_on);
  if (row.leave_request_id && (row.type === 'change' || row.type === 'cancel')) parts.push(row.type === 'cancel' ? 'Permintaan pembatalan' : 'Permintaan perubahan tanggal');
  if (start) parts.push(`${start}${end && end !== start ? `–${end}` : ''}`);
  const startsAt = time(row.starts_at), endsAt = time(row.ends_at);
  if (startsAt || endsAt) parts.push(`jam ${[startsAt,endsAt].filter(Boolean).join('–')} WIB`);
  if (typeof row.status === 'string' && statuses[row.status]) parts.push(statuses[row.status]);
  const deductions = snapshot(row.deductions);
  if (deductions) {
    const allocation = Object.entries(deductions).filter(([year,days]) => /^20\d{2}$/.test(year)
      && typeof days === 'number' && Number.isFinite(days) && days >= 0 && days <= 12)
      .sort(([a],[b]) => a.localeCompare(b)).map(([year,days]) => `${year}: ${days} hari`);
    parts.push(allocation.length ? `potongan ${allocation.join(', ')}` : 'tanpa potongan');
  }
  return parts.join(' · ');
}

/** Whitelist leave fields; never render whole audit JSON or attachment paths. */
export function leaveAuditDetail(reason: string | null | undefined, before: unknown, after: unknown): string {
  const previous = leaveSnapshot(before), next = leaveSnapshot(after);
  return [reason?.trim(),previous ? `Sebelum: ${previous}` : '',next ? `Sesudah: ${next}` : ''].filter(Boolean).join('\n');
}
