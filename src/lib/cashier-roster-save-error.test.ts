import { describe, expect, it } from 'vitest';
import { cashierRosterSaveErrorMessage } from './cashier-roster-save-error';

describe('cashier roster save errors', () => {
  it.each([
    new TypeError('Failed to fetch'),
    new Error('TypeError: fetch failed'),
    new Error('NetworkError when attempting to fetch resource.'),
    Object.assign(new Error('Service Unavailable'), { status: 503 }),
    Object.assign(new Error('Request failed'), { status: 0 }),
  ])('offers a same-key retry for an uncertain transport failure', (error) => {
    const message = cashierRosterSaveErrorMessage(error);
    expect(message).toContain('Belum ada konfirmasi dari server');
    expect(message).toContain('Draft tetap tersimpan');
    expect(message).toContain('kunci yang sama');
  });

  it('preserves a database rejection instead of describing it as a retryable network error', () => {
    const error = Object.assign(new Error('Jadwal berubah sejak pratinjau. Muat ulang dan periksa konflik.'), { code: 'P0001', status: 400 });
    expect(cashierRosterSaveErrorMessage(error)).toBe(error.message);
  });

  it('preserves other server messages when the browser is online', () => {
    expect(cashierRosterSaveErrorMessage(new Error('Akses Admin HR diperlukan'))).toBe('Akses Admin HR diperlukan');
  });

  it('uses a safe fallback for an unknown thrown value', () => {
    expect(cashierRosterSaveErrorMessage(null)).toBe('Batch jadwal belum tersimpan.');
  });
});
