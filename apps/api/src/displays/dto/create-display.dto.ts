import { IsString, Length } from 'class-validator';

export class CreateDisplayDto {
  @IsString()
  @Length(2, 120)
  name!: string;
}
