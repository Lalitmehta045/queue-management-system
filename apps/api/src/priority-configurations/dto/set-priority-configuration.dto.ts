import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PriorityLevel } from '@prisma/client';

export class SetPriorityConfigurationDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsEnum(PriorityLevel)
  level!: PriorityLevel;

  @IsInt()
  @Min(0)
  @Max(100)
  weight!: number;

  @IsBoolean()
  active!: boolean;
}
