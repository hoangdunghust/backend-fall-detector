import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import {
  buildExpoMessage, chunk, EXPO_PUSH_URL, ExpoPushProvider, interpretTickets, isExpoPushToken,
} from '../src/notifications/providers/expo.provider';
import { loadConfig } from '../src/config/app-config';

Logger.overrideLogger(false);

const tok = (i: number | string) => `ExponentPushToken[abcdefghijklmnopqrstu${i}]`;
const alert = { level: 'ALERT' as const, title: 'Té ngã', body: 'b', data: { kind: 'INCIDENT', incidentId: 'x' } };

type Sent = { url: string; init: any; body: any[] };
function fakeFetch(respond: (body: any[], n: number) => { status?: number; json?: unknown; text?: string }) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ url, init, body });
    const r = respond(body, sent.length);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}
const allOk = (body: any[]) => ({ json: { data: body.map((_, i) => ({ status: 'ok', id: `t${i}` })) } });

test('nhận diện định dạng Expo push token', () => {
  assert.equal(isExpoPushToken('ExponentPushToken[abc123_-XYZ]'), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abc123]'), true);
  assert.equal(isExpoPushToken('fcm-token-dài-không-phải-expo'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[]'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[a b]'), false);
  assert.equal(isExpoPushToken(' ExponentPushToken[abc]'), false);
});

test('tin ALERT: ưu tiên cao, kênh alerts, time-sensitive, hết hạn sau 1 giờ', () => {
  const m = buildExpoMessage(tok(1), alert);
  assert.deepEqual(m, {
    to: tok(1), title: 'Té ngã', body: 'b', data: { kind: 'INCIDENT', incidentId: 'x' },
    sound: 'default', priority: 'high', channelId: 'alerts', ttl: 3600, interruptionLevel: 'time-sensitive',
  });
});

test('WARNING và INFO dùng đúng kênh/ưu tiên; thiếu data thành {}', () => {
  const w = buildExpoMessage(tok(1), { level: 'WARNING', title: 't', body: 'b' });
  assert.equal(w.channelId, 'warnings');
  assert.equal(w.priority, 'high');
  assert.equal(w.interruptionLevel, 'active');
  assert.deepEqual(w.data, {});
  const i = buildExpoMessage(tok(1), { level: 'INFO', title: 't', body: 'b' });
  assert.equal(i.channelId, 'info');
  assert.equal(i.priority, 'default');
  assert.equal(i.ttl, 6 * 3600);
});

test('chunk chia lô đúng', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});

test('interpretTickets: ok, DeviceNotRegistered, lỗi khác, và phản hồi sai hình dạng', () => {
  const r = interpretTickets({ data: [
    { status: 'ok', id: 'a' },
    { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'quá lớn', details: { error: 'MessageTooBig' } },
    { status: 'error', message: 'không rõ chi tiết' },
  ] }, 4);
  assert.deepEqual(r.map((x) => [x.ok, x.invalid]), [[true, false], [false, true], [false, false], [false, false]]);
  assert.equal(r[3].error, 'không rõ chi tiết');
  for (const bad of [undefined, null, 'x', {}, { data: 'x' }, { data: [{ status: 'ok' }] }]) {
    const o = interpretTickets(bad, 2);
    assert.equal(o.length, 2);
    assert.ok(o.every((x) => !x.ok && !x.invalid), 'lệch/sai hình dạng không được xóa token');
  }
});

test('gửi: đúng URL/headers/body; không có Authorization khi chưa cấu hình access token', async () => {
  const { fetchImpl, sent } = fakeFetch(allOk);
  const res = await new ExpoPushProvider({ fetchImpl }).send([tok(1), tok(2)], alert);
  assert.deepEqual(res.invalidTokens, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, EXPO_PUSH_URL);
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers['Content-Type'], 'application/json');
  assert.equal(sent[0].init.headers.Authorization, undefined);
  assert.deepEqual(sent[0].body.map((m: any) => m.to), [tok(1), tok(2)]);
  assert.equal(sent[0].body[0].channelId, 'alerts');
});

test('có access token thì gửi Authorization: Bearer', async () => {
  const { fetchImpl, sent } = fakeFetch(allOk);
  await new ExpoPushProvider({ fetchImpl, accessToken: 'secret' }).send([tok(1)], alert);
  assert.equal(sent[0].init.headers.Authorization, 'Bearer secret');
});

test('250 token => 3 request (100/100/50), giữ nguyên thứ tự', async () => {
  const tokens = Array.from({ length: 250 }, (_, i) => tok(i));
  const { fetchImpl, sent } = fakeFetch(allOk);
  await new ExpoPushProvider({ fetchImpl }).send(tokens, alert);
  assert.deepEqual(sent.map((s) => s.body.length), [100, 100, 50]);
  assert.equal(sent[2].body[0].to, tok(200));
});

test('DeviceNotRegistered => token bị báo hết hạn đúng vị trí trong lô', async () => {
  const { fetchImpl } = fakeFetch((body) => ({
    json: { data: body.map((_: any, i: number) => (i === 1
      ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok', id: String(i) })) },
  }));
  const res = await new ExpoPushProvider({ fetchImpl }).send([tok(1), tok(2), tok(3)], alert);
  assert.deepEqual(res.invalidTokens, [tok(2)]);
});

test('token không phải Expo: không gửi, báo hết hạn; nếu không còn token hợp lệ thì không gọi mạng', async () => {
  const { fetchImpl, sent } = fakeFetch(allOk);
  const res = await new ExpoPushProvider({ fetchImpl }).send(['fcm-token-cũ', tok(1)], alert);
  assert.deepEqual(res.invalidTokens, ['fcm-token-cũ']);
  assert.deepEqual(sent[0].body.map((m: any) => m.to), [tok(1)]);

  const none = fakeFetch(allOk);
  const r2 = await new ExpoPushProvider({ fetchImpl: none.fetchImpl }).send(['x', 'y'], alert);
  assert.deepEqual(r2.invalidTokens, ['x', 'y']);
  assert.equal(none.sent.length, 0);
});

test('lỗi HTTP: ném lỗi kèm thông điệp, không báo token hết hạn', async () => {
  const bad = fakeFetch(() => ({ status: 400, json: { errors: [{ code: 'VALIDATION_ERROR', message: 'sai định dạng' }] } }));
  await assert.rejects(new ExpoPushProvider({ fetchImpl: bad.fetchImpl }).send([tok(1)], alert), /HTTP 400.*sai định dạng/);
  const html = fakeFetch(() => ({ status: 502, text: '<html>Bad Gateway</html>' }));
  await assert.rejects(new ExpoPushProvider({ fetchImpl: html.fetchImpl }).send([tok(1)], alert), /HTTP 502/);
});

test('phản hồi 200 nhưng sai hình dạng: không xóa token', async () => {
  const { fetchImpl } = fakeFetch(() => ({ json: { data: [] } }));
  const res = await new ExpoPushProvider({ fetchImpl }).send([tok(1), tok(2)], alert);
  assert.deepEqual(res.invalidTokens, []);
});

test('mất mạng: ném lỗi (NotificationsService sẽ bắt và ghi log)', async () => {
  const fetchImpl = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  await assert.rejects(new ExpoPushProvider({ fetchImpl }).send([tok(1)], alert), /fetch failed/);
});

const BASE = {
  DEVICE_ID: 'esp_a1b2c3d4e5f6', DATABASE_URL: 'postgresql://u:p@localhost:5432/x', MQTT_URL: 'mqtt://localhost',
  AUTH_USERNAME: 'a', AUTH_PASSWORD_HASH_B64: Buffer.from('$2a$12$' + 'a'.repeat(53)).toString('base64'), JWT_SECRET: 'x'.repeat(40),
};
test('cấu hình NOTIFY_PROVIDER=expo: không cần thông tin Firebase, access token tùy chọn', () => {
  const c = loadConfig({ ...BASE, NOTIFY_PROVIDER: 'expo' });
  assert.equal(c.notify.provider, 'expo');
  assert.equal(c.notify.expoAccessToken, undefined);
  assert.equal(loadConfig({ ...BASE, NOTIFY_PROVIDER: 'EXPO', EXPO_ACCESS_TOKEN: 'abc' }).notify.expoAccessToken, 'abc');
  assert.throws(() => loadConfig({ ...BASE, NOTIFY_PROVIDER: 'sms' }), /console, expo hoặc fcm/);
});
