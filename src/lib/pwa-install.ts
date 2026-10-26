import { validatePwaResponse } from './pwa-cache-validation';

type CacheLike = Pick<Cache, 'keys' | 'match' | 'put'>;
type CacheStorageLike = {
  delete(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  open(name: string): Promise<CacheLike>;
};

export type PwaInstallOptions = {
  cacheStorage: CacheStorageLike;
  fetcher: typeof globalThis.fetch;
  origin: string;
  cacheName: string;
  paths: string[];
  shellPath?: string;
  shellCacheKey?: string;
};

/**
 * Precache into a staging cache and publish only after every response is valid.
 * A failed install removes only its staging/fresh cache and never the active cache.
 */
export async function installPwaCache({
  cacheStorage,
  fetcher,
  origin,
  cacheName,
  paths,
  shellPath = '/',
  shellCacheKey = '/200.html'
}: PwaInstallOptions) {
  const stagingName = `${cacheName}-install`;
  await cacheStorage.delete(stagingName);
  const staging = await cacheStorage.open(stagingName);
  let createdFinal = false;
  try {
    for (const path of paths) {
      const response = await fetcher(path, { cache: 'reload' });
      const check = await validatePwaResponse(response, path, origin, 'asset');
      if (!check.ok) throw new Error(`PWA asset unavailable: ${path} (${check.reason})`);
      await staging.put(path, response);
    }

    const shell = await fetcher(shellPath, { cache: 'reload' });
    const shellCheck = await validatePwaResponse(shell, shellPath, origin, 'shell');
    if (!shellCheck.ok) throw new Error(`SPA shell unavailable (${shellCheck.reason})`);
    await staging.put(shellCacheKey, shell);

    const finalExisted = await cacheStorage.has(cacheName);
    const final = await cacheStorage.open(cacheName);
    createdFinal = !finalExisted;
    for (const request of await staging.keys()) {
      const response = await staging.match(request);
      if (response) await final.put(request, response);
    }
    await cacheStorage.delete(stagingName);
  } catch (error) {
    await cacheStorage.delete(stagingName);
    if (createdFinal) await cacheStorage.delete(cacheName);
    throw error;
  }
}
