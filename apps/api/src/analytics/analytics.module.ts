import { Module } from '@nestjs/common';
import { FeatureGuard } from '../entitlements/feature.guard';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, FeatureGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
