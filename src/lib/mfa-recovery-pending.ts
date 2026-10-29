type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface MfaRecoveryScope {
  environment: string;
  projectOrigin: string;
  authUserId: string;
  actorEmployeeId: string;
}
export interface MfaRecoveryPending { employeeId: string; requestId: string; reason: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const failure = () => new Error('Penyimpanan pemulihan belum dapat dipastikan. Jangan membuat permintaan baru; periksa penyimpanan perangkat atau hubungi dukungan HR.');

export function mfaRecoveryScope(environment: string, projectUrl: string, authUserId: string, actorEmployeeId: string): MfaRecoveryScope {
  const origin = new URL(projectUrl).origin;
  if (!['production','preview','development'].includes(environment) || !/^https?:\/\//.test(origin)
    || !isUuid(authUserId) || !isUuid(actorEmployeeId)) throw failure();
  return { environment, projectOrigin: origin, authUserId, actorEmployeeId };
}
export function mfaRecoveryPendingKey(scope: MfaRecoveryScope) {
  return `rajaklana:mfa-recovery:v1:${encodeURIComponent(scope.environment)}:${encodeURIComponent(scope.projectOrigin)}:${scope.authUserId}:${scope.actorEmployeeId}`;
}
function validPayload(value: unknown): value is MfaRecoveryPending {
  return record(value) && exactKeys(value, ['employeeId','requestId','reason'])
    && isUuid(value.employeeId) && isUuid(value.requestId)
    && typeof value.reason === 'string' && value.reason.trim().length >= 10 && value.reason.length <= 1000;
}
const samePayload = (left: MfaRecoveryPending, right: MfaRecoveryPending) => left.employeeId === right.employeeId && left.requestId === right.requestId && left.reason === right.reason;
function serialized(scope: MfaRecoveryScope, payload: MfaRecoveryPending) {
  if (!validPayload(payload)) throw failure();
  return JSON.stringify({ version: 1, scope, payload });
}
function parse(raw: string, scope: MfaRecoveryScope): MfaRecoveryPending {
  if (raw.length > 5000) throw failure();
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !exactKeys(value, ['version','scope','payload']) || value.version !== 1
    || !record(value.scope) || !exactKeys(value.scope, ['environment','projectOrigin','authUserId','actorEmployeeId'])
    || value.scope.environment !== scope.environment || value.scope.projectOrigin !== scope.projectOrigin
    || value.scope.authUserId !== scope.authUserId || value.scope.actorEmployeeId !== scope.actorEmployeeId
    || !validPayload(value.payload)) throw failure();
  return { ...value.payload };
}
export function readMfaRecoveryPending(storage: RecoveryStorage, scope: MfaRecoveryScope): MfaRecoveryPending | null {
  try {
    const raw = storage.getItem(mfaRecoveryPendingKey(scope));
    return raw === null ? null : parse(raw, scope);
  } catch { throw failure(); }
}
/** The original payload must be durably read back before sending a request. */
export function persistMfaRecoveryPending(storage: RecoveryStorage, scope: MfaRecoveryScope, payload: MfaRecoveryPending) {
  try {
    const original = readMfaRecoveryPending(storage, scope);
    if (original && !samePayload(original, payload)) throw failure();
    const raw = serialized(scope, payload);
    storage.setItem(mfaRecoveryPendingKey(scope), raw);
    if (storage.getItem(mfaRecoveryPendingKey(scope)) !== raw) throw failure();
  } catch { throw failure(); }
}
/** A late response can clear only its own matching draft and confirmed receipt. */
export function completeMfaRecoveryPending(storage: RecoveryStorage, scope: MfaRecoveryScope, payload: MfaRecoveryPending, receipt: unknown) {
  if (!record(receipt) || receipt.ok !== true || receipt.request_id !== payload.requestId) throw failure();
  try {
    const original = readMfaRecoveryPending(storage, scope);
    if (!original || !samePayload(original, payload)) throw failure();
    storage.removeItem(mfaRecoveryPendingKey(scope));
    if (storage.getItem(mfaRecoveryPendingKey(scope)) !== null) throw failure();
  } catch { throw failure(); }
}
