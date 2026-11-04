export const PRIVATE_MEDIA_BUCKETS = ['attendance-selfies', 'profile-photos', 'leave-attachments', 'outlet-issue-photos'] as const;
export type PrivateMediaBucket = typeof PRIVATE_MEDIA_BUCKETS[number];
export interface PrivateMediaSignedResult { path: string; signedUrl?: string | null; error?: unknown }
export interface PrivateMediaRequest {
  scope: string; bucket: PrivateMediaBucket; path: string; assertCurrent: () => void; force?: boolean;
}
export interface PrivateMediaSigner {
  signOne: (bucket: PrivateMediaBucket, path: string) => Promise<string>;
  signMany?: (bucket: PrivateMediaBucket, paths: string[]) => Promise<PrivateMediaSignedResult[]>;
  now?: () => number;
  allowedOrigin?: string;
}
const CACHE_MS = 120_000;
const MAX_ENTRIES = 128;
const MAX_BATCH = 25;
const SIGN_TIMEOUT_MS = 20_000;

export function assertPrivateMediaPath(bucket: unknown, path: unknown): asserts bucket is PrivateMediaBucket {
  if (!PRIVATE_MEDIA_BUCKETS.includes(bucket as PrivateMediaBucket) || typeof path !== 'string' || !path || path.length > 2048
    || path.startsWith('/') || /[\\?#:\u0000-\u001f\u007f]/u.test(path)) throw new Error('Lokasi berkas privat tidak valid.');
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { throw new Error('Lokasi berkas privat tidak valid.'); }
  if (decoded.startsWith('/') || /[\\?#:\u0000-\u001f\u007f]/u.test(decoded)
    || decoded.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Lokasi berkas privat tidak valid.');
}

export function createPrivateMediaLoader(signer: PrivateMediaSigner) {
  type Pending = { request: PrivateMediaRequest; generation: number; startedAt: number; promise: Promise<string>;
    resolve: (url: string) => void; reject: (error: unknown) => void };
  let generation = 0, activeScope: string | null = null, flushScheduled = false;
  const cache = new Map<string, { url: string; expiresAt: number }>();
  const pending = new Map<string, Pending>();
  const queued = new Map<string, Pending>();
  const now = signer.now ?? Date.now;
  const keyFor = (request: PrivateMediaRequest) => `${request.bucket}\n${request.path}`;
  const changed = () => new Error('Sesi berubah. Buka kembali berkas dengan akun Anda.');
  function clear() {
    generation++; activeScope = null; cache.clear(); queued.clear();
    for (const entry of pending.values()) entry.reject(changed());
    pending.clear();
  }
  function assertEntry(entry: Pending) {
    entry.request.assertCurrent();
    if (entry.generation !== generation || entry.request.scope !== activeScope) throw changed();
  }
  function validUrl(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Tautan berkas belum tersedia.');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Tautan berkas belum tersedia.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || (signer.allowedOrigin && url.origin !== signer.allowedOrigin)) throw new Error('Tautan berkas belum tersedia.');
    return value;
  }
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Pembuatan tautan berkas terlalu lama. Periksa koneksi dan coba lagi.')), SIGN_TIMEOUT_MS);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  function settle(entry: Pending, result?: PrivateMediaSignedResult, error?: unknown) {
    const key = keyFor(entry.request);
    try {
      assertEntry(entry);
      if (error || result?.error || !result) throw error ?? new Error('Berkas belum dapat dibuka. Coba lagi.');
      const url = validUrl(result.signedUrl);
      cache.delete(key);
      cache.set(key, { url, expiresAt: entry.startedAt + CACHE_MS });
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      entry.resolve(url);
    } catch (failure) { entry.reject(failure); }
    finally { if (pending.get(key) === entry) pending.delete(key); }
  }
  async function signBatch(entries: Pending[]) {
    try {
      for (const entry of entries) assertEntry(entry);
      const bucket = entries[0].request.bucket;
      if (entries.length === 1 || !signer.signMany) {
        await Promise.all(entries.map(async entry => {
          try { const signedUrl = await bounded(signer.signOne(bucket, entry.request.path)); settle(entry, { path: entry.request.path, signedUrl }); }
          catch (error) { settle(entry, undefined, error); }
        }));
      } else {
        const results = await bounded(signer.signMany(bucket, entries.map(entry => entry.request.path)));
        for (const entry of entries) {
          const matches = results.filter(row => row.path === entry.request.path);
          settle(entry, matches.length === 1 ? matches[0] : undefined);
        }
      }
    } catch (error) { for (const entry of entries) settle(entry, undefined, error); }
  }
  function flush() {
    flushScheduled = false;
    const groups = new Map<PrivateMediaBucket, Pending[]>();
    for (const entry of queued.values()) {
      const bucket = entry.request.bucket;
      groups.set(bucket, [...(groups.get(bucket) ?? []), entry]);
    }
    queued.clear();
    for (const entries of groups.values()) for (let offset = 0; offset < entries.length; offset += MAX_BATCH) void signBatch(entries.slice(offset, offset + MAX_BATCH));
  }
  async function load(request: PrivateMediaRequest): Promise<string> {
    assertPrivateMediaPath(request.bucket, request.path);
    request.assertCurrent();
    if (!request.scope) throw changed();
    if (activeScope !== request.scope) { clear(); activeScope = request.scope; }
    const key = keyFor(request), cached = cache.get(key);
    if (!request.force && cached && cached.expiresAt > now()) { request.assertCurrent(); return cached.url; }
    cache.delete(key);
    let entry = pending.get(key);
    if (!entry) {
      let resolve!: Pending['resolve'], reject!: Pending['reject'];
      const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
      entry = { request, generation, startedAt: now(), promise, resolve, reject };
      pending.set(key, entry); queued.set(key, entry);
      if (!flushScheduled) { flushScheduled = true; queueMicrotask(flush); }
    }
    const url = await entry.promise;
    request.assertCurrent();
    if (request.scope !== activeScope || entry.generation !== generation) throw changed();
    return url;
  }
  return { load, clear };
}
