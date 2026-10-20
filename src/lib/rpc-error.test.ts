import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { cashierRosterSaveOutcomeIsUncertain } from './cashier-roster-save-error';
import { rpcError } from './rpc-error';

async function requestRpc(payload: Record<string, unknown>, status: number) {
  const fetch = async () => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' }
  });
  const client = createClient('https://rpc-test.supabase.co', 'test-anon-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return client.rpc('cashier_roster_batch_save', {});
}

describe('Supabase RPC HTTP status forwarding', () => {
  it('uses the installed SDK top-level 500 status to classify an ambiguous save', async () => {
    const result = await requestRpc({ message: 'Internal Server Error' }, 500);
    expect(result.error?.message).toBe('Internal Server Error');
    expect((result.error as { status?: number } | null)?.status).toBeUndefined();
    const error = rpcError(result.error!, result.status);
    expect(error.status).toBe(500);
    expect(cashierRosterSaveOutcomeIsUncertain(error)).toBe(true);
  });

  it('keeps SQLSTATE rejections non-retryable after forwarding the top-level status', async () => {
    const result = await requestRpc({ code: 'P0001', message: 'Jadwal berubah sejak pratinjau.', details: 'Versi terbaru berbeda.' }, 400);
    const error = rpcError(result.error!, result.status);
    expect(error).toMatchObject({ message: 'Jadwal berubah sejak pratinjau.', code: 'P0001', details: 'Versi terbaru berbeda.', status: 400 });
    expect(cashierRosterSaveOutcomeIsUncertain(error)).toBe(false);
  });
});
