/**
 * Giả lập ESP32 để thử BE mà không cần phần cứng.
 * Bắt chước đúng định dạng payload và hành vi của firmware (comms.cpp):
 *   - publish status online (retained) + info + heartbeat định kỳ, LWT offline
 *   - nhận config/emergency_contacts và command, phản hồi cmd/resp như firmware
 *   - gửi event FALL / HELP_REQUEST / FALL_CANCEL / LOCATION_UPDATE (+ bản legacy alert/* như firmware)
 *
 * Chạy:  npm run simulate      (đọc DEVICE_ID, MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD từ .env)
 */
import 'dotenv/config';
import * as readline from 'readline';
import { connect } from 'mqtt';
import { buildTopics } from '../src/mqtt/topics';
import { PHONE_REGEX } from '../src/common/phone.util';

const DEVICE_ID = process.env.DEVICE_ID ?? '';
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const HB_SECONDS = Number(process.env.SIM_HEARTBEAT_S ?? 30);
const MAX_CONTACTS = 5;

const topics = buildTopics(DEVICE_ID);
const statusTopic = `device/${DEVICE_ID}/status`;

// ---------------------------------------------------------------- trạng thái thiết bị giả
let bootAt = Date.now();
let contacts: string[] = [];
let signal = 20;
let imuOk = true;
let gpsMode: 'on' | 'old' | 'off' = 'on';
let clockSynced = true;
let heartbeatsOn = true;
let legacyOn = true;
const LAST = { lat: 21.028511, lon: 105.804817 };

const tsMs = () => (clockSynced ? Date.now() : 0);
const uptimeS = () => Math.floor((Date.now() - bootAt) / 1000);

const client = connect(MQTT_URL, {
  clientId: `sim-${DEVICE_ID}`,
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clean: true,
  keepalive: 20,
  will: {
    topic: statusTopic,
    payload: JSON.stringify({ device_id: DEVICE_ID, status: 'offline' }),
    qos: 1,
    retain: true,
  },
});

function pub(topic: string, obj: unknown, retain = false): void {
  client.publish(topic, JSON.stringify(obj), { qos: 0, retain });
  console.log(`  -> ${topic}${retain ? ' (retain)' : ''} ${JSON.stringify(obj)}`);
}

function gpsBlock() {
  if (gpsMode === 'off') return { valid: false, lat: 0, lon: 0, sat: 0, age_s: 0 };
  if (gpsMode === 'old') return { valid: false, lat: LAST.lat, lon: LAST.lon, sat: 0, age_s: 120 };
  return { valid: true, lat: LAST.lat, lon: LAST.lon, sat: 8, age_s: 2 };
}

const pubStatusOnline = () =>
  pub(statusTopic, {
    device_id: DEVICE_ID,
    ts_ms: tsMs(),
    status: 'online',
    uptime_s: uptimeS(),
    firmware: 'v2.0.0-sim',
    free_heap: 180000,
  }, true);

const pubInfo = () =>
  pub(`device/${DEVICE_ID}/info`, {
    device_id: DEVICE_ID,
    firmware: 'v2.0.0-sim',
    imu_fs: 200,
    capabilities: ['imu', 'fall_ml', 'gps', 'sms_4g', 'sos_button'],
  }, true);

const pubHeartbeat = () =>
  pub(`v2/device/${DEVICE_ID}/heartbeat`, {
    ts_ms: tsMs(),
    status: 'ONLINE',
    signal,
    imu_ok: imuOk,
    gps_fix: gpsMode === 'on',
    contacts: contacts.length,
    heap: 180000,
  });

function pubEvent(type: string, confidence: number): void {
  pub(`v2/device/${DEVICE_ID}/event`, { ts_ms: tsMs(), type, confidence, gps: gpsBlock() });
  if (!legacyOn) return;
  // Firmware cũng publish bản legacy; BE KHÔNG được xử lý chúng (tránh cảnh báo trùng)
  if (type === 'FALL') pub(`device/${DEVICE_ID}/alert/fall`, { device_id: DEVICE_ID, ts_ms: tsMs(), event: 'fall', confidence });
  if (type === 'HELP_REQUEST') pub(`device/${DEVICE_ID}/alert/help`, { device_id: DEVICE_ID, ts_ms: tsMs(), event: 'help_request' });
  if (type === 'FALL_CANCEL') pub(`device/${DEVICE_ID}/alert/fall_cancel`, { device_id: DEVICE_ID, ts_ms: tsMs(), event: 'fall_cancel' });
}

const pubSms = (phone: string, ok: boolean) =>
  pub(`v2/device/${DEVICE_ID}/status/sms`, { phone, status: ok ? 'success' : 'failed', ts_ms: tsMs() });

const pubCmdResp = (action: string, status: string) =>
  pub(`device/${DEVICE_ID}/cmd/resp`, { device_id: DEVICE_ID, action, status, ts_ms: tsMs() });

/** Như firmware: gửi SMS cho từng số sau khi publish event. */
function smsToAll(ok: boolean): void {
  if (contacts.length === 0) {
    console.log('  (thiết bị chưa có số khẩn cấp nên KHÔNG gửi SMS — giống firmware)');
    return;
  }
  contacts.forEach((p, i) => setTimeout(() => pubSms(p, ok), 1500 + i * 1000));
}

function simulateReboot(): void {
  console.log('  (giả lập reboot...)');
  heartbeatsOn = false;
  setTimeout(() => {
    bootAt = Date.now();
    pubStatusOnline();
    pubInfo();
    heartbeatsOn = true;
  }, 2000);
}

// ---------------------------------------------------------------- nhận lệnh từ BE
client.on('connect', () => {
  console.log(`Đã kết nối ${MQTT_URL} với tư cách ${DEVICE_ID}`);
  client.subscribe([topics.commandTopic, topics.contactsConfigTopic], { qos: 1 });
  pubStatusOnline();
  pubInfo();
  pubHeartbeat();
  help();
});
client.on('error', (e: Error) => console.error('MQTT lỗi:', e.message));

client.on('message', (topic: string, payload: Buffer, packet: { retain?: boolean }) => {
  console.log(`<- ${topic}${packet.retain ? ' (retained)' : ''} ${payload.toString()}`);
  let json: any;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    return;
  }

  if (topic === topics.contactsConfigTopic) {
    // Như firmware: kiểm tra từng số, bỏ trùng, tối đa 5; không có số hợp lệ thì từ chối
    const valid: string[] = [];
    for (const p of Array.isArray(json?.contacts) ? json.contacts : []) {
      if (typeof p === 'string' && PHONE_REGEX.test(p) && !valid.includes(p)) valid.push(p);
      if (valid.length >= MAX_CONTACTS) break;
    }
    if (valid.length > 0) {
      contacts = valid;
      pubCmdResp('set_contacts', 'ok');
    } else {
      pubCmdResp('set_contacts', 'rejected');
    }
    return;
  }

  const action = json?.action;
  if (action === 'reboot') {
    pubCmdResp('reboot', 'accepted');
    simulateReboot();
  } else if (action === 'request_location') {
    pubEvent('LOCATION_UPDATE', 0);
  } else if (action === 'get_status') {
    pubStatusOnline();
    pubHeartbeat();
  }
});

setInterval(() => {
  if (client.connected && heartbeatsOn) pubHeartbeat();
}, HB_SECONDS * 1000);

// ---------------------------------------------------------------- dòng lệnh
function help(): void {
  console.log(`
Lệnh:
  fall [0-1]        gửi FALL (độ tin cậy, mặc định 0.93) + SMS tới các số đang giữ
  sos               gửi HELP_REQUEST + SMS
  cancel            gửi FALL_CANCEL (người đeo hủy)
  loc               gửi LOCATION_UPDATE
  sms <số> ok|fail  gửi một kết quả SMS thủ công
  hb                gửi heartbeat ngay
  hb off|on         ngừng/tiếp tục heartbeat (thử watchdog offline)
  signal <0-99>     đặt CSQ (99 = không rõ)
  imu ok|bad        đặt imu_ok
  gps on|old|off    fix mới / fix cũ / chưa từng có fix
  clock on|off      có/không có giờ GPS (off => ts_ms = 0)
  legacy on|off     có/không publish alert/* legacy kèm event
  contacts          in số khẩn cấp thiết bị đang giữ
  reboot            giả lập reboot
  kill              ngắt đột ngột (kích hoạt LWT offline)
  quit              thoát bình thường
`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line: string) => {
  const [cmd, a, b] = line.trim().split(/\s+/);
  switch (cmd) {
    case 'fall': {
      const c = a !== undefined ? Number(a) : 0.93;
      pubEvent('FALL', Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.93);
      smsToAll(true);
      break;
    }
    case 'sos': pubEvent('HELP_REQUEST', 1); smsToAll(true); break;
    case 'cancel': pubEvent('FALL_CANCEL', 1); break;
    case 'loc': pubEvent('LOCATION_UPDATE', 0); break;
    case 'sms': if (a && (b === 'ok' || b === 'fail')) pubSms(a, b === 'ok'); else console.log('Dùng: sms <số> ok|fail'); break;
    case 'hb':
      if (a === 'off') heartbeatsOn = false;
      else if (a === 'on') heartbeatsOn = true;
      else pubHeartbeat();
      break;
    case 'signal': signal = Math.max(0, Math.min(99, Number(a) || 0)); console.log(`signal=${signal}`); break;
    case 'imu': imuOk = a !== 'bad'; console.log(`imu_ok=${imuOk}`); break;
    case 'gps': if (a === 'on' || a === 'old' || a === 'off') gpsMode = a; console.log(`gps=${gpsMode}`); break;
    case 'clock': clockSynced = a !== 'off'; console.log(`clock=${clockSynced}`); break;
    case 'legacy': legacyOn = a !== 'off'; console.log(`legacy=${legacyOn}`); break;
    case 'contacts': console.log(contacts.length ? contacts.join(', ') : '(chưa có số nào)'); break;
    case 'reboot': simulateReboot(); break;
    case 'kill': console.log('Ngắt đột ngột...'); client.end(true, () => process.exit(0)); break;
    case 'quit': client.end(false, {}, () => process.exit(0)); break;
    case 'help': case '?': help(); break;
    case '': break;
    default: console.log('Lệnh không rõ. Gõ "help".');
  }
});
