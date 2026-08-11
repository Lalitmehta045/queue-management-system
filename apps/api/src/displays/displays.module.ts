import { Module } from '@nestjs/common';
import { FeatureGuard } from '../entitlements/feature.guard';
import { DisplaysController } from './displays.controller';
import { PublicDisplaysController } from './public-displays.controller';
import { DisplayEventsService } from './display-events.service';
import { DisplaysService } from './displays.service';

@Module({
  controllers: [DisplaysController, PublicDisplaysController],
  providers: [DisplaysService, DisplayEventsService, FeatureGuard],
  exports: [DisplayEventsService],
})
export class DisplaysModule {}
