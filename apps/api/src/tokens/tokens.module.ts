import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [DisplaysModule, NotificationsModule],
  controllers: [TokensController],
  providers: [TokensService],
})
export class TokensModule {}
