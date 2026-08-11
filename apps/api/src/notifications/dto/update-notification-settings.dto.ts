import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export const SUPPORTED_ANNOUNCEMENT_LANGUAGES: string[] = [
  'en-US',
  'en-GB',
  'hi-IN',
  'mr-IN',
  'ta-IN',
  'te-IN',
  'kn-IN',
  'bn-IN',
  'gu-IN',
  'pa-IN',
  'ml-IN',
];

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  announcementEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_ANNOUNCEMENT_LANGUAGES)
  language?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speechRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  announcementVolume?: number;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  announcementTemplate?: string;

  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;
}
