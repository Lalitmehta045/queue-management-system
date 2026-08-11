import { Controller, Get, Param, Sse } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicQueueService } from './public-queue.service';

@Controller('public/queue')
export class PublicQueueController {
  constructor(private readonly publicQueueService: PublicQueueService) {}

  @Get(':publicTokenId')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  get(@Param('publicTokenId') publicTokenId: string) {
    return this.publicQueueService.getPublicTokenStatus(publicTokenId);
  }

  @Sse(':publicTokenId/events')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  events(@Param('publicTokenId') publicTokenId: string) {
    return this.publicQueueService.streamPublicTokenEvents(publicTokenId);
  }
}
