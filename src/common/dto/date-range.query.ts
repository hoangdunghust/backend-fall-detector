import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class DateRangeQuery {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Chỉ lấy bản ghi từ thời điểm này trở đi (ISO 8601, ví dụ `2026-11-26T00:00:00Z`).',
    example: '2026-11-26T00:00:00Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Chỉ lấy bản ghi đến thời điểm này (ISO 8601).',
    example: '2026-11-26T23:59:59Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    description: 'Số bản ghi tối đa trả về (mới nhất trước).',
    default: 200,
    minimum: 1,
    maximum: 1000,
    example: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 200;
}
