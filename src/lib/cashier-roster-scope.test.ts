import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from './cashier-spv-drafts';
import * as errors from './cashier-roster-save-error';
import * as reconciliation from './cashier-roster-reconcile';

// Exercise the actual component handlers, including awaits and lifecycle hooks.
// Only imports/reactive declarations are removed; browser tests exercise the
// renderer, reactive activation and real notification navigation separately.
const raw = readFileSync(new URL('./components/CashierWeeklyPlanner.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)![1];
const tree = ts.createSourceFile('planner.ts', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let script = raw;
for (const node of tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isLabeledStatement(node) && node.label.text === '$').reverse()) {
  script = script.slice(0, node.getStart(tree)) + script.slice(node.end);
}
const code = ts.transpileModule(`let days=[], cashiers=[], today='2026-10-22', changes=[], reviewEntries=[], conflicts=[];
${script}
globalThis.planner = {
  save,
  activateWeek(value) { weekStart=value; activateDraftKey(cashierRosterDraftStorageKey(get(app).user.id,weekStart)); },
  navigateWeek(value) { window.location.search='?week='+value; navigationCallback(); activateDraftKey(cashierRosterDraftStorageKey(get(app).user.id,weekStart)); },
  activateAccount() { activateDraftKey(get(app).user ? cashierRosterDraftStorageKey(get(app).user.id,weekStart) : ''); },
  snapshot() { return structuredClone({weekStart,pendingAttempt,drafts,reason,activeDraftStorageKey,saving,message,failed,draftStorageWarning}); }
};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const weekA = '2026-10-26', weekB = '2026-11-02', owner = 'admin-a';
const keyFor = (week: string, account = owner) => drafts.cashierRosterDraftStorageKey(account, week);
const fixture = (week: string) => {
  const changes = [{ employeeId: 'cashier-test', workDate: week, outletId: 'outlet-test', shift: 'morning' as const, reason: `Uji minggu ${week}`, expectedUpdatedAt: null }];
  const attempt = drafts.createCashierRosterAttempt(week, changes, null);
  return { drafts: { [`cashier-test:${week}`]: { shift: 'morning' as const, outletId: 'outlet-test', baseline: drafts.cashierRosterBaseline(undefined, 'outlet-test'), needsReview: false } },
    reason: changes[0].reason, pendingAttempt: attempt, legacyAttemptNeedsReview: false };
};
const conflict = { code: 'P0001', status: 400, message: 'Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik' };
const network = new Error('Failed to fetch');
const changedSource = [{ id: 'new-source', employeeId: 'cashier-test', workDate: weekA, updatedAt: '2026-10-22T01:00:00Z', status: 'active', shift: 'afternoon', outletId: 'outlet-test' }];
const reflectedSource = [{ ...changedSource[0], shift: 'morning' }];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cleanup: (() => void)[] = [];
afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); });

function mount(storage: Map<string, string>, rpc = deferred<{ saved_count: number }>()) {
  const listeners = new Set<(value: typeof state) => void>();
  const state = { user: { id: owner } as { id: string } | null, employees: [], cashierAssignments: [] as typeof changedSource, error: null as string | null };
  let destroyed = () => {}, failStorage = false;
  const emit = (id: string | null) => { state.user = id ? { id } : null; for (const listener of listeners) listener(state); };
  const refresh = vi.fn(async () => { state.cashierAssignments = changedSource; });
  const context: Record<string, any> = {
    ...drafts, ...errors, ...reconciliation, structuredClone, URLSearchParams, URL, Date,
    $app: state, app: { subscribe(listener: (value: typeof state) => void) { listeners.add(listener); listener(state); return () => listeners.delete(listener); } },
    get: () => state, isCashier: () => true, onDestroy: (callback: () => void) => { destroyed = callback; },
    page: { url: new URL(`http://localhost/assignments?week=${weekA}`), state: {} },
    window: { location: { search: `?week=${weekA}`, href: `http://localhost/assignments?week=${weekA}` } },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { if (failStorage) throw new Error('Storage full'); storage.set(key, value); },
      removeItem: (key: string) => { if (failStorage) throw new Error('Storage full'); storage.delete(key); }
    },
    afterNavigate: (callback: () => void) => { context.navigationCallback = callback; }, goto: async () => {},
    startOfWorkWeek: (value: string) => value, todayJakarta: () => '2026-10-22', isValidWorkDate: (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
    dateLabel: (value: string) => value, validateRosterBatch: () => {}, workWeekDates: () => [], workWeekLabel: () => '', addWorkDays: () => '', previewPreviousWeekCopy: () => ({ changes: [] }),
    actions: { saveCashierRosterBatch: vi.fn(() => rpc.promise), refresh }
  };
  vm.runInNewContext(code, context);
  const planner = context.planner as { save: () => Promise<void>; activateWeek: (week: string) => void; navigateWeek: (week: string) => void; activateAccount: () => void; snapshot: () => any };
  planner.activateWeek(weekA);
  cleanup.push(() => destroyed());
  return { planner, state, emit, refresh, rpc, destroy: () => destroyed(), setStorageFailure: (fail: boolean) => { failStorage = fail; }, calls: context.actions.saveCashierRosterBatch };
}
function storageFixture() {
  const a = fixture(weekA), b = fixture(weekB);
  return { a, b, storage: new Map([[keyFor(weekA), drafts.serializeCashierRosterDraft(a)], [keyFor(weekB), drafts.serializeCashierRosterDraft(b)]]) };
}

describe('weekly planner async recovery scope', () => {
  it.each(['success', 'baseline', 'uncertain'] as const)('settles only origin A after navigation to pending B: %s', async outcome => {
    const { storage, a } = storageFixture(), beforeB = storage.get(keyFor(weekB));
    const h = mount(storage), saving = h.planner.save();
    h.planner.navigateWeek(weekB);
    if (outcome === 'success') h.rpc.resolve({ saved_count: 1 });
    else if (outcome === 'baseline') h.rpc.reject(conflict);
    else { h.refresh.mockImplementation(async () => { h.state.cashierAssignments = reflectedSource; }); h.rpc.reject(network); }
    await saving;
    expect(storage.get(keyFor(weekB))).toBe(beforeB);
    expect(h.planner.snapshot().pendingAttempt).toEqual(JSON.parse(beforeB!).pendingAttempt);
    expect(h.planner.snapshot().message).toBe('');
    if (outcome === 'baseline') {
      const resolved = drafts.parseCashierRosterDraft(storage.get(keyFor(weekA))!);
      expect(resolved).toEqual({ ...a, pendingAttempt: null });
    } else expect(storage.has(keyFor(weekA))).toBe(false);
    h.planner.navigateWeek(weekA);
    expect(h.planner.snapshot().pendingAttempt).toBeNull();
    h.planner.navigateWeek(weekB);
    expect(storage.get(keyFor(weekB))).toBe(beforeB);
  });

  it('updates returned A after A→B→A without resurrecting recovery or showing stale feedback', async () => {
    const { storage } = storageFixture(), h = mount(storage), saving = h.planner.save();
    h.planner.navigateWeek(weekB); h.planner.navigateWeek(weekA);
    h.rpc.resolve({ saved_count: 1 }); await saving;
    expect(h.planner.snapshot()).toMatchObject({ pendingAttempt: null, message: '', saving: false });
    h.planner.navigateWeek(weekB);
    expect(storage.has(keyFor(weekA))).toBe(false);
  });

  it('does not unlock B while its own request is still running', async () => {
    const { storage, b } = storageFixture(), h = mount(storage), next = deferred<{ saved_count: number }>();
    h.calls.mockImplementationOnce(() => h.rpc.promise).mockImplementationOnce(() => next.promise);
    const savingA = h.planner.save(); h.planner.navigateWeek(weekB);
    const savingB = h.planner.save();
    h.rpc.resolve({ saved_count: 1 }); await savingA;
    expect(h.planner.snapshot()).toMatchObject({ saving: true, pendingAttempt: b.pendingAttempt, message: '' });
    next.resolve({ saved_count: 1 }); await savingB;
    expect(h.planner.snapshot()).toMatchObject({ saving: false, pendingAttempt: null });
    expect(storage.has(keyFor(weekA))).toBe(false);
    expect(storage.has(keyFor(weekB))).toBe(false);
  });

  it('leaves both recoveries intact when origin settlement fails while B is active', async () => {
    const { storage } = storageFixture(), h = mount(storage), saving = h.planner.save();
    h.planner.navigateWeek(weekB);
    const before = [...storage]; h.setStorageFailure(true);
    h.rpc.resolve({ saved_count: 1 }); await saving;
    expect([...storage]).toEqual(before);
    expect(h.planner.snapshot()).toMatchObject({ message: '', failed: false, draftStorageWarning: false });
  });

  it('settles origin storage after unmount and synchronizes a remount in the same window', async () => {
    const { storage } = storageFixture(), old = mount(storage), saving = old.planner.save();
    old.destroy();
    const remounted = mount(storage);
    old.rpc.resolve({ saved_count: 1 }); await saving;
    expect(remounted.planner.snapshot()).toMatchObject({ pendingAttempt: null, reason: '', message: '' });
    remounted.planner.navigateWeek(weekB);
    expect(storage.has(keyFor(weekA))).toBe(false);
  });

  it.each(['baseline', 'uncertain'] as const)('does not reconcile A using another account source: %s', async outcome => {
    const { storage } = storageFixture(), beforeA = storage.get(keyFor(weekA));
    storage.set(keyFor(weekA, 'admin-b'), drafts.serializeCashierRosterDraft(fixture(weekA)));
    const beforeB = storage.get(keyFor(weekA, 'admin-b'));
    const h = mount(storage), saving = h.planner.save();
    h.emit('admin-b'); h.planner.activateAccount();
    h.state.cashierAssignments = outcome === 'baseline' ? changedSource : reflectedSource;
    h.rpc.reject(outcome === 'baseline' ? conflict : network); await saving;
    expect(h.refresh).not.toHaveBeenCalled();
    expect(storage.get(keyFor(weekA))).toBe(beforeA);
    expect(storage.get(keyFor(weekA, 'admin-b'))).toBe(beforeB);
    expect(h.planner.snapshot()).toMatchObject({ message: '', pendingAttempt: JSON.parse(beforeB!).pendingAttempt });
  });

  it('does not trust refresh when the account changes during its await', async () => {
    const { storage } = storageFixture(), before = storage.get(keyFor(weekA));
    const h = mount(storage), refresh = deferred<void>();
    h.refresh.mockImplementation(() => refresh.promise);
    const saving = h.planner.save(); h.rpc.reject(conflict);
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
    h.emit('admin-b'); h.emit(owner); h.state.cashierAssignments = changedSource;
    refresh.resolve(); await saving;
    expect(storage.get(keyFor(weekA))).toBe(before);
  });

  it('settles definitive success for A while leaving the new account untouched', async () => {
    const { storage } = storageFixture();
    storage.set(keyFor(weekA, 'admin-b'), drafts.serializeCashierRosterDraft(fixture(weekA)));
    const before = storage.get(keyFor(weekA, 'admin-b')), h = mount(storage), saving = h.planner.save();
    h.emit('admin-b'); h.planner.activateAccount(); h.rpc.resolve({ saved_count: 1 }); await saving;
    expect(storage.has(keyFor(weekA))).toBe(false);
    expect(storage.get(keyFor(weekA, 'admin-b'))).toBe(before);
    expect(h.planner.snapshot().message).toBe('');
  });

  it.each(['success', 'baseline'] as const)('preserves pending on failed origin persistence, then retries the original payload: %s', async outcome => {
    const { storage, a } = storageFixture(), before = storage.get(keyFor(weekA)), h = mount(storage);
    const saving = h.planner.save(); h.setStorageFailure(true);
    if (outcome === 'success') h.rpc.resolve({ saved_count: 1 }); else h.rpc.reject(conflict);
    await saving;
    expect(storage.get(keyFor(weekA))).toBe(before);
    expect(h.planner.snapshot()).toMatchObject({ pendingAttempt: a.pendingAttempt, draftStorageWarning: true });
    h.setStorageFailure(false);
    await h.planner.save();
    expect(h.calls).toHaveBeenCalledTimes(2);
    expect(h.calls.mock.calls[1]).toEqual(h.calls.mock.calls[0]);
    expect(drafts.parseCashierRosterDraft(storage.get(keyFor(weekA)) ?? null)?.pendingAttempt ?? null).toBeNull();
  });

  it('does not let an old A completion clear a replacement A attempt after remount', async () => {
    const { storage } = storageFixture(), old = mount(storage), saving = old.planner.save();
    old.destroy();
    const replacement = fixture(weekA);
    storage.set(keyFor(weekA), drafts.serializeCashierRosterDraft(replacement));
    const before = storage.get(keyFor(weekA)), current = mount(storage);
    old.rpc.resolve({ saved_count: 1 }); await saving;
    expect(storage.get(keyFor(weekA))).toBe(before);
    expect(current.planner.snapshot().pendingAttempt).toEqual(replacement.pendingAttempt);
  });

  it.each(['success', 'network', 'authorization'] as const)('ignores a late same-key replay after another request resolved it: %s', async outcome => {
    const { storage } = storageFixture(), old = mount(storage), saving = old.planner.save();
    old.destroy();
    const current = mount(storage), replaying = current.planner.save();
    old.rpc.resolve({ saved_count: 1 }); await saving;
    if (outcome === 'success') current.rpc.resolve({ saved_count: 1 });
    else current.rpc.reject(outcome === 'network' ? network : { status: 401, code: 'PGRST301', message: 'JWT expired' });
    await replaying;
    expect(current.planner.snapshot()).toMatchObject({ pendingAttempt: null, draftStorageWarning: false, failed: false, saving: false });
    expect(storage.has(keyFor(weekA))).toBe(false);
  });
});
