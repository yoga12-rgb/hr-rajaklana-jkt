import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.createClient }));
vi.mock('../../server/face-engine.mjs', () => ({
  extractFace: vi.fn(), assertFaceMatch: vi.fn(), MODEL_ID: 'synthetic-model'
}));

import { authenticate } from '../../server/security.mjs';
import { POST as biometric } from '../../api/biometric.mjs';
import { POST as push } from '../../api/push.mjs';

type Access = {
  employee_id: string | null; requires_mfa: boolean; current_level: string;
  allowed: boolean; reason: string | null;
};
const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'fixture-public', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const employeeA = '20000000-0000-4000-8000-000000000001';
const employeeB = '20000000-0000-4000-8000-000000000002';
const contexts: Record<string, Access> = {};
const getUser = vi.fn(), selectEmployee = vi.fn(), adminRPC = vi.fn(), clientRPC = vi.fn();
let getContext: (token: string) => Promise<{ data: unknown; error: unknown }>;
let employeeOverride: Record<string, unknown> | null;

function request(token = 'token.A', route = 'push', body: Record<string, unknown> = { action: 'config' }) {
  return new Request(`https://hr.example/api/${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv('VAPID_PUBLIC_KEY', 'a'.repeat(87));
  contexts['token.A'] = { employee_id: employeeA, requires_mfa: true, current_level: 'aal2', allowed: true, reason: null };
  contexts['token.B'] = { employee_id: employeeB, requires_mfa: false, current_level: 'aal1', allowed: true, reason: null };
  employeeOverride = null;
  getContext = async token => ({ data: contexts[token], error: null });
  getUser.mockImplementation(async (token: string) => ({ data: { user: {
    id: token === 'token.A' ? userA : userB,
    // User-editable metadata must never be accepted as an MFA bypass.
    user_metadata: { aal: 'aal2', requires_mfa: false, role: 'admin_hr' }
  } }, error: null }));
  selectEmployee.mockImplementation((id: string) => ({
    data: employeeOverride ?? {
      id: id === userA ? employeeA : employeeB, auth_user_id: id,
      status: 'active', account_status: 'active', can_clock: true
    }, error: null
  }));
  clientRPC.mockResolvedValue({ data: true, error: null });
  boundary.createClient.mockImplementation((_url: string, key: string, options: { global?: { headers?: { Authorization?: string } } }) => {
    if (key === env.SUPABASE_SERVICE_ROLE_KEY) return {
      auth: { getUser }, rpc: adminRPC,
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn((_field: string, id: string) => ({ single: async () => selectEmployee(id) })) })) }))
    };
    const token = options.global?.headers?.Authorization?.slice(7) ?? '';
    return { rpc: vi.fn((name: string, args: unknown) => name === 'auth_access_context' ? getContext(token) : clientRPC(name, args)) };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('service-backed API MFA enforcement', () => {
  it.each([['biometric', biometric], ['push', push]] as const)('%s rejects a privileged aal1 request before service reads or actions', async (route, handler) => {
    contexts['token.A'] = { ...contexts['token.A'], current_level: 'aal1', allowed: false, reason: 'mfa_required' };
    const result = await handler(request('token.A', route, { action: 'verify', aal: 'aal2', requires_mfa: false }));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: 'mfa_required' });
    expect(getUser).toHaveBeenCalledWith('token.A');
    expect(selectEmployee).not.toHaveBeenCalled();
    expect(adminRPC).not.toHaveBeenCalled(); expect(clientRPC).not.toHaveBeenCalled();
  });

  it('allows a privileged aal2 request and an ordinary cashier aal1 request with their own identities', async () => {
    const hr = await authenticate(request('token.A'), env);
    const cashier = await authenticate(request('token.B'), env);
    expect(hr.employee.id).toBe(employeeA); expect(hr.user.id).toBe(userA);
    expect(cashier.employee.id).toBe(employeeB); expect(cashier.user.id).toBe(userB);
    expect(selectEmployee.mock.calls).toEqual([[userA], [userB]]);
  });

  it('preserves the ordinary cashier push API after the security check', async () => {
    const result = await push(request('token.B'));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ publicKey: 'a'.repeat(87) });
    expect(adminRPC).not.toHaveBeenCalled();
  });

  it('rejects aal1 even if an inconsistent context says allowed, without trusting user metadata', async () => {
    contexts['token.A'] = { ...contexts['token.A'], current_level: 'aal1', allowed: true };
    await expect(authenticate(request(), env)).rejects.toMatchObject({ code: 'mfa_required', status: 403 });
    expect(selectEmployee).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'session_revoked'])('denies a %s context before service access', async reason => {
    contexts['token.A'] = { ...contexts['token.A'], allowed: false, reason };
    await expect(authenticate(request(), env)).rejects.toMatchObject({ code: reason === 'inactive' ? 'inactive' : 'unauthorized' });
    expect(selectEmployee).not.toHaveBeenCalled(); expect(adminRPC).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { employee_id: employeeA, requires_mfa: false, allowed: true },
    { employee_id: employeeA, requires_mfa: false, current_level: 'forged', allowed: true },
    { employee_id: employeeA, requires_mfa: false, current_level: 'aal1', allowed: true },
    { employee_id: employeeA, requires_mfa: false, current_level: 'aal1', allowed: true, reason: 'inactive' },
    { employee_id: 123, requires_mfa: false, current_level: 'aal1', allowed: true, reason: null },
    { employee_id: employeeA, requires_mfa: false, current_level: 'aal1', allowed: true, reason: 'unknown_future_state' }
  ])('fails closed for an unavailable or malformed access context: %j', async data => {
    getContext = async () => ({ data, error: null });
    await expect(authenticate(request(), env)).rejects.toMatchObject({ code: 'auth_unavailable', status: 503 });
    expect(selectEmployee).not.toHaveBeenCalled();
  });

  it('fails closed when the access-context RPC fails and does not expose its internal error', async () => {
    getContext = async () => ({ data: null, error: { message: 'synthetic internal token detail' } });
    const result = await push(request());
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain('synthetic internal token detail');
    expect(selectEmployee).not.toHaveBeenCalled();
  });

  it.each([
    { id: employeeB, auth_user_id: userA, status: 'active', account_status: 'active' },
    { id: employeeA, auth_user_id: userB, status: 'active', account_status: 'active' },
    { id: employeeA, auth_user_id: userA, status: 'inactive', account_status: 'disabled' }
  ])('rejects a service-row identity or lifecycle mismatch', async row => {
    employeeOverride = row;
    await expect(authenticate(request(), env)).rejects.toMatchObject({ code: 'inactive', status: 403 });
    expect(adminRPC).not.toHaveBeenCalled();
  });

  it('keeps concurrent requests bound to their own verified bearer during an account switch', async () => {
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    getContext = async token => {
      if (token === 'token.A') await paused;
      return { data: contexts[token], error: null };
    };
    const first = authenticate(request('token.A'), env);
    const replacement = await authenticate(request('token.B'), env);
    expect(replacement.employee.id).toBe(employeeB);
    release();
    expect((await first).employee.id).toBe(employeeA);
    expect(getUser.mock.calls).toEqual([['token.A'], ['token.B']]);
  });

  it('requires token verification before calling the access-context RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    const context = vi.fn(getContext); getContext = context;
    await expect(authenticate(request(), env)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(context).not.toHaveBeenCalled(); expect(selectEmployee).not.toHaveBeenCalled();
  });
});
