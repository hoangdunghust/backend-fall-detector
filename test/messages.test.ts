import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncidentMessage,
  deviceBackOnlineMessage,
  deviceOfflineMessage,
  deviceRebootedMessage,
  healthMessage,
  HealthIssue,
  mapUrl,
  smsFailedMessage,
} from '../src/notifications/messages';

const base = { id: 'inc1', confidence: 0.93, lat: 21.028511, lon: 105.804817, gpsValid: true, gpsAgeS: 3 };

test('FALL có vị trí mới', () => {
  const m = buildIncidentMessage({ ...base, type: 'FALL' });
  assert.equal(m.level, 'ALERT');
  assert.match(m.title, /té ngã/);
  assert.match(m.body, /93%/);
  assert.match(m.body, /Vị trí: https:\/\/maps\.google\.com\/\?q=21\.028511,105\.804817/);
  assert.equal(m.data?.incidentId, 'inc1');
  assert.equal(m.data?.incidentType, 'FALL');
  assert.equal(m.data?.mapUrl, mapUrl(21.028511, 105.804817));
  assert.equal(m.collapseKey, 'incident-inc1');
  // FCM yêu cầu mọi giá trị trong data là chuỗi
  assert.ok(Object.values(m.data ?? {}).every((v) => typeof v === 'string'));
});

test('FALL vị trí cũ ghi rõ tuổi', () => {
  const m = buildIncidentMessage({ ...base, type: 'FALL', gpsValid: false, gpsAgeS: 150 });
  assert.match(m.body, /Vị trí cũ \(cách đây 2 phút\)/);
});

test('SOS và không có vị trí', () => {
  const m = buildIncidentMessage({ id: 'x', type: 'HELP_REQUEST', confidence: 1, lat: null, lon: null, gpsValid: false, gpsAgeS: null });
  assert.match(m.title, /SOS/);
  assert.match(m.body, /Chưa có vị trí GPS/);
  assert.equal(m.data?.lat, undefined);
});

test('FALL không có độ tin cậy', () => {
  const m = buildIncidentMessage({ ...base, type: 'FALL', confidence: null });
  assert.doesNotMatch(m.body, /độ tin cậy/);
});

test('thông báo thiết bị', () => {
  assert.equal(deviceOfflineMessage(90).level, 'WARNING');
  assert.match(deviceOfflineMessage(90).body, /1 phút/);
  assert.equal(deviceBackOnlineMessage().level, 'INFO');
  assert.equal(deviceRebootedMessage().level, 'WARNING');
  // offline/online/reboot thay thế nhau trong khay thông báo
  assert.equal(deviceOfflineMessage(90).collapseKey, deviceBackOnlineMessage().collapseKey);
});

test('SMS thất bại che số điện thoại', () => {
  const m = smsFailedMessage('+84901234567', 'inc1');
  assert.doesNotMatch(m.body, /84901234567/);
  assert.match(m.body, /4567/);
  assert.equal(m.data?.incidentId, 'inc1');
  assert.equal(smsFailedMessage('+84901234567', null).data?.incidentId, undefined);
});

test('mọi vấn đề sức khỏe đều có nội dung', () => {
  for (const issue of ['IMU_FAULT', 'WEAK_SIGNAL', 'NO_CONTACTS'] as HealthIssue[]) {
    const m = healthMessage(issue);
    assert.ok(m.title.length > 0 && m.body.length > 0);
    assert.equal(m.data?.issue, issue);
  }
});
