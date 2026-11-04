import type { AppNotification } from './types';

type NotificationLink = Pick<AppNotification, 'href' | 'entityId' | 'entityType'>;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
function calendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

/** Only links emitted by the notification contract may become SPA destinations.
 * Route authorization still belongs to the destination and server/RLS. */
export function notificationDestination(notification: NotificationLink): string | null {
  const href = notification.href;
  if (typeof href !== 'string' || href.length > 2048 || !href.startsWith('/') || href.startsWith('//')
    || /[\\#\u0000-\u0020\u007f]/.test(href) || !safeId(notification.entityId)) return null;
  let url: URL;
  try { url = new URL(href, 'https://notification.invalid'); } catch { return null; }
  // Reject path normalization (dot segments/encoded paths) instead of silently
  // treating a different spelling as an allowed route.
  if (url.origin !== 'https://notification.invalid' || url.pathname !== href.split('?')[0]) return null;
  const query = url.searchParams;
  const exactly = (...keys: string[]) => [...query.keys()].length === keys.length
    && keys.every(key => query.getAll(key).length === 1);
  const entityLink = (path: string, key: string) => url.pathname === path && exactly(key)
    && query.get(key) === notification.entityId ? `${path}?${key}=${encodeURIComponent(notification.entityId)}` : null;
  switch (notification.entityType ?? 'leave') {
    case 'leave': return entityLink('/leave', 'request');
    case 'attendance_correction':
      if (url.pathname === '/reports' && exactly('tab', 'request') && query.get('tab') === 'corrections'
        && query.get('request') === notification.entityId) return `/reports?tab=corrections&request=${encodeURIComponent(notification.entityId)}`;
      return entityLink('/attendance', 'request');
    case 'attendance_reminder': return entityLink('/attendance', 'record');
    case 'spv_followup': return entityLink('/supervisor', 'case');
    case 'outlet_issue': return entityLink('/operations', 'issue');
    case 'handover': return entityLink('/operations', 'handover');
    case 'shift_exchange': return entityLink('/operations', 'exchange');
    case 'assignment':
    case 'assignment_week': {
      const key = notification.entityType === 'assignment' ? 'date' : 'week';
      const date = query.get(key);
      return url.pathname === '/assignments' && exactly(key) && calendarDate(date) ? `/assignments?${key}=${date}` : null;
    }
    default: return null;
  }
}
