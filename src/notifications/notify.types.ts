export type NotifyLevel = 'ALERT' | 'WARNING' | 'INFO';

export interface NotifyMessage {
  level: NotifyLevel;
  title: string;
  body: string;
  /** Dữ liệu kèm cho app (FCM yêu cầu giá trị chuỗi). */
  data?: Record<string, string>;
  /** Thông báo cùng khóa sẽ thay thế nhau thay vì chồng lên. */
  collapseKey?: string;
}

export interface PushProvider {
  readonly name: string;
  send(tokens: string[], msg: NotifyMessage): Promise<{ invalidTokens: string[] }>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
