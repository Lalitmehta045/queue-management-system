import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { FeatureGuard } from '../entitlements/feature.guard';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, FeatureGuard],
  exports: [AuditService],
})
export class AuditModule {}
