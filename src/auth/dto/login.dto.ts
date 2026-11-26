import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'admin',
    description: 'Tên tài khoản. Chỉ có MỘT tài khoản cố định, cấu hình bằng biến môi trường `AUTH_USERNAME`.',
    minLength: 1,
    maxLength: 128,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  username!: string;

  @ApiProperty({
    example: 'mat-khau-cua-ban',
    description: 'Mật khẩu (bản gốc, không phải bản băm). BE so khớp với `AUTH_PASSWORD_HASH_B64`.',
    minLength: 1,
    maxLength: 128,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
