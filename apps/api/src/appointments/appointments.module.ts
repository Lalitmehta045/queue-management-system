import { Module } from '@nestjs/common';
import { DisplaysModule } from '../displays/displays.module';
import { FeatureGuard } from '../entitlements/feature.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { TokensService } from '../tokens/tokens.service';
import { QueueEntriesService } from '../queue-entries/queue-entries.service';

@Module({
  imports: [DisplaysModule, NotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, TokensService, QueueEntriesService, FeatureGuard],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
