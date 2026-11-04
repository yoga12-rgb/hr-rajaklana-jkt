export type TimingPhase = 'login.credentials' | 'login.session' | 'workspace.refresh' | 'workspace.identity'
  | 'workspace.data' | 'attendance.gps' | 'attendance.upload' | 'attendance.verify' | 'attendance.save' | 'attendance.reconcile'
  | 'media.sign' | 'report.query';
export interface OperationTiming { phase: TimingPhase; durationMs: number; outcome: 'success' | 'error' }
const samples: OperationTiming[] = [];
let generation = 0;
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
// Only a fixed phase, duration and outcome are recorded. Never persist user,
// request, location, credential, URL, photo or error-message data.
export async function measureOperation<T>(phase: TimingPhase, operation: () => Promise<T>, successful?: (result: T) => boolean): Promise<T> {
  const started = now(), revision = generation;
  let outcome: OperationTiming['outcome'] = 'error';
  try {
    const result = await operation();
    // Diagnostics must never alter the operation's result, even if a classifier fails.
    try { outcome = !successful || successful(result) ? 'success' : 'error'; } catch { /* keep error */ }
    return result;
  }
  finally {
    if (revision === generation) {
      samples.push({ phase, durationMs: Math.max(0, Math.round((now() - started) * 10) / 10), outcome });
      if (samples.length > 100) samples.splice(0, samples.length - 100);
    }
  }
}
export const operationTimings = () => samples.map(sample => ({ ...sample }));
export function clearOperationTimings() { generation += 1; samples.length = 0; }
