import { Controller, Get, Header, Param, Req, Sse } from '@nestjs/common';
import { Request } from 'express';
import { DisplaysService } from './displays.service';
import { Throttle } from '@nestjs/throttler';

@Controller('public/displays')
export class PublicDisplaysController {
  constructor(private readonly displaysService: DisplaysService) {}

  @Get(':publicId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  get(@Param('publicId') publicId: string, @Req() request: Request) {
    return this.displaysService.getPublicSnapshot(publicId, request.ip);
  }

  @Sse(':publicId/events')
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async events(@Param('publicId') publicId: string, @Req() request: Request) {
    return this.displaysService.streamPublicEvents(publicId, request.ip);
  }
}
