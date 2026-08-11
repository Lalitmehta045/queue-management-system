import { Module } from '@nestjs/common';
import { FeatureGuard } from '../entitlements/feature.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrintersService } from './printers.service';
import { PrintersController } from './printers.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [PrintersController],
  providers: [PrintersService, FeatureGuard],
})
export class PrintersModule {}
