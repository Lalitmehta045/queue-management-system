import { IsString, Length } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @Length(2, 120)
  name!: string;
}