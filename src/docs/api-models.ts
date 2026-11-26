import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Các lớp dưới đây CHỈ dùng để Swagger vẽ ra cấu trúc JSON trả về.
 * Chúng không ảnh hưởng tới logic của BE (BE vẫn trả thẳng dữ liệu từ Prisma/service).
 */

const DATE_TIME = { type: String, format: 'date-time' } as const;

// ---------------------------------------------------------------- Lỗi chung
export class ErrorResponse {
  @ApiProperty({ example: 400, description: 'Mã HTTP' })
  statusCode!: number;

  @ApiProperty({
    example: 'Không tìm thấy sự cố',
    type: String,
    description: 'Thông báo lỗi. Với lỗi 400 (sai dữ liệu gửi lên) trường này là MẢNG chuỗi, mỗi chuỗi mô tả một trường sai.',
  })
  message!: string | string[];

  @ApiProperty({ example: 'Not Found', description: 'Tên mã lỗi HTTP' })
  error!: string;
}

// ---------------------------------------------------------------- Auth
export class LoginResponse {
  @ApiProperty({
    description: 'JWT. Gửi kèm mọi request khác qua header `Authorization: Bearer <accessToken>`.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvd25lciJ9.xxxxx',
  })
  accessToken!: string;

  @ApiProperty({ example: '30d', description: 'Thời hạn token, lấy từ biến môi trường `JWT_EXPIRES_IN`.' })
  expiresIn!: string;
}

// ---------------------------------------------------------------- Health
export class HealthResponse {
  @ApiProperty({ example: 'ok', enum: ['ok', 'error'] })
  status!: string;

  @ApiProperty({ example: true, description: 'Kết nối được PostgreSQL (Supabase) hay không.' })
  db!: boolean;

  @ApiProperty({ example: true, description: 'Đang kết nối được MQTT broker hay không.' })
  mqtt!: boolean;
}

// ---------------------------------------------------------------- Device
export class DeviceStateView {
  @ApiProperty({ example: 1, description: 'Luôn bằng 1 (chỉ có một thiết bị).' })
  id!: number;

  @ApiProperty({ example: 'esp_a1b2c3d4e5f6', description: 'Mã thiết bị (biến môi trường `DEVICE_ID`).' })
  deviceId!: string;

  @ApiProperty({ example: true, description: 'Thiết bị đang online hay không (dựa vào heartbeat/LWT).' })
  online!: boolean;

  @ApiPropertyOptional({ example: 'v2.0.0', nullable: true, description: 'Phiên bản firmware.' })
  firmware!: string | null;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true, description: 'Lần cuối BE nhận được tín hiệu từ thiết bị.' })
  lastSeenAt!: string | null;

  @ApiPropertyOptional({ example: 12, nullable: true, description: 'Số giây kể từ lần cuối thấy thiết bị (dùng để hiển thị "12 giây trước").' })
  lastSeenAgoS!: number | null;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true, description: 'Thời điểm khởi động ước tính (suy từ `uptime_s`).' })
  bootedAt!: string | null;

  @ApiPropertyOptional({ example: 3600, nullable: true, description: 'Số giây thiết bị đã chạy kể từ lần khởi động gần nhất.' })
  uptimeS!: number | null;

  @ApiPropertyOptional({ example: 20, nullable: true, description: 'Chất lượng sóng 4G (CSQ) từ 0 đến 31; 99 = không rõ. Càng cao càng tốt.' })
  signal!: number | null;

  @ApiPropertyOptional({ example: true, nullable: true, description: 'Cảm biến chuyển động (IMU) hoạt động bình thường.' })
  imuOk!: boolean | null;

  @ApiPropertyOptional({ example: true, nullable: true, description: 'GPS đang có tín hiệu (fix).' })
  gpsFix!: boolean | null;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Số liên hệ khẩn cấp mà THIẾT BỊ đang giữ (nên bằng số liên hệ ở BE).' })
  contactsCnt!: number | null;

  @ApiPropertyOptional({ example: 180000, nullable: true, description: 'Bộ nhớ heap còn trống của ESP32 (byte).' })
  heap!: number | null;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class DeviceHealthItem {
  @ApiProperty({ example: 'cm3x9k2l00001abcd' })
  id!: string;

  @ApiPropertyOptional({ example: 20, nullable: true })
  signal!: number | null;

  @ApiPropertyOptional({ example: true, nullable: true })
  imuOk!: boolean | null;

  @ApiPropertyOptional({ example: true, nullable: true })
  gpsFix!: boolean | null;

  @ApiPropertyOptional({ example: 180000, nullable: true })
  heap!: number | null;

  @ApiProperty({ ...DATE_TIME, description: 'Thời điểm BE nhận heartbeat.' })
  at!: string;
}

export class DeviceHealthHistoryResponse {
  @ApiProperty({ type: [DeviceHealthItem], description: 'Mới nhất trước.' })
  items!: DeviceHealthItem[];
}

// ---------------------------------------------------------------- Incidents
export class SmsDeliveryModel {
  @ApiProperty({ example: 'cm3x9k2l00002abcd' })
  id!: string;

  @ApiPropertyOptional({ example: 'cm3x9k2l00000abcd', nullable: true, description: 'Sự cố mà tin SMS này được gắn vào.' })
  incidentId!: string | null;

  @ApiProperty({ example: '+84901234567', description: 'Số điện thoại thiết bị đã gửi SMS tới.' })
  phone!: string;

  @ApiProperty({ example: true, description: 'true = SMS gửi thành công, false = thất bại.' })
  success!: boolean;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true })
  deviceTime!: string | null;

  @ApiProperty(DATE_TIME)
  at!: string;
}

export class IncidentModel {
  @ApiProperty({ example: 'cm3x9k2l00000abcd', description: 'Mã sự cố (dùng làm `:id` và `cursor`).' })
  id!: string;

  @ApiProperty({
    enum: ['FALL', 'HELP_REQUEST'],
    example: 'FALL',
    description: '`FALL` = thiết bị phát hiện ngã. `HELP_REQUEST` = người đeo bấm nút SOS.',
  })
  type!: string;

  @ApiProperty({
    enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
    example: 'OPEN',
    description:
      '`OPEN` = mới, chưa ai xác nhận. `ACKNOWLEDGED` = đã có người xác nhận. `RESOLVED` = đã xử lý xong. `CANCELLED` = người đeo tự hủy trong cửa sổ cảnh báo (chỉ lưu vết, không báo).',
  })
  status!: string;

  @ApiPropertyOptional({ example: 0.93, nullable: true, description: 'Độ tin cậy của mô hình phát hiện ngã (0-1).' })
  confidence!: number | null;

  @ApiPropertyOptional({ example: 21.028511, nullable: true, description: 'Vĩ độ. null nếu chưa có GPS.' })
  lat!: number | null;

  @ApiPropertyOptional({ example: 105.804817, nullable: true, description: 'Kinh độ. null nếu chưa có GPS.' })
  lon!: number | null;

  @ApiProperty({ example: true, description: 'true = vị trí còn mới; false = vị trí cũ hoặc không có.' })
  gpsValid!: boolean;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Tuổi của vị trí (giây) lúc thiết bị gửi.' })
  gpsAgeS!: number | null;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true, description: 'Giờ do thiết bị báo (null nếu thiết bị chưa có giờ GPS).' })
  deviceTime!: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'Giờ BE nhận sự cố. Danh sách được sắp xếp theo trường này.' })
  receivedAt!: string;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true })
  ackedAt!: string | null;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true })
  resolvedAt!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Mã sự kiện do firmware gửi (nếu có) để chống trùng chính xác.' })
  eventId!: string | null;

  @ApiProperty({ type: [SmsDeliveryModel], description: 'Kết quả SMS thiết bị đã gửi cho người thân cho sự cố này.' })
  sms!: SmsDeliveryModel[];
}

export class IncidentListResponse {
  @ApiProperty({ type: [IncidentModel], description: 'Mới nhất trước.' })
  items!: IncidentModel[];

  @ApiPropertyOptional({
    example: 'cm3x9k2l00000abcd',
    nullable: true,
    description: 'Truyền giá trị này vào `cursor` để lấy trang kế tiếp. `null` = đã hết dữ liệu.',
  })
  nextCursor!: string | null;
}

// ---------------------------------------------------------------- Location
export class LocationView {
  @ApiProperty({ example: 'cm3x9k2l00003abcd' })
  id!: string;

  @ApiProperty({ example: 21.028511 })
  lat!: number;

  @ApiProperty({ example: 105.804817 })
  lon!: number;

  @ApiProperty({ example: true, description: 'true = vị trí còn mới lúc thiết bị gửi.' })
  valid!: boolean;

  @ApiPropertyOptional({ example: 2, nullable: true, description: 'Tuổi vị trí (giây) lúc thiết bị gửi.' })
  ageS!: number | null;

  @ApiProperty({ example: 'FALL', description: 'Loại sự kiện kèm vị trí: FALL, HELP_REQUEST, LOCATION_UPDATE...' })
  source!: string;

  @ApiProperty({ ...DATE_TIME, description: 'Thời điểm BE nhận vị trí.' })
  at!: string;

  @ApiProperty({
    example: 185,
    description: 'Tuổi hiệu dụng (giây) = tuổi lúc gửi + thời gian đã trôi qua. Dùng để hiển thị "cập nhật 3 phút trước".',
  })
  effectiveAgeS!: number;

  @ApiProperty({ example: 'https://maps.google.com/?q=21.028511,105.804817', description: 'Liên kết mở Google Maps.' })
  mapUrl!: string;
}

export class LatestLocationResponse {
  @ApiPropertyOptional({ type: LocationView, nullable: true, description: 'null nếu chưa từng nhận vị trí nào.' })
  location!: LocationView | null;
}

export class LocationListResponse {
  @ApiProperty({ type: [LocationView], description: 'Mới nhất trước.' })
  items!: LocationView[];
}

// ---------------------------------------------------------------- Contacts
export class ContactModel {
  @ApiProperty({ example: 'cm3x9k2l00004abcd' })
  id!: string;

  @ApiProperty({ example: '+84901234567' })
  phone!: string;

  @ApiPropertyOptional({ example: 'Mẹ', nullable: true })
  name!: string | null;

  @ApiProperty({ example: 0, description: 'Thứ tự trong danh sách (0 = số đầu tiên).' })
  position!: number;

  @ApiProperty({
    enum: ['PENDING', 'SYNCED', 'FAILED'],
    example: 'SYNCED',
    description:
      '`PENDING` = đã lưu ở BE, chờ thiết bị xác nhận. `SYNCED` = thiết bị đã nhận. `FAILED` = thiết bị từ chối.',
  })
  sync!: string;

  @ApiProperty(DATE_TIME)
  updatedAt!: string;
}

export class ContactsListResponse {
  @ApiProperty({ type: [ContactModel] })
  contacts!: ContactModel[];
}

export class ReplaceContactsResponse {
  @ApiProperty({ type: [ContactModel] })
  contacts!: ContactModel[];

  @ApiProperty({
    enum: ['sent', 'queued'],
    example: 'sent',
    description: '`sent` = đã gửi tới broker, chờ thiết bị xác nhận. `queued` = broker đang lỗi, BE sẽ tự thử lại.',
  })
  delivery!: string;
}

// ---------------------------------------------------------------- Commands
export class CommandModel {
  @ApiProperty({ example: 'cm3x9k2l00005abcd' })
  id!: string;

  @ApiProperty({ enum: ['REBOOT', 'REQUEST_LOCATION'], example: 'REQUEST_LOCATION', description: 'Lưu ý: ở phản hồi, tên lệnh viết HOA.' })
  action!: string;

  @ApiProperty({
    enum: ['PENDING', 'OK', 'EXPIRED'],
    example: 'PENDING',
    description: '`PENDING` = đang chờ thiết bị. `OK` = thiết bị đã làm. `EXPIRED` = quá 60 giây không thấy phản hồi.',
  })
  status!: string;

  @ApiProperty({ ...DATE_TIME, description: 'Quá thời điểm này mà chưa có phản hồi thì chuyển `EXPIRED`.' })
  expiresAt!: string;

  @ApiProperty(DATE_TIME)
  createdAt!: string;

  @ApiPropertyOptional({ ...DATE_TIME, nullable: true })
  resolvedAt!: string | null;
}

export class CommandListResponse {
  @ApiProperty({ type: [CommandModel], description: 'Tối đa 20 lệnh gần nhất, mới nhất trước.' })
  items!: CommandModel[];
}
