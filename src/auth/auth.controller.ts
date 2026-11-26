import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ErrorResponse, LoginResponse } from '../docs/api-models';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@ApiTags('1. Đăng nhập')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Chống dò mật khẩu: tối đa 5 lần/phút theo IP. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đăng nhập, lấy JWT',
    description: [
      'Đăng nhập bằng tài khoản cố định để lấy `accessToken`. **Đây là API đầu tiên cần gọi**; mọi API khác (trừ `/health`) đều cần token này.',
      '',
      '**Cách dùng trong Swagger:** gọi API này → copy `accessToken` → bấm nút **Authorize** (ổ khóa, góc trên bên phải) → dán token → **Authorize**. Từ đó các request khác tự gắn token.',
      '',
      '**Giới hạn:** tối đa **5 lần/phút/IP**. Vượt quá sẽ bị trả `429` và phải chờ.',
    ].join('\n'),
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      dangNhap: { summary: 'Đăng nhập', value: { username: 'admin', password: 'mat-khau-cua-ban' } },
    },
  })
  @ApiOkResponse({ description: 'Đăng nhập thành công.', type: LoginResponse })
  @ApiBadRequestResponse({ description: 'Thiếu `username`/`password` hoặc có trường thừa.', type: ErrorResponse })
  @ApiUnauthorizedResponse({ description: 'Sai tài khoản hoặc mật khẩu.', type: ErrorResponse })
  @ApiTooManyRequestsResponse({ description: 'Đăng nhập quá 5 lần trong 1 phút.', type: ErrorResponse })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }
}
