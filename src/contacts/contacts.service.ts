import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { DeviceMsg, EVT } from '../common/events';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { MqttService } from '../mqtt/mqtt.service';
import { CmdRespPayload, HeartbeatPayload } from '../mqtt/payloads';
import { buildTopics, DeviceTopics } from '../mqtt/topics';
import { contactsRejectedMessage } from '../notifications/messages';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const RESYNC_MIN_INTERVAL_MS = 5 * 60_000;
const REPUBLISH_PENDING_INTERVAL_MS = 10 * 60_000;

/**
 * Danh bạ khẩn cấp. Thiết bị KHÔNG có số mặc định, nên đây là đường duy nhất để nó gửi được SMS.
 * Cấu hình được publish với retain=true: thiết bị nhận lại ở mỗi lần kết nối. Trạng thái
 * PENDING -> SYNCED chỉ đổi khi thiết bị phản hồi cmd/resp "set_contacts".
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);
  private readonly topics: DeviceTopics;
  private lastPublishAt = 0;
  private lastResyncAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly emitter: EventEmitter2,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.topics = buildTopics(cfg.deviceId);
  }

  list() {
    return this.prisma.emergencyContact.findMany({ orderBy: { position: 'asc' } });
  }

  /** Thay toàn bộ danh sách rồi đẩy xuống thiết bị. */
  async replaceAll(items: Array<{ phone: string; name?: string }>) {
    const seen = new Set<string>();
    const unique = items.filter((c) => (seen.has(c.phone) ? false : (seen.add(c.phone), true)));

    await this.prisma.$transaction([
      this.prisma.emergencyContact.deleteMany(),
      this.prisma.emergencyContact.createMany({
        data: unique.map((c, i) => ({ phone: c.phone, name: c.name ?? null, position: i, sync: 'PENDING' as const })),
      }),
    ]);

    const published = await this.publishToDevice();
    const contacts = await this.list();
    this.emitter.emit(EVT.CONTACTS_UPDATED, contacts);
    // sent: đã tới broker, chờ thiết bị xác nhận | queued: broker đang lỗi, sẽ tự thử lại
    return { contacts, delivery: published ? 'sent' : 'queued' };
  }

  async publishToDevice(): Promise<boolean> {
    const contacts = await this.list();
    if (contacts.length === 0) return false;
    try {
      await this.mqtt.publish(
        this.topics.contactsConfigTopic,
        { contacts: contacts.map((c: { phone: string }) => c.phone) },
        { qos: 1, retain: true },
      );
      this.lastPublishAt = Date.now();
      return true;
    } catch (e) {
      this.logger.warn(`Chưa đẩy được danh bạ xuống thiết bị: ${(e as Error).message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- Phản hồi từ thiết bị
  @OnEvent(EVT.CMD_RESP)
  async onCmdResp(msg: DeviceMsg<CmdRespPayload>): Promise<void> {
    try {
      if (msg.payload.action !== 'set_contacts') return;
      const ok = msg.payload.status === 'ok';
      await this.prisma.emergencyContact.updateMany({
        where: { sync: 'PENDING' },
        data: { sync: ok ? 'SYNCED' : 'FAILED' },
      });
      this.logger.log(`Thiết bị phản hồi set_contacts: ${msg.payload.status}`);
      this.emitter.emit(EVT.CONTACTS_UPDATED, await this.list());
      if (!ok) await this.notifications.notify(contactsRejectedMessage());
    } catch (e) {
      this.logger.error(`onCmdResp: ${(e as Error).message}`);
    }
  }

  /**
   * Tự phục hồi: nếu thiết bị báo số liên hệ khác với BE (ví dụ broker mất bản retain, hoặc thiết bị
   * vừa xóa NVS) thì đẩy lại, tối đa 5 phút một lần.
   */
  @OnEvent(EVT.HEARTBEAT)
  async onHeartbeat(msg: DeviceMsg<HeartbeatPayload>): Promise<void> {
    try {
      const reported = msg.payload.contacts;
      if (reported === undefined) return;
      const contacts = await this.list();
      if (contacts.length === 0 || reported === contacts.length) return;
      if (contacts.some((c: { sync: string }) => c.sync === 'FAILED')) return; // thiết bị đã từ chối, cần người sửa
      if (Date.now() - this.lastResyncAt < RESYNC_MIN_INTERVAL_MS) return;
      this.lastResyncAt = Date.now();
      this.logger.warn(`Thiết bị giữ ${reported} số, BE có ${contacts.length}: đẩy lại danh bạ`);
      await this.publishToDevice();
    } catch (e) {
      this.logger.error(`onHeartbeat: ${(e as Error).message}`);
    }
  }

  /** Còn PENDING (broker lỗi lúc lưu, hoặc phản hồi bị mất): đẩy lại định kỳ. */
  @Interval(60_000)
  async retryPending(): Promise<void> {
    try {
      if (!this.mqtt.isConnected()) return;
      const pending = await this.prisma.emergencyContact.count({ where: { sync: 'PENDING' } });
      if (pending === 0) return;
      if (Date.now() - this.lastPublishAt < REPUBLISH_PENDING_INTERVAL_MS) return;
      await this.publishToDevice();
    } catch (e) {
      this.logger.error(`retryPending: ${(e as Error).message}`);
    }
  }
}
