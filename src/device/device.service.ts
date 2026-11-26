import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DeviceMsg, EVT } from '../common/events';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { HeartbeatPayload, InfoPayload, StatusPayload } from '../mqtt/payloads';
import {
  deviceBackOnlineMessage,
  deviceOfflineMessage,
  deviceRebootedMessage,
} from '../notifications/messages';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { estimateBootAt, isNewBoot } from './boot-detect';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Hàng trạng thái duy nhất (id = 1), tự tạo nếu chưa có. */
  async getState() {
    return this.prisma.deviceState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  async getStateView() {
    const s = await this.getState();
    return {
      ...s,
      deviceId: this.cfg.deviceId,
      lastSeenAgoS: s.lastSeenAt ? Math.max(0, Math.floor((Date.now() - s.lastSeenAt.getTime()) / 1000)) : null,
    };
  }

  async getHealthHistory(from?: Date, to?: Date, limit = 200) {
    const items = await this.prisma.deviceHealthLog.findMany({
      where: { at: { gte: from, lte: to } },
      orderBy: { at: 'desc' },
      take: limit,
    });
    return { items };
  }

  // ---------------------------------------------------------------- MQTT
  @OnEvent(EVT.HEARTBEAT)
  async onHeartbeat(msg: DeviceMsg<HeartbeatPayload>): Promise<void> {
    try {
      const { payload: p, receivedAt } = msg;
      const prev = await this.getState();
      const state = await this.prisma.deviceState.update({
        where: { id: 1 },
        data: {
          online: true,
          lastSeenAt: receivedAt,
          signal: p.signal,
          imuOk: p.imuOk,
          gpsFix: p.gpsFix,
          contactsCnt: p.contacts,
          heap: p.heap,
        },
      });
      await this.prisma.deviceHealthLog.create({
        data: { signal: p.signal, imuOk: p.imuOk, gpsFix: p.gpsFix, heap: p.heap, at: receivedAt },
      });
      this.emitter.emit(EVT.DEVICE_STATE, state);
      if (!prev.online && prev.lastSeenAt !== null) {
        await this.notifications.notify(deviceBackOnlineMessage());
      }
    } catch (e) {
      this.logger.error(`onHeartbeat: ${(e as Error).message}`);
    }
  }

  @OnEvent(EVT.STATUS)
  async onStatus(msg: DeviceMsg<StatusPayload>): Promise<void> {
    try {
      const { payload: p, receivedAt, retained } = msg;

      if (p.status === 'offline') {
        // LWT (retained hoặc không): thiết bị đã rớt khỏi broker
        await this.markOffline('lwt', !retained);
        return;
      }
      // "online" retained có thể là bản cũ từ trước khi BE khởi động: đợi heartbeat xác nhận
      if (retained) return;

      const prev = await this.getState();
      const wasOffline = !prev.online && prev.lastSeenAt !== null;

      let rebooted = false;
      let bootedAt: Date | undefined;
      if (p.uptimeS !== undefined) {
        const est = estimateBootAt(receivedAt, p.uptimeS);
        rebooted = isNewBoot(prev.bootedAt, est);
        if (prev.bootedAt === null || rebooted) bootedAt = est;
      }

      const state = await this.prisma.deviceState.update({
        where: { id: 1 },
        data: {
          online: true,
          lastSeenAt: receivedAt,
          firmware: p.firmware,
          heap: p.freeHeap,
          uptimeS: p.uptimeS,
          bootedAt,
        },
      });
      this.emitter.emit(EVT.DEVICE_STATE, state);

      if (rebooted) {
        // Reboot do lệnh từ app thì không cần cảnh báo
        const commanded = await this.prisma.commandLog.findFirst({
          where: { action: 'REBOOT', createdAt: { gte: new Date(Date.now() - 180_000) } },
        });
        if (!commanded) await this.notifications.notify(deviceRebootedMessage());
      } else if (wasOffline) {
        await this.notifications.notify(deviceBackOnlineMessage());
      }
    } catch (e) {
      this.logger.error(`onStatus: ${(e as Error).message}`);
    }
  }

  @OnEvent(EVT.INFO)
  async onInfo(msg: DeviceMsg<InfoPayload>): Promise<void> {
    try {
      if (msg.payload.firmware) {
        await this.getState();
        await this.prisma.deviceState.update({ where: { id: 1 }, data: { firmware: msg.payload.firmware } });
      }
    } catch (e) {
      this.logger.error(`onInfo: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- Offline
  /** Trả về true nếu đây là lần chuyển online -> offline (để chỉ báo một lần dù nhiều nguồn cùng phát hiện). */
  async markOffline(reason: 'timeout' | 'lwt', notify = true): Promise<boolean> {
    const r = await this.prisma.deviceState.updateMany({
      where: { id: 1, online: true },
      data: { online: false },
    });
    if (r.count === 0) return false;

    this.logger.warn(`Thiết bị OFFLINE (${reason})`);
    const state = await this.getState();
    this.emitter.emit(EVT.DEVICE_STATE, state);
    if (notify) await this.notifications.notify(deviceOfflineMessage(this.cfg.watchdog.heartbeatTimeoutS));
    return true;
  }

  async checkTimeout(timeoutMs: number): Promise<void> {
    const s = await this.getState();
    if (s.online && s.lastSeenAt && Date.now() - s.lastSeenAt.getTime() > timeoutMs) {
      await this.markOffline('timeout');
    }
  }
}
