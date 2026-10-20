type RpcErrorLike = { message: string; code?: string; details?: string; hint?: string };

/** Preserve the HTTP status returned beside the Supabase RPC error. */
export function rpcError(error: RpcErrorLike, status: number): Error & Pick<RpcErrorLike, 'code' | 'details' | 'hint'> & { status: number } {
  return Object.assign(new Error(error.message), { code: error.code, details: error.details, hint: error.hint, status });
}
