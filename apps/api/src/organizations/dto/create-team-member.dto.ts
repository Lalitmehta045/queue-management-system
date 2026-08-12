import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateTeamMemberDto {
  @IsString()
  @Length(2, 120)
  displayName!: string;

  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  counterId?: string;
}
