import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCmdResp,
  parseEvent,
  parseHeartbeat,
  parseInfo,
  parseJsonBuffer,
  parseSms,
  parseStatus,
} from '../src/mqtt/payloads';

// Các chuỗi dưới đây có đúng định dạng mà firmware sinh ra (snprintf trong comms.cpp)
const FALL =
  '{"ts_ms":1788962000000,"type":"FALL","confidence":0.930,"gps":{"valid":true,"lat":21.028511,"lon":105.804817,"sat":8,"age_s":3}}';
const SOS_NO_CLOCK_NO_GPS =
  '{"ts_ms":0,"type":"HELP_REQUEST","confidence":1.000,"gps":{"valid":false,"lat":0.000000,"lon":0.000000,"sat":0,"age_s":0}}';

const evt = (s: string) => parseEvent(parseJsonBuffer(s));

test('event FALL đầy đủ', () => {
  const p = evt(FALL)!;
  assert.equal(p.type, 'FALL');
  assert.equal(p.tsMs, 1788962000000);
  assert.equal(p.confidence, 0.93);
  assert.deepEqual(p.gps, { valid: true, lat: 21.028511, lon: 105.804817, sat: 8, ageS: 3 });
  assert.equal(p.eventId, undefined);
});

test('event khi chưa có giờ GPS (ts_ms=0) và chưa có fix', () => {
  const p = evt(SOS_NO_CLOCK_NO_GPS)!;
  assert.equal(p.type, 'HELP_REQUEST');
  assert.equal(p.tsMs, 0);
  assert.equal(p.gps?.valid, false);
  assert.equal(p.gps?.lat, 0);
});

test('event FALL_CANCEL và LOCATION_UPDATE', () => {
  assert.equal(evt('{"ts_ms":1,"type":"FALL_CANCEL","confidence":1.000}')?.type, 'FALL_CANCEL');
  assert.equal(evt('{"ts_ms":1,"type":"LOCATION_UPDATE","confidence":0.000}')?.confidence, 0);
});

test('event: event_id tùy chọn cho firmware tương lai', () => {
  assert.equal(evt('{"type":"FALL","event_id":"b12-7"}')?.eventId, 'b12-7');
});

test('event: loại lạ / thiếu type / không phải object bị từ chối', () => {
  assert.equal(evt('{"type":"EXPLODE"}'), null);
  assert.equal(evt('{"confidence":0.5}'), null);
  assert.equal(evt('[1,2,3]'), null);
  assert.equal(evt('"FALL"'), null);
  assert.equal(parseEvent(null), null);
});

test('event: dữ liệu bẩn bị loại bỏ thay vì làm hỏng', () => {
  const p = evt('{"type":"FALL","confidence":7,"gps":{"valid":true,"lat":999,"lon":10}}')!;
  assert.equal(p.confidence, undefined); // ngoài [0,1]
  assert.equal(p.gps, undefined); // lat ngoài khoảng
  const q = evt('{"type":"FALL","confidence":"high","gps":{"lat":"a","lon":"b"}}')!;
  assert.equal(q.confidence, undefined);
  assert.equal(q.gps, undefined);
});

test('heartbeat chuẩn', () => {
  const p = parseHeartbeat(
    parseJsonBuffer('{"ts_ms":0,"status":"ONLINE","signal":18,"imu_ok":true,"gps_fix":false,"contacts":2,"heap":183000}'),
  )!;
  assert.deepEqual(p, { tsMs: 0, signal: 18, imuOk: true, gpsFix: false, contacts: 2, heap: 183000 });
});

test('heartbeat: signal 99 hợp lệ, giá trị ngoài khoảng bị bỏ', () => {
  assert.equal(parseHeartbeat({ signal: 99 })!.signal, 99);
  assert.equal(parseHeartbeat({ signal: 100 })!.signal, undefined);
  assert.equal(parseHeartbeat({ signal: -1 })!.signal, undefined);
  assert.equal(parseHeartbeat({ contacts: 1.5 })!.contacts, undefined);
  assert.equal(parseHeartbeat('x'), null);
});

test('status online / LWT offline', () => {
  const on = parseStatus(
    parseJsonBuffer(
      '{"device_id":"esp_a1b2c3d4e5f6","ts_ms":0,"status":"online","uptime_s":120,"firmware":"v2.0.0-4g","free_heap":183000}',
    ),
  )!;
  assert.equal(on.status, 'online');
  assert.equal(on.uptimeS, 120);
  assert.equal(on.firmware, 'v2.0.0-4g');
  const off = parseStatus(parseJsonBuffer('{"device_id":"esp_a1b2c3d4e5f6","status":"offline"}'))!;
  assert.equal(off.status, 'offline');
  assert.equal(off.tsMs, null);
  assert.equal(parseStatus({ status: 'maybe' }), null);
  assert.equal(parseStatus({ status: 5 }), null);
});

test('info', () => {
  const p = parseInfo(
    parseJsonBuffer(
      '{"device_id":"esp_a1b2c3d4e5f6","firmware":"v2.0.0-4g","imu_fs":200,"capabilities":["imu","fall_ml","gps","sms_4g","sos_button"]}',
    ),
  )!;
  assert.equal(p.imuFs, 200);
  assert.deepEqual(p.capabilities, ['imu', 'fall_ml', 'gps', 'sms_4g', 'sos_button']);
});

test('sms status', () => {
  const ok = parseSms(parseJsonBuffer('{"phone":"+84901234567","status":"success","ts_ms":0}'))!;
  assert.deepEqual(ok, { phone: '+84901234567', success: true, tsMs: 0 });
  assert.equal(parseSms({ phone: '+84901234567', status: 'failed' })!.success, false);
  assert.equal(parseSms({ phone: '+84901234567', status: 'pending' }), null);
  assert.equal(parseSms({ status: 'success' }), null);
});

test('cmd/resp', () => {
  const p = parseCmdResp(
    parseJsonBuffer('{"device_id":"esp_a1b2c3d4e5f6","action":"set_contacts","status":"ok","ts_ms":0}'),
  )!;
  assert.equal(p.action, 'set_contacts');
  assert.equal(p.status, 'ok');
  assert.equal(parseCmdResp({ action: 'reboot' }), null);
});

test('parseJsonBuffer: JSON hỏng, rỗng, quá lớn, Buffer', () => {
  assert.equal(parseJsonBuffer('{oops'), null);
  assert.equal(parseJsonBuffer(''), null);
  assert.equal(parseJsonBuffer('x'.repeat(9000)), null);
  assert.deepEqual(parseJsonBuffer(Buffer.from('{"a":1}')), { a: 1 });
});
