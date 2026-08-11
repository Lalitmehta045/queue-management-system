import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { EntitlementsService } from './entitlements.service';
import { REQUIRED_FEATURE_KEY } from './feature.decorator';
import { FeatureKey } from './features';

/**
 * Enforces feature entitlements declared via @RequireFeature.
 *
 * Runs AFTER JwtAuthGuard + TenantGuard so `request.tenant` is populated.
 * The organization context is always resolved server-side from the tenant
 * (never from client-supplied ids).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;
    if (!tenant) {
      throw new ForbiddenException('Tenant context is required for feature authorization');
    }

    await this.entitlements.requireFeature(tenant.organizationId, feature);
    return true;
  }
}
