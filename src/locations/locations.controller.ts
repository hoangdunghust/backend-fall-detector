import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DateRangeQuery } from '../common/dto/date-range.query';
import { ErrorResponse, LatestLocationResponse, LocationListResponse } from '../docs/api-models';
import { LocationsService } from './locations.service';

@ApiTags('5. Vị trí GPS')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  /** Vị trí gần nhất kèm tuổi hiệu dụng. Thiết bị chỉ gửi vị trí khi có sự kiện hoặc khi được yêu cầu (POST /commands). */
  @Get('location')
  @ApiOperation({
    summary: 'Vị trí gần nhất',
    description: [
      'Vị trí GPS mới nhất BE đã nhận, kèm `mapUrl` để mở Google Maps.',
      '',
      '**Lưu ý quan trọng:** thiết bị KHÔNG gửi vị trí liên tục (để tiết kiệm pin và dữ liệu 4G). Nó chỉ gửi khi có sự kiện (ngã, SOS) hoặc khi được yêu cầu. Muốn làm mới vị trí:',
      '1. Gọi `POST /commands` với `{ "action": "request_location" }`.',
      '2. Chờ vài giây rồi gọi lại API này.',
      '',
      '`effectiveAgeS` cho biết vị trí đã "cũ" bao nhiêu giây (gồm cả thời gian đã trôi qua kể từ lúc nhận). Dùng nó để hiển thị "cập nhật 3 phút trước".',
      '',
      'Nếu chưa từng nhận vị trí nào thì `location = null`.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Vị trí gần nhất (hoặc `location: null`).', type: LatestLocationResponse })
  latest() {
    return this.locations.latest();
  }

  @Get('locations')
  @ApiOperation({
    summary: 'Lịch sử vị trí',
    description: [
      'Danh sách vị trí đã ghi, **mới nhất trước**. Lọc bằng `from`/`to` (ISO 8601), giới hạn bằng `limit`.',
      '',
      'Dữ liệu cũ hơn `LOCATION_RETENTION_DAYS` (mặc định **90 ngày**) bị dọn tự động lúc 3 giờ sáng.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Danh sách vị trí.', type: LocationListResponse })
  @ApiBadRequestResponse({ description: 'Tham số `from`, `to` hoặc `limit` không hợp lệ.', type: ErrorResponse })
  list(@Query() q: DateRangeQuery) {
    return this.locations.list(q.from, q.to, q.limit);
  }
}
