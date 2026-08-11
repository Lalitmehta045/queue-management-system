import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminEntitlementsService } from './admin-entitlements.service';
import { AdminOrganizationSubscriptionsController } from './admin-organization-subscriptions.controller';
import { AdminSubscriptionPlansController } from './admin-subscription-plans.controller';
import { EntitlementsService } from './entitlements.service';
import { FeatureGuard } from './feature.guard';
import { SubscriptionsController } from './subscriptions.controller';
import { UsageController } from './usage.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [
    SubscriptionsController,
    UsageController,
    AdminSubscriptionPlansController,
    AdminOrganizationSubscriptionsController,
  ],
  providers: [EntitlementsService, AdminEntitlementsService, FeatureGuard],
  exports: [EntitlementsService, FeatureGuard],
})
export class EntitlementsModule {}
