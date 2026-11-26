# Backend — thiết bị phát hiện té ngã (1 ESP32)

NestJS + Prisma (PostgreSQL) + MQTT. App chỉ nói chuyện với BE (REST + WebSocket + push FCM), không bao giờ nói chuyện trực tiếp với ESP hay broker.

```
ESP32 ──4G──► MQTT broker ◄──► BE (NestJS) ◄── REST + WebSocket ──► App
                                  │
                                  └──► FCM push ──► App (khi app đang đóng)
```

## Khởi động nhanh (máy cục bộ)

Cần: Node 20+, một PostgreSQL (khuyến nghị **Supabase**, xem mục [Dùng Supabase](#dùng-supabase)) và một MQTT broker.

```bash
npm install
cp .env.example .env
npm run hash-password -- "mat-khau-cua-ban"   # dán 2 dòng in ra vào .env (AUTH_PASSWORD_HASH_B64, JWT_SECRET)
# Điền DATABASE_URL + DIRECT_URL (Supabase), DEVICE_ID, MQTT_URL... trong .env
npx prisma migrate dev --name init             # tạo bảng + thư mục prisma/migrations (nên commit)
# Supabase: chạy supabase/secure.sql trong SQL Editor (khóa bảng khỏi Data API) — xem bên dưới
npm run start:dev
```

Muốn thử hoàn toàn cục bộ (không Supabase, không broker thật):

```bash
docker compose --profile local-db --profile local-broker up -d db mosquitto
# .env: DATABASE_URL và DIRECT_URL = postgresql://fall:fall_dev_password@localhost:5432/fall?schema=public
#       MQTT_URL=mqtt://localhost:1883
```

Thử không cần phần cứng, ở terminal thứ hai:

```bash
npm run simulate        # giả lập ESP, gõ: sos | fall | cancel | loc | help ...
```

Lấy JWT rồi gọi API:

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"mat-khau-cua-ban"}' | jq -r .accessToken)
curl -s localhost:3000/device -H "authorization: Bearer $TOKEN"
```

**Việc đầu tiên: nạp số khẩn cấp.** Firmware không có số mặc định, nên chưa có số thì ESP không gửi được SMS:

```bash
curl -X PUT localhost:3000/contacts -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"contacts":[{"phone":"+84901234567","name":"Mẹ"},{"phone":"+84912345678"}]}'
```
Trạng thái `sync` là `PENDING` cho tới khi thiết bị phản hồi, rồi thành `SYNCED` (hoặc `FAILED` nếu thiết bị từ chối).

## Dùng Supabase

Supabase là PostgreSQL được host sẵn, Prisma dùng bình thường. Ba việc cần làm đúng:

**1. Hai chuỗi kết nối (Supabase Dashboard → nút *Connect*).** Theo hướng dẫn của Supabase, `DATABASE_URL` là transaction pooler (cổng 6543) kèm `?pgbouncer=true` (tắt prepared statement), còn Prisma Migrate cần `DIRECT_URL` là kết nối trực tiếp hoặc session pooler (cổng 5432):

```env
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```
- Kết nối trực tiếp `db.[ref].supabase.co` mặc định chỉ có IPv6; nếu máy/VPS của bạn không có IPv6 thì dùng session pooler như trên cho `DIRECT_URL`.
- Mật khẩu có ký tự đặc biệt phải URL-encode (`@`→`%40`, `/`→`%2F`, `#`→`%23`). BE kiểm tra khi khởi động và báo rõ các lỗi hay gặp: thiếu `pgbouncer=true`, dùng user `postgres` trơn với pooler (phải là `postgres.[ref]`), `DIRECT_URL` dùng cổng 6543, URL sai định dạng. Giới hạn: `@` hoặc `#` chưa mã hóa **không** phát hiện được.
- Tùy chọn tăng cường: Supabase khuyên tạo một user riêng `prisma` thay vì dùng `postgres` (xem hướng dẫn Prisma của Supabase). User đó **phải có `BYPASSRLS`**, nếu không RLS bên dưới sẽ chặn luôn cả BE.

**2. Khóa bảng khỏi API tự sinh của Supabase — quan trọng.** Supabase tự sinh REST/GraphQL API cho schema `public`; bảng không bật RLS có thể bị đọc/ghi bởi bất kỳ ai có URL dự án và anon key (khóa công khai). Bảng của BE chứa vị trí GPS, lịch sử cảnh báo, danh bạ khẩn cấp và token FCM. Sau khi chạy `migrate`/`db push`, dán `supabase/secure.sql` vào *SQL Editor* và Run: nó bật RLS (không policy) và thu hồi quyền của `anon`/`authenticated` trên các bảng của BE. BE vẫn truy cập bình thường vì Prisma kết nối bằng vai trò bỏ qua RLS. Chạy lại mỗi khi thêm bảng. Supabase đã thay đổi mặc định để bảng mới không tự mở ra Data API, nhưng đừng dựa vào đó: script này rẻ và chạy lại được.

**3. Chọn gói cho phù hợp với thiết bị an toàn.** Nếu DB bị tạm dừng hoặc mất dữ liệu thì BE không lưu được sự cố và không đẩy được push tới app (SMS của ESP vẫn đi). Hãy kiểm tra chính sách tạm dừng dự án không hoạt động, giới hạn dung lượng và sao lưu của gói bạn dùng trên trang giá của Supabase (tôi chưa xác minh các chi tiết này). Lượng ghi của BE nhỏ: 2 lần ghi mỗi 30 giây (heartbeat), lịch sử tự dọn sau `HEALTH_RETENTION_DAYS`.

Không dùng Supabase Auth/Realtime: BE tự có đăng nhập 1 tài khoản và WebSocket riêng, Supabase chỉ đóng vai PostgreSQL.

## Biến môi trường

Xem `.env.example`. BE kiểm tra toàn bộ khi khởi động và in ra mọi lỗi cấu hình một lần.

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL (Supabase): pooler 6543 + `?pgbouncer=true` cho ứng dụng; kết nối trực tiếp/session pooler 5432 cho Prisma CLI |
| `DEVICE_ID` | `esp_` + 12 hex thường — ESP in ra Serial lúc khởi động |
| `MQTT_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` | Broker. HiveMQ Cloud: `mqtts://<host>:8883` |
| `AUTH_USERNAME` / `AUTH_PASSWORD_HASH_B64` / `JWT_SECRET` | 1 tài khoản cố định, mật khẩu băm bcrypt (base64 để tránh ký tự `$`) |
| `NOTIFY_PROVIDER` | `console` (chỉ log), `expo` (dùng với app Expo) hoặc `fcm` |
| `HEARTBEAT_TIMEOUT_S` | Quá ngần này giây không có tín hiệu thì coi là offline (mặc định 90) |
| `DEDUPE_WINDOW_S` | Hai sự kiện cùng loại trong ngần này giây bị coi là trùng (mặc định 8) |
| `SWAGGER_ENABLED` | Bật/tắt trang `/docs`. Bỏ trống: bật khi dev, tắt khi `NODE_ENV=production` |
| `TRUST_PROXY` | `true` nếu đứng sau reverse proxy (để giới hạn đăng nhập theo đúng IP) |

## API REST

Mọi route (trừ `/auth/login` và `/health`) cần header `Authorization: Bearer <jwt>`. Đăng nhập giới hạn 5 lần/phút/IP.

| Method | Route | Mô tả |
|---|---|---|
| POST | `/auth/login` | `{username,password}` → `{accessToken,expiresIn}` |
| GET | `/health` | Công khai. `{status,db,mqtt}`, 503 nếu DB hỏng |
| GET | `/device` | Trạng thái: online, sóng, `imuOk`, `gpsFix`, số liên hệ thiết bị giữ, `lastSeenAgoS` |
| GET | `/device/health?from&to&limit` | Lịch sử heartbeat |
| GET | `/incidents?limit&cursor&status` | Lịch sử cảnh báo (mới nhất trước), kèm kết quả SMS; `nextCursor` để phân trang |
| GET | `/incidents/:id` | Chi tiết |
| POST | `/incidents/:id/ack` | Xác nhận đã nhận (idempotent) |
| POST | `/incidents/:id/resolve` | Đã xử lý xong |
| GET | `/location` | Vị trí gần nhất + `effectiveAgeS` + `mapUrl` |
| GET | `/locations?from&to&limit` | Lịch sử vị trí |
| GET | `/contacts` | Danh sách + trạng thái `sync` |
| PUT | `/contacts` | Thay toàn bộ (1–5 số), đẩy xuống thiết bị |
| POST | `/commands` | `{action:"reboot"\|"request_location"}` → 202; 409 nếu thiết bị offline |
| GET | `/commands` | Lệnh gần đây (PENDING → OK/EXPIRED) |
| POST | `/push-token` | `{token}` đăng ký token FCM (204) |
| POST | `/push-token/remove` | Hủy đăng ký (204) |

Vị trí: thiết bị chỉ gửi GPS kèm sự kiện hoặc khi được yêu cầu, nên muốn làm mới hãy `POST /commands {"action":"request_location"}`. `effectiveAgeS` = tuổi fix lúc gửi + thời gian đã trôi qua — dùng nó để hiển thị "cập nhật 3 phút trước".

## Tài liệu API (Swagger)

BE có sẵn trang Swagger mô tả từng API (tham số, ví dụ, mã lỗi) và cho gọi thử trực tiếp trên trình duyệt.

- **Mở:** chạy `npm run start:dev` rồi vào `http://localhost:3000/docs`. File OpenAPI (JSON) ở `http://localhost:3000/docs/json`, có thể nhập vào Postman (Import → Link).
- **Gọi thử API có khóa:** `POST /auth/login` → copy `accessToken` → nút **Authorize** (ổ khóa) → dán token (không gõ chữ `Bearer`) → Authorize. Token được giữ lại khi tải lại trang.
- **Bật/tắt:** biến `SWAGGER_ENABLED`. Bỏ trống thì **bật khi chạy dev, tắt khi `NODE_ENV=production`** (Docker đặt sẵn). Muốn bật trên server thì đặt `SWAGGER_ENABLED=true`; trang này chỉ mô tả API, không chứa dữ liệu, nhưng nên đặt sau VPN/HTTPS như các route khác.
- **Thêm API mới:** gắn `@ApiTags`, `@ApiOperation`, `@ApiOkResponse` trên controller và `@ApiProperty` trên DTO (xem `src/incidents/` làm mẫu). Cấu trúc JSON trả về được khai báo ở `src/docs/api-models.ts`; chúng chỉ phục vụ tài liệu, không ảnh hưởng logic.
- Swagger **không mô tả** WebSocket và MQTT; phần hướng dẫn Socket.IO có ở đầu trang `/docs`.

## WebSocket (Socket.IO)

```js
const socket = io('https://host', { auth: { token: jwt } });
socket.on('incident.created', ...);   // sự cố mới (kể cả bản CANCELLED để lưu vết)
socket.on('incident.updated', ...);   // ack/resolve, kết quả SMS tới
socket.on('device.state', ...);       // online/offline, heartbeat; gửi ngay một bản khi nối
socket.on('location.updated', ...);
socket.on('contacts.updated', ...);   // đổi trạng thái sync
```
Token sai → nhận `auth_error` rồi bị ngắt. WebSocket chỉ có tác dụng khi app đang mở; khi app đóng, cảnh báo đến bằng push FCM.

## Hợp đồng MQTT (với firmware)

BE subscribe **đúng 6 topic cụ thể** (không dùng wildcard, và không nghe `device/<id>/alert/*` legacy nên không bị trùng cảnh báo):

| Topic | Hướng | Retain | Payload |
|---|---|---|---|
| `v2/device/<id>/event` | ESP → BE | không | `{ts_ms,type,confidence,gps{valid,lat,lon,sat,age_s}}`, `type` ∈ FALL, HELP_REQUEST, FALL_CANCEL, LOCATION_UPDATE |
| `v2/device/<id>/heartbeat` | ESP → BE | không | `{ts_ms,status,signal,imu_ok,gps_fix,contacts,heap}` mỗi 30s |
| `v2/device/<id>/status/sms` | ESP → BE | không | `{phone,status:"success"\|"failed",ts_ms}` |
| `device/<id>/status` | ESP → BE | có | `{status:"online",uptime_s,firmware,...}` / LWT `{status:"offline"}` |
| `device/<id>/info` | ESP → BE | có | firmware, năng lực |
| `device/<id>/cmd/resp` | ESP → BE | không | `{action,status,ts_ms}` |
| `v2/device/<id>/config/emergency_contacts` | BE → ESP | **có**, QoS1 | `{"contacts":["+84..."]}` |
| `v2/device/<id>/command` | BE → ESP | **không**, QoS1 | `{"action":"reboot"}` / `{"action":"request_location"}` |

Quy tắc xử lý đáng chú ý:
- `FALL`/`HELP_REQUEST` → tạo sự cố `OPEN` + push mức ALERT. `FALL_CANCEL` (người đeo hủy trong cửa sổ cảnh báo) → chỉ lưu vết `CANCELLED`, **không** thông báo.
- `ts_ms = 0` (ESP chưa có giờ GPS) → dùng giờ BE nhận (`receivedAt`).
- Sự kiện `event` mang cờ retained bị bỏ qua. `status` online retained cũ bị bỏ qua (đợi heartbeat xác nhận).
- Offline phát hiện qua heartbeat (quá `HEARTBEAT_TIMEOUT_S`) hoặc LWT; chỉ báo **một lần** cho mỗi lần chuyển trạng thái.
- Reboot nhận ra từ `uptime_s` (mốc khởi động dịch chuyển); reboot do lệnh từ app thì không báo.
- Cảnh báo sức khỏe (nhắc lại sau `ALERT_COOLDOWN_MIN`): `imu_ok=false` ≥ 2 lần liên tiếp, sóng yếu (CSQ ≤ ngưỡng hoặc 99) ≥ 3 lần, `contacts=0` ≥ 4 lần.
- Tự phục hồi: heartbeat báo số liên hệ lệch với BE → đẩy lại danh bạ (tối đa 5 phút/lần); danh bạ còn `PENDING` được đẩy lại định kỳ.
- Lệnh không retain; nếu ESP offline thì từ chối ngay (409) thay vì báo thành công giả.

### Phân quyền broker (ACL) — nên cấu hình

| Tài khoản | Publish | Subscribe |
|---|---|---|
| BE | `v2/device/<id>/command`, `v2/device/<id>/config/emergency_contacts` | 6 topic ở trên |
| ESP | `v2/device/<id>/{event,heartbeat,status/sms}`, `device/<id>/{status,info,cmd/resp,alert/#}` | `v2/device/<id>/command`, `v2/device/<id>/config/emergency_contacts`, `device/<id>/cmd/#`, `v2/device/<id>/config` |

Nếu BE bị broker từ chối subscribe, log sẽ ghi rõ "Broker TỪ CHỐI subscribe …".

## Thông báo đẩy

Chọn bằng `NOTIFY_PROVIDER`:

| Giá trị | Khi nào dùng |
|---|---|
| `console` | Mặc định, chỉ ghi log (chưa có app) |
| `expo` | **Dùng với app Expo đi kèm** (thư mục `mobile/`). BE gửi qua dịch vụ Expo Push; app không cần cấu hình Firebase trong code |
| `fcm` | Firebase trực tiếp, chỉ khi app của bạn đăng ký token FCM thuần |

**Expo:** `NOTIFY_PROVIDER=expo`. `EXPO_ACCESS_TOKEN` chỉ cần nếu bạn bật "enhanced push security" trong dự án Expo. BE gửi tối đa 100 tin mỗi request; cảnh báo té ngã/SOS dùng ưu tiên cao, kênh Android `alerts` và `interruptionLevel: time-sensitive` trên iOS. Token hết hạn (`DeviceNotRegistered`) tự bị xóa; token sai định dạng cũng bị loại. Chưa kiểm tra "receipt" sau khi gửi (một tin `ok` chưa bảo đảm đã tới máy), nên token chết đôi khi chỉ bị phát hiện ở lần gửi sau.

**FCM:** tạo service account (Firebase Console → Project settings → Service accounts → Generate new private key), rồi `FIREBASE_SERVICE_ACCOUNT_PATH` hoặc `FIREBASE_SERVICE_ACCOUNT_JSON`. Không commit file key.

Chung cho mọi provider:
- App gọi `POST /push-token` mỗi khi mở. Token hết hạn tự bị xóa.
- Android cần 3 notification channel `alerts`, `warnings`, `info` (app đi kèm tạo sẵn).
- Dữ liệu kèm (`data`): `kind` (INCIDENT / DEVICE / SMS_FAILED / HEALTH / CONTACTS), `incidentId`, `incidentType`, `lat`, `lon`, `mapUrl`.
- **Quyền riêng tư:** nội dung thông báo (tiêu đề, nội dung, tọa độ và liên kết bản đồ của sự cố) đi qua máy chủ của bên thứ ba (Expo hoặc Google/Apple). Nếu không muốn vị trí đi qua đó, hãy bỏ tọa độ khỏi `buildIncidentMessage` trong `src/notifications/messages.ts`; app vẫn mở được chi tiết sự cố qua `incidentId`.

Thông báo luôn tới người dùng qua kênh bổ sung này; **kênh cảnh báo chính tới người thân vẫn là SMS do thiết bị gửi**, không phụ thuộc BE hay app.

## Triển khai

```bash
docker compose up -d --build                          # api, dùng DB trong .env (Supabase)
# hoặc có Postgres cục bộ: docker compose --profile local-db up -d --build
```
- Container chạy `prisma migrate deploy` nếu có `prisma/migrations`, nếu chưa có thì `prisma db push` (cả hai dùng `DIRECT_URL`, nên file `.env` trong container phải có biến này). Nên chạy `npx prisma migrate dev --name init` một lần rồi commit thư mục `prisma/migrations`. Với Supabase, nhớ chạy `supabase/secure.sql` sau lần tạo bảng đầu tiên.
- **Bắt buộc HTTPS** (Caddy/Nginx/Cloudflare Tunnel) vì mật khẩu, JWT và vị trí GPS đi qua đường này; đặt `TRUST_PROXY=true` khi đứng sau proxy.
- Khuyến nghị đặt BE sau VPN (Tailscale/WireGuard) nếu chỉ dùng cá nhân. Chỉ có 1 tài khoản cố định, nên cần mật khẩu mạnh; đổi mật khẩu = sửa `AUTH_PASSWORD_HASH_B64`, đổi `JWT_SECRET` = vô hiệu mọi token đã cấp.
- Chạy **một** bản BE. Nếu cần nhiều bản, dùng shared subscription của MQTT 5 (`$share/...`), nếu không mỗi cảnh báo bị xử lý nhiều lần.
- Dữ liệu cũ tự dọn lúc 3h sáng (`HEALTH_RETENTION_DAYS`, `LOCATION_RETENTION_DAYS`).

## Kiểm thử

```bash
npm test      # 111 test, chạy offline (node:test + tsx), không cần DB/broker
```
Gồm: parse đúng các chuỗi JSON mà firmware sinh ra, định tuyến topic, luật sức khỏe, soạn thông báo, cấu hình, và logic nghiệp vụ của các service (chống trùng, hủy cảnh báo, gắn SMS, offline/reboot, đồng bộ danh bạ, lệnh) trên Prisma giả trong bộ nhớ.

**Chưa được kiểm chứng** (cần chạy thật): việc dùng API của các thư viện bên ngoài (NestJS, Prisma, mqtt, firebase-admin, socket.io) — mã đã qua kiểm tra kiểu với khai báo giả, nhưng chưa được `npm install && npm run build` với gói thật; đăng nhập/JWT (`AuthService`, guard); truy vấn SQL thật; FCM thật; kết nối broker thật. Lần build đầu có thể lộ vài lỗi kiểu nhỏ, hãy báo lại log.

## Cấu trúc

```
prisma/        schema.prisma, seed.ts
supabase/      secure.sql (bật RLS, thu hồi quyền anon/authenticated)
scripts/       simulate-device.ts (giả lập ESP), hash-password.js
src/
  config/      đọc + kiểm tra biến môi trường
  mqtt/        topics, payloads (parse), router, service (kết nối/publish)
  device/      trạng thái thiết bị duy nhất, online/offline/reboot
  incidents/   FALL/SOS/hủy, chống trùng, SMS, ack/resolve
  contacts/    danh bạ khẩn cấp + đồng bộ xuống thiết bị
  commands/    reboot, request_location
  locations/   vị trí
  notifications/ push (console | Expo | FCM), nội dung thông báo, push-token
  watchdog/    mất heartbeat, luật sức khỏe, dọn dữ liệu
  realtime/    Socket.IO
  auth/        1 tài khoản cố định + JWT
  health/      /health
  docs/        Swagger (cấu hình + mô tả cấu trúc JSON trả về)
test/          111 test + helpers/fake-prisma.ts
```

## Khuyến nghị cho firmware

BE đã tương thích với firmware hiện tại; hai thay đổi nhỏ sẽ làm hệ thống chắc hơn:
1. **Thêm `event_id`** (số tăng dần kèm boot counter) vào payload `event`: BE đã hỗ trợ sẵn (chống trùng chính xác bằng ràng buộc unique) và sẽ dùng nó thay cho cửa sổ thời gian.
2. **Bỏ publish `device/<id>/alert/*` legacy** (BE không dùng, chỉ tốn băng thông 4G).

## Hạn chế đã biết

- Thiết bị publish QoS 0: `event` có thể mất nếu đúng lúc rớt mạng. SMS là kênh chính nên BE không coi "không có event" là "không có ngã".
- Chống trùng bằng cửa sổ thời gian có thể nuốt một SOS thứ hai trong vòng `DEDUPE_WINDOW_S` giây sau SOS đầu.
- Cảnh báo sức khỏe giữ bộ đếm trong bộ nhớ; khởi động lại BE đặt lại bộ đếm.
- Phiên bản gói được cố định ở NestJS 10 / Prisma 5; có thể nâng cấp sau. (Prisma 7 đổi cách cấu hình CLI sang `prisma.config.ts`, nên đừng nâng cấp mà không đọc hướng dẫn chuyển đổi.)
- Kết nối DB/Supabase thật chưa được thử (chỉ có kiểm tra cấu hình và logic trên Prisma giả).
