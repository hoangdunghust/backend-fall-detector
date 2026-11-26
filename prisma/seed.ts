/**
 * Seed tùy chọn: tạo hàng DeviceState và (nếu có SEED_CONTACTS) các số khẩn cấp ban đầu.
 * Chạy: npm run seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../src/common/phone.util';

const prisma = new PrismaClient();

async function main() {
  await prisma.deviceState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const raw = process.env.SEED_CONTACTS ?? '';
  const phones = raw
    .split(',')
    .map((s: string) => normalizePhone(s))
    .filter((p: string | null): p is string => p !== null)
    .slice(0, 5);

  for (let i = 0; i < phones.length; i++) {
    await prisma.emergencyContact.upsert({
      where: { phone: phones[i] },
      update: { position: i },
      create: { phone: phones[i], position: i },
    });
  }
  console.log(`Seed xong. Số khẩn cấp: ${phones.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
