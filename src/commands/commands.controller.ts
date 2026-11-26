import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CommandListResponse, CommandModel, ErrorResponse } from '../docs/api-models';
import { CommandsService } from './commands.service';
import { CreateCommandDto } from './dto/create-command.dto';

@ApiTags('7. Lệnh điều khiển thiết bị')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller('commands')
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  /** reboot | request_location. 202: đã gửi, kết quả theo dõi qua GET /commands (PENDING -> OK/EXPIRED). */
  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Gửi lệnh cho thiết bị',
    description: [
      'Gửi một lệnh xuống thiết bị qua MQTT. Có 2 lệnh:',
      '- `request_location`: yêu cầu thiết bị gửi vị trí GPS hiện tại (xem kết quả ở `GET /location`).',
      '- `reboot`: khởi động lại thiết bị.',
      '',
      '**Trả `202`** nghĩa là lệnh ĐÃ ĐƯỢC GỬI, chưa chắc thiết bị đã thực hiện. Theo dõi kết quả bằng `GET /commands`: `PENDING` → `OK` (thiết bị đã làm) hoặc `EXPIRED` (quá **60 giây** không thấy phản hồi).',
      '',
      '**Thiết bị offline → trả `409`.** Lệnh không được giữ lại cho lần kết nối sau (để tránh thiết bị tự khởi động lại lặp đi lặp lại), nên BE từ chối ngay thay vì báo thành công giả.',
      '',
      'Nếu đã có lệnh cùng loại đang `PENDING` và còn hạn thì BE trả lại lệnh đó, không gửi thêm.',
    ].join('\n'),
  })
  @ApiBody({
    type: CreateCommandDto,
    examples: {
      yeuCauViTri: { summary: 'Yêu cầu vị trí', value: { action: 'request_location' } },
      khoiDongLai: { summary: 'Khởi động lại thiết bị', value: { action: 'reboot' } },
    },
  })
  @ApiAcceptedResponse({ description: 'Lệnh đã gửi, đang chờ thiết bị (`status = PENDING`).', type: CommandModel })
  @ApiBadRequestResponse({ description: '`action` không phải `reboot` hoặc `request_location`.', type: ErrorResponse })
  @ApiConflictResponse({ description: 'Thiết bị đang offline nên lệnh không thể tới nơi.', type: ErrorResponse })
  create(@Body() dto: CreateCommandDto) {
    return this.commands.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Các lệnh gần đây',
    description:
      'Tối đa 20 lệnh gần nhất, mới nhất trước, kèm trạng thái `PENDING` / `OK` / `EXPIRED`. Dùng để kiểm tra lệnh vừa gửi đã được thiết bị thực hiện chưa.',
  })
  @ApiOkResponse({ description: 'Danh sách lệnh.', type: CommandListResponse })
  async list() {
    return { items: await this.commands.list() };
  }
}
