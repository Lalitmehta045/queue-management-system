import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;
}