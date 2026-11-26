import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse, IncidentListResponse, IncidentModel } from '../docs/api-models';
import { ListIncidentsQuery } from './dto/list-incidents.query';
import { IncidentsService } from './incidents.service';

const ID_PARAM = {
  name: 'id',
  description: 'Mã sự cố (trường `id` trong danh sách sự cố).',
  example: 'cm3x9k2l00000abcd',
};

@ApiTags('4. Sự cố (té ngã / SOS)')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai JWT (chưa đăng nhập / token hết hạn).', type: ErrorResponse })
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** Lịch sử cảnh báo, mới nhất trước. Phân trang bằng cursor. */
  @Get()
  @ApiOperation({
    summary: 'Danh sách sự cố (lịch sử cảnh báo)',
    description: [
      'Lịch sử các sự cố (ngã hoặc bấm SOS), **mới nhất trước**, kèm kết quả SMS thiết bị đã gửi cho người thân.',
      '',
      '**Phân trang bằng cursor:**',
      '1. Gọi lần đầu không có `cursor`.',
      '2. Nếu kết quả có `nextCursor` khác `null`, gọi lại với `cursor=<nextCursor>` để lấy trang kế.',
      '3. Dừng khi `nextCursor = null`.',
      '',
      '**Lọc theo trạng thái** bằng `status`. Ví dụ `status=OPEN` để chỉ hiện các sự cố chưa ai xác nhận.',
      '',
      '**Vòng đời sự cố:** `OPEN` → `ACKNOWLEDGED` (gọi `/ack`) → `RESOLVED` (gọi `/resolve`). `CANCELLED` là trường hợp người đeo tự hủy cảnh báo, chỉ để lưu vết và không có thông báo.',
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Một trang sự cố.', type: IncidentListResponse })
  @ApiBadRequestResponse({ description: 'Tham số `limit`, `cursor` hoặc `status` không hợp lệ.', type: ErrorResponse })
  list(@Query() q: ListIncidentsQuery) {
    return this.incidents.list(q);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết một sự cố',
    description: 'Trả về đầy đủ thông tin một sự cố: loại, trạng thái, vị trí GPS, các mốc thời gian và danh sách SMS đã gửi.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ description: 'Chi tiết sự cố.', type: IncidentModel })
  @ApiNotFoundResponse({ description: 'Không có sự cố với `id` này.', type: ErrorResponse })
  get(@Param('id') id: string) {
    return this.incidents.get(id);
  }

  @Post(':id/ack')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Xác nhận đã nhận cảnh báo',
    description: [
      'Người chăm sóc báo "tôi đã nhận được cảnh báo này". Chuyển `OPEN` → `ACKNOWLEDGED` và ghi `ackedAt`.',
      '',
      '**Gọi lại nhiều lần không sao** (idempotent): nếu đã `ACKNOWLEDGED` thì trả lại sự cố như cũ.',
      '',
      'Không dùng được khi sự cố đã `RESOLVED` hoặc `CANCELLED` (trả `409`).',
    ].join('\n'),
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ description: 'Sự cố sau khi cập nhật.', type: IncidentModel })
  @ApiNotFoundResponse({ description: 'Không có sự cố với `id` này.', type: ErrorResponse })
  @ApiConflictResponse({ description: 'Sự cố không còn ở trạng thái `OPEN` (đã xử lý xong hoặc đã bị hủy).', type: ErrorResponse })
  ack(@Param('id') id: string) {
    return this.incidents.ack(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Đánh dấu đã xử lý xong',
    description: [
      'Chuyển sự cố sang `RESOLVED` và ghi `resolvedAt`. Nếu trước đó chưa xác nhận, `ackedAt` được ghi luôn cùng lúc.',
      '',
      '**Gọi lại nhiều lần không sao** (idempotent). Không dùng được với sự cố `CANCELLED` (trả `409`).',
    ].join('\n'),
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ description: 'Sự cố sau khi cập nhật.', type: IncidentModel })
  @ApiNotFoundResponse({ description: 'Không có sự cố với `id` này.', type: ErrorResponse })
  @ApiConflictResponse({ description: 'Sự cố đã bị người đeo hủy (`CANCELLED`).', type: ErrorResponse })
  resolve(@Param('id') id: string) {
    return this.incidents.resolve(id);
  }
}
