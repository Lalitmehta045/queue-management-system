import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PriorityLevel } from '@prisma/client';

export class CreateQueueEntryDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsEnum(PriorityLevel)
  priority?: PriorityLevel;
}
