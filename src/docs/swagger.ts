import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Đường dẫn giao diện Swagger. JSON (OpenAPI) nằm ở `${SWAGGER_PATH}/json`. */
export const SWAGGER_PATH = 'docs';

/**
 * Mặc định: BẬT khi chạy dev, TẮT khi NODE_ENV=production (ví dụ trong Docker).
 * Ép bật/tắt bằng biến môi trường SWAGGER_ENABLED=true|false.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env.SWAGGER_ENABLED ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return env.NODE_ENV !== 'production';
}

const GUIDE = `
BE của **thiết bị phát hiện té ngã** (1 chiếc ESP32). Trang này liệt kê toàn bộ API REST và cho phép **gọi thử trực tiếp**.

\`\`\`
ESP32 ──4G──► MQTT broker ◄──► BE (NestJS) ◄── REST + WebSocket ──► App
                                  │
                                  └──► Push (Expo/FCM) ──► App (khi app đang đóng)
\`\`\`

App chỉ nói chuyện với BE, **không bao giờ** nói chuyện trực tiếp với ESP32 hay MQTT broker.

---

## Bắt đầu nhanh (5 bước)

1. **Kiểm tra BE sống:** mở nhóm *Kiểm tra hệ thống* → \`GET /health\` → **Try it out** → **Execute**. Kết quả \`db: true\` và \`mqtt: true\` là ổn.
2. **Đăng nhập:** nhóm *Đăng nhập* → \`POST /auth/login\` → nhập \`username\`, \`password\` → **Execute**. Copy giá trị \`accessToken\` trong phản hồi.
3. **Gắn token:** bấm nút **Authorize** (ổ khóa, góc trên bên phải), dán token (**không** gõ chữ \`Bearer\`) → **Authorize** → **Close**. Các API có biểu tượng ổ khóa sẽ tự gửi token.
4. **Nạp số khẩn cấp** (bắt buộc trước khi dùng thật): \`PUT /contacts\` với 1-5 số. Chưa có số thì thiết bị **không gửi được SMS**.
5. **Xem trạng thái:** \`GET /device\`, \`GET /incidents\`, \`GET /location\`.

> Chưa có phần cứng? Chạy \`npm run simulate\` ở một cửa sổ terminal khác, gõ \`fall\` hoặc \`sos\` để giả lập thiết bị, rồi gọi \`GET /incidents\` để thấy sự cố.

---

## Quy ước chung

| Nội dung | Quy ước |
|---|---|
| **Xác thực** | Header \`Authorization: Bearer <accessToken>\`. Chỉ \`/auth/login\` và \`/health\` không cần. |
| **Thời gian** | Chuỗi ISO 8601, giờ UTC, ví dụ \`2026-11-26T07:30:00.000Z\`. |
| **Giới hạn tần suất** | Chung: 120 request/phút. Riêng \`/auth/login\`: 5 lần/phút/IP. Vượt quá trả \`429\`. |
| **Dữ liệu thừa** | Gửi trường không được khai báo sẽ bị từ chối với \`400\`. |

### Mã lỗi

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| \`400\` | Dữ liệu gửi lên sai. \`message\` là **mảng** các câu mô tả từng trường sai. | Sửa theo thông báo. |
| \`401\` | Chưa đăng nhập, token sai hoặc hết hạn. | Gọi lại \`/auth/login\`, rồi Authorize lại. |
| \`404\` | Không tìm thấy (ví dụ sai \`id\` sự cố). | Kiểm tra lại \`id\`. |
| \`409\` | Xung đột trạng thái (ví dụ gửi lệnh khi thiết bị offline). | Đọc \`message\`. |
| \`429\` | Gọi quá nhiều. | Chờ khoảng 1 phút rồi thử lại. |
| \`503\` | Chỉ ở \`/health\`: database lỗi. | Kiểm tra \`DATABASE_URL\` và Supabase. |

Mọi lỗi đều có dạng:
\`\`\`json
{ "statusCode": 404, "message": "Không tìm thấy sự cố", "error": "Not Found" }
\`\`\`

---

## Các quy trình thường dùng

### A. Cài đặt lần đầu
\`PUT /contacts\` (đặt số khẩn cấp) → \`GET /contacts\` đến khi mọi số có \`sync = SYNCED\` (thiết bị đã nhận) → \`GET /device\` kiểm tra \`online\`, \`imuOk\`, \`gpsFix\`.

### B. Khi có sự cố (ngã / SOS)
1. Thiết bị tự gửi **SMS** cho các số khẩn cấp (kênh chính, **không phụ thuộc BE hay app**).
2. BE tạo sự cố \`OPEN\` và đẩy thông báo tới app (push + WebSocket).
3. Người chăm sóc mở app: \`GET /incidents?status=OPEN\` → xem \`GET /incidents/{id}\` (vị trí, SMS đã gửi).
4. Đã nhận được tin: \`POST /incidents/{id}/ack\`.
5. Xử lý xong: \`POST /incidents/{id}/resolve\`.

> Nếu người đeo bấm hủy trong cửa sổ cảnh báo, sự cố được lưu với trạng thái \`CANCELLED\` và **không** có thông báo.

### C. Làm mới vị trí
Thiết bị không gửi vị trí liên tục. \`POST /commands\` \`{ "action": "request_location" }\` → chờ vài giây → \`GET /location\`. Nếu trả \`409\` nghĩa là thiết bị đang offline.

---

## Thời gian thực (WebSocket / Socket.IO)

Swagger **không mô tả được** WebSocket, nên ghi ở đây. Kết nối tới cùng địa chỉ của BE (ví dụ \`http://localhost:3000\`) bằng thư viện **Socket.IO**, kèm token:

\`\`\`js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000', { auth: { token: accessToken } });

socket.on('incident.created', (incident) => { /* sự cố mới (kể cả bản CANCELLED để lưu vết) */ });
socket.on('incident.updated', (incident) => { /* đã ack/resolve, hoặc có kết quả SMS */ });
socket.on('device.state',     (state)    => { /* online/offline, heartbeat; gửi ngay một bản khi vừa nối */ });
socket.on('location.updated', (location) => { /* có vị trí mới */ });
socket.on('contacts.updated', (contacts) => { /* trạng thái đồng bộ danh bạ đổi */ });
socket.on('auth_error',       ()         => { /* token sai/hết hạn: BE sẽ ngắt kết nối */ });
\`\`\`

WebSocket chỉ có tác dụng khi **app đang mở**. Khi app đóng, cảnh báo đến bằng **thông báo đẩy**.

---

## Phần KHÔNG nằm trong REST API

Thiết bị ESP32 nói chuyện với BE qua **MQTT** (không phải REST): gửi sự kiện ngã/SOS, heartbeat 30 giây/lần, kết quả SMS; nhận danh sách số khẩn cấp và lệnh. Các API ở trang này chỉ là phía app. Chi tiết topic và payload xem \`README.md\`, mục *Hợp đồng MQTT*.
`.trim();

/** Gắn Swagger UI vào ứng dụng. Gọi SAU khi tạo app, TRƯỚC app.listen(). */
export function setupSwagger(app: INestApplication, deviceId: string): void {
  const config = new DocumentBuilder()
    .setTitle('API thiết bị phát hiện té ngã')
    .setDescription(`Thiết bị đang cấu hình: \`${deviceId}\`\n\n${GUIDE}`)
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Dán `accessToken` lấy từ `POST /auth/login` (không cần gõ chữ "Bearer").',
      },
      'jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    customSiteTitle: 'API thiết bị phát hiện té ngã',
    jsonDocumentUrl: `${SWAGGER_PATH}/json`,
    swaggerOptions: {
      persistAuthorization: true, // giữ token khi tải lại trang
      tagsSorter: 'alpha', // nhóm xếp theo số thứ tự trong tên (1., 2., ...)
      operationsSorter: 'alpha',
      docExpansion: 'list',
      displayRequestDuration: true,
    },
  });
}
