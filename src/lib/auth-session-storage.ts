import { MfaAccountChanged, type MfaSession } from './auth-mfa';

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type Exclusive = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

/** Serializes every Auth storage write; an MFA token commit also compares identity inside the lock. */
export function guardedAuthStorage(backing: StorageLike, sessionKey: string, exclusive: Exclusive | null) {
  const pending = new Map<string, string>();
  const run = <T>(key: string, operation: () => Promise<T>) => exclusive ? exclusive(`rk-auth-storage:${key}`, operation) : operation();
  const parse = (value: string | null): Partial<MfaSession> | null => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const storage = {
    getItem(key: string) { return backing.getItem(key); },
    async setItem(key: string, value: string) {
      return run(key, async () => {
        const next = key === sessionKey ? parse(value) : null;
        // setSession may rotate an expired external token before persisting it.
        // Bind every write for the installing user, including that new token.
        const expectedUser = next?.access_token
          ? pending.get(next.access_token) ?? [...pending.values()].find(userId => userId === next?.user?.id)
          : undefined;
        if (expectedUser) {
          const current = parse(backing.getItem(sessionKey));
          if (current?.user?.id !== expectedUser || next?.user?.id !== expectedUser) throw new MfaAccountChanged();
        }
        backing.setItem(key, value);
      });
    },
    async removeItem(key: string) { return run(key, async () => { backing.removeItem(key); }); }
  };
  return {
    storage,
    async install<T>(session: MfaSession, expectedUserId: string, write: () => Promise<T>): Promise<T> {
      if (!exclusive) throw new Error('Verifikasi aman memerlukan browser terbaru dengan dukungan Web Locks. Perbarui Safari/Chrome lalu coba kembali.');
      if (!session.access_token || session.user.id !== expectedUserId) throw new MfaAccountChanged();
      pending.set(session.access_token, expectedUserId);
      try { return await write(); } finally { pending.delete(session.access_token); }
    }
  };
}
