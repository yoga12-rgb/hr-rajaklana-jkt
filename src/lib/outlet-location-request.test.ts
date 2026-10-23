import { describe, expect, it } from 'vitest';
import { isCurrentOutletLocationRequest } from './outlet-location-request';

const request = { requestGeneration: 4, currentGeneration: 4, requestOutletId: 'outlet-a', currentOutletId: 'outlet-a', editing: true, activeTab: 'outlets' };

describe('outlet location request ownership', () => {
  it('accepts a response only for the same open outlet form', () => {
    expect(isCurrentOutletLocationRequest(request)).toBe(true);
    expect(isCurrentOutletLocationRequest({ ...request, currentOutletId: 'outlet-b' })).toBe(false);
    expect(isCurrentOutletLocationRequest({ ...request, editing: false })).toBe(false);
    expect(isCurrentOutletLocationRequest({ ...request, activeTab: 'departments' })).toBe(false);
    expect(isCurrentOutletLocationRequest({ ...request, currentGeneration: 5 })).toBe(false);
  });
});
