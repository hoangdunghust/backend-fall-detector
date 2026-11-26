import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopics, DEVICE_ID_REGEX } from '../src/mqtt/topics';

const ID = 'esp_a1b2c3d4e5f6';

test('subscribe đúng 6 topic cụ thể, không wildcard, không alert/* legacy', () => {
  const t = buildTopics(ID);
  assert.deepEqual(t.subscribe.sort(), [
    `device/${ID}/cmd/resp`,
    `device/${ID}/info`,
    `device/${ID}/status`,
    `v2/device/${ID}/event`,
    `v2/device/${ID}/heartbeat`,
    `v2/device/${ID}/status/sms`,
  ]);
  assert.ok(t.subscribe.every((s) => !s.includes('#') && !s.includes('+')));
  assert.ok(t.subscribe.every((s) => !s.includes('/alert/')));
});

test('phân loại topic', () => {
  const t = buildTopics(ID);
  assert.equal(t.kindOf(`v2/device/${ID}/event`), 'event');
  assert.equal(t.kindOf(`v2/device/${ID}/heartbeat`), 'heartbeat');
  assert.equal(t.kindOf(`v2/device/${ID}/status/sms`), 'sms');
  assert.equal(t.kindOf(`device/${ID}/status`), 'status');
  assert.equal(t.kindOf(`device/${ID}/info`), 'info');
  assert.equal(t.kindOf(`device/${ID}/cmd/resp`), 'cmdresp');
});

test('topic của thiết bị khác / lạ / khóa nguy hiểm đều bị bỏ qua', () => {
  const t = buildTopics(ID);
  assert.equal(t.kindOf('v2/device/esp_000000000000/event'), null);
  assert.equal(t.kindOf(`device/${ID}/alert/fall`), null);
  assert.equal(t.kindOf('constructor'), null);
  assert.equal(t.kindOf('__proto__'), null);
});

test('topic lệnh và cấu hình đúng hợp đồng', () => {
  const t = buildTopics(ID);
  assert.equal(t.commandTopic, `v2/device/${ID}/command`);
  assert.equal(t.contactsConfigTopic, `v2/device/${ID}/config/emergency_contacts`);
});

test('deviceId sai định dạng bị từ chối', () => {
  assert.throws(() => buildTopics('esp_XYZ'));
  assert.throws(() => buildTopics('esp_A1B2C3D4E5F6')); // phải là hex thường như firmware in ra
  assert.throws(() => buildTopics('x/../y'));
  assert.ok(DEVICE_ID_REGEX.test(ID));
});
