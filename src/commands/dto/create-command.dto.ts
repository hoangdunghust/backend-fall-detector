import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const COMMAND_ACTIONS = ['reboot', 'request_location'] as const;

export class CreateCommandDto {
  @ApiProperty({
    enum: COMMAND_ACTIONS,
    example: 'request_location',
    description:
      '`reboot` = khởi động lại thiết bị. `request_location` = yêu cầu thiết bị gửi vị trí GPS hiện tại (kết quả xem ở `GET /location`).',
  })
  @IsIn(COMMAND_ACTIONS)
  action!: (typeof COMMAND_ACTIONS)[number];
}
