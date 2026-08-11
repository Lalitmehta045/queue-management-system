'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Limits = Record<string, number>;

type SubscriptionDetails = {
  organizationId: string;
  hasActiveSubscription: boolean;
  status: string;
  plan: {
    name: string;
    code: string;
    monthlyPrice: number;
    yearlyPrice: number;
    active: boolean;
    limits: Limits;
    features: Record<string, boolean>;
  } | null;
  limits: Limits;
  features: Record<string, boolean>;
  startsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
};

type UsageItem = { used: number; limit: number };
type Usage = {
  branches: UsageItem;
  users: UsageItem;
  counters: UsageItem;
  services: UsageItem;
  displays: UsageItem;
  dailyTokens: UsageItem;
  waitingQueue: UsageItem;
};

const FEATURE_LABELS: Record<string, string> = {
  ANALYTICS: 'Analytics',
  APPOINTMENTS: 'Appointments',
  PRIORITY_QUEUE: 'Priority Queue',
  QR_STATUS: 'QR Status',
  SELF_SERVICE_CHECKIN: 'Self-Service Check-in',
  THERMAL_PRINTING: 'Thermal Printing',
  PUBLIC_DISPLAY: 'Public Display',
  NOTIFICATIONS: 'Notifications',
  AUDIT_LOGS: 'Audit Logs',
};

const USAGE_ROWS: Array<{ key: keyof Usage; label: string }> = [
  { key: 'branches', label: 'Branches' },
  { key: 'users', label: 'Users' },
  { key: 'counters', label: 'Counters' },
  { key: 'services', label: 'Services' },
  { key: 'displays', label: 'Displays' },
  { key: 'dailyTokens', label: 'Daily Tokens' },
  { key: 'waitingQueue', label: 'Waiting Queue' },
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  LEGACY: { label: 'Legacy plan', className: 'sb-active' },
  TRIAL: { label: 'Trial', className: 'sb-active' },
  ACTIVE: { label: 'Active', className: 'sb-active' },
  PAST_DUE: { label: 'Past due', className: 'sb-warn' },
  CANCELLED: { label: 'Cancelled', className: 'sb-danger' },
  EXPIRED: { label: 'Expired', className: 'sb-danger' },
};

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function usageState(used: number, limit: number) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  if (pct >= 100) return { pct: 100, note: 'Plan limit reached', noteClass: 'reached', fillClass: 'usage-full' };
  if (pct >= 80) return { pct, note: 'Approaching plan limit', noteClass: 'near', fillClass: 'usage-warn' };
  return { pct, note: 'OK', noteClass: 'ok', fillClass: '' };
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [details, setDetails] = useState<SubscriptionDetails | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  useEffect(() => {
    async function load() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState('error'); return; }
      const user = await me.json();
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      const headers = { 'x-organization-id': membership.organization.id };

      const [subscriptionResponse, usageResponse] = await Promise.all([
        fetchWithAuth('/api/organizations/current/subscription', { headers }),
        fetchWithAuth('/api/organizations/current/usage', { headers }),
      ]);

      if (subscriptionResponse.status === 403 || usageResponse.status === 403) { setState('forbidden'); return; }
      if (!subscriptionResponse.ok || !usageResponse.ok) { setState('error'); return; }

      const [current, currentUsage] = await Promise.all([
        subscriptionResponse.json() as Promise<SubscriptionDetails>,
        usageResponse.json() as Promise<Usage>,
      ]);
      setDetails(current);
      setUsage(currentUsage);
      setState('ready');
    }
    void load().catch(() => setState('error'));
  }, [router]);

  if (state === 'loading') return <main className="page-shell">Loading subscription...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to view subscription details.</p></main>;
  if (state === 'error' || !details) return <main className="page-shell"><p className="error-text">Unable to load subscription details.</p></main>;

  const statusMeta = STATUS_META[details.status] ?? { label: details.status, className: 'sb-inactive' };
  const plan = details.plan;
  const features = details.features ?? {};
  const featureEntries = Object.entries(FEATURE_LABELS);

  return (
    <main className="page-shell">
      <nav className="top-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/organization">Organization settings</a>
      </nav>
      <section className="content-panel">
        <p className="eyebrow">Organization</p>
        <h1>Subscription & Entitlements</h1>

        <div className="status-banner" style={{ padding: '1.25rem', background: '#f5f5f5', borderRadius: '6px', margin: '1.25rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>Current Plan: {plan?.name || 'Legacy / Default Plan'}</h3>
              <p className="muted" style={{ margin: '.35rem 0 0' }}>Code: <strong>{plan?.code || 'legacy'}</strong></p>
            </div>
            <span className={`status-badge ${statusMeta.className}`}>{statusMeta.label}</span>
          </div>

          {plan && plan.monthlyPrice > 0 && (
            <p className="muted" style={{ marginTop: '.75rem' }}>
              {formatPrice(plan.monthlyPrice)}/month · {formatPrice(plan.yearlyPrice)}/year
            </p>
          )}

          {(details.trialEndsAt || details.endsAt) && (
            <p className="muted" style={{ marginTop: '.5rem', fontSize: '.875rem' }}>
              {details.trialEndsAt && <span>Trial ends: <strong>{new Date(details.trialEndsAt).toLocaleDateString()}</strong></span>}
              {details.trialEndsAt && details.endsAt && <span> · </span>}
              {details.endsAt && <span>Subscription ends: <strong>{new Date(details.endsAt).toLocaleDateString()}</strong></span>}
            </p>
          )}

          {!details.hasActiveSubscription && (
            <p className="muted" style={{ marginTop: '.5rem' }}>
              Your organization is currently operating on default fallback limits with all features enabled.
            </p>
          )}
        </div>

        <h3>Usage vs. Plan Limits</h3>
        {usage ? (
          <div className="usage-list">
            {USAGE_ROWS.map(({ key, label }) => {
              const item = usage[key];
              if (!item) return null;
              const { pct, note, noteClass, fillClass } = usageState(item.used, item.limit);
              return (
                <div className="usage-item" key={key}>
                  <div className="usage-head">
                    <strong>{label}</strong>
                    <span>{item.used} / {item.limit}</span>
                  </div>
                  <div className="usage-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} usage`}>
                    <span className={`usage-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`usage-note ${noteClass}`}>{note}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Usage data is unavailable.</p>
        )}

        <h3 style={{ marginTop: '2.5rem' }}>Features</h3>
        <div className="feature-grid">
          {featureEntries.map(([key, label]) => {
            const enabled = features[key] === true;
            return (
              <span key={key} className={`feature-chip ${enabled ? 'feature-on' : 'feature-off'}`}>
                <span>{enabled ? '✓' : '✗'}</span>
                {label}
              </span>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: '.75rem', fontSize: '.8rem' }}>
          Feature enforcement is always performed server-side, even if a control appears disabled here.
        </p>
      </section>
    </main>
  );
}
