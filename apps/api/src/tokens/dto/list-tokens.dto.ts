import { Type } from 'class-transformer';
import { TokenStatus } from '@prisma/client';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, IsString, Length, Matches, Max, Min } from 'class-validator';

export class ListTokensDto {
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
  @IsEnum(TokenStatus)
  status?: TokenStatus;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  queueEntryId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  businessDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @IsOptional()
  @IsIn(['issuedAt', 'createdAt', 'status', 'sequenceNumber'])
  sortBy: 'issuedAt' | 'createdAt' | 'status' | 'sequenceNumber' = 'issuedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'asc';
}
