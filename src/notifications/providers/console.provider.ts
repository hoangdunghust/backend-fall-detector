import { Logger } from '@nestjs/common';
import { NotifyMessage, PushProvider } from '../notify.types';

/** Chỉ ghi log — dùng khi chưa cấu hình FCM. */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Push[console]');

  async send(tokens: string[], msg: NotifyMessage): Promise<{ invalidTokens: string[] }> {
    this.logger.log(`(${tokens.length} thiết bị) [${msg.level}] ${msg.title} — ${msg.body}`);
    return { invalidTokens: [] };
  }
}
