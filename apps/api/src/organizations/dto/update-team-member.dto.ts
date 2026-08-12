import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class UpdateTeamMemberDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsUUID()
  counterId?: string | null;
}
