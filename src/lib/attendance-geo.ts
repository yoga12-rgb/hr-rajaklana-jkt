export const GPS_MAX_AGE_MS = 60_000;
export interface AttendanceLocation { latitude: number; longitude: number; accuracy: number; geoCapturedAt: string }
export function isFreshAttendanceLocation(location: AttendanceLocation | null, now = Date.now()): boolean {
  return !!location && Number.isFinite(Date.parse(location.geoCapturedAt)) && Date.parse(location.geoCapturedAt) <= now && now - Date.parse(location.geoCapturedAt) <= GPS_MAX_AGE_MS;
}
