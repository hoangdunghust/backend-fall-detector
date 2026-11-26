/**
 * Phân tích payload JSON do firmware gửi. Dữ liệu từ thiết bị là dữ liệu KHÔNG đáng tin,
 * nên mọi trường đều được kiểm tra kiểu/khoảng; trả về null nếu không dùng được.
 * Định dạng khớp các snprintf trong firmware (comms.cpp).
 */

export type EventType = 'FALL' | 'HELP_REQUEST' | 'FALL_CANCEL' | 'LOCATION_UPDATE';
const EVENT_TYPES: readonly string[] = ['FALL', 'HELP_REQUEST', 'FALL_CANCEL', 'LOCATION_UPDATE'];

export interface GpsPayload {
  valid: boolean; // fix còn mới (<= 60s) tại thời điểm gửi
  lat: number;
  lon: number;
  sat?: number;
  ageS?: number;
}

export interface EventPayload {
  type: EventType;
  tsMs: number | null;
  confidence?: number;
  gps?: GpsPayload;
  eventId?: string; // firmware tương lai có thể gửi event_id
}

export interface HeartbeatPayload {
  tsMs: number | null;
  signal?: number;
  imuOk?: boolean;
  gpsFix?: boolean;
  contacts?: number;
  heap?: number;
}

export interface StatusPayload {
  status: 'online' | 'offline';
  tsMs: number | null;
  uptimeS?: number;
  firmware?: string;
  freeHeap?: number;
}

export interface InfoPayload {
  firmware?: string;
  imuFs?: number;
  capabilities?: string[];
}

export interface SmsPayload {
  phone: string;
  success: boolean;
  tsMs: number | null;
}

export interface CmdRespPayload {
  action: string;
  status: string;
  tsMs: number | null;
}

// ---------------------------------------------------------------- helpers
type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function int(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function str(v: unknown, maxLen = 128): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen ? v : undefined;
}
function ts(v: unknown): number | null {
  const n = num(v);
  return n !== undefined && n >= 0 ? n : null;
}

const MAX_PAYLOAD_BYTES = 8 * 1024;

export function parseJsonBuffer(buf: Buffer | string): unknown | null {
  const text = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (text.length === 0 || text.length > MAX_PAYLOAD_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- parsers
export function parseEvent(raw: unknown): EventPayload | null {
  if (!isObj(raw)) return null;
  const type = typeof raw.type === 'string' && EVENT_TYPES.includes(raw.type) ? (raw.type as EventType) : null;
  if (!type) return null;

  let gps: GpsPayload | undefined;
  if (isObj(raw.gps)) {
    const lat = num(raw.gps.lat);
    const lon = num(raw.gps.lon);
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      gps = {
        valid: bool(raw.gps.valid) ?? false,
        lat,
        lon,
        sat: int(raw.gps.sat, 0, 64),
        ageS: int(raw.gps.age_s, 0, 31_536_000),
      };
    }
  }

  const confidence = num(raw.confidence);
  return {
    type,
    tsMs: ts(raw.ts_ms),
    confidence: confidence !== undefined && confidence >= 0 && confidence <= 1 ? confidence : undefined,
    gps,
    eventId: str(raw.event_id, 64),
  };
}

export function parseHeartbeat(raw: unknown): HeartbeatPayload | null {
  if (!isObj(raw)) return null;
  return {
    tsMs: ts(raw.ts_ms),
    signal: int(raw.signal, 0, 99),
    imuOk: bool(raw.imu_ok),
    gpsFix: bool(raw.gps_fix),
    contacts: int(raw.contacts, 0, 50),
    heap: int(raw.heap, 0, 1_000_000_000),
  };
}

export function parseStatus(raw: unknown): StatusPayload | null {
  if (!isObj(raw) || typeof raw.status !== 'string') return null;
  const s = raw.status.toLowerCase();
  if (s !== 'online' && s !== 'offline') return null;
  return {
    status: s,
    tsMs: ts(raw.ts_ms),
    uptimeS: int(raw.uptime_s, 0, 4_294_967),
    firmware: str(raw.firmware, 64),
    freeHeap: int(raw.free_heap, 0, 1_000_000_000),
  };
}

export function parseInfo(raw: unknown): InfoPayload | null {
  if (!isObj(raw)) return null;
  const caps = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((c): c is string => typeof c === 'string' && c.length <= 32).slice(0, 16)
    : undefined;
  return { firmware: str(raw.firmware, 64), imuFs: int(raw.imu_fs, 1, 10_000), capabilities: caps };
}

export function parseSms(raw: unknown): SmsPayload | null {
  if (!isObj(raw)) return null;
  const phone = str(raw.phone, 20);
  if (!phone || (raw.status !== 'success' && raw.status !== 'failed')) return null;
  return { phone, success: raw.status === 'success', tsMs: ts(raw.ts_ms) };
}

export function parseCmdResp(raw: unknown): CmdRespPayload | null {
  if (!isObj(raw)) return null;
  const action = str(raw.action, 32);
  const status = str(raw.status, 32);
  if (!action || !status) return null;
  return { action, status, tsMs: ts(raw.ts_ms) };
}
