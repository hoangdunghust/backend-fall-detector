/**
 * Thiết bị chưa có giờ GPS sẽ gửi ts_ms = 0. Chỉ tin timestamp trong khoảng hợp lý,
 * còn lại dùng giờ BE nhận được.
 */
const MIN_VALID_MS = Date.UTC(2023, 0, 1);
const MAX_VALID_MS = Date.UTC(2100, 0, 1);

export function deviceTsToDate(tsMs: number | null | undefined): Date | null {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs)) return null;
  if (tsMs < MIN_VALID_MS || tsMs > MAX_VALID_MS) return null;
  return new Date(tsMs);
}

/** Tuổi hiệu dụng của một fix: tuổi lúc thiết bị gửi + thời gian đã trôi qua kể từ khi BE nhận. */
export function effectiveAgeS(
  ageS: number | null | undefined,
  receivedAt: Date,
  now: Date = new Date(),
): number | null {
  if (ageS === null || ageS === undefined) return null;
  const elapsed = Math.max(0, Math.floor((now.getTime() - receivedAt.getTime()) / 1000));
  return ageS + elapsed;
}

export function formatAgeVi(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  return `${Math.floor(s / 86400)} ngày`;
}
