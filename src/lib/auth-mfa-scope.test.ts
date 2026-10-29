import { describe, expect, it } from 'vitest';
import { acquireMfaScope } from './auth-mfa-scope';

function storage(initial?: string) {
  const values = new Map<string, string>(initial ? [['rk-mfa-enrollment-scope', initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function locks() {
  const held = new Set<string>();
  return { request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { await callback({ name }); } finally { held.delete(name); }
  } } as unknown as Pick<LockManager, 'request'>;
}
describe('MFA enrollment ownership', () => {
  it('reclaims the same nonsecret scope after reload but gives a cloned active tab a different scope', async () => {
    const manager = locks(), firstStorage = storage();
    const first = await acquireMfaScope(firstStorage, manager);
    const clone = await acquireMfaScope(storage(first.id), manager);
    expect(clone.id).not.toBe(first.id);
    first.release();
    await Promise.resolve(); await Promise.resolve();
    const reloaded = await acquireMfaScope(firstStorage, manager);
    expect(reloaded.id).toBe(first.id);
    clone.release(); reloaded.release();
  });
  it('fails before enrollment if tab ownership cannot be safely established', async () => {
    await expect(acquireMfaScope(storage(), undefined)).rejects.toThrow('Web Locks');
    const manager = locks();
    await expect(acquireMfaScope({ getItem: () => null, setItem: () => { throw new Error('storage blocked'); } }, manager)).rejects.toThrow('Penyimpanan sesi');
  });
});
