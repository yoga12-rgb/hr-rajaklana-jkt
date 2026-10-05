/** Validates public build settings without including their values in errors. */
export function validatePublicSupabaseConfiguration(urlValue = '', keyValue = '') {
  const url = urlValue.trim(), key = keyValue.trim();
  if (!url && !key) return { mode: 'demo' as const, url, key };
  if (!url || !key) throw new Error('Konfigurasi Supabase belum lengkap. Isi PUBLIC_SUPABASE_URL dan PUBLIC_SUPABASE_ANON_KEY, atau kosongkan keduanya untuk demo.');

  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('PUBLIC_SUPABASE_URL harus berupa URL proyek Supabase yang valid.'); }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127\./.test(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('PUBLIC_SUPABASE_URL harus berupa origin HTTPS proyek; HTTP hanya diperbolehkan untuk Supabase lokal.');
  }

  if (key.startsWith('sb_secret_')) throw new Error('Kunci rahasia Supabase tidak boleh digunakan pada konfigurasi publik. Gunakan publishable key atau anon key.');
  if (key.startsWith('sb_publishable_') && key.length > 'sb_publishable_'.length) return { mode: 'live' as const, url: parsed.origin, key };

  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    if (claims.role === 'service_role') throw new Error('private');
    if (claims.role !== 'anon') throw new Error();
  } catch (error) {
    if (error instanceof Error && error.message === 'private') throw new Error('Service role key tidak boleh digunakan pada konfigurasi publik. Gunakan publishable key atau anon key.');
    throw new Error('PUBLIC_SUPABASE_ANON_KEY harus berupa publishable key atau anon key Supabase.');
  }
  return { mode: 'live' as const, url: parsed.origin, key };
}
