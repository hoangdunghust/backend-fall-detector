import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PushTokenDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description:
      'Token nhận thông báo đẩy của điện thoại: `ExponentPushToken[...]` nếu `NOTIFY_PROVIDER=expo`, hoặc token FCM nếu `NOTIFY_PROVIDER=fcm`.',
    minLength: 20,
    maxLength: 4096,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;
}
