import { Controller, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SelfServiceService } from './self-service.service';
import { ValidateQrDto } from './dto/validate-qr.dto';
import { Request } from 'express';

@Controller('public/self-service')
export class SelfServiceController {
  constructor(private readonly selfService: SelfServiceService) {}

  @Post('qr/validate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  validateQr(@Body() dto: ValidateQrDto, @Req() req: Request) {
    return this.selfService.validateQr(dto.qrPayload, req.ip, req.headers['user-agent']);
  }

  @Post('qr/check-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  checkInQr(@Body() dto: ValidateQrDto, @Req() req: Request) {
    return this.selfService.checkInQr(dto.qrPayload, req.ip, req.headers['user-agent']);
  }
}
