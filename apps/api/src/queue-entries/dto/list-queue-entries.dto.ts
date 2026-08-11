import { Type } from 'class-transformer';
import { QueueEntryStatus } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, IsString, Length, Max, Min } from 'class-validator';

export class ListQueueEntriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsEnum(QueueEntryStatus)
  status?: QueueEntryStatus;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'status'])
  sortBy: 'createdAt' | 'updatedAt' | 'status' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
