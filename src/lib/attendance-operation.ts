import { get, writable } from 'svelte/store';
import { app } from './state/app';

export type AttendanceOperationStage = 'preparing' | 'upload' | 'verify' | 'save' | 'reconcile';
type OperationState = {
  scope: string; id: number; mode: 'in' | 'out' | null;
  status: 'idle' | 'pending' | 'succeeded' | 'failed';
  stage: AttendanceOperationStage; message: string;
  uncertain?: boolean; statusChecked?: boolean;
};
const idle = (scope: string, id = 0): OperationState => ({ scope, id, mode: null, status: 'idle', stage: 'preparing', message: '' });
export const attendanceOperation = writable<OperationState>(idle(''));
let sequence = 0;
const projectKey = import.meta.env.PUBLIC_SUPABASE_URL || 'local-demo';
export function attendanceOperationScopeFor(mode: string, authId: string, employeeId: string) {
  return employeeId ? `${projectKey}:${mode}:${authId}:${employeeId}` : '';
}
export function attendanceOperationScope() {
  const state = get(app);
  return attendanceOperationScopeFor(state.mode, state.user?.authUserId ?? '', state.user?.id ?? '');
}
// This lease is intentionally memory-only. It survives SPA route changes but
// never queues an attendance write for a later session or another account.
app.subscribe(() => {
  const scope = attendanceOperationScope();
  if (get(attendanceOperation).scope !== scope) attendanceOperation.set(idle(scope, ++sequence));
});
export function beginAttendanceOperation(mode: 'in' | 'out') {
  const scope = attendanceOperationScope(), current = get(attendanceOperation);
  if (!scope) throw new Error('Silakan masuk dengan akun aktif.');
  if (current.scope === scope && current.status === 'pending') throw new Error('Absensi masih diproses. Tunggu hasil sebelum mengirim kembali.');
  const id = ++sequence;
  attendanceOperation.set({ scope, id, mode, status: 'pending', stage: 'preparing', message: '' });
  return { scope, id };
}
type Lease = ReturnType<typeof beginAttendanceOperation>;
function owns(lease: Lease) {
  const state = get(attendanceOperation);
  return state.id === lease.id && state.scope === lease.scope && lease.scope === attendanceOperationScope() && state.status === 'pending';
}
export function advanceAttendanceOperation(lease: Lease, stage: AttendanceOperationStage) {
  if (owns(lease)) attendanceOperation.update(state => ({ ...state, stage }));
}
export function isAttendanceOutcomeUncertain(error: unknown) {
  if (!error || typeof error !== 'object') return true;
  const details = error as { code?: unknown; status?: unknown; uploadRejected?: unknown };
  if (details.uploadRejected === true || typeof details.code === 'string' && /^[0-9A-Z]{5}$/.test(details.code)) return false;
  return !(typeof details.status === 'number' && details.status >= 400 && details.status < 500 && details.status !== 408);
}
export function finishAttendanceOperation(lease: Lease, error?: unknown, outcome?: { uncertain: boolean; statusChecked: boolean }) {
  if (!owns(lease)) return false;
  // Catch handlers may receive a non-Error (even undefined). Only the one-arg
  // call signifies a confirmed success; never infer it from error truthiness.
  const failed = arguments.length > 1;
  attendanceOperation.update(state => ({ ...state, status: failed ? 'failed' : 'succeeded', uncertain: outcome?.uncertain ?? false, statusChecked: outcome?.statusChecked ?? false,
    message: failed ? error instanceof Error ? error.message : 'Hasil absensi belum dapat dikonfirmasi. Periksa riwayat sebelum mencoba kembali.'
      : state.mode === 'in' ? 'Clock in berhasil dicatat. Selamat bekerja!' : 'Clock out berhasil dicatat. Terima kasih untuk hari ini.' }));
  return true;
}
export function dismissAttendanceOutcome() {
  const state = get(attendanceOperation);
  if (state.scope === attendanceOperationScope() && state.status !== 'pending') attendanceOperation.set(idle(state.scope, state.id));
}
export const attendanceStageLabel = (stage: AttendanceOperationStage) => ({
  preparing: 'Menyiapkan absensi…', upload: 'Mengunggah selfie…', verify: 'Memeriksa selfie dan lokasi…',
  save: 'Menyimpan absensi…', reconcile: 'Memastikan catatan terbaru…'
})[stage];
