/**
 * Kiểm thử logic nghiệp vụ của các service bằng Prisma/MQTT/Notification giả (không cần DB, broker).
 */
import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EVT } from '../src/common/events';
import { CommandsService } from '../src/commands/commands.service';
import { ContactsService } from '../src/contacts/contacts.service';
import { DeviceService } from '../src/device/device.service';
import { IncidentsService } from '../src/incidents/incidents.service';
import { LocationsService } from '../src/locations/locations.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { Fake, FakeEmitter, FakeMqtt, FakeNotifications, fakeConfig, ID, msg } from './helpers/fake-prisma';

Logger.overrideLogger(false);

const T0 = new Date('2026-09-09T14:00:00Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const GPS = { valid: true, lat: 21.028511, lon: 105.804817, sat: 8, ageS: 3 };
const FALL = (o: Record<string, unknown> = {}) => ({ type: 'FALL', tsMs: 1788962000000, confidence: 0.93, gps: GPS, ...o }) as any;
const SOS = (o: Record<string, unknown> = {}) => ({ type: 'HELP_REQUEST', tsMs: 0, confidence: 1, gps: GPS, ...o }) as any;
const SMS = (phone: string, success: boolean) => ({ phone, success, tsMs: null });

// ================================================================ IncidentsService
function mkIncidents() {
  const prisma = new Fake();
  const emitter = new FakeEmitter();
  const notif = new FakeNotifications();
  const svc = new IncidentsService(prisma as any, emitter as any, notif as any, fakeConfig());
  return { prisma, emitter, notif, svc };
}

test('FALL: tạo sự cố OPEN, lưu vị trí, thông báo ALERT một lần, phát sự kiện realtime', async () => {
  const { prisma, emitter, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), T0));
  assert.equal(prisma.incident.rows.length, 1);
  const i = prisma.incident.rows[0];
  assert.equal(i.type, 'FALL');
  assert.equal(i.status, 'OPEN');
  assert.equal(i.confidence, 0.93);
  assert.equal(i.lat, 21.028511);
  assert.equal(i.gpsValid, true);
  assert.equal(i.gpsAgeS, 3);
  assert.equal(i.deviceTime.toISOString(), '2026-09-09T13:53:20.000Z');
  assert.equal(notif.sent.length, 1);
  assert.equal(notif.sent[0].level, 'ALERT');
  assert.equal(notif.sent[0].data.incidentId, i.id);
  assert.equal(emitter.of(EVT.INCIDENT_CREATED).length, 1);
});

test('SOS với ts_ms=0 (chưa có giờ GPS): deviceTime = null, vẫn tạo và thông báo', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(SOS(), T0));
  assert.equal(prisma.incident.rows[0].type, 'HELP_REQUEST');
  assert.equal(prisma.incident.rows[0].deviceTime, null);
  assert.match(notif.sent[0].title, /SOS/);
});

test('trùng trong 8s bị bỏ qua; sau cửa sổ thì tạo mới; loại khác không bị coi là trùng', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), at(0)));
  await svc.onDeviceEvent(msg(FALL(), at(3)));
  assert.equal(prisma.incident.rows.length, 1);
  await svc.onDeviceEvent(msg(SOS(), at(4)));
  assert.equal(prisma.incident.rows.length, 2);
  await svc.onDeviceEvent(msg(FALL(), at(20)));
  assert.equal(prisma.incident.rows.length, 3);
  assert.equal(notif.sent.length, 3);
});

test('có event_id: chống trùng chính xác dù cách xa nhau', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL({ eventId: 'b1-1' }), at(0)));
  await svc.onDeviceEvent(msg(FALL({ eventId: 'b1-1' }), at(600)));
  await svc.onDeviceEvent(msg(FALL({ eventId: 'b1-2' }), at(601)));
  assert.equal(prisma.incident.rows.length, 2);
  assert.equal(notif.sent.length, 2);
});

test('FALL_CANCEL: lưu vết CANCELLED, KHÔNG thông báo; ngã thật ngay sau đó vẫn được ghi nhận', async () => {
  const { prisma, emitter, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg({ type: 'FALL_CANCEL', tsMs: null, confidence: 1 } as any, at(0)));
  assert.equal(prisma.incident.rows[0].status, 'CANCELLED');
  assert.ok(prisma.incident.rows[0].cancelledAt);
  assert.equal(notif.sent.length, 0);
  assert.equal(emitter.of(EVT.INCIDENT_CREATED).length, 1);

  await svc.onDeviceEvent(msg(FALL(), at(2)));
  assert.equal(prisma.incident.rows.length, 2);
  assert.equal(notif.sent.length, 1);
});

test('LOCATION_UPDATE không tạo sự cố', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg({ type: 'LOCATION_UPDATE', tsMs: 0, confidence: 0, gps: GPS } as any, at(0)));
  assert.equal(prisma.incident.rows.length, 0);
  assert.equal(notif.sent.length, 0);
});

test('không GPS hoặc GPS (0,0): lat/lon = null, vẫn thông báo', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL({ gps: undefined }), at(0)));
  await svc.onDeviceEvent(msg(FALL({ gps: { valid: false, lat: 0, lon: 0, sat: 0, ageS: 0 } }), at(30)));
  assert.equal(prisma.incident.rows[0].lat, null);
  assert.equal(prisma.incident.rows[1].lat, null);
  assert.match(notif.sent[0].body, /Chưa có vị trí GPS/);
});

test('SMS thành công gắn vào sự cố gần nhất, cập nhật realtime, không thông báo thêm', async () => {
  const { prisma, emitter, notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), at(0)));
  await svc.onSms(msg(SMS('+84901234567', true), at(2)));
  assert.equal(prisma.smsDelivery.rows.length, 1);
  assert.equal(prisma.smsDelivery.rows[0].incidentId, prisma.incident.rows[0].id);
  const updated = emitter.of(EVT.INCIDENT_UPDATED);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].sms.length, 1);
  assert.equal(notif.sent.length, 1);
});

test('SMS thất bại: thông báo WARNING và che số điện thoại', async () => {
  const { notif, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), at(0)));
  await svc.onSms(msg(SMS('+84901234567', false), at(2)));
  assert.equal(notif.sent.length, 2);
  assert.equal(notif.sent[1].level, 'WARNING');
  assert.doesNotMatch(notif.sent[1].body, /84901234567/);
});

test('event và SMS đến sát nhau vẫn được xử lý đúng thứ tự (SMS luôn gắn được vào sự cố)', async () => {
  const { prisma, svc } = mkIncidents();
  const p1 = svc.onDeviceEvent(msg(FALL(), at(0)));
  const p2 = svc.onSms(msg(SMS('+84901234567', true), at(1)));
  await Promise.all([p1, p2]);
  assert.equal(prisma.smsDelivery.rows[0].incidentId, prisma.incident.rows[0].id);
});

test('SMS không có sự cố tương ứng (hoặc quá 10 phút): lưu với incidentId = null', async () => {
  const { prisma, notif, svc } = mkIncidents();
  await svc.onSms(msg(SMS('+84901234567', false), at(0)));
  assert.equal(prisma.smsDelivery.rows[0].incidentId, null);
  assert.equal(notif.sent[0].data.incidentId, undefined);

  await svc.onDeviceEvent(msg(FALL(), at(100)));
  await svc.onSms(msg(SMS('+84912345678', true), at(100 + 11 * 60)));
  assert.equal(prisma.smsDelivery.rows[1].incidentId, null);
});

test('SMS không gắn vào sự cố đã bị hủy', async () => {
  const { prisma, svc } = mkIncidents();
  await svc.onDeviceEvent(msg({ type: 'FALL_CANCEL', tsMs: null, confidence: 1 } as any, at(0)));
  await svc.onSms(msg(SMS('+84901234567', true), at(1)));
  assert.equal(prisma.smsDelivery.rows[0].incidentId, null);
});

test('ack / resolve: idempotent, đúng ràng buộc trạng thái', async () => {
  const { prisma, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), at(0)));
  const id = prisma.incident.rows[0].id;

  const a1 = await svc.ack(id);
  assert.equal(a1.status, 'ACKNOWLEDGED');
  assert.ok(a1.ackedAt);
  assert.equal((await svc.ack(id)).status, 'ACKNOWLEDGED');

  const r = await svc.resolve(id);
  assert.equal(r.status, 'RESOLVED');
  assert.ok(r.resolvedAt);
  assert.equal((await svc.resolve(id)).status, 'RESOLVED');
  await assert.rejects(svc.ack(id), (e: unknown) => e instanceof ConflictException);

  await svc.onDeviceEvent(msg({ type: 'FALL_CANCEL', tsMs: null, confidence: 1 } as any, at(60)));
  const cancelled = prisma.incident.rows.find((x) => x.status === 'CANCELLED')!;
  await assert.rejects(svc.ack(cancelled.id), (e: unknown) => e instanceof ConflictException);
  await assert.rejects(svc.resolve(cancelled.id), (e: unknown) => e instanceof ConflictException);

  await assert.rejects(svc.get('khong-ton-tai'), (e: unknown) => e instanceof NotFoundException);
});

test('resolve thẳng từ OPEN cũng đặt ackedAt', async () => {
  const { prisma, svc } = mkIncidents();
  await svc.onDeviceEvent(msg(FALL(), at(0)));
  const r = await svc.resolve(prisma.incident.rows[0].id);
  assert.ok(r.ackedAt && r.resolvedAt);
});

test('phân trang bằng cursor: đủ, không trùng, mới nhất trước; lọc theo trạng thái', async () => {
  const { prisma, svc } = mkIncidents();
  for (let i = 0; i < 5; i++) {
    await prisma.incident.create({ data: { type: 'FALL', receivedAt: at(i * 100), status: i === 2 ? 'RESOLVED' : 'OPEN' } });
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await svc.list({ limit: 2, cursor } as any);
    seen.push(...page.items.map((x: any) => x.id));
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 5);
  const times = seen.map((id) => prisma.incident.rows.find((r) => r.id === id)!.receivedAt.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));

  const resolved = await svc.list({ limit: 20, status: 'RESOLVED' } as any);
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.nextCursor, null);
});

// ================================================================ DeviceService
function mkDevice() {
  const prisma = new Fake();
  const emitter = new FakeEmitter();
  const notif = new FakeNotifications();
  const svc = new DeviceService(prisma as any, emitter as any, notif as any, fakeConfig());
  return { prisma, emitter, notif, svc };
}
const HB = (o: Record<string, unknown> = {}) => ({ tsMs: 0, signal: 18, imuOk: true, gpsFix: true, contacts: 2, heap: 1000, ...o }) as any;
const ONLINE = (uptimeS: number) => ({ status: 'online', tsMs: null, uptimeS, firmware: 'v2.0.0-4g', freeHeap: 1000 }) as any;

test('heartbeat đầu tiên: online, lưu số liệu + lịch sử, KHÔNG báo "kết nối lại"', async () => {
  const { prisma, emitter, notif, svc } = mkDevice();
  await svc.onHeartbeat(msg(HB()));
  const s = prisma.deviceState.rows[0];
  assert.equal(s.online, true);
  assert.equal(s.signal, 18);
  assert.equal(s.contactsCnt, 2);
  assert.equal(prisma.deviceHealthLog.rows.length, 1);
  assert.equal(notif.sent.length, 0);
  assert.equal(emitter.of(EVT.DEVICE_STATE).length, 1);
});

test('heartbeat thiếu trường không xóa giá trị cũ', async () => {
  const { prisma, svc } = mkDevice();
  await svc.onHeartbeat(msg(HB({ signal: 22 })));
  await svc.onHeartbeat(msg({ tsMs: 0 } as any));
  assert.equal(prisma.deviceState.rows[0].signal, 22);
});

test('timeout => offline đúng MỘT lần; LWT sau đó không báo trùng; heartbeat lại => báo kết nối lại', async () => {
  const { prisma, notif, svc } = mkDevice();
  await svc.onHeartbeat(msg(HB()));

  await svc.checkTimeout(90_000); // còn mới: không đổi
  assert.equal(prisma.deviceState.rows[0].online, true);

  prisma.deviceState.rows[0].lastSeenAt = new Date(Date.now() - 200_000);
  await svc.checkTimeout(90_000);
  assert.equal(prisma.deviceState.rows[0].online, false);
  assert.equal(notif.sent.length, 1);
  assert.equal(notif.sent[0].data.event, 'OFFLINE');

  await svc.checkTimeout(90_000);
  await svc.onStatus(msg({ status: 'offline', tsMs: null } as any));
  assert.equal(notif.sent.length, 1);

  await svc.onHeartbeat(msg(HB()));
  assert.equal(prisma.deviceState.rows[0].online, true);
  assert.equal(notif.sent.length, 2);
  assert.equal(notif.sent[1].data.event, 'ONLINE');
});

test('LWT offline đến trước timeout => báo offline, sau đó timeout không báo thêm', async () => {
  const { prisma, notif, svc } = mkDevice();
  await svc.onHeartbeat(msg(HB()));
  await svc.onStatus(msg({ status: 'offline', tsMs: null } as any));
  assert.equal(notif.sent.length, 1);
  prisma.deviceState.rows[0].lastSeenAt = new Date(Date.now() - 500_000);
  await svc.checkTimeout(90_000);
  assert.equal(notif.sent.length, 1);
});

test('phát hiện reboot từ uptime; kết nối lại cùng lần chạy thì không báo; reboot do lệnh thì không báo', async () => {
  const { prisma, notif, svc } = mkDevice();
  const base = Date.now() - 10 * 3600_000;
  const t = (s: number) => new Date(base + s * 1000);

  await svc.onStatus(msg(ONLINE(100), t(0)));
  assert.ok(prisma.deviceState.rows[0].bootedAt);
  assert.equal(notif.sent.length, 0);

  await svc.onStatus(msg(ONLINE(3700), t(3601))); // nối lại sau 1 giờ, uptime liên tục
  assert.equal(notif.sent.length, 0);

  await svc.onStatus(msg(ONLINE(20), t(7200))); // uptime nhỏ lại => reboot
  assert.equal(notif.sent.length, 1);
  assert.equal(notif.sent[0].data.event, 'REBOOTED');

  await prisma.commandLog.create({ data: { action: 'REBOOT', expiresAt: new Date(Date.now() + 60_000) } });
  await svc.onStatus(msg(ONLINE(10), t(10_800))); // reboot nhưng do lệnh từ app
  assert.equal(notif.sent.length, 1);
});

test('mất kết nối rồi nối lại (không reboot): báo "kết nối lại", không báo reboot', async () => {
  const { prisma, notif, svc } = mkDevice();
  const base = Date.now() - 3600_000;
  await svc.onStatus(msg(ONLINE(100), new Date(base)));
  await svc.markOffline('timeout', false);
  assert.equal(prisma.deviceState.rows[0].online, false);
  await svc.onStatus(msg(ONLINE(100 + 1800), new Date(base + 1800_000)));
  assert.equal(notif.sent.length, 1);
  assert.equal(notif.sent[0].data.event, 'ONLINE');
});

test('status online RETAINED (có thể là bản cũ) bị bỏ qua; offline retained đặt offline im lặng', async () => {
  const { prisma, notif, svc } = mkDevice();
  await svc.onStatus(msg(ONLINE(100), new Date(), true));
  assert.equal(prisma.deviceState.rows.length, 0);

  await svc.onHeartbeat(msg(HB()));
  await svc.onStatus(msg({ status: 'offline', tsMs: null } as any, new Date(), true));
  assert.equal(prisma.deviceState.rows[0].online, false);
  assert.equal(notif.sent.length, 0);
});

test('getStateView có lastSeenAgoS', async () => {
  const { svc } = mkDevice();
  await svc.onHeartbeat(msg(HB()));
  const v = await svc.getStateView();
  assert.equal(v.deviceId, ID);
  assert.ok(v.lastSeenAgoS !== null && v.lastSeenAgoS >= 0 && v.lastSeenAgoS < 5);
});

// ================================================================ ContactsService
function mkContacts() {
  const prisma = new Fake();
  const mqtt = new FakeMqtt();
  const emitter = new FakeEmitter();
  const notif = new FakeNotifications();
  const svc = new ContactsService(prisma as any, mqtt as any, emitter as any, notif as any, fakeConfig());
  return { prisma, mqtt, emitter, notif, svc };
}
const seedContacts = async (prisma: Fake, phones: string[], sync = 'SYNCED') => {
  for (let i = 0; i < phones.length; i++) await prisma.emergencyContact.create({ data: { phone: phones[i], position: i, sync } });
};

test('lưu danh bạ: bỏ trùng, đúng thứ tự, PENDING, publish retained QoS1 tới đúng topic', async () => {
  const { prisma, mqtt, emitter, svc } = mkContacts();
  const res = await svc.replaceAll([
    { phone: '+84901234567', name: 'Mẹ' },
    { phone: '+84912345678' },
    { phone: '+84901234567' },
  ]);
  assert.equal(res.delivery, 'sent');
  assert.deepEqual(prisma.emergencyContact.rows.map((r) => [r.phone, r.position, r.sync]), [
    ['+84901234567', 0, 'PENDING'],
    ['+84912345678', 1, 'PENDING'],
  ]);
  assert.equal(mqtt.published.length, 1);
  assert.equal(mqtt.published[0].topic, `v2/device/${ID}/config/emergency_contacts`);
  assert.deepEqual(mqtt.published[0].payload, { contacts: ['+84901234567', '+84912345678'] });
  assert.deepEqual(mqtt.published[0].opts, { qos: 1, retain: true });
  assert.equal(emitter.of(EVT.CONTACTS_UPDATED).length, 1);

  await svc.replaceAll([{ phone: '+84999999999' }]); // thay hoàn toàn
  assert.deepEqual(prisma.emergencyContact.rows.map((r) => r.phone), ['+84999999999']);
});

test('broker lỗi lúc lưu: vẫn lưu DB và trả về "queued"', async () => {
  const { prisma, mqtt, svc } = mkContacts();
  mqtt.failPublish = true;
  const res = await svc.replaceAll([{ phone: '+84901234567' }]);
  assert.equal(res.delivery, 'queued');
  assert.equal(prisma.emergencyContact.rows.length, 1);
});

test('thiết bị phản hồi ok => SYNCED; từ chối => FAILED + thông báo; action khác bị bỏ qua', async () => {
  const { prisma, notif, svc } = mkContacts();
  await seedContacts(prisma, ['+84901234567', '+84912345678'], 'PENDING');

  await svc.onCmdResp(msg({ action: 'reboot', status: 'accepted', tsMs: null }));
  assert.ok(prisma.emergencyContact.rows.every((r) => r.sync === 'PENDING'));

  await svc.onCmdResp(msg({ action: 'set_contacts', status: 'ok', tsMs: null }));
  assert.ok(prisma.emergencyContact.rows.every((r) => r.sync === 'SYNCED'));
  assert.equal(notif.sent.length, 0);

  prisma.emergencyContact.rows.forEach((r) => (r.sync = 'PENDING'));
  await svc.onCmdResp(msg({ action: 'set_contacts', status: 'rejected', tsMs: null }));
  assert.ok(prisma.emergencyContact.rows.every((r) => r.sync === 'FAILED'));
  assert.equal(notif.sent.length, 1);
  assert.equal(notif.sent[0].data.event, 'REJECTED');
});

test('heartbeat báo số liên hệ lệch: đẩy lại danh bạ, tối đa 5 phút một lần', async () => {
  const { prisma, mqtt, svc } = mkContacts();
  await seedContacts(prisma, ['+84901234567', '+84912345678']);
  await svc.onHeartbeat(msg(HB({ contacts: 0 })));
  assert.equal(mqtt.published.length, 1);
  assert.deepEqual(mqtt.published[0].payload, { contacts: ['+84901234567', '+84912345678'] });
  await svc.onHeartbeat(msg(HB({ contacts: 0 })));
  assert.equal(mqtt.published.length, 1); // bị giới hạn tần suất
});

test('heartbeat KHÔNG đẩy lại khi: số khớp / BE chưa có số / có số bị từ chối / thiếu trường', async () => {
  const a = mkContacts();
  await seedContacts(a.prisma, ['+84901234567', '+84912345678']);
  await a.svc.onHeartbeat(msg(HB({ contacts: 2 })));
  await a.svc.onHeartbeat(msg({ tsMs: 0 } as any));
  assert.equal(a.mqtt.published.length, 0);

  const b = mkContacts();
  await b.svc.onHeartbeat(msg(HB({ contacts: 0 })));
  assert.equal(b.mqtt.published.length, 0);

  const c = mkContacts();
  await seedContacts(c.prisma, ['+84901234567'], 'FAILED');
  await c.svc.onHeartbeat(msg(HB({ contacts: 0 })));
  assert.equal(c.mqtt.published.length, 0);
});

test('retryPending: chỉ đẩy lại khi còn PENDING, broker đang nối, và không dồn dập', async () => {
  const a = mkContacts();
  await seedContacts(a.prisma, ['+84901234567'], 'PENDING');
  await a.svc.retryPending();
  assert.equal(a.mqtt.published.length, 1);
  await a.svc.retryPending();
  assert.equal(a.mqtt.published.length, 1); // vừa đẩy xong, chưa tới 10 phút

  const b = mkContacts();
  await seedContacts(b.prisma, ['+84901234567'], 'PENDING');
  b.mqtt.connected = false;
  await b.svc.retryPending();
  assert.equal(b.mqtt.published.length, 0);

  const c = mkContacts();
  await seedContacts(c.prisma, ['+84901234567'], 'SYNCED');
  await c.svc.retryPending();
  assert.equal(c.mqtt.published.length, 0);
});

// ================================================================ CommandsService
function mkCommands(online = true) {
  const prisma = new Fake();
  const mqtt = new FakeMqtt();
  const device = { getState: async () => ({ online }) };
  const svc = new CommandsService(prisma as any, mqtt as any, device as any, fakeConfig());
  return { prisma, mqtt, svc };
}

test('lệnh khi thiết bị offline bị từ chối, không publish, không ghi log', async () => {
  const { prisma, mqtt, svc } = mkCommands(false);
  await assert.rejects(svc.create({ action: 'reboot' }), (e: unknown) => e instanceof ConflictException);
  assert.equal(mqtt.published.length, 0);
  assert.equal(prisma.commandLog.rows.length, 0);
});

test('lệnh được publish KHÔNG retain, QoS1, đúng topic; lệnh trùng đang chờ không gửi lại', async () => {
  const { prisma, mqtt, svc } = mkCommands();
  const c1 = await svc.create({ action: 'reboot' });
  assert.equal(c1.status, 'PENDING');
  assert.equal(c1.action, 'REBOOT');
  assert.equal(mqtt.published.length, 1);
  assert.equal(mqtt.published[0].topic, `v2/device/${ID}/command`);
  assert.deepEqual(mqtt.published[0].payload, { action: 'reboot' });
  assert.deepEqual(mqtt.published[0].opts, { qos: 1, retain: false });

  const c2 = await svc.create({ action: 'reboot' });
  assert.equal(c2.id, c1.id);
  assert.equal(mqtt.published.length, 1);

  await svc.create({ action: 'request_location' });
  assert.equal(mqtt.published.length, 2);
  assert.equal(prisma.commandLog.rows.length, 2);
});

test('broker lỗi: ném lỗi và không ghi log lệnh', async () => {
  const { prisma, mqtt, svc } = mkCommands();
  mqtt.failPublish = true;
  await assert.rejects(svc.create({ action: 'reboot' }));
  assert.equal(prisma.commandLog.rows.length, 0);
});

test('reboot: cmd/resp "accepted" => OK; request_location: LOCATION_UPDATE => OK; hết hạn => EXPIRED', async () => {
  const { prisma, svc } = mkCommands();
  await svc.create({ action: 'reboot' });
  await svc.create({ action: 'request_location' });

  await svc.onCmdResp(msg({ action: 'set_contacts', status: 'ok', tsMs: null }));
  assert.ok(prisma.commandLog.rows.every((r) => r.status === 'PENDING'));

  await svc.onCmdResp(msg({ action: 'reboot', status: 'accepted', tsMs: null }));
  assert.equal(prisma.commandLog.rows.find((r) => r.action === 'REBOOT')!.status, 'OK');

  await svc.onDeviceEvent(msg(FALL()));
  assert.equal(prisma.commandLog.rows.find((r) => r.action === 'REQUEST_LOCATION')!.status, 'PENDING');
  await svc.onDeviceEvent(msg({ type: 'LOCATION_UPDATE', tsMs: 0, confidence: 0, gps: GPS } as any));
  assert.equal(prisma.commandLog.rows.find((r) => r.action === 'REQUEST_LOCATION')!.status, 'OK');

  await prisma.commandLog.create({ data: { action: 'REBOOT', expiresAt: new Date(Date.now() - 1000) } });
  await svc.expireOld();
  assert.equal(prisma.commandLog.rows[2].status, 'EXPIRED');
  assert.equal(prisma.commandLog.rows[0].status, 'OK'); // không đụng tới lệnh đã xong
});

// ================================================================ LocationsService
test('lưu vị trí từ mọi sự kiện có GPS, bỏ qua (0,0); latest có tuổi hiệu dụng', async () => {
  const prisma = new Fake();
  const emitter = new FakeEmitter();
  const svc = new LocationsService(prisma as any, emitter as any);

  await svc.onDeviceEvent(msg(FALL(), new Date(Date.now() - 60_000)));
  await svc.onDeviceEvent(msg(FALL({ gps: { valid: false, lat: 0, lon: 0 } })));
  await svc.onDeviceEvent(msg(FALL({ gps: undefined })));
  assert.equal(prisma.location.rows.length, 1);
  assert.equal(emitter.of(EVT.LOCATION_UPDATED).length, 1);

  const { location } = await svc.latest();
  assert.ok(location);
  assert.equal(location!.lat, 21.028511);
  assert.ok(location!.effectiveAgeS! >= 62 && location!.effectiveAgeS! <= 66); // 3s + ~60s đã trôi qua
  assert.match(location!.mapUrl, /maps\.google\.com/);

  assert.deepEqual(await new LocationsService(new Fake() as any, emitter as any).latest(), { location: null });
});

// ================================================================ NotificationsService
const TOKEN = (c: string) => c.repeat(30);

test('thông báo: xóa token hết hạn, không gọi provider khi chưa có token, không bao giờ ném lỗi', async () => {
  const prisma = new Fake();
  const calls: string[][] = [];
  const provider = { name: 't', send: async (tokens: string[]) => { calls.push(tokens); return { invalidTokens: [TOKEN('a')] }; } };
  const svc = new NotificationsService(prisma as any, provider as any);

  await svc.notify({ level: 'ALERT', title: 't', body: 'b' });
  assert.equal(calls.length, 0);

  await svc.registerToken(TOKEN('a'));
  await svc.registerToken(TOKEN('b'));
  await svc.registerToken(TOKEN('b')); // đăng ký lặp không tạo bản ghi mới
  assert.equal(prisma.pushToken.rows.length, 2);

  await svc.notify({ level: 'ALERT', title: 't', body: 'b' });
  assert.equal(calls.length, 1);
  assert.deepEqual(prisma.pushToken.rows.map((r) => r.token), [TOKEN('b')]);

  const boom = new NotificationsService(prisma as any, { name: 'x', send: async () => { throw new Error('FCM down'); } } as any);
  await boom.notify({ level: 'ALERT', title: 't', body: 'b' }); // không ném
  await svc.removeToken(TOKEN('b'));
  assert.equal(prisma.pushToken.rows.length, 0);
});
