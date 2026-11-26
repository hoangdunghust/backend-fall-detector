import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as admin from 'firebase-admin';
import { NotifyMessage, PushProvider } from '../notify.types';

const INVALID_TOKEN_CODES = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

const CHANNEL: Record<NotifyMessage['level'], string> = {
  ALERT: 'alerts',
  WARNING: 'warnings',
  INFO: 'info',
};

export interface FcmOptions {
  serviceAccountPath?: string;
  serviceAccountJson?: string;
}

/** Firebase Cloud Messaging (firebase-admin). Cảnh báo dùng ưu tiên cao để đánh thức app ngay cả khi đang ngủ. */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger('Push[fcm]');
  private readonly app: admin.app.App;

  constructor(opts: FcmOptions) {
    const raw = opts.serviceAccountJson ?? fs.readFileSync(opts.serviceAccountPath as string, 'utf8');
    const serviceAccount = JSON.parse(raw);
    this.app = admin.apps.length
      ? (admin.app() as admin.app.App)
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    this.logger.log(`Đã khởi tạo FCM (project ${serviceAccount.project_id ?? '?'})`);
  }

  async send(tokens: string[], msg: NotifyMessage): Promise<{ invalidTokens: string[] }> {
    const invalid: string[] = [];
    const ttlMs = msg.level === 'ALERT' ? 3_600_000 : 6 * 3_600_000;
    const highPriority = msg.level !== 'INFO';

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      // Dùng any: firmware-admin kiểm tra chặt các khóa APNs không chuẩn (interruption-level)
      const message: any = {
        tokens: chunk,
        notification: { title: msg.title, body: msg.body },
        data: msg.data ?? {},
        android: {
          priority: highPriority ? 'high' : 'normal',
          ttl: ttlMs,
          collapseKey: msg.collapseKey,
          notification: { channelId: CHANNEL[msg.level], sound: 'default' },
        },
        apns: {
          headers: {
            'apns-priority': highPriority ? '10' : '5',
            'apns-expiration': String(Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000)),
            ...(msg.collapseKey ? { 'apns-collapse-id': msg.collapseKey.slice(0, 64) } : {}),
          },
          payload: {
            aps: {
              sound: 'default',
              'interruption-level': msg.level === 'ALERT' ? 'time-sensitive' : 'active',
            },
          },
        },
      };

      const res = await admin.messaging(this.app).sendEachForMulticast(message);
      res.responses.forEach((r: { success: boolean; error?: { code?: string; message?: string } }, idx: number) => {
        if (!r.success) {
          const code = r.error?.code ?? '';
          if (INVALID_TOKEN_CODES.includes(code)) invalid.push(chunk[idx]);
          else this.logger.warn(`Gửi push thất bại: ${code} ${r.error?.message ?? ''}`);
        }
      });
      this.logger.log(`Đã gửi push: ${res.successCount}/${chunk.length} thành công`);
    }
    return { invalidTokens: invalid };
  }
}
