import { describe, expect, it } from 'vitest';
import { guardedAuthStorage } from './auth-session-storage';

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

describe('generic account session storage', () => {
  it('serializes writes and keeps the newest account token', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    await guard.storage.setItem(key, JSON.stringify(tokens('b')));
    expect(JSON.parse(store.getItem(key)!)).toEqual(tokens('b'));
  });
  it('allows an empty storage to accept a password login session', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, null);
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    expect(JSON.parse(store.getItem(key)!)).toEqual(tokens('a'));
  });
  it('preserves unrelated Auth storage keys', async () => {
    const store = backing(), guard = guardedAuthStorage(store, key, lock());
    await guard.storage.setItem(`${key}-code-verifier`, 'fixture');
    await guard.storage.setItem(key, JSON.stringify(tokens('a')));
    expect(store.getItem(`${key}-code-verifier`)).toBe('fixture');
  });
});
