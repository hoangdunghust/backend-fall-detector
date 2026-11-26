import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { IncidentType } from '@prisma/client';
import { DeviceMsg, EVT } from '../common/events';
import { toGpsFields } from '../common/geo.util';
import { SerialQueue } from '../common/serial-queue';
import { deviceTsToDate } from '../common/time.util';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { EventPayload, SmsPayload } from '../mqtt/payloads';
import { buildIncidentMessage, smsFailedMessage } from '../notifications/messages';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListIncidentsQuery } from './dto/list-incidents.query';

const INCLUDE_SMS = { sms: { orderBy: { at: 'asc' as const } } };
/** SMS tới trễ hơn ngần này sau sự kiện thì không gắn vào sự cố nữa. */
const SMS_ATTACH_WINDOW_MS = 10 * 60_000;

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);
  /** Xử lý tuần tự để các bản tin sát nhau không đua dữ liệu (chống trùng, gắn SMS). */
  private readonly queue = new SerialQueue();

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------------------------------------------------------------- MQTT
  @OnEvent(EVT.DEVICE_EVENT)
  onDeviceEvent(msg: DeviceMsg<EventPayload>): Promise<void> {
    return this.queue
      .run(() => this.handleEvent(msg))
      .catch((e: Error) => this.logger.error(`handleEvent: ${e.message}`));
  }

  @OnEvent(EVT.SMS)
  onSms(msg: DeviceMsg<SmsPayload>): Promise<void> {
    return this.queue
      .run(() => this.handleSms(msg))
      .catch((e: Error) => this.logger.error(`handleSms: ${e.message}`));
  }

  private async handleEvent(msg: DeviceMsg<EventPayload>): Promise<void> {
    switch (msg.payload.type) {
      case 'FALL':
      case 'HELP_REQUEST':
        return this.createIncident(msg);
      case 'FALL_CANCEL':
        return this.recordCancel(msg);
      default:
        return; // LOCATION_UPDATE do LocationsService/CommandsService xử lý
    }
  }

  private async isRecentDuplicate(type: IncidentType, receivedAt: Date): Promise<boolean> {
    const windowMs = this.cfg.dedupeWindowS * 1000;
    if (windowMs <= 0) return false;
    const dup = await this.prisma.incident.findFirst({
      where: {
        type,
        status: { not: 'CANCELLED' },
        receivedAt: { gte: new Date(receivedAt.getTime() - windowMs) },
      },
      select: { id: true },
    });
    return dup !== null;
  }

  private async createIncident(msg: DeviceMsg<EventPayload>): Promise<void> {
    const { payload: p, receivedAt } = msg;
    const type = p.type as IncidentType;

    // Có event_id: chống trùng chính xác bằng ràng buộc unique. Chưa có: dùng cửa sổ thời gian.
    if (!p.eventId && (await this.isRecentDuplicate(type, receivedAt))) {
      this.logger.warn(`Bỏ qua ${type} trùng trong ${this.cfg.dedupeWindowS}s`);
      return;
    }

    let incident;
    try {
      incident = await this.prisma.incident.create({
        data: {
          type,
          status: 'OPEN',
          confidence: p.confidence ?? null,
          ...toGpsFields(p.gps),
          deviceTime: deviceTsToDate(p.tsMs),
          receivedAt,
          eventId: p.eventId ?? null,
        },
        include: INCLUDE_SMS,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        this.logger.warn(`Bỏ qua ${type} trùng event_id=${p.eventId}`);
        return;
      }
      throw e;
    }

    this.logger.warn(`SỰ CỐ MỚI ${incident.type} id=${incident.id}`);
    this.emitter.emit(EVT.INCIDENT_CREATED, incident);
    await this.notifications.notify(buildIncidentMessage(incident));
  }

  /** Người đeo đã hủy trong cửa sổ cảnh báo: chỉ lưu vết, KHÔNG thông báo. */
  private async recordCancel(msg: DeviceMsg<EventPayload>): Promise<void> {
    const { payload: p, receivedAt } = msg;
    const incident = await this.prisma.incident.create({
      data: {
        type: 'FALL',
        status: 'CANCELLED',
        confidence: p.confidence ?? null,
        ...toGpsFields(p.gps),
        deviceTime: deviceTsToDate(p.tsMs),
        receivedAt,
        cancelledAt: receivedAt,
      },
      include: INCLUDE_SMS,
    });
    this.logger.log(`Người đeo đã hủy cảnh báo ngã (id=${incident.id})`);
    this.emitter.emit(EVT.INCIDENT_CREATED, incident);
  }

  private async handleSms(msg: DeviceMsg<SmsPayload>): Promise<void> {
    const { payload: p, receivedAt } = msg;
    const incident = await this.prisma.incident.findFirst({
      where: {
        status: { not: 'CANCELLED' },
        receivedAt: { gte: new Date(receivedAt.getTime() - SMS_ATTACH_WINDOW_MS) },
      },
      orderBy: { receivedAt: 'desc' },
      select: { id: true },
    });

    await this.prisma.smsDelivery.create({
      data: {
        incidentId: incident?.id ?? null,
        phone: p.phone,
        success: p.success,
        deviceTime: deviceTsToDate(p.tsMs),
      },
    });

    if (incident) {
      const full = await this.prisma.incident.findUnique({ where: { id: incident.id }, include: INCLUDE_SMS });
      if (full) this.emitter.emit(EVT.INCIDENT_UPDATED, full);
    }
    if (!p.success) {
      await this.notifications.notify(smsFailedMessage(p.phone, incident?.id ?? null));
    }
  }

  // ---------------------------------------------------------------- API
  async list(q: ListIncidentsQuery) {
    const limit = q.limit ?? 20;
    const rows = await this.prisma.incident.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: INCLUDE_SMS,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async get(id: string) {
    const incident = await this.prisma.incident.findUnique({ where: { id }, include: INCLUDE_SMS });
    if (!incident) throw new NotFoundException('Không tìm thấy sự cố');
    return incident;
  }

  /** Người chăm sóc xác nhận đã nhận cảnh báo. Idempotent. */
  async ack(id: string) {
    const cur = await this.get(id);
    if (cur.status === 'ACKNOWLEDGED') return cur;
    if (cur.status !== 'OPEN') throw new ConflictException(`Sự cố đang ở trạng thái ${cur.status}`);
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', ackedAt: new Date() },
      include: INCLUDE_SMS,
    });
    this.emitter.emit(EVT.INCIDENT_UPDATED, updated);
    return updated;
  }

  /** Đánh dấu đã xử lý xong. Idempotent. */
  async resolve(id: string) {
    const cur = await this.get(id);
    if (cur.status === 'RESOLVED') return cur;
    if (cur.status === 'CANCELLED') throw new ConflictException('Sự cố đã bị người đeo hủy');
    const now = new Date();
    const updated = await this.prisma.incident.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: now, ackedAt: cur.ackedAt ?? now },
      include: INCLUDE_SMS,
    });
    this.emitter.emit(EVT.INCIDENT_UPDATED, updated);
    return updated;
  }
}
