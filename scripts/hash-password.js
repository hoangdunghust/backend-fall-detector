// Dùng: npm run hash-password -- "mat-khau-cua-ban"
// In ra giá trị cho AUTH_PASSWORD_HASH_B64 (bcrypt, mã hóa base64 để tránh ký tự '$' trong .env/docker)
// và một JWT_SECRET ngẫu nhiên.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Dùng: npm run hash-password -- "<mật khẩu, tối thiểu 8 ký tự>"');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
console.log('AUTH_PASSWORD_HASH_B64=' + Buffer.from(hash, 'utf8').toString('base64'));
console.log('JWT_SECRET=' + crypto.randomBytes(48).toString('base64url'));
