import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../docs/api-models';
import { PushTokenDto } from './dto/push-token.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('8. Thông báo đẩy (push)')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller('push-token')
export class PushTokenController {
  constructor(private readonly notifications: NotificationsService) {}

  /** App gửi token FCM lúc mở lần đầu (và mỗi khi token đổi). */
  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Đăng ký token nhận thông báo đẩy',
    description: [
      'App di động gọi API này **mỗi lần mở app** (và khi token đổi) để BE biết gửi thông báo đẩy tới đâu khi có sự cố mà app đang đóng.',
      '',
      'Loại token phụ thuộc biến môi trường `NOTIFY_PROVIDER`: `expo` → `ExponentPushToken[...]`; `fcm` → token FCM; `console` → chỉ ghi log, không gửi thật.',
      '',
      'Gọi nhiều lần với cùng một token không sao. Token hết hạn sẽ được BE tự xóa.',
    ].join('\n'),
  })
  @ApiBody({
    type: PushTokenDto,
    examples: { expo: { summary: 'Token Expo', value: { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' } } },
  })
  @ApiNoContentResponse({ description: 'Đã đăng ký (không có nội dung trả về).' })
  @ApiBadRequestResponse({ description: 'Token ngắn hơn 20 ký tự hoặc dài hơn 4096 ký tự.', type: ErrorResponse })
  async register(@Body() dto: PushTokenDto): Promise<void> {
    await this.notifications.registerToken(dto.token);
  }

  /** Hủy đăng ký (ví dụ khi đăng xuất). */
  @Post('remove')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Hủy đăng ký token thông báo đẩy',
    description: 'Gọi khi người dùng đăng xuất khỏi app, để điện thoại đó không nhận thông báo nữa.',
  })
  @ApiBody({ type: PushTokenDto })
  @ApiNoContentResponse({ description: 'Đã hủy đăng ký (không có nội dung trả về).' })
  @ApiBadRequestResponse({ description: 'Token không hợp lệ.', type: ErrorResponse })
  async remove(@Body() dto: PushTokenDto): Promise<void> {
    await this.notifications.removeToken(dto.token);
  }
}
