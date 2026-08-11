import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  code?: string;
}