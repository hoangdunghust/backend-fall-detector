import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DateRangeQuery } from '../common/dto/date-range.query';
import { DeviceHealthHistoryResponse, DeviceStateView, ErrorResponse } from '../docs/api-models';
import { DeviceService } from './device.service';

@ApiTags('3. Thiết bị')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller('device')
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  /** Trạng thái hiện tại: online, sóng, cảm biến, GPS, số liên hệ thiết bị đang giữ... */
  @Get()
  @ApiOperation({
    summary: 'Trạng thái thiết bị hiện tại',
    description: [
      'Trả về tình trạng mới nhất của chiếc ESP32: có online không, sóng 4G, cảm biến, GPS, số liên hệ khẩn cấp thiết bị đang giữ.',
      '',
      'Thiết bị gửi heartbeat mỗi **30 giây**. Quá `HEARTBEAT_TIMEOUT_S` (mặc định **90 giây**) không có tín hiệu thì `online = false`.',
      '',
      '**Gợi ý hiển thị:** dùng `lastSeenAgoS` để hiện "12 giây trước"; cảnh báo người dùng nếu `signal` ≤ 5, `imuOk = false`, hoặc `contactsCnt` khác số liên hệ ở `GET /contacts`.',
      '',
      'Nếu chưa từng nhận tín hiệu từ thiết bị, các trường dữ liệu đều là `null` và `online = false`.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Trạng thái thiết bị.', type: DeviceStateView })
  state() {
    return this.device.getStateView();
  }

  /** Lịch sử heartbeat (sóng, imu_ok, gps_fix) để vẽ biểu đồ. */
  @Get('health')
  @ApiOperation({
    summary: 'Lịch sử sức khỏe thiết bị (heartbeat)',
    description: [
      'Danh sách các heartbeat đã ghi (sóng, cảm biến, GPS, bộ nhớ), **mới nhất trước**, dùng để vẽ biểu đồ.',
      '',
      'Lọc theo khoảng thời gian bằng `from`/`to` (ISO 8601). Dữ liệu cũ hơn `HEALTH_RETENTION_DAYS` (mặc định **30 ngày**) bị dọn tự động lúc 3 giờ sáng.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Danh sách heartbeat.', type: DeviceHealthHistoryResponse })
  @ApiBadRequestResponse({ description: 'Tham số `from`, `to` hoặc `limit` không hợp lệ.', type: ErrorResponse })
  health(@Query() q: DateRangeQuery) {
    return this.device.getHealthHistory(q.from, q.to, q.limit);
  }
}
