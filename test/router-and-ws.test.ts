import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { EVT } from '../src/common/events';
import { MqttRouterService } from '../src/mqtt/mqtt-router.service';
import { extractToken } from '../src/realtime/extract-token';
import { FakeEmitter, fakeConfig, ID } from './helpers/fake-prisma';

Logger.overrideLogger(false);

const mk = () => {
  const emitter = new FakeEmitter();
  const router = new MqttRouterService(fakeConfig(), emitter as any);
  return { emitter, router };
};
const buf = (s: string) => Buffer.from(s);

test('định tuyến đủ 6 loại bản tin theo topic, kèm receivedAt và cờ retained', () => {
  const { emitter, router } = mk();
  router.route(`v2/device/${ID}/event`, buf('{"ts_ms":0,"type":"FALL","confidence":0.9}'), false);
  router.route(`v2/device/${ID}/heartbeat`, buf('{"ts_ms":0,"status":"ONLINE","signal":18,"imu_ok":true,"gps_fix":true,"contacts":2,"heap":1}'), false);
  router.route(`v2/device/${ID}/status/sms`, buf('{"phone":"+84901234567","status":"success","ts_ms":0}'), false);
  router.route(`device/${ID}/status`, buf('{"device_id":"x","ts_ms":0,"status":"online","uptime_s":5}'), true);
  router.route(`device/${ID}/info`, buf('{"firmware":"v2"}'), true);
  router.route(`device/${ID}/cmd/resp`, buf('{"action":"reboot","status":"accepted","ts_ms":0}'), false);

  assert.deepEqual(emitter.events.map((e) => e.name), [
    EVT.DEVICE_EVENT, EVT.HEARTBEAT, EVT.SMS, EVT.STATUS, EVT.INFO, EVT.CMD_RESP,
  ]);
  assert.ok(emitter.events.every((e) => e.payload.receivedAt instanceof Date));
  assert.equal(emitter.events[3].payload.retained, true);
  assert.equal(emitter.events[0].payload.retained, false);
  assert.equal(emitter.events[0].payload.payload.type, 'FALL');
});

test('event RETAINED bị bỏ qua (cảnh báo không bao giờ retain)', () => {
  const { emitter, router } = mk();
  router.route(`v2/device/${ID}/event`, buf('{"type":"FALL"}'), true);
  assert.equal(emitter.events.length, 0);
});

test('payload hỏng / sai định dạng / topic lạ / bản legacy alert/* đều không phát sự kiện', () => {
  const { emitter, router } = mk();
  router.route(`v2/device/${ID}/event`, buf('{oops'), false);
  router.route(`v2/device/${ID}/event`, buf('{"type":"EXPLODE"}'), false);
  router.route(`v2/device/${ID}/heartbeat`, buf('[1]'), false);
  router.route(`v2/device/${ID}/status/sms`, buf('{"status":"success"}'), false);
  router.route(`device/${ID}/status`, buf('{"status":"maybe"}'), false);
  router.route('v2/device/esp_000000000000/event', buf('{"type":"FALL"}'), false);
  router.route(`device/${ID}/alert/fall`, buf('{"event":"fall"}'), false); // legacy: KHÔNG được xử lý (tránh cảnh báo trùng)
  router.route(`v2/device/${ID}/event`, buf(''), false);
  assert.equal(emitter.events.length, 0);
});

test('danh sách subscribe của router đúng 6 topic', () => {
  assert.equal(mk().router.subscriptions.length, 6);
});

test('extractToken: ưu tiên auth.token, rồi header Bearer; còn lại null', () => {
  assert.equal(extractToken({ handshake: { auth: { token: 'abc' }, headers: {} } }), 'abc');
  assert.equal(extractToken({ handshake: { auth: { token: 'abc' }, headers: { authorization: 'Bearer zzz' } } }), 'abc');
  assert.equal(extractToken({ handshake: { auth: {}, headers: { authorization: 'Bearer zzz' } } }), 'zzz');
  assert.equal(extractToken({ handshake: { auth: {}, headers: { authorization: 'Basic zzz' } } }), null);
  assert.equal(extractToken({ handshake: { auth: { token: '' }, headers: {} } }), null);
  assert.equal(extractToken({ handshake: {} }), null);
  assert.equal(extractToken({ handshake: { auth: { token: 123 }, headers: {} } }), null);
});
