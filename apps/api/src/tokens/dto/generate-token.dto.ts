import { IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { TokenType, SpecialCategory } from '@prisma/client';

export class GenerateTokenDto {
  @IsOptional()
  @IsEnum(TokenType)
  type?: TokenType;

  @ValidateIf((o) => o.specialCategory !== null && o.specialCategory !== undefined)
  @IsEnum(SpecialCategory)
  specialCategory?: SpecialCategory | null;
}
