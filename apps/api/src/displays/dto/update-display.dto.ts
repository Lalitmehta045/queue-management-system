import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateDisplayDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}
