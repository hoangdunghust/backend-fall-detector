/** Cùng quy tắc với firmware (GSM_isValidPhone): '+' tùy chọn rồi 6-15 chữ số. */
export const PHONE_REGEX = /^\+?\d{6,15}$/;

/** Bỏ khoảng trắng, dấu chấm, gạch, ngoặc; trả về null nếu không hợp lệ. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[\s().-]/g, '');
  return PHONE_REGEX.test(cleaned) ? cleaned : null;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}
