import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  acceptingQueueEntries?: boolean;
}