import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { TokenType } from '@prisma/client';

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  code?: string;

  @IsOptional()
  @IsEnum(TokenType)
  tokenType?: TokenType;
}