import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { HealthResponse } from '../docs/api-models';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('2. Kiểm tra hệ thống')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Không cần đăng nhập: dùng cho Docker healthcheck / giám sát. 503 nếu DB hỏng. */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Kiểm tra BE còn sống không',
    description: [
      '**Không cần đăng nhập.** Dùng để kiểm tra nhanh sau khi chạy BE, hoặc cho Docker healthcheck / công cụ giám sát.',
      '',
      '- `db`: BE có truy vấn được PostgreSQL (Supabase) không. Chỉ chứng tỏ KẾT NỐI được, **không** chứng tỏ các bảng đã được tạo.',
      '- `mqtt`: BE có đang nối với MQTT broker không.',
      '',
      'DB lỗi thì trả `503`. MQTT lỗi thì vẫn trả `200` nhưng `mqtt: false` (BE tự nối lại).',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'BE hoạt động.', type: HealthResponse })
  @ApiServiceUnavailableResponse({
    description: 'Không kết nối được database. Body có dạng `{ "status": "error", "db": false, "mqtt": true }`.',
    type: HealthResponse,
  })
  async check() {
    const mqtt = this.mqtt.isConnected();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: false, mqtt });
    }
    return { status: 'ok', db: true, mqtt };
  }
}
