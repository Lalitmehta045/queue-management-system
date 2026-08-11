import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueCallingController } from './queue-calling.controller';
import { QueueCallingService } from './queue-calling.service';

@Module({
  imports: [DisplaysModule, NotificationsModule],
  controllers: [QueueCallingController],
  providers: [QueueCallingService],
})
export class QueueCallingModule {}
