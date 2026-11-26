import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HEALTH_RULES, HealthTracker } from '../src/watchdog/health-rules';

const MIN = 60_000;
const hb = (o: Record<string, unknown>) => ({ tsMs: 0, ...o }) as any;

test('IMU lỗi: cảnh báo ở lần liên tiếp thứ 2, không lặp lại', () => {
  const t = new HealthTracker();
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 0), []);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 30_000), ['IMU_FAULT']);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 60_000), []);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 90_000), []);
});

test('một lần lỗi thoáng qua không cảnh báo', () => {
  const t = new HealthTracker();
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 0), []);
  assert.deepEqual(t.evaluate(hb({ imuOk: true }), 30_000), []);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 60_000), []); // streak đã reset
});

test('nhắc lại sau cooldown nếu vẫn còn lỗi', () => {
  const t = new HealthTracker({ ...DEFAULT_HEALTH_RULES, cooldownMs: 10 * MIN });
  t.evaluate(hb({ imuOk: false }), 0);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 1000), ['IMU_FAULT']);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 5 * MIN), []);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 11 * MIN), ['IMU_FAULT']);
});

test('hết lỗi rồi lỗi lại thì cảnh báo ngay (không chờ cooldown)', () => {
  const t = new HealthTracker();
  t.evaluate(hb({ imuOk: false }), 0);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 1000), ['IMU_FAULT']);
  t.evaluate(hb({ imuOk: true }), 2000);
  t.evaluate(hb({ imuOk: false }), 3000);
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 4000), ['IMU_FAULT']);
});

test('sóng yếu: cần 3 lần liên tiếp; 99 cũng tính là yếu; CSQ cao thì không', () => {
  const t = new HealthTracker();
  assert.deepEqual(t.evaluate(hb({ signal: 4 }), 0), []);
  assert.deepEqual(t.evaluate(hb({ signal: 99 }), 1), []);
  assert.deepEqual(t.evaluate(hb({ signal: 5 }), 2), ['WEAK_SIGNAL']);
  const u = new HealthTracker();
  for (let i = 0; i < 10; i++) assert.deepEqual(u.evaluate(hb({ signal: 6 }), i), []);
});

test('99 thoáng qua (modem bận) xen kẽ giá trị tốt không cảnh báo', () => {
  const t = new HealthTracker();
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(t.evaluate(hb({ signal: i % 2 === 0 ? 99 : 18 }), i), []);
  }
});

test('chưa có số khẩn cấp: cần 4 heartbeat liên tiếp (chừa thời gian BE đồng bộ lại)', () => {
  const t = new HealthTracker();
  for (let i = 0; i < 3; i++) assert.deepEqual(t.evaluate(hb({ contacts: 0 }), i), []);
  assert.deepEqual(t.evaluate(hb({ contacts: 0 }), 3), ['NO_CONTACTS']);
});

test('trường vắng mặt không làm reset chuỗi và không gây cảnh báo', () => {
  const t = new HealthTracker();
  t.evaluate(hb({ imuOk: false }), 0);
  assert.deepEqual(t.evaluate(hb({ signal: 20 }), 1), []); // không có imuOk
  assert.deepEqual(t.evaluate(hb({ imuOk: false }), 2), ['IMU_FAULT']);
});

test('nhiều vấn đề cùng lúc', () => {
  const t = new HealthTracker({ ...DEFAULT_HEALTH_RULES, imuReadings: 1, weakReadings: 1, contactsReadings: 1 });
  assert.deepEqual(t.evaluate(hb({ imuOk: false, signal: 2, contacts: 0 }), 0).sort(), [
    'IMU_FAULT',
    'NO_CONTACTS',
    'WEAK_SIGNAL',
  ]);
});
