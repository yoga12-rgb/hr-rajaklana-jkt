import { beforeEach, expect, it } from 'vitest';
import { clearOperationTimings, measureOperation, operationTimings } from './operation-timing';
beforeEach(clearOperationTimings);
it('keeps outcome and duration while preserving the actual result or rejection', async () => {
  const value = { important: true }, error = new Error('private data must not be recorded');
  expect(await measureOperation('attendance.save', async () => value)).toBe(value);
  await expect(measureOperation('attendance.verify', async () => { throw error; })).rejects.toBe(error);
  expect(operationTimings().map(row => row.outcome)).toEqual(['success', 'error']);
  for (const row of operationTimings()) expect(Object.keys(row).sort()).toEqual(['durationMs','outcome','phase']);
  expect(JSON.stringify(operationTimings())).not.toContain(error.message);
});
it('does not retain a pending operation after the account diagnostics are reset', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = measureOperation('attendance.save', () => gate);
  clearOperationTimings(); release(); await pending;
  expect(operationTimings()).toEqual([]);
});
it('classifies a resolved GPS failure without rejecting or changing the result', async () => {
  expect(await measureOperation('attendance.gps', async () => false, result => result)).toBe(false);
  const value = { unchanged: true };
  expect(await measureOperation('attendance.gps', async () => value, () => { throw new Error('classifier'); })).toBe(value);
  expect(operationTimings().map(row => row.outcome)).toEqual(['error', 'error']);
});
it('bounds retained samples and returns copies', async () => {
  for (let index = 0; index < 105; index++) await measureOperation('report.query', async () => undefined);
  expect(operationTimings()).toHaveLength(100);
  operationTimings()[0].outcome = 'error';
  expect(operationTimings()[0].outcome).toBe('success');
});
