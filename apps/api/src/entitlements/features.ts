/**
 * Controlled SaaS feature catalog.
 *
 * Feature entitlements are plan-level capabilities that are enforced
 * server-side. The frontend must NEVER be trusted to enforce these —
 * every feature gate is re-validated by the API before the operation runs.
 */
export const FEATURES = {
  ANALYTICS: 'ANALYTICS',
  APPOINTMENTS: 'APPOINTMENTS',
  PRIORITY_QUEUE: 'PRIORITY_QUEUE',
  QR_STATUS: 'QR_STATUS',
  SELF_SERVICE_CHECKIN: 'SELF_SERVICE_CHECKIN',
  THERMAL_PRINTING: 'THERMAL_PRINTING',
  PUBLIC_DISPLAY: 'PUBLIC_DISPLAY',
  NOTIFICATIONS: 'NOTIFICATIONS',
  AUDIT_LOGS: 'AUDIT_LOGS',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export const ALL_FEATURES: readonly FeatureKey[] = Object.values(FEATURES);

export type FeatureMap = Record<FeatureKey, boolean>;

/**
 * Default feature set: every feature enabled.
 *
 * Used as the safe fallback so that:
 *  - legacy organizations (no subscription) keep full access, and
 *  - plans that do not declare a `features` map inherit the full feature set
 *    (preserving Phase 21 behavior — a plan must explicitly disable a feature).
 */
export const DEFAULT_FEATURES: FeatureMap = ALL_FEATURES.reduce(
  (acc, key) => {
    acc[key] = true;
    return acc;
  },
  {} as FeatureMap,
);
