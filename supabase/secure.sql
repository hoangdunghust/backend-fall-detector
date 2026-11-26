-- =============================================================================
-- Khóa các bảng của BE khỏi API tự sinh của Supabase (PostgREST / Data API).
--
-- Vì sao cần: Supabase mở schema "public" ra internet qua Data API, ai có URL dự án
-- và anon key (khóa công khai, vốn được nhúng trong app khách) đều gọi được. Bảng không
-- bật RLS có thể bị đọc/ghi qua đó: ở đây là vị trí GPS, lịch sử cảnh báo, danh bạ khẩn
-- cấp và token FCM. BE chỉ truy cập DB trực tiếp bằng Prisma (vai trò postgres bỏ qua RLS),
-- nên hoàn toàn không cần các bảng này truy cập được từ Data API.
--
-- Cách dùng: Supabase Dashboard -> SQL Editor -> dán toàn bộ file này -> Run.
-- Chạy SAU lần `prisma migrate dev` / `db push` đầu tiên (khi bảng đã tồn tại) và chạy lại
-- mỗi khi thêm bảng mới vào schema.prisma. An toàn khi chạy nhiều lần.
-- Chỉ dùng cho Supabase (cần các vai trò anon/authenticated).
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'DeviceState', 'EmergencyContact', 'Incident', 'SmsDelivery',
    'Location', 'CommandLog', 'DeviceHealthLog', 'PushToken',
    '_prisma_migrations'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      -- RLS bật + không có policy nào => anon/authenticated không đọc/ghi được dòng nào
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Thêm một lớp nữa: thu hồi quyền để Data API không "thấy" bảng
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
      RAISE NOTICE 'Đã khóa public.%', t;
    ELSE
      RAISE NOTICE 'Bỏ qua public.% (chưa tồn tại)', t;
    END IF;
  END LOOP;
END $$;

-- Kiểm tra: cột rowsecurity phải là true cho mọi bảng của BE
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('DeviceState','EmergencyContact','Incident','SmsDelivery',
                    'Location','CommandLog','DeviceHealthLog','PushToken','_prisma_migrations')
ORDER BY tablename;
