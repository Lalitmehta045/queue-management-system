import { IsString, MinLength } from 'class-validator';

export class UpdateTeamMemberPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
