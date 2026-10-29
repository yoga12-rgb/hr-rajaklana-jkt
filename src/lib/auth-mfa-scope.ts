type ScopeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type MfaScopeLease = { id: string; release(): void };

/** A nonsecret tab identifier survives reload; a live lock detects cloned tabs. */
export async function acquireMfaScope(storage: ScopeStorage, locks: Pick<LockManager, 'request'> | undefined): Promise<MfaScopeLease> {
  if (!locks) throw new Error('Verifikasi aman memerlukan browser terbaru dengan dukungan Web Locks. Perbarui Safari/Chrome lalu coba kembali.');
  const key = 'rk-mfa-enrollment-scope';
  let scope = storage.getItem(key) ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(scope)) scope = crypto.randomUUID();
  for (;;) {
    const candidate = scope;
    const lease = await new Promise<MfaScopeLease | null>((resolve, reject) => {
      void locks.request(`rk-mfa-enrollment:${candidate}`, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { resolve(null); return; }
        let release!: () => void;
        const released = new Promise<void>(done => { release = done; });
        resolve({ id: candidate, release });
        await released;
      }).catch(reject);
    });
    if (lease) {
      try { storage.setItem(key, candidate); }
      catch { lease.release(); throw new Error('Penyimpanan sesi verifikasi tidak tersedia. Izinkan penyimpanan browser lalu coba lagi.'); }
      return lease;
    }
    scope = crypto.randomUUID();
  }
}
