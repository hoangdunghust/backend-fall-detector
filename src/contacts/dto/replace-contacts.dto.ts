import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CONTACTS } from '../../common/limits';
import { normalizePhone, PHONE_REGEX } from '../../common/phone.util';

export class ContactDto {
  @ApiProperty({
    example: '+84901234567',
    description:
      'Số điện thoại nhận SMS khẩn cấp: dấu `+` tùy chọn rồi 6-15 chữ số. Khoảng trắng, dấu chấm, gạch, ngoặc sẽ được tự bỏ. Số trùng trong cùng danh sách bị loại bớt.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizePhone(value) ?? value) : value,
  )
  @IsString()
  @Matches(PHONE_REGEX, { message: 'Số điện thoại không hợp lệ (ví dụ +84901234567; 6-15 chữ số)' })
  phone!: string;

  @ApiPropertyOptional({ example: 'Mẹ', maxLength: 60, description: 'Tên gợi nhớ (chỉ lưu ở BE, không gửi xuống thiết bị).' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class ReplaceContactsDto {
  /** Thiết bị từ chối danh sách rỗng, nên cần ít nhất 1 số. */
  @ApiProperty({
    type: [ContactDto],
    minItems: 1,
    maxItems: MAX_CONTACTS,
    description: `Danh sách ĐẦY ĐỦ số khẩn cấp (1-${MAX_CONTACTS} số). Danh sách này THAY THẾ hoàn toàn danh sách cũ.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CONTACTS)
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts!: ContactDto[];
}
