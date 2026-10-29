type RecoveryReceipt = {
  employee_id: string;
  auth_user_id: string;
  request_id: string;
  factor_ids: string[];
  status: string;
};
type Result<T> = { data: T | null; error: unknown };
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<Result<any>>;
type FactorAdmin = {
  listFactors(input: { userId: string }): PromiseLike<Result<{ factors: { id: string }[] }>>;
  deleteFactor(input: { userId: string; id: string }): PromiseLike<Result<{ id: string }>>;
};

export class MfaRecoveryError extends Error {
  constructor(message: string, readonly status: 403 | 503 = 503) { super(message); }
}

/** All authorization and immutable retry inputs come from the user-scoped RPC. */
export async function recoverMfa(
  actorRpc: Rpc,
  serviceRpc: Rpc,
  factors: FactorAdmin,
  employeeId: string,
  requestId: string,
  reason: string
) {
  try {
    return await performRecovery(actorRpc, serviceRpc, factors, employeeId, requestId, reason);
  } catch (error) {
    if (error instanceof MfaRecoveryError) throw error;
    // Transport/SDK exceptions can contain provider internals. Only the fixed,
    // actionable messages declared here may cross the public Edge boundary.
    throw new MfaRecoveryError('Pemulihan MFA belum dapat dipastikan. Coba kembali dengan permintaan yang sama.');
  }
}

async function performRecovery(
  actorRpc: Rpc, serviceRpc: Rpc, factors: FactorAdmin,
  employeeId: string, requestId: string, reason: string
) {
  const authorized = await actorRpc('auth_mfa_recovery_authorize', {
    p_employee_id: employeeId, p_request_id: requestId, p_reason: reason
  });
  if (authorized.error) throw new MfaRecoveryError('Pemulihan MFA ditolak. Periksa akses dan verifikasi dua langkah Anda.', 403);
  const receipt = authorized.data as RecoveryReceipt | null;
  if (!receipt || receipt.employee_id !== employeeId || receipt.request_id !== requestId
    || typeof receipt.auth_user_id !== 'string' || !receipt.auth_user_id || !Array.isArray(receipt.factor_ids)
    || receipt.factor_ids.some(id => typeof id !== 'string' || !id)) throw new MfaRecoveryError('Otorisasi pemulihan MFA tidak valid.');
  if (receipt.status === 'completed') return { ok: true, request_id: requestId };
  if (receipt.status !== 'pending') throw new MfaRecoveryError('Permintaan pemulihan MFA tidak dapat dilanjutkan.', 403);

  // An ambiguous previous deletion is safe to retry: only IDs captured by the
  // original authorization may be removed. Newly enrolled factors are untouched.
  const listed = await factors.listFactors({ userId: receipt.auth_user_id });
  if (listed.error || !listed.data || !Array.isArray(listed.data.factors)) throw new MfaRecoveryError('Faktor MFA belum dapat diperiksa. Coba kembali dengan permintaan yang sama.');
  const present = new Set(listed.data.factors.map(factor => factor.id));
  for (const id of receipt.factor_ids) {
    if (!present.has(id)) continue;
    const deleted = await factors.deleteFactor({ userId: receipt.auth_user_id, id });
    if (deleted.error) throw new MfaRecoveryError('Pemulihan MFA tertunda. Coba kembali dengan permintaan yang sama.');
  }
  const finalized = await serviceRpc('auth_mfa_recovery_complete', { p_request_id: requestId, p_succeeded: true });
  if (finalized.error || finalized.data?.request_id !== requestId || finalized.data?.employee_id !== employeeId
    || finalized.data?.status !== 'completed') throw new MfaRecoveryError('Faktor sudah diproses; pencatatan pemulihan tertunda. Coba kembali dengan permintaan yang sama.');
  return { ok: true, request_id: requestId };
}
