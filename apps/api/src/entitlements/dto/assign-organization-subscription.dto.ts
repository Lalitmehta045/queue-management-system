import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';

export class AssignOrganizationSubscriptionDto {
  @IsUUID()
  @IsNotEmpty()
  planId!: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsISO8601()
  trialEndsAt?: string;
}
