import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { QueueEntriesController } from './queue-entries.controller';
import { QueueEntriesService } from './queue-entries.service';

@Module({
  imports: [DisplaysModule],
  controllers: [QueueEntriesController],
  providers: [QueueEntriesService],
})
export class QueueEntriesModule {}
