import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from './features';

export const REQUIRED_FEATURE_KEY = 'requiredFeature';

/**
 * Declares that a route requires a plan feature entitlement.
 * Enforced server-side by FeatureGuard — never by the frontend.
 */
export const RequireFeature = (feature: FeatureKey) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);
