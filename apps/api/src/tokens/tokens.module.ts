import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';
import { QueueCallingModule } from '../queue-calling/queue-calling.module';

@Module({
  imports: [DisplaysModule, NotificationsModule, QueueCallingModule],
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
