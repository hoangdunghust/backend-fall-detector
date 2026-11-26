import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const INCIDENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'] as const;

export class ListIncidentsQuery {
  @ApiPropertyOptional({
    description: 'Số sự cố tối đa mỗi trang.',
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** id của sự cố cuối trang trước (nextCursor). */
  @ApiPropertyOptional({
    description:
      'Phân trang: điền `nextCursor` của trang trước để lấy trang kế tiếp. Bỏ trống để lấy trang đầu.',
    maxLength: 64,
    example: 'cm3x9k2l00000abcd',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Chỉ lấy sự cố ở trạng thái này. Bỏ trống để lấy tất cả.',
    enum: INCIDENT_STATUSES,
    example: 'OPEN',
  })
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];
}
