import { DEVICE_ID_REGEX } from '../mqtt/topics';

export interface AppConfig {
  port: number;
  trustProxy: boolean;
  corsOrigins: string[];
  deviceId: string;
  database: { url: string; directUrl?: string };
  mqtt: {
    url: string;
    username?: string;
    password?: string;
    clientId: string;
    caPath?: string;
  };
  auth: {
    username: string;
    passwordHash: string;
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  notify: {
    provider: 'console' | 'fcm' | 'expo';
    expoAccessToken?: string;
    firebaseServiceAccountPath?: string;
    firebaseServiceAccountJson?: string;
  };
  watchdog: {
    heartbeatTimeoutS: number;
    weakSignalCsq: number;
    weakSignalReadings: number;
    alertCooldownMin: number;
  };
  dedupeWindowS: number;
  retention: { healthDays: number; locationDays: number };
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

/**
 * Kiểm tra chuỗi kết nối DB để bắt sớm các lỗi cấu hình hay gặp với Supabase
 * (thay vì để Prisma báo lỗi khó hiểu khi truy vấn đầu tiên).
 */
export function checkDatabaseUrls(databaseUrl: string, directUrl?: string): string[] {
  const errors: string[] = [];

  const parse = (name: string, raw: string): URL | null => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
        errors.push(`${name} phải bắt đầu bằng postgresql:// hoặc postgres://`);
        return null;
      }
      if (!u.hostname) {
        errors.push(`${name} thiếu tên máy chủ`);
        return null;
      }
      return u;
    } catch {
      errors.push(`${name} không phải URL hợp lệ (mật khẩu chứa ký tự đặc biệt như @ : / # ? cần được URL-encode)`);
      return null;
    }
  };

  const isPooler = (u: URL): boolean => u.hostname.endsWith('.pooler.supabase.com');

  const db = parse('DATABASE_URL', databaseUrl);
  if (db && isPooler(db)) {
    if (!db.username.includes('.')) {
      errors.push('DATABASE_URL: với Supabase pooler, tên người dùng phải có dạng postgres.<project-ref> (không phải "postgres" trơn)');
    }
    if (db.port === '6543' && db.searchParams.get('pgbouncer') !== 'true') {
      errors.push('DATABASE_URL: pooler cổng 6543 (transaction mode) phải thêm ?pgbouncer=true, nếu không Prisma báo lỗi "prepared statement already exists"');
    }
  }

  if (directUrl) {
    const d = parse('DIRECT_URL', directUrl);
    if (d && d.port === '6543') {
      errors.push('DIRECT_URL không được dùng cổng 6543 (transaction pooler không chạy được migrate); dùng kết nối trực tiếp hoặc session pooler cổng 5432');
    }
  }
  return errors;
}

function intVar(env: Env, key: string, def: number, min: number, max: number, errors: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${key} phải là số nguyên trong khoảng [${min}, ${max}] (hiện là "${raw}")`);
    return def;
  }
  return n;
}

function required(env: Env, key: string, errors: string[]): string {
  const v = env[key]?.trim();
  if (!v) {
    errors.push(`${key} là bắt buộc`);
    return '';
  }
  return v;
}

function optional(env: Env, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: Env): AppConfig {
  const errors: string[] = [];

  const deviceId = required(env, 'DEVICE_ID', errors);
  if (deviceId && !DEVICE_ID_REGEX.test(deviceId)) {
    errors.push('DEVICE_ID phải có dạng esp_ + 12 ký tự hex thường (ví dụ esp_a1b2c3d4e5f6)');
  }

  const mqttUrl = required(env, 'MQTT_URL', errors);
  if (mqttUrl && !/^(mqtt|mqtts|ws|wss):\/\/.+/.test(mqttUrl)) {
    errors.push('MQTT_URL phải bắt đầu bằng mqtt://, mqtts://, ws:// hoặc wss://');
  }

  const databaseUrl = required(env, 'DATABASE_URL', errors);
  const directUrl = optional(env, 'DIRECT_URL');
  if (databaseUrl) errors.push(...checkDatabaseUrls(databaseUrl, directUrl));

  const authUsername = required(env, 'AUTH_USERNAME', errors);

  const hashB64 = required(env, 'AUTH_PASSWORD_HASH_B64', errors);
  let passwordHash = '';
  if (hashB64) {
    passwordHash = Buffer.from(hashB64, 'base64').toString('utf8');
    if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(passwordHash)) {
      errors.push('AUTH_PASSWORD_HASH_B64 không phải bcrypt hash hợp lệ (tạo bằng: npm run hash-password -- "mật khẩu")');
    }
  }

  const jwtSecret = required(env, 'JWT_SECRET', errors);
  if (jwtSecret && jwtSecret.length < 32) {
    errors.push('JWT_SECRET phải dài tối thiểu 32 ký tự');
  }

  const provider = (env.NOTIFY_PROVIDER ?? 'console').trim().toLowerCase();
  if (provider !== 'console' && provider !== 'fcm' && provider !== 'expo') {
    errors.push('NOTIFY_PROVIDER chỉ nhận console, expo hoặc fcm');
  }
  const fcmPath = optional(env, 'FIREBASE_SERVICE_ACCOUNT_PATH');
  const fcmJson = optional(env, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  if (provider === 'fcm' && !fcmPath && !fcmJson) {
    errors.push('NOTIFY_PROVIDER=fcm cần FIREBASE_SERVICE_ACCOUNT_PATH hoặc FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  const cfg: AppConfig = {
    port: intVar(env, 'PORT', 3000, 1, 65535, errors),
    trustProxy: (env.TRUST_PROXY ?? 'false').trim().toLowerCase() === 'true',
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    deviceId,
    database: { url: databaseUrl, directUrl },
    mqtt: {
      url: mqttUrl,
      username: optional(env, 'MQTT_USERNAME'),
      password: optional(env, 'MQTT_PASSWORD'),
      clientId: optional(env, 'MQTT_CLIENT_ID') ?? `fall-be-${Math.random().toString(16).slice(2, 10)}`,
      caPath: optional(env, 'MQTT_CA_PATH'),
    },
    auth: {
      username: authUsername,
      passwordHash,
      jwtSecret,
      jwtExpiresIn: optional(env, 'JWT_EXPIRES_IN') ?? '30d',
    },
    notify: {
      provider: provider === 'fcm' ? 'fcm' : provider === 'expo' ? 'expo' : 'console',
      expoAccessToken: optional(env, 'EXPO_ACCESS_TOKEN'),
      firebaseServiceAccountPath: fcmPath,
      firebaseServiceAccountJson: fcmJson,
    },
    watchdog: {
      heartbeatTimeoutS: intVar(env, 'HEARTBEAT_TIMEOUT_S', 90, 35, 3600, errors),
      weakSignalCsq: intVar(env, 'WEAK_SIGNAL_CSQ', 5, 0, 31, errors),
      weakSignalReadings: intVar(env, 'WEAK_SIGNAL_READINGS', 3, 1, 100, errors),
      alertCooldownMin: intVar(env, 'ALERT_COOLDOWN_MIN', 360, 1, 10080, errors),
    },
    dedupeWindowS: intVar(env, 'DEDUPE_WINDOW_S', 8, 0, 300, errors),
    retention: {
      healthDays: intVar(env, 'HEALTH_RETENTION_DAYS', 30, 1, 3650, errors),
      locationDays: intVar(env, 'LOCATION_RETENTION_DAYS', 90, 1, 3650, errors),
    },
  };

  if (errors.length > 0) {
    throw new ConfigError('Cấu hình không hợp lệ:\n - ' + errors.join('\n - '));
  }
  return cfg;
}
