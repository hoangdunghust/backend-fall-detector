import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { CommandAction } from '@prisma/client';
import { DeviceMsg, EVT } from '../common/events';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { DeviceService } from '../device/device.service';
import { MqttService } from '../mqtt/mqtt.service';
import { CmdRespPayload, EventPayload } from '../mqtt/payloads';
import { buildTopics, DeviceTopics } from '../mqtt/topics';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommandDto } from './dto/create-command.dto';

const COMMAND_TTL_MS = 60_000;

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);
  private readonly topics: DeviceTopics;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly device: DeviceService,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.topics = buildTopics(cfg.deviceId);
  }

  /**
   * Lệnh được publish KHÔNG retain (retain sẽ khiến thiết bị reboot lặp ở mỗi lần kết nối),
   * nên nếu thiết bị đang offline thì lệnh sẽ mất: từ chối ngay thay vì báo thành công giả.
   */
  async create(dto: CreateCommandDto) {
    const state = await this.device.getState();
    if (!state.online) throw new ConflictException('Thiết bị đang offline, lệnh sẽ không tới được');

    const action: CommandAction = dto.action === 'reboot' ? 'REBOOT' : 'REQUEST_LOCATION';
    const existing = await this.prisma.commandLog.findFirst({
      where: { action, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
    if (existing) return existing;

    await this.mqtt.publish(this.topics.commandTopic, { action: dto.action }, { qos: 1, retain: false });
    this.logger.log(`Đã gửi lệnh ${dto.action}`);
    return this.prisma.commandLog.create({
      data: { action, expiresAt: new Date(Date.now() + COMMAND_TTL_MS) },
    });
  }

  list(limit = 20) {
    return this.prisma.commandLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  // reboot: thiết bị phản hồi cmd/resp "accepted"
  @OnEvent(EVT.CMD_RESP)
  async onCmdResp(msg: DeviceMsg<CmdRespPayload>): Promise<void> {
    try {
      const { action, status } = msg.payload;
      if (action === 'reboot' && (status === 'accepted' || status === 'ok')) {
        await this.resolveLatest('REBOOT');
      }
    } catch (e) {
      this.logger.error(`onCmdResp: ${(e as Error).message}`);
    }
  }

  // request_location: firmware không có cmd/resp, chỉ publish event LOCATION_UPDATE
  @OnEvent(EVT.DEVICE_EVENT)
  async onDeviceEvent(msg: DeviceMsg<EventPayload>): Promise<void> {
    try {
      if (msg.payload.type === 'LOCATION_UPDATE') await this.resolveLatest('REQUEST_LOCATION');
    } catch (e) {
      this.logger.error(`onDeviceEvent: ${(e as Error).message}`);
    }
  }

  private async resolveLatest(action: CommandAction): Promise<void> {
    const cmd = await this.prisma.commandLog.findFirst({
      where: { action, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (cmd) {
      await this.prisma.commandLog.update({
        where: { id: cmd.id },
        data: { status: 'OK', resolvedAt: new Date() },
      });
    }
  }

  @Interval(10_000)
  async expireOld(): Promise<void> {
    try {
      await this.prisma.commandLog.updateMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED', resolvedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`expireOld: ${(e as Error).message}`);
    }
  }
}
