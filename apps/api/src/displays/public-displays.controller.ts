import { Controller, Get, Param, Req, Res, Sse } from '@nestjs/common';
import { Request, Response } from 'express';
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
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  async events(@Param('publicId') publicId: string, @Req() request: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    return this.displaysService.streamPublicEvents(publicId, request.ip);
  }
}
