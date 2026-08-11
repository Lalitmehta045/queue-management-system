import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchHolidayDto {
  @IsDateString()
  date!: string; // YYYY-MM-DD format is best parsed this way

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
