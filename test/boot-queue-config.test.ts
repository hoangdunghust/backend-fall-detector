import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBootAt, isNewBoot } from '../src/device/boot-detect';
import { SerialQueue } from '../src/common/serial-queue';
import { checkDatabaseUrls, ConfigError, loadConfig } from '../src/config/app-config';

test('kết nối lại MQTT không reboot: mốc khởi động gần như không đổi', () => {
  const t0 = new Date('2026-06-01T10:00:00Z');
  const boot1 = estimateBootAt(t0, 120);
  // 1 giờ sau, thiết bị rớt mạng rồi nối lại, uptime tăng tương ứng, lệch 2s do độ trễ mạng
  const t1 = new Date(t0.getTime() + 3600_000 + 2000);
  const boot2 = estimateBootAt(t1, 120 + 3600);
  assert.equal(isNewBoot(boot1, boot2), false);
});

test('reboot: uptime nhỏ lại => mốc khởi động dịch chuyển', () => {
  const boot1 = estimateBootAt(new Date('2026-06-01T10:00:00Z'), 120);
  const boot2 = estimateBootAt(new Date('2026-06-01T12:00:00Z'), 15);
  assert.equal(isNewBoot(boot1, boot2), true);
});

test('lần đầu (chưa có mốc cũ) không tính là reboot', () => {
  assert.equal(isNewBoot(null, new Date()), false);
});

test('SerialQueue chạy tuần tự đúng thứ tự dù tác vụ đầu chậm hơn', async () => {
  const q = new SerialQueue();
  const order: number[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const a = q.run(async () => { await sleep(30); order.push(1); });
  const b = q.run(async () => { order.push(2); });
  const c = q.run(async () => { await sleep(5); order.push(3); });
  await Promise.all([a, b, c]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('SerialQueue: lỗi của một tác vụ không chặn các tác vụ sau', async () => {
  const q = new SerialQueue();
  const a = q.run(async () => { throw new Error('boom'); });
  const b = q.run(async () => 42);
  await assert.rejects(a, /boom/);
  assert.equal(await b, 42);
});

// ---------------------------------------------------------------- config
const FAKE_HASH = '$2a$12$' + 'a'.repeat(53);
const goodEnv = () => ({
  DEVICE_ID: 'esp_a1b2c3d4e5f6',
  DATABASE_URL: 'postgresql://fall:pw@localhost:5432/fall?schema=public',
  MQTT_URL: 'mqtts://broker.example.com:8883',
  AUTH_USERNAME: 'admin',
  AUTH_PASSWORD_HASH_B64: Buffer.from(FAKE_HASH).toString('base64'),
  JWT_SECRET: 'x'.repeat(40),
});

test('cấu hình hợp lệ + giá trị mặc định', () => {
  const c = loadConfig(goodEnv());
  assert.equal(c.port, 3000);
  assert.equal(c.notify.provider, 'console');
  assert.equal(c.watchdog.heartbeatTimeoutS, 90);
  assert.equal(c.dedupeWindowS, 8);
  assert.equal(c.auth.passwordHash, FAKE_HASH);
  assert.equal(c.auth.jwtExpiresIn, '30d');
  assert.match(c.mqtt.clientId, /^fall-be-/);
  assert.deepEqual(c.corsOrigins, []);
});

test('thiếu biến bắt buộc: báo lỗi đầy đủ một lần', () => {
  assert.throws(
    () => loadConfig({}),
    (e: unknown) =>
      e instanceof ConfigError &&
      /DEVICE_ID/.test(e.message) &&
      /DATABASE_URL/.test(e.message) &&
      /MQTT_URL/.test(e.message) &&
      /JWT_SECRET/.test(e.message) &&
      /AUTH_PASSWORD_HASH_B64/.test(e.message),
  );
});

test('từ chối giá trị yếu hoặc sai định dạng', () => {
  assert.throws(() => loadConfig({ ...goodEnv(), JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ ...goodEnv(), DEVICE_ID: 'esp_XYZ' }), /DEVICE_ID/);
  assert.throws(() => loadConfig({ ...goodEnv(), MQTT_URL: 'http://x' }), /MQTT_URL/);
  assert.throws(() => loadConfig({ ...goodEnv(), AUTH_PASSWORD_HASH_B64: Buffer.from('plaintext').toString('base64') }), /bcrypt/);
  assert.throws(() => loadConfig({ ...goodEnv(), PORT: '99999' }), /PORT/);
  assert.throws(() => loadConfig({ ...goodEnv(), HEARTBEAT_TIMEOUT_S: '10' }), /HEARTBEAT_TIMEOUT_S/);
});

test('fcm cần thông tin service account', () => {
  assert.throws(() => loadConfig({ ...goodEnv(), NOTIFY_PROVIDER: 'fcm' }), /FIREBASE/);
  const c = loadConfig({ ...goodEnv(), NOTIFY_PROVIDER: 'FCM', FIREBASE_SERVICE_ACCOUNT_PATH: '/x.json' });
  assert.equal(c.notify.provider, 'fcm');
  assert.throws(() => loadConfig({ ...goodEnv(), NOTIFY_PROVIDER: 'sms' }), /NOTIFY_PROVIDER/);
});

test('CORS_ORIGINS và TRUST_PROXY', () => {
  const c = loadConfig({ ...goodEnv(), CORS_ORIGINS: 'https://a.com, https://b.com ,', TRUST_PROXY: 'true' });
  assert.deepEqual(c.corsOrigins, ['https://a.com', 'https://b.com']);
  assert.equal(c.trustProxy, true);
});

// ---------------------------------------------------------------- chuỗi kết nối DB / Supabase
const REF = 'abcdefghijklmnop';
const POOLED = `postgresql://postgres.${REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const SESSION = `postgresql://postgres.${REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const DIRECT = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;

test('chuỗi kết nối Supabase đúng chuẩn được chấp nhận', () => {
  assert.deepEqual(checkDatabaseUrls(POOLED, SESSION), []);
  assert.deepEqual(checkDatabaseUrls(POOLED, DIRECT), []);
  assert.deepEqual(checkDatabaseUrls(SESSION), []); // session pooler không cần pgbouncer
  assert.deepEqual(checkDatabaseUrls(DIRECT), []);
  assert.deepEqual(checkDatabaseUrls('postgresql://fall:pw@localhost:5432/fall?schema=public'), []);
  assert.deepEqual(checkDatabaseUrls('postgres://u:p@db:5432/x'), []);
});

test('thiếu pgbouncer=true trên pooler 6543 bị bắt', () => {
  const errs = checkDatabaseUrls(POOLED.replace('?pgbouncer=true', ''));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /pgbouncer=true/);
});

test('pooler mà dùng user "postgres" trơn bị bắt', () => {
  const errs = checkDatabaseUrls(POOLED.replace(`postgres.${REF}`, 'postgres'));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /postgres\.<project-ref>/);
});

test('DIRECT_URL dùng cổng 6543 bị bắt', () => {
  const errs = checkDatabaseUrls(POOLED, POOLED);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /DIRECT_URL/);
});

test('URL sai định dạng / sai giao thức / mật khẩu có ký tự đặc biệt chưa mã hóa', () => {
  assert.match(checkDatabaseUrls('mysql://u:p@h:3306/x')[0], /postgresql/);
  assert.match(checkDatabaseUrls('không phải url')[0], /URL hợp lệ/);
  // '/' trong mật khẩu làm hỏng phần cổng => bắt được
  assert.match(checkDatabaseUrls('postgresql://u:pa/ss@host:5432/x')[0], /URL hợp lệ/);
  // Mật khẩu mã hóa đúng thì chấp nhận
  assert.deepEqual(checkDatabaseUrls('postgresql://u:pa%2Fss%40x@host:5432/x'), []);
  // Giới hạn đã biết: '@' hoặc '#' chưa mã hóa vẫn phân tích được (sai máy chủ) nên KHÔNG phát hiện được ở đây.
});

test('loadConfig gom lỗi DB cùng các lỗi khác và lưu directUrl', () => {
  const c = loadConfig({ ...goodEnv(), DATABASE_URL: POOLED, DIRECT_URL: SESSION });
  assert.equal(c.database.url, POOLED);
  assert.equal(c.database.directUrl, SESSION);
  assert.throws(
    () => loadConfig({ ...goodEnv(), DATABASE_URL: POOLED.replace('?pgbouncer=true', ''), JWT_SECRET: 'x' }),
    (e: unknown) => e instanceof ConfigError && /pgbouncer/.test(e.message) && /JWT_SECRET/.test(e.message),
  );
});
