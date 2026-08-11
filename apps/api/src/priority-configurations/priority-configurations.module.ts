import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FeatureGuard } from '../entitlements/feature.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { PriorityConfigurationsService } from './priority-configurations.service';
import { PriorityConfigurationsController } from './priority-configurations.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [PriorityConfigurationsController],
  providers: [PriorityConfigurationsService, FeatureGuard],
})
export class PriorityConfigurationsModule {}
