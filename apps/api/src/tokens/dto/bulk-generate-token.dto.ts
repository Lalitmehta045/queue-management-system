import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PriorityLevel } from '@prisma/client';

export class BulkGenerateTokenDto {
  @IsUUID()
  serviceId!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @IsEnum(PriorityLevel)
  priority!: PriorityLevel;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}
