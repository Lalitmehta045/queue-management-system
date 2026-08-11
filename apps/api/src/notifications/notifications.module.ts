import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../config/env.validation';
import { FeatureGuard } from '../entitlements/feature.guard';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { MockProvider, NoopProvider, NotificationProviderToken } from './notification-providers';
import { TicketPrintService } from './ticket-print.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationSettingsService,
    NotificationsService,
    TicketPrintService,
    FeatureGuard,
    {
      provide: NotificationProviderToken,
      useFactory: (configService: ConfigService<ValidatedEnvironment, true>) => {
        return configService.get('NOTIFICATION_PROVIDER') === 'mock'
          ? new MockProvider()
          : new NoopProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [NotificationsService, TicketPrintService],
})
export class NotificationsModule {}
