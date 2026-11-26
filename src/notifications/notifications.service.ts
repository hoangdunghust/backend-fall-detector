import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyMessage, PUSH_PROVIDER, PushProvider } from './notify.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  /** Không bao giờ ném lỗi: việc gửi thông báo thất bại không được làm hỏng luồng xử lý cảnh báo. */
  async notify(msg: NotifyMessage): Promise<void> {
    try {
      this.logger.log(`[${msg.level}] ${msg.title} — ${msg.body}`);
      const rows = await this.prisma.pushToken.findMany({ select: { token: true } });
      const tokens = rows.map((r: { token: string }) => r.token);
      if (tokens.length === 0) {
        this.logger.warn('Chưa có push token nào (app chưa gọi POST /push-token) — không có ai nhận thông báo');
        return;
      }
      const res = await this.provider.send(tokens, msg);
      if (res.invalidTokens.length > 0) {
        await this.prisma.pushToken.deleteMany({ where: { token: { in: res.invalidTokens } } });
        this.logger.log(`Đã xóa ${res.invalidTokens.length} push token hết hạn`);
      }
    } catch (e) {
      this.logger.error(`Gửi thông báo thất bại: ${(e as Error).message}`);
    }
  }

  async registerToken(token: string): Promise<void> {
    await this.prisma.pushToken.upsert({ where: { token }, update: {}, create: { token } });
  }

  async removeToken(token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }
}
