export type ConnectionIndicator = 'connected' | 'connecting' | 'offline';

export function connectionIndicator(connected: boolean, networkOnline: boolean): ConnectionIndicator {
  if (!networkOnline) return 'offline';
  return connected ? 'connected' : 'connecting';
}
