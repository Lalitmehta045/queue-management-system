import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { PriorityLevel, TokenType, SpecialCategory } from '@prisma/client';

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

  @IsOptional()
  @IsEnum(TokenType)
  type?: TokenType;

  @ValidateIf((o) => o.specialCategory !== null && o.specialCategory !== undefined)
  @IsEnum(SpecialCategory)
  specialCategory?: SpecialCategory | null;
}
