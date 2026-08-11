import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateAppointmentDto {
  @IsString()
  @IsNotEmpty()
  patientId!: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, { message: 'appointmentDate must be YYYY-MM-DD' })
  appointmentDate!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{2}:[0-9]{2}$/, { message: 'startTime must be HH:MM' })
  startTime!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
