import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const live = vi.hoisted(() => ({
  configured: false,
  supabase: null as Record<string, any> | null
}));

vi.mock('./state/client', () => ({
  get configured() { return live.configured; },
  get supabase() { return live.supabase; }
}));

import { actions, app } from './state/app';
import { initialDemo } from './state/demo';

const issueKey = '10000000-0000-4000-8000-000000000011';
const handoverKey = '10000000-0000-4000-8000-000000000012';
const exchangeKey = '10000000-0000-4000-8000-000000000013';
const intervalKey = '10000000-0000-4000-8000-000000000014';
const categoryKey = '10000000-0000-4000-8000-000000000015';
const routeKey = '10000000-0000-4000-8000-000000000016';
const capabilityKey = '10000000-0000-4000-8000-000000000017';

function rejectedBackend(message: string, code = '') {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message, code }, status: code === '40001' ? 409 : 0 });
  const upload = vi.fn().mockResolvedValue({ data: { path: 'ignored' }, error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const from = vi.fn(() => ({ upload, remove }));
  live.supabase = {
    rpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'auth-supervisor' } } } }) },
    storage: { from }
  };
  return { rpc, upload, remove, from };
}

beforeEach(() => {
  const state = initialDemo();
  state.initialized = true;
  state.mode = 'live';
  state.user = state.employees.find((employee) => employee.id === 'employee-1')!;
  app.set(state);
  live.configured = true;
  live.supabase = null;
});

describe('supervisor operation client boundary', () => {
  it('retains a deterministic issue photo and exact payload after an ambiguous RPC result', async () => {
    const backend = rejectedBackend('Koneksi terputus saat hasil belum diterima');
    const photo = new File(['jpeg'], 'kendala.jpg', { type: 'image/jpeg' });
    const input = {
      outletId: 'outlet-a', categoryId: 'category-a', description: 'Mesin kasir tidak dapat mencetak struk.', urgency: 'high' as const,
      photo, reporterEmployeeId: null, idempotencyKey: issueKey
    };

    await expect(actions.submitOutletIssue(input)).rejects.toThrow('Koneksi terputus');
    const path = `auth-supervisor/${issueKey}.jpg`;
    expect(backend.upload).toHaveBeenCalledWith(path, photo, { contentType: 'image/jpeg', upsert: false });
    expect(backend.rpc).toHaveBeenCalledWith('outlet_issue_submit', {
      p_outlet_id: input.outletId, p_category_id: input.categoryId, p_description: input.description,
      p_urgency: input.urgency, p_photo_path: path, p_reporter_employee_id: null, p_idempotency_key: issueKey
    });
    expect(backend.remove).not.toHaveBeenCalled();

    const replay = { ...input, photo: undefined, photoPath: path };
    await expect(actions.submitOutletIssue(replay)).rejects.toThrow('Koneksi terputus');
    expect(backend.upload).toHaveBeenCalledTimes(1);
    expect(backend.rpc.mock.calls[1]).toEqual(backend.rpc.mock.calls[0]);
  });

  it('removes only a definite rejected issue upload, preserving the original error', async () => {
    const backend = rejectedBackend('Kategori sudah tidak tersedia', 'P0001');
    const photo = new File(['png'], 'kendala.png', { type: 'image/png' });

    await expect(actions.submitOutletIssue({
      outletId: 'outlet-a', categoryId: 'category-a', description: 'Laci kasir tidak dapat dibuka dengan normal.', urgency: 'normal', photo,
      idempotencyKey: issueKey
    })).rejects.toThrow('Kategori sudah tidak tersedia');
    expect(backend.remove).toHaveBeenCalledWith([`auth-supervisor/${issueKey}.png`]);
  });

  it('forwards optimistic baselines and original idempotency keys for handover, exchange, and interval writes', async () => {
    const backend = rejectedBackend('Data berubah di sesi lain', '40001');
    await expect(actions.saveShiftHandover({
      id: 'handover-a', expectedVersion: 4, idempotencyKey: handoverKey, outletId: 'outlet-a', workDate: '2026-10-27',
      senderAssignmentId: 'assignment-a', recipientEmployeeId: 'employee-2', recipientAssignmentId: 'assignment-b',
      pendingWork: 'Sisa hitung kas untuk diselesaikan pada shift berikut.', outletCondition: '', notes: '', send: true, reason: 'Perbarui catatan serah terima'
    })).rejects.toThrow('Data berubah');
    await expect(actions.submitShiftExchange({
      requestType: 'swap', requesterAssignmentId: 'assignment-a', peerEmployeeId: 'employee-2',
      reason: 'Perlu bertukar shift karena ada keperluan keluarga.', idempotencyKey: exchangeKey
    })).rejects.toThrow('Data berubah');
    await expect(actions.saveIntervalRequirement({
      id: 'requirement-a', expectedRevision: 7, idempotencyKey: intervalKey, outletId: 'outlet-a', weekday: 2,
      startsAt: '14:00', endsAt: '16:00', minimum: 2, effectiveFrom: '2026-10-27', effectiveUntil: null,
      reason: 'Kebutuhan kasir meningkat pada jam sibuk sore.'
    })).rejects.toThrow('Data berubah');

    expect(backend.rpc).toHaveBeenNthCalledWith(1, 'shift_handover_save_v2', expect.objectContaining({
      p_id: 'handover-a', p_expected_version: 4, p_idempotency_key: handoverKey
    }));
    expect(backend.rpc).toHaveBeenNthCalledWith(2, 'shift_exchange_submit', expect.objectContaining({
      p_requester_assignment_id: 'assignment-a', p_idempotency_key: exchangeKey
    }));
    expect(backend.rpc).toHaveBeenNthCalledWith(3, 'staffing_interval_requirement_save_v2', expect.objectContaining({
      p_id: 'requirement-a', p_expected_revision: 7, p_idempotency_key: intervalKey,
      p_effective_from: '2026-10-27', p_effective_until: null
    }));
    expect(get(app).user?.id).toBe('employee-1');
  });

  it('uses v2 baselines and deterministic keys for category, route, and capability configuration', async () => {
    const backend = rejectedBackend('Koneksi terputus saat hasil belum diterima');
    await expect(actions.saveSupervisorIssueCategory({ idempotencyKey: categoryKey, id: null, expectedRevision: null,
      code: 'perangkat_kasir', name: 'Perangkat kasir', active: true })).rejects.toThrow('Koneksi terputus');
    await expect(actions.saveSupervisorIssueRoute({ idempotencyKey: routeKey, id: 'route-a', expectedRevision: 5,
      categoryId: 'category-a', outletId: 'outlet-a', recipientEmployeeId: 'employee-2', active: true })).rejects.toThrow('Koneksi terputus');
    await expect(actions.saveSupervisorCapability({ idempotencyKey: capabilityKey, id: 'capability-a', expectedRevision: 7,
      employeeId: 'employee-2', capability: 'issue_handle', outletId: 'outlet-a', categoryId: 'category-a', granted: false })).rejects.toThrow('Koneksi terputus');

    expect(backend.rpc).toHaveBeenNthCalledWith(1, 'supervisor_issue_category_save_v2', {
      p_id: null, p_expected_revision: null, p_idempotency_key: categoryKey,
      p_code: 'perangkat_kasir', p_name: 'Perangkat kasir', p_active: true
    });
    expect(backend.rpc).toHaveBeenNthCalledWith(2, 'supervisor_issue_route_save_v2', {
      p_id: 'route-a', p_expected_revision: 5, p_idempotency_key: routeKey,
      p_category_id: 'category-a', p_outlet_id: 'outlet-a', p_recipient_employee_id: 'employee-2', p_active: true
    });
    expect(backend.rpc).toHaveBeenNthCalledWith(3, 'supervisor_capability_save_v2', {
      p_id: 'capability-a', p_expected_revision: 7, p_idempotency_key: capabilityKey,
      p_employee_id: 'employee-2', p_capability: 'issue_handle', p_outlet_id: 'outlet-a', p_category_id: 'category-a', p_granted: false
    });
  });

  it('rejects a non-eight-hour Middle plan before it can reach the server', async () => {
    const backend = rejectedBackend('should not be called');
    await expect(actions.saveCashierAssignmentPlan({
      assignmentId: 'assignment-middle', expectedUpdatedAt: '2026-10-24T00:00:00.000Z', idempotencyKey: intervalKey,
      startsAt: '08:00', endsAt: '15:00', reason: 'Rencana Middle yang sengaja tidak valid.'
    })).rejects.toThrow('tepat 8 jam');
    expect(backend.rpc).not.toHaveBeenCalled();
  });
});
