import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';

const fixture = vi.hoisted(() => ({ app: null as unknown as Writable<any> }));
vi.mock('./state/app', async () => {
  const { writable } = await import('svelte/store');
  fixture.app = writable({ mode: 'live', user: { id: 'cashier-a', authUserId: 'auth-a' } });
  return { app: fixture.app };
});
beforeEach(() => {
  vi.resetModules();
  fixture.app?.set({ mode: 'live', user: { id: 'cashier-a', authUserId: 'auth-a' } });
});

describe('attendance operation UI ownership', () => {
  it('retains the pending operation for another same-account page consumer and refuses a duplicate', async () => {
    const op = await import('./attendance-operation');
    const lease = op.beginAttendanceOperation('in');
    const snapshots: string[] = [];
    const unsubscribe = op.attendanceOperation.subscribe(state => snapshots.push(state.status));
    unsubscribe();
    expect(snapshots).toEqual(['pending']);
    expect(() => op.beginAttendanceOperation('in')).toThrow('Absensi masih diproses');
    op.dismissAttendanceOutcome();
    expect(get(op.attendanceOperation)).toMatchObject({ id: lease.id, status: 'pending' });
    op.advanceAttendanceOperation(lease, 'verify');
    expect(get(op.attendanceOperation).stage).toBe('verify');
  });

  it('keeps the operation during same-account refresh or token-only rotation', async () => {
    const op = await import('./attendance-operation');
    const lease = op.beginAttendanceOperation('out');
    fixture.app.update(state => ({ ...state, sessionValidating: true, dataRevision: 20 }));
    expect(get(op.attendanceOperation)).toMatchObject({ id: lease.id, status: 'pending' });
    expect(op.finishAttendanceOperation(lease)).toBe(true);
    expect(get(op.attendanceOperation)).toMatchObject({ status: 'succeeded', message: 'Clock out berhasil dicatat. Terima kasih untuk hari ini.' });
  });

  it('drops account A pending status at logout and ignores its late response', async () => {
    const op = await import('./attendance-operation');
    const lease = op.beginAttendanceOperation('in');
    fixture.app.set({ mode: 'live', user: null });
    op.advanceAttendanceOperation(lease, 'save');
    expect(op.finishAttendanceOperation(lease)).toBe(false);
    expect(get(op.attendanceOperation)).toMatchObject({ scope: '', status: 'idle', message: '' });
  });

  it('cannot overwrite account B status with account A progress or failure', async () => {
    const op = await import('./attendance-operation');
    const old = op.beginAttendanceOperation('in');
    fixture.app.set({ mode: 'live', user: { id: 'cashier-b', authUserId: 'auth-b' } });
    const current = op.beginAttendanceOperation('out');
    op.advanceAttendanceOperation(old, 'save');
    expect(op.finishAttendanceOperation(old, new Error('Old account error'))).toBe(false);
    expect(get(op.attendanceOperation)).toMatchObject({ id: current.id, status: 'pending', stage: 'preparing', message: '' });
  });

  it('retains a failed result without claiming a server cancellation and clears it before the next explicit attempt', async () => {
    const op = await import('./attendance-operation');
    const lease = op.beginAttendanceOperation('in');
    expect(op.finishAttendanceOperation(lease, new Error('Hasil belum dapat dikonfirmasi. Periksa riwayat.'))).toBe(true);
    expect(get(op.attendanceOperation)).toMatchObject({ status: 'failed', message: 'Hasil belum dapat dikonfirmasi. Periksa riwayat.' });
    op.dismissAttendanceOutcome();
    expect(get(op.attendanceOperation)).toMatchObject({ status: 'idle', message: '' });
    expect(op.beginAttendanceOperation('in').id).not.toBe(lease.id);
  });

  it('distinguishes definite database/HTTP rejection from an ambiguous transport outcome', async () => {
    const op = await import('./attendance-operation');
    expect(op.isAttendanceOutcomeUncertain(Object.assign(new Error('rollback'), { code: '42501' }))).toBe(false);
    expect(op.isAttendanceOutcomeUncertain(Object.assign(new Error('invalid photo'), { uploadRejected: true }))).toBe(false);
    expect(op.isAttendanceOutcomeUncertain(Object.assign(new Error('denied'), { status: 401 }))).toBe(false);
    expect(op.isAttendanceOutcomeUncertain(Object.assign(new Error('timeout'), { status: 408 }))).toBe(true);
    expect(op.isAttendanceOutcomeUncertain(new TypeError('Failed to fetch'))).toBe(true);
    expect(op.isAttendanceOutcomeUncertain(Object.assign(new Error('server error'), { status: 500 }))).toBe(true);
  });

  it('never interprets an undefined rejection as a confirmed success', async () => {
    const op = await import('./attendance-operation');
    const lease = op.beginAttendanceOperation('in');
    expect(op.finishAttendanceOperation(lease, undefined, { uncertain: true, statusChecked: false })).toBe(true);
    expect(get(op.attendanceOperation)).toMatchObject({ status: 'failed', uncertain: true });
    expect(get(op.attendanceOperation).message).not.toContain('berhasil dicatat');
  });
});
