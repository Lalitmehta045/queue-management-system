import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { FeatureGuard } from '../entitlements/feature.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { TokensModule } from '../tokens/tokens.module';
import { QueueEntriesModule } from '../queue-entries/queue-entries.module';

@Module({
  imports: [DisplaysModule, NotificationsModule, TokensModule, QueueEntriesModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, FeatureGuard],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
