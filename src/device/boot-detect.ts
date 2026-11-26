/** Phát hiện thiết bị vừa khởi động lại từ uptime_s trong bản tin status. */
export function estimateBootAt(receivedAt: Date, uptimeS: number): Date {
  return new Date(receivedAt.getTime() - uptimeS * 1000);
}

/**
 * Mốc khởi động ước tính khác mốc đã lưu quá ngưỡng => đã khởi động lại.
 * (Kết nối lại MQTT mà không reboot cho mốc gần như không đổi, chỉ lệch độ trễ mạng.)
 */
export function isNewBoot(prevBootedAt: Date | null, estimated: Date, toleranceMs = 60_000): boolean {
  if (prevBootedAt === null) return false;
  return Math.abs(estimated.getTime() - prevBootedAt.getTime()) > toleranceMs;
}
