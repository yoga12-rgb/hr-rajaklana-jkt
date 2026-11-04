import { describe, expect, it, vi } from 'vitest';
import { assertPrivateMediaPath, createPrivateMediaLoader, type PrivateMediaBucket, type PrivateMediaRequest } from './private-media';

const origin = 'https://storage.example.test';
const signed = (path: string, version = 1) => `${origin}/${path}?signature=${version}`;
const request = (path = 'account/photo.jpg', extras: Partial<PrivateMediaRequest> = {}): PrivateMediaRequest => ({
  scope: 'project:account:revision-1', bucket: 'attendance-selfies', path, assertCurrent: () => {}, ...extras
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('scoped private media broker', () => {
  it('does no signing before requested and reuses a short-lived same-account cache', async () => {
    let now = 0;
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path));
    const loader = createPrivateMediaLoader({ signOne, now: () => now, allowedOrigin: origin });
    expect(signOne).not.toHaveBeenCalled();
    expect(await loader.load(request())).toBe(signed('account/photo.jpg'));
    now = 119_000;
    expect(await loader.load(request())).toBe(signed('account/photo.jpg'));
    expect(signOne).toHaveBeenCalledTimes(1);
    now = 120_001; await loader.load(request());
    expect(signOne).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous visible requests by bucket and deduplicates one path', async () => {
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path));
    const signMany = vi.fn(async (_bucket: PrivateMediaBucket, paths: string[]) => paths.map(path => ({ path, signedUrl: signed(path) })));
    const loader = createPrivateMediaLoader({ signOne, signMany });
    const values = await Promise.all([loader.load(request('a/photo.jpg')), loader.load(request('b/photo.jpg')), loader.load(request('a/photo.jpg'))]);
    expect(values).toEqual([signed('a/photo.jpg'), signed('b/photo.jpg'), signed('a/photo.jpg')]);
    expect(signOne).not.toHaveBeenCalled(); expect(signMany).toHaveBeenCalledTimes(1);
    expect(signMany).toHaveBeenCalledWith('attendance-selfies', ['a/photo.jpg', 'b/photo.jpg']);
  });

  it('keeps buckets separate and bounds each bulk request', async () => {
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path));
    const signMany = vi.fn(async (_bucket: PrivateMediaBucket, paths: string[]) => paths.map(path => ({ path, signedUrl: signed(path) })));
    const loader = createPrivateMediaLoader({ signOne, signMany });
    await Promise.all([...Array.from({ length: 26 }, (_, index) => loader.load(request(`account/${index}.jpg`))),
      loader.load(request('account/profile.jpg', { bucket: 'profile-photos' }))]);
    expect(signMany.mock.calls.every(([, paths]) => paths.length <= 25)).toBe(true);
    expect(signMany).toHaveBeenCalledWith('attendance-selfies', expect.arrayContaining(['account/0.jpg']));
    expect(signOne).toHaveBeenCalledWith('profile-photos', 'account/profile.jpg');
  });

  it('preserves per-object failures and does not poison successful peers or retry', async () => {
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path, 2));
    const signMany = vi.fn(async () => [{ path: 'a/photo.jpg', signedUrl: signed('a/photo.jpg') }, { path: 'b/photo.jpg', error: 'not authorized' }]);
    const loader = createPrivateMediaLoader({ signOne, signMany });
    const result = await Promise.allSettled([loader.load(request('a/photo.jpg')), loader.load(request('b/photo.jpg'))]);
    expect(result[0]).toMatchObject({ status: 'fulfilled', value: signed('a/photo.jpg') });
    expect(result[1].status).toBe('rejected');
    expect(await loader.load(request('b/photo.jpg'))).toBe(signed('b/photo.jpg', 2));
    expect(await loader.load(request('a/photo.jpg'))).toBe(signed('a/photo.jpg'));
    expect(signOne).toHaveBeenCalledTimes(1);
  });

  it('rejects missing or duplicated rows in a batch rather than mismatching another file', async () => {
    const loader = createPrivateMediaLoader({ signOne: async () => 'unused', signMany: async () => [
      { path: 'a/photo.jpg', signedUrl: signed('a/photo.jpg') }, { path: 'a/photo.jpg', signedUrl: signed('other.jpg') }
    ] });
    const result = await Promise.allSettled([loader.load(request('a/photo.jpg')), loader.load(request('b/photo.jpg'))]);
    expect(result.every(row => row.status === 'rejected')).toBe(true);
  });

  it('cannot publish a late account-A URL into account B or reuse it after clear', async () => {
    const gate = deferred<string>();
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => path === 'a/photo.jpg' ? gate.promise : signed(path));
    const loader = createPrivateMediaLoader({ signOne });
    const old = loader.load(request('a/photo.jpg'));
    const rejected = expect(old).rejects.toThrow('Sesi berubah');
    await Promise.resolve();
    expect(await loader.load(request('b/photo.jpg', { scope: 'project:account-b:revision-1' }))).toBe(signed('b/photo.jpg'));
    gate.resolve(signed('a/photo.jpg')); await rejected; await Promise.resolve();
    expect(await loader.load(request('b/photo.jpg', { scope: 'project:account-b:revision-1' }))).toBe(signed('b/photo.jpg'));
    expect(signOne).toHaveBeenCalledTimes(2);
  });

  it('invalidates an in-flight same-account request after token/permission scope changes', async () => {
    const gate = deferred<string>();
    const signOne = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(signed('account/photo.jpg', 2));
    const loader = createPrivateMediaLoader({ signOne });
    const old = loader.load(request()); const rejected = expect(old).rejects.toThrow('Sesi berubah');
    await Promise.resolve(); loader.clear();
    expect(await loader.load(request())).toBe(signed('account/photo.jpg', 2));
    gate.resolve(signed('account/photo.jpg')); await rejected;
    expect(await loader.load(request())).toBe(signed('account/photo.jpg', 2));
  });

  it('checks current authorization even for cached URLs and again after signing', async () => {
    let allowed = true;
    const assertCurrent = () => { if (!allowed) throw new Error('account revoked'); };
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path));
    const loader = createPrivateMediaLoader({ signOne });
    await loader.load(request('account/photo.jpg', { assertCurrent })); allowed = false;
    await expect(loader.load(request('account/photo.jpg', { assertCurrent }))).rejects.toThrow('account revoked');
    expect(signOne).toHaveBeenCalledTimes(1);
    allowed = true;
    signOne.mockImplementationOnce(async (_bucket, path) => { allowed = false; return signed(path); });
    await expect(loader.load(request('account/new.jpg', { assertCurrent }))).rejects.toThrow('account revoked');
  });

  it('force refresh bypasses a cached URL after an expired image or manual retry', async () => {
    let version = 0;
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path, ++version));
    const loader = createPrivateMediaLoader({ signOne });
    expect(await loader.load(request())).toBe(signed('account/photo.jpg', 1));
    expect(await loader.load(request(undefined, { force: true }))).toBe(signed('account/photo.jpg', 2));
  });

  it('does not extend cache lifetime by a slow response', async () => {
    let now = 0;
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => { now += 125_000; return signed(path); });
    const loader = createPrivateMediaLoader({ signOne, now: () => now });
    await loader.load(request()); await loader.load(request());
    expect(signOne).toHaveBeenCalledTimes(2);
  });

  it('never turns invalid storage paths or arbitrary buckets into sign requests', async () => {
    const signOne = vi.fn(async () => signed('photo.jpg'));
    const loader = createPrivateMediaLoader({ signOne });
    for (const path of ['', '/account/photo.jpg', '../photo.jpg', 'account/../photo.jpg', 'https://attacker.test/p.jpg', 'account/p.jpg?token=x', 'account\\p.jpg', 'account/%2e%2e/photo.jpg', 'account/%00.jpg']) {
      await expect(loader.load(request(path))).rejects.toThrow('Lokasi berkas privat tidak valid');
    }
    await expect(loader.load(request('account/p.jpg', { bucket: 'public' as PrivateMediaBucket }))).rejects.toThrow();
    expect(signOne).not.toHaveBeenCalled();
    expect(() => assertPrivateMediaPath('leave-attachments', 'account/arsip foto 2025.pdf')).not.toThrow();
  });

  it('rejects unsafe or off-project signed URLs', async () => {
    const signOne = vi.fn().mockResolvedValueOnce('javascript:alert(1)').mockResolvedValueOnce('https://other.example.test/private.jpg');
    const loader = createPrivateMediaLoader({ signOne, allowedOrigin: origin });
    await expect(loader.load(request())).rejects.toThrow('Tautan berkas belum tersedia');
    await expect(loader.load(request())).rejects.toThrow('Tautan berkas belum tersedia');
  });

  it('bounds retained signed URLs instead of accumulating the entire history', async () => {
    const signOne = vi.fn(async (_bucket: PrivateMediaBucket, path: string) => signed(path));
    const loader = createPrivateMediaLoader({ signOne });
    for (let index = 0; index < 129; index++) await loader.load(request(`account/${index}.jpg`));
    await loader.load(request('account/0.jpg'));
    expect(signOne).toHaveBeenCalledTimes(130);
  });

  it('times out a read-only signing request, permits retry and ignores the late old URL', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const gate = deferred<string>();
      const signOne = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(signed('account/photo.jpg', 2));
      const loader = createPrivateMediaLoader({ signOne });
      const old = loader.load(request());
      const rejected = expect(old).rejects.toThrow('terlalu lama');
      await Promise.resolve(); await vi.advanceTimersByTimeAsync(20_001); await rejected;
      expect(await loader.load(request())).toBe(signed('account/photo.jpg', 2));
      gate.resolve(signed('account/photo.jpg', 1)); await Promise.resolve();
      expect(await loader.load(request())).toBe(signed('account/photo.jpg', 2));
      expect(signOne).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
