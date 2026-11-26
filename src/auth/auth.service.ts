import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'crypto';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** Một tài khoản cố định lấy từ cấu hình (không có đăng ký). */
@Injectable()
export class AuthService {
  private readonly usernameDigest: Buffer;

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.usernameDigest = sha256(cfg.auth.username);
  }

  async login(username: string, password: string): Promise<{ accessToken: string; expiresIn: string }> {
    // So sánh hằng thời gian và LUÔN chạy cả hai phép kiểm tra, để không lộ tên tài khoản có đúng hay không
    const userOk = timingSafeEqual(sha256(username), this.usernameDigest);
    const passOk = await bcrypt.compare(password, this.cfg.auth.passwordHash);
    if (!userOk || !passOk) throw new UnauthorizedException('Sai tài khoản hoặc mật khẩu');

    const accessToken = await this.jwt.signAsync({ sub: 'owner' });
    return { accessToken, expiresIn: this.cfg.auth.jwtExpiresIn };
  }
}
