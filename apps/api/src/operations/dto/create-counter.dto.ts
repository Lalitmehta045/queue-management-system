import { IsString, Length } from 'class-validator';

export class CreateCounterDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Length(1, 40)
  code!: string;
}