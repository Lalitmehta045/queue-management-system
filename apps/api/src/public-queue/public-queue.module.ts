import { Module } from '@nestjs/common';
import { PublicQueueController } from './public-queue.controller';
import { PublicQueueService } from './public-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DisplaysModule } from '../displays/displays.module';

@Module({
  imports: [PrismaModule, DisplaysModule],
  controllers: [PublicQueueController],
  providers: [PublicQueueService],
})
export class PublicQueueModule {}
