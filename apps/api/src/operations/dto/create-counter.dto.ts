import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { TokenType } from '@prisma/client';

export class CreateCounterDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Length(1, 40)
  code!: string;

  @IsOptional()
  @IsEnum(TokenType)
  tokenType?: TokenType;
}