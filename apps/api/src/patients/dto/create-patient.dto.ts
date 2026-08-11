import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @IsString()
  @Length(1, 80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @Length(3, 30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 254)
  email?: string;
}
