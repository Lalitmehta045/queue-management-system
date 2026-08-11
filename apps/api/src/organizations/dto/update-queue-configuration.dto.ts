import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PriorityLevel } from '@prisma/client';

export class UpdateQueueConfigurationDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxWaitingQueueSize?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  maxDailyTokens?: number;

  @IsOptional()
  @IsEnum(PriorityLevel)
  defaultPriority?: PriorityLevel;

  @IsOptional()
  @IsBoolean()
  allowWalkIns?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAppointmentCheckIns?: boolean;
}
