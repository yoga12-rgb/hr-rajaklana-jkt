import { describe, expect, it, vi } from 'vitest';
import { guardedAuthStorage } from './auth-session-storage';
import { MfaAccountChanged } from './auth-mfa';

const key = 'session';
const tokens = (id: string) => ({ access_token: `access-${id}`, refresh_token: `refresh-${id}`, user: { id } });
function backing() {
  const data = new Map<string, string>();
  return { getItem: (name: string) => data.get(name) ?? null, setItem: (name: string, value: string) => { data.set(name, value); }, removeItem: (name: string) => { data.delete(name); } };
}
function lock() {
  let previous = Promise.resolve();
  return <T>(_name: string, operation: () => Promise<T>): Promise<T> => {
    const next = previous.then(operation); previous = next.then(() => undefined, () => undefined); return next;
  };
}
describe('MFA session storage commit', () => {
  it('checks the stored identity at actual token persistence after a delayed SDK setter', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const verifiedA = { ...tokens('a'), access_token: 'new-mfa-a' };
    const installer = vi.fn(async () => { await deferred; await guard.storage.setItem(key, JSON.stringify(verifiedA)); });
    const install = guard.install(verifiedA, 'a', installer);
    await vi.waitFor(() => expect(installer).toHaveBeenCalled());
    await guard.storage.setItem(key, JSON.stringify(tokens('b')));
    release();
    await expect(install).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(JSON.parse(store.getItem(key)!)).toEqual(tokens('b'));
  });
  it('does not restore an account after logout during token installation', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    const verifiedA = { ...tokens('a'), access_token: 'new-mfa-a' };
    await expect(guard.install(verifiedA, 'a', async () => {
      await guard.storage.removeItem(key);
      await guard.storage.setItem(key, JSON.stringify(verifiedA));
    })).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(store.getItem(key)).toBeNull();
  });
  it('binds an SDK-rotated MFA token to the same expected user at persistence', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    const expiredA = { ...tokens('a'), access_token: 'expired-mfa-a' };
    await expect(guard.install(expiredA, 'a', async () => {
      await guard.storage.setItem(key, JSON.stringify(tokens('b')));
      await guard.storage.setItem(key, JSON.stringify({ ...tokens('a'), access_token: 'sdk-rotated-mfa-a' }));
    })).rejects.toBeInstanceOf(MfaAccountChanged);
    expect(JSON.parse(store.getItem(key)!)).toEqual(tokens('b'));
  });
  it('commits the same current account and preserves unrelated auth keys', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    const verifiedA = { ...tokens('a'), access_token: 'new-mfa-a' };
    await guard.install(verifiedA, 'a', () => guard.storage.setItem(key, JSON.stringify(verifiedA)));
    await guard.storage.setItem(`${key}-code-verifier`, 'synthetic-verifier');
    expect(JSON.parse(store.getItem(key)!)).toEqual(verifiedA);
    expect(store.getItem(`${key}-code-verifier`)).toBe('synthetic-verifier');
  });
  it('keeps ordinary login storage usable but refuses MFA installation without a cross-tab lock', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, null), writer = vi.fn();
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    await expect(guard.install(tokens('a'), 'a', writer)).rejects.toThrow('Web Locks');
    expect(writer).not.toHaveBeenCalled();
    expect(JSON.parse(store.getItem(key)!)).toEqual(tokens('a'));
  });
});
