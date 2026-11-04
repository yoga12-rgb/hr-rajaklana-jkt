import { describe, expect, it } from 'vitest';
import { notificationDestination } from './notification-destination';
import type { AppNotification } from './types';

const entityId = '0242f6e5-98f1-43cc-bf65-31ff069506c9';
const link = (href: string, entityType?: AppNotification['entityType'], id = entityId) => ({ href, entityType, entityId: id });

describe('notification destination contract', () => {
  it.each([
    ['leave', `/leave?request=${entityId}`],
    ['attendance_correction', `/attendance?request=${entityId}`],
    ['attendance_correction', `/reports?tab=corrections&request=${entityId}`],
    ['attendance_reminder', `/attendance?record=${entityId}`],
    ['spv_followup', `/supervisor?case=${entityId}`],
    ['outlet_issue', `/operations?issue=${entityId}`],
    ['handover', `/operations?handover=${entityId}`],
    ['shift_exchange', `/operations?exchange=${entityId}`],
    ['assignment', '/assignments?date=2026-11-04'],
    ['assignment_week', '/assignments?week=2026-11-02']
  ] as const)('opens the real %s notification route', (type, href) => {
    expect(notificationDestination(link(href, type))).toBe(href);
  });

  it('keeps legacy leave notifications and safe synthetic/demo IDs usable', () => {
    expect(notificationDestination(link(`/leave?request=${entityId}`))).toBe(`/leave?request=${entityId}`);
    expect(notificationDestination(link('/supervisor?case=followup-old-case', 'spv_followup', 'followup-old-case'))).toBe('/supervisor?case=followup-old-case');
    expect(notificationDestination(link(`/reports?request=${entityId}&tab=corrections`, 'attendance_correction'))).toBe(`/reports?tab=corrections&request=${entityId}`);
  });

  it.each([
    `https://evil.test/leave?request=${entityId}`, `//evil.test/leave?request=${entityId}`,
    `/\\evil.test/leave?request=${entityId}`, `javascript:alert(1)`,
    `/leave?request=${entityId}#https://evil.test`, `/leave?request=${entityId}#`,
    `/leave?request=${entityId}\n`, ` /leave?request=${entityId}`,
    `/operations/../leave?request=${entityId}`, `/operations/%2e%2e/leave?request=${entityId}`,
    `/%6ceave?request=${entityId}`, `/leave/?request=${entityId}`,
    `/leave?request=${entityId}&next=https://evil.test`, `/leave?request=${entityId}&request=${entityId}`,
    `/leave?request=another-id`, '/leave', '/login', '/employees'
  ])('refuses unsafe or noncontract leave link %s', href => {
    expect(notificationDestination(link(href, 'leave'))).toBeNull();
  });

  it.each(['2026-02-30', '2026-13-01', '2026-2-03', '2026-11-04T00:00:00Z', '//evil.test', ''])('rejects invalid schedule date %s', date => {
    expect(notificationDestination(link(`/assignments?date=${date}`, 'assignment'))).toBeNull();
    expect(notificationDestination(link(`/assignments?week=${date}`, 'assignment_week'))).toBeNull();
  });

  it('binds entity type, query key and exact entity ID rather than allowing arbitrary same-origin links', () => {
    expect(notificationDestination(link(`/supervisor?case=${entityId}`, 'leave'))).toBeNull();
    expect(notificationDestination(link(`/operations?exchange=${entityId}`, 'outlet_issue'))).toBeNull();
    expect(notificationDestination(link(`/operations?issue=${entityId}&handover=${entityId}`, 'outlet_issue'))).toBeNull();
    expect(notificationDestination(link(`/reports?tab=audit&request=${entityId}`, 'attendance_correction'))).toBeNull();
    expect(notificationDestination(link('/assignments?week=2026-11-02&date=2026-11-04', 'assignment_week'))).toBeNull();
    expect(notificationDestination(link('/operations?issue=a%2Fb', 'outlet_issue', 'a/b'))).toBeNull();
    expect(notificationDestination(link(`/leave?request=${entityId}`, 'leave', ''))).toBeNull();
  });
});
