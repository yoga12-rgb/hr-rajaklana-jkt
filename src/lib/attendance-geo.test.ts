import { describe, expect, it } from 'vitest';
import { isFreshAttendanceLocation } from './attendance-geo';
describe('Kesegaran lokasi absensi', () => {
  const location = { latitude: -6.2, longitude: 106.8, accuracy: 10, geoCapturedAt: new Date(100_000).toISOString() };
  it('menerima tepat 60 detik dan menolak setelahnya', () => {
    expect(isFreshAttendanceLocation(location, 160_000)).toBe(true);
    expect(isFreshAttendanceLocation(location, 160_001)).toBe(false);
  });
  it('menolak lokasi kosong, waktu tidak valid dan waktu masa depan', () => {
    expect(isFreshAttendanceLocation(null, 100_000)).toBe(false);
    expect(isFreshAttendanceLocation({ ...location, geoCapturedAt: 'invalid' }, 100_000)).toBe(false);
    expect(isFreshAttendanceLocation(location, 99_999)).toBe(false);
  });
});
