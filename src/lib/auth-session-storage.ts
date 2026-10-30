type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
type Exclusive = <T>(name: string, operation: () => Promise<T>) => Promise<T>;

type StoredSession = { access_token?: string; user?: { id?: string } };

/**
 * Serializes Auth storage writes and prevents a delayed token write from
 * replacing a different account's session. This is generic session safety;
 * it is not an MFA enrollment lock and does not require Web Locks to log in.
 */
export function guardedAuthStorage(backing: StorageLike, sessionKey: string, exclusive: Exclusive | null) {
  const run = <T>(key: string, operation: () => Promise<T>) => exclusive ? exclusive(`rk-auth-storage:${key}`, operation) : operation();
  const parse = (value: string | null): StoredSession | null => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const storage = {
    getItem(key: string) { return backing.getItem(key); },
    async setItem(key: string, value: string) {
      return run(key, async () => {
        if (key === sessionKey) {
          const next = parse(value);
          const current = parse(backing.getItem(sessionKey));
          // Auth SDK writes are accepted for the same account or an empty
          // store. A new account switch is performed by the SDK after its
          // auth event, so it must not be overwritten by a stale token.
          if (current?.user?.id && next?.user?.id && current.user.id !== next.user.id) {
            backing.removeItem(sessionKey);
          }
        }
        backing.setItem(key, value);
      });
    },
    async removeItem(key: string) { return run(key, async () => { backing.removeItem(key); }); }
  };
  return { storage };
}
