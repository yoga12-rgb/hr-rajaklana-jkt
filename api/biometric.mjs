import { json } from '../server/security.mjs';

// Tombstone for stale installed clients: no reference or image side effects.
export async function POST() {
  return json({ code: 'feature_removed', error: 'Verifikasi wajah sudah dihapus. Buka ulang aplikasi untuk menggunakan absensi dengan selfie dan lokasi.' }, 410);
}
