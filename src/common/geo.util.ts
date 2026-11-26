import { GpsPayload } from '../mqtt/payloads';

export interface GpsFields {
  lat: number | null;
  lon: number | null;
  gpsValid: boolean;
  gpsAgeS: number | null;
}

/** (0,0) là giá trị firmware gửi khi chưa từng có fix, không phải vị trí thật. */
export function isUsableFix(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function toGpsFields(gps: GpsPayload | undefined): GpsFields {
  if (!gps || !isUsableFix(gps.lat, gps.lon)) {
    return { lat: null, lon: null, gpsValid: false, gpsAgeS: null };
  }
  return { lat: gps.lat, lon: gps.lon, gpsValid: gps.valid, gpsAgeS: gps.ageS ?? null };
}
