import { describe, expect, it } from 'vitest';
import { connectionIndicator } from './connection-status';

describe('connectionIndicator', () => {
  it('shows connected only when the Realtime channel is subscribed and the network is online', () => {
    expect(connectionIndicator(true, true)).toBe('connected');
    expect(connectionIndicator(true, false)).toBe('offline');
  });

  it('shows connecting while online but before the Realtime channel is ready', () => {
    expect(connectionIndicator(false, true)).toBe('connecting');
  });

  it('shows offline when the browser reports no network, even if the previous channel was connected', () => {
    expect(connectionIndicator(false, false)).toBe('offline');
  });
});
