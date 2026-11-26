import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { DeviceMsg, EVT } from '../common/events';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { DeviceService } from '../device/device.service';
import { HeartbeatPayload } from '../mqtt/payloads';
import { healthMessage } from '../notifications/messages';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { HealthTracker } from './health-rules';

@Injectable()
export class WatchdogService {
  private readonly logger = new Logger(WatchdogService.name);
  private readonly tracker: HealthTracker;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly device: DeviceService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {
    this.tracker = new HealthTracker({
      weakCsq: cfg.watchdog.weakSignalCsq,
      weakReadings: cfg.watchdog.weakSignalReadings,
      cooldownMs: cfg.watchdog.alertCooldownMin * 60_000,
      imuReadings: 2,
      contactsReadings: 4,
    });
  }

  /** Quá HEARTBEAT_TIMEOUT_S không có tín hiệu => offline. */
  @Interval(15_000)
  async checkHeartbeatTimeout(): Promise<void> {
    try {
      await this.device.checkTimeout(this.cfg.watchdog.heartbeatTimeoutS * 1000);
    } catch (e) {
      this.logger.error(`checkHeartbeatTimeout: ${(e as Error).message}`);
    }
  }

  @OnEvent(EVT.HEARTBEAT)
  async onHeartbeat(msg: DeviceMsg<HeartbeatPayload>): Promise<void> {
    try {
      for (const issue of this.tracker.evaluate(msg.payload, Date.now())) {
        await this.notifications.notify(healthMessage(issue));
      }
    } catch (e) {
      this.logger.error(`onHeartbeat: ${(e as Error).message}`);
    }
  }

  /** Dọn dữ liệu cũ mỗi ngày lúc 3h sáng. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup(): Promise<void> {
    try {
      const day = 86_400_000;
      const h = await this.prisma.deviceHealthLog.deleteMany({
        where: { at: { lt: new Date(Date.now() - this.cfg.retention.healthDays * day) } },
      });
      const l = await this.prisma.location.deleteMany({
        where: { at: { lt: new Date(Date.now() - this.cfg.retention.locationDays * day) } },
      });
      const c = await this.prisma.commandLog.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * day) } },
      });
      this.logger.log(`Dọn dữ liệu: health=${h.count}, location=${l.count}, commands=${c.count}`);
    } catch (e) {
      this.logger.error(`cleanup: ${(e as Error).message}`);
    }
  }
}
