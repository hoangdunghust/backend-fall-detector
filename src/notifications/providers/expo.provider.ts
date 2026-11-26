import { Logger } from '@nestjs/common';
import { NotifyMessage, PushProvider } from '../notify.types';

/** Dịch vụ Expo Push: nhận tối đa 100 tin mỗi request, trả "ticket" theo đúng thứ tự gửi. */
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH_SIZE = 100;

const EXPO_TOKEN_REGEX = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;
export const isExpoPushToken = (t: string): boolean => EXPO_TOKEN_REGEX.test(t);

/** id kênh Android: PHẢI trùng với kênh app tạo (alerts / warnings / info). */
const CHANNEL: Record<NotifyMessage['level'], string> = {
  ALERT: 'alerts',
  WARNING: 'warnings',
  INFO: 'info',
};

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  priority: 'default' | 'high';
  channelId: string;
  ttl: number; // giây
  interruptionLevel: 'active' | 'time-sensitive';
}

/** Cảnh báo dùng ưu tiên cao + time-sensitive (iOS) để đánh thức app ngay cả khi điện thoại đang ngủ. */
export function buildExpoMessage(token: string, msg: NotifyMessage): ExpoMessage {
  return {
    to: token,
    title: msg.title,
    body: msg.body,
    data: msg.data ?? {},
    sound: 'default',
    priority: msg.level === 'INFO' ? 'default' : 'high',
    channelId: CHANNEL[msg.level],
    ttl: msg.level === 'ALERT' ? 3600 : 6 * 3600,
    interruptionLevel: msg.level === 'ALERT' ? 'time-sensitive' : 'active',
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface TicketOutcome {
  ok: boolean;
  /** Token không còn dùng được (app đã gỡ / hủy đăng ký) => nên xóa khỏi DB. */
  invalid: boolean;
  error?: string;
}

/**
 * Đọc phần `data` trong phản hồi của Expo. Phản hồi sai hình dạng (hoặc lệch số lượng) được coi là
 * thất bại tạm thời của cả lô, KHÔNG xóa token.
 */
export function interpretTickets(body: unknown, expectedCount: number): TicketOutcome[] {
  const data = typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    return Array.from({ length: expectedCount }, () => ({ ok: false, invalid: false, error: 'phản hồi không hợp lệ' }));
  }
  return data.map((t: unknown): TicketOutcome => {
    const ticket = (typeof t === 'object' && t !== null ? t : {}) as {
      status?: string;
      message?: string;
      details?: { error?: string };
    };
    if (ticket.status === 'ok') return { ok: true, invalid: false };
    const code = ticket.details?.error;
    return { ok: false, invalid: code === 'DeviceNotRegistered', error: code ?? ticket.message ?? 'lỗi không rõ' };
  });
}

export interface ExpoProviderOptions {
  /** Access token của Expo (tùy chọn, bật "enhanced push security" nếu bạn đã bật trong dự án). */
  accessToken?: string;
  fetchImpl?: typeof fetch;
  url?: string;
  timeoutMs?: number;
}

export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger('Push[expo]');
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ExpoProviderOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  async send(tokens: string[], msg: NotifyMessage): Promise<{ invalidTokens: string[] }> {
    // Token sai định dạng (ví dụ token FCM cũ còn sót) không thể gửi qua Expo => coi là hết hạn
    const invalid = tokens.filter((t) => !isExpoPushToken(t));
    const valid = tokens.filter((t) => isExpoPushToken(t));

    for (const batch of chunk(valid, EXPO_BATCH_SIZE)) {
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (this.opts.accessToken) headers.Authorization = `Bearer ${this.opts.accessToken}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 10_000);
      let res: Response;
      let text: string;
      try {
        res = await this.fetchImpl(this.opts.url ?? EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch.map((t) => buildExpoMessage(t, msg))),
          signal: controller.signal,
        });
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const errors = (json as { errors?: Array<{ message?: string }> } | undefined)?.errors;
        throw new Error(`Expo Push HTTP ${res.status}: ${errors?.[0]?.message ?? text.slice(0, 200)}`);
      }

      const outcomes = interpretTickets(json, batch.length);
      let okCount = 0;
      outcomes.forEach((o, i) => {
        if (o.ok) okCount++;
        else if (o.invalid) invalid.push(batch[i]);
        else this.logger.warn(`Gửi push thất bại: ${o.error}`);
      });
      this.logger.log(`Đã gửi push: ${okCount}/${batch.length} thành công`);
    }
    return { invalidTokens: invalid };
  }
}
