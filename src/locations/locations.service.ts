import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DeviceMsg, EVT } from '../common/events';
import { isUsableFix } from '../common/geo.util';
import { effectiveAgeS } from '../common/time.util';
import { EventPayload } from '../mqtt/payloads';
import { mapUrl } from '../notifications/messages';
import { PrismaService } from '../prisma/prisma.service';

interface LocationRow {
  id: string;
  lat: number;
  lon: number;
  valid: boolean;
  ageS: number | null;
  source: string;
  at: Date;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** Mọi sự kiện có kèm GPS (FALL, SOS, LOCATION_UPDATE...) đều cập nhật vị trí. */
  @OnEvent(EVT.DEVICE_EVENT)
  async onDeviceEvent(msg: DeviceMsg<EventPayload>): Promise<void> {
    try {
      const g = msg.payload.gps;
      if (!g || !isUsableFix(g.lat, g.lon)) return;
      const row = await this.prisma.location.create({
        data: {
          lat: g.lat,
          lon: g.lon,
          valid: g.valid,
          ageS: g.ageS ?? null,
          source: msg.payload.type,
          at: msg.receivedAt,
        },
      });
      this.emitter.emit(EVT.LOCATION_UPDATED, this.toView(row));
    } catch (e) {
      this.logger.error(`onDeviceEvent: ${(e as Error).message}`);
    }
  }

  /**
   * ageS là tuổi fix lúc thiết bị gửi; effectiveAgeS cộng thêm thời gian đã trôi qua kể từ khi BE nhận,
   * để app hiển thị "cập nhật 3 phút trước" cho đúng.
   */
  toView(row: LocationRow, now: Date = new Date()) {
    return {
      ...row,
      effectiveAgeS: effectiveAgeS(row.ageS ?? 0, row.at, now),
      mapUrl: mapUrl(row.lat, row.lon),
    };
  }

  async latest() {
    const row = await this.prisma.location.findFirst({ orderBy: { at: 'desc' } });
    return { location: row ? this.toView(row) : null };
  }

  async list(from?: Date, to?: Date, limit = 200) {
    const rows = await this.prisma.location.findMany({
      where: { at: { gte: from, lte: to } },
      orderBy: { at: 'desc' },
      take: limit,
    });
    return { items: rows.map((r: LocationRow) => this.toView(r)) };
  }
}
