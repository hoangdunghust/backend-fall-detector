import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Bỏ qua JwtAuthGuard toàn cục (chỉ dùng cho /auth/login và /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
