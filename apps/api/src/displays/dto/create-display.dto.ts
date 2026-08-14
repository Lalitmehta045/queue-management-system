import { IsString, Length, IsOptional } from 'class-validator';

export class CreateDisplayDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}
