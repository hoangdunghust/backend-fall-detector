import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ContactsListResponse, ErrorResponse, ReplaceContactsResponse } from '../docs/api-models';
import { ContactsService } from './contacts.service';
import { ReplaceContactsDto } from './dto/replace-contacts.dto';

@ApiTags('6. Số điện thoại khẩn cấp')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @ApiOperation({
    summary: 'Xem danh sách số khẩn cấp',
    description: [
      'Danh sách số điện thoại sẽ nhận SMS khi có sự cố, theo thứ tự, kèm trạng thái đồng bộ xuống thiết bị (`sync`).',
      '',
      '- `PENDING`: đã lưu ở BE, đang chờ thiết bị xác nhận đã nhận.',
      '- `SYNCED`: thiết bị đã nhận và lưu.',
      '- `FAILED`: thiết bị từ chối danh sách.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Danh sách số khẩn cấp.', type: ContactsListResponse })
  async list() {
    return { contacts: await this.contacts.list() };
  }

  /** Thay toàn bộ danh sách (1-5 số). BE lưu rồi đẩy xuống thiết bị; sync = PENDING cho tới khi thiết bị xác nhận. */
  @Put()
  @ApiOperation({
    summary: 'Đặt (thay toàn bộ) danh sách số khẩn cấp',
    description: [
      '**Việc đầu tiên cần làm khi dùng thật:** firmware không có số mặc định, nên chưa có số thì thiết bị **không gửi được SMS** khi có sự cố.',
      '',
      '**Cách hoạt động:**',
      '1. Bạn gửi danh sách ĐẦY ĐỦ (1 đến 5 số). Danh sách này **thay thế hoàn toàn** danh sách cũ, nên muốn thêm một số thì phải gửi cả các số cũ.',
      '2. BE lưu, đặt `sync = PENDING`, rồi gửi xuống thiết bị qua MQTT.',
      '3. Khi thiết bị phản hồi đã nhận, `sync` chuyển thành `SYNCED` (xem lại bằng `GET /contacts`).',
      '',
      '**Ý nghĩa `delivery` trong phản hồi:** `sent` = đã tới broker, đang chờ thiết bị. `queued` = broker đang lỗi, BE sẽ tự thử lại.',
      '',
      'Nếu thiết bị đang offline, danh sách vẫn được lưu và thiết bị sẽ nhận lại khi kết nối trở lại.',
    ].join('\n'),
  })
  @ApiBody({
    type: ReplaceContactsDto,
    examples: {
      haiSo: {
        summary: 'Hai số khẩn cấp',
        value: { contacts: [{ phone: '+84901234567', name: 'Mẹ' }, { phone: '0912345678' }] },
      },
      motSo: { summary: 'Một số', value: { contacts: [{ phone: '+84901234567', name: 'Mẹ' }] } },
    },
  })
  @ApiOkResponse({ description: 'Đã lưu và đẩy xuống thiết bị.', type: ReplaceContactsResponse })
  @ApiBadRequestResponse({
    description: 'Danh sách rỗng, quá 5 số, hoặc số điện thoại không hợp lệ (6-15 chữ số, `+` tùy chọn).',
    type: ErrorResponse,
  })
  replace(@Body() dto: ReplaceContactsDto) {
    return this.contacts.replaceAll(dto.contacts);
  }
}
