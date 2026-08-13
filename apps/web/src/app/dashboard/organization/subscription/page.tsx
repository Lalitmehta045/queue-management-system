'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../../lib/auth-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/Card';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { Badge } from '../../../../components/ui/Badge';
import { LayoutDashboard, Building, CreditCard, ChevronRight, BarChart3, Calendar, Zap, Ticket, MonitorSmartphone, Printer, Monitor, Bell, FileText, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';

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

const FEATURE_META: Record<string, { label: string; icon: React.ElementType }> = {
  ANALYTICS: { label: 'Analytics', icon: BarChart3 },
  APPOINTMENTS: { label: 'Appointments', icon: Calendar },
  PRIORITY_QUEUE: { label: 'Priority Queue', icon: Zap },
  QR_STATUS: { label: 'QR Status', icon: Ticket },
  SELF_SERVICE_CHECKIN: { label: 'Self-Service Check-in', icon: MonitorSmartphone },
  THERMAL_PRINTING: { label: 'Thermal Printing', icon: Printer },
  PUBLIC_DISPLAY: { label: 'Public Display', icon: Monitor },
  NOTIFICATIONS: { label: 'Notifications', icon: Bell },
  AUDIT_LOGS: { label: 'Audit Logs', icon: FileText },
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

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function getUsageStatus(used: number, limit: number) {
  if (limit === 0) return { pct: 0, color: 'bg-slate-200', text: 'text-slate-500' };
  const pct = Math.min(100, Math.round((used / limit) * 100));
  if (pct >= 100) return { pct, color: 'bg-rose-500', text: 'text-rose-600' };
  if (pct >= 80) return { pct, color: 'bg-amber-500', text: 'text-amber-600' };
  return { pct, color: 'bg-indigo-500', text: 'text-indigo-600' };
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [details, setDetails] = useState<SubscriptionDetails | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  useEffect(() => {
    async function load() {
      try {
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
      } catch {
        setState('error');
      }
    }
    void load();
  }, [router]);

  if (state === 'loading') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64 mb-8" />
        <Skeleton className="h-[200px] w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] w-full rounded-xl" />
          <Skeleton className="h-[300px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to view subscription details." />
      </div>
    );
  }

  if (state === 'error' || !details) {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Error Loading Subscription" message="Unable to load subscription details." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const plan = details.plan;
  const features = details.features ?? {};
  const featureEntries = Object.entries(FEATURE_META);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE': return <Badge variant="success">Active</Badge>;
      case 'TRIAL': return <Badge variant="info">Trial</Badge>;
      case 'PAST_DUE': return <Badge variant="warning">Past Due</Badge>;
      case 'CANCELLED': case 'EXPIRED': return <Badge variant="danger">{status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()}</Badge>;
      default: return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Navigation */}
      <nav className="flex items-center gap-2 text-sm font-medium text-slate-500 overflow-x-auto pb-2 scrollbar-hide">
        <Link href="/dashboard" className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-indigo-50 whitespace-nowrap">
          <LayoutDashboard className="w-4 h-4" /> Dashboard
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
        <Link href="/dashboard/organization" className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-indigo-50 whitespace-nowrap">
          <Building className="w-4 h-4" /> Organization Settings
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
        <span className="text-slate-900 font-semibold px-2 py-1 whitespace-nowrap flex items-center gap-1.5">
          <CreditCard className="w-4 h-4 text-indigo-600" /> Subscription
        </span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Subscription & Entitlements</h1>
          <p className="text-slate-500 mt-1">Manage your plan, limits, and billing details.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Current Plan Overview */}
        <div className="lg:col-span-3">
          <Card className="border-slate-200/60 shadow-sm rounded-xl overflow-hidden bg-gradient-to-r from-slate-900 to-indigo-900 text-white border-0">
            <CardContent className="p-8 sm:p-10 relative">
              <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl pointer-events-none"></div>
              
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold">{plan?.name || 'Legacy Plan'}</h2>
                      {getStatusBadge(details.status)}
                    </div>
                    <p className="text-indigo-200 font-mono text-sm">Code: {plan?.code || 'legacy'}</p>
                  </div>
                  
                  {(details.trialEndsAt || details.endsAt) && (
                    <div className="flex items-center gap-4 text-sm font-medium text-slate-300">
                      {details.trialEndsAt && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" /> Trial ends: {new Date(details.trialEndsAt).toLocaleDateString()}
                        </div>
                      )}
                      {details.endsAt && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4" /> Subscription ends: {new Date(details.endsAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {!details.hasActiveSubscription && (
                    <p className="text-sm text-amber-200 bg-amber-900/30 px-3 py-1.5 rounded-lg border border-amber-500/30 inline-block">
                      Organization is operating on default fallback limits.
                    </p>
                  )}
                </div>

                {plan && plan.monthlyPrice > 0 && (
                  <div className="bg-white/10 backdrop-blur-sm border border-white/20 p-4 rounded-xl text-center md:text-right w-full md:w-auto">
                    <div className="text-3xl font-bold">{formatPrice(plan.monthlyPrice)}<span className="text-lg text-indigo-200 font-normal">/mo</span></div>
                    <div className="text-sm text-indigo-200 mt-1">or {formatPrice(plan.yearlyPrice)}/year</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Usage Stats */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-200/60 shadow-sm rounded-xl h-full">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 pt-6">
              <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-600" /> Usage vs. Plan Limits
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {usage ? (
                <div className="space-y-6">
                  {USAGE_ROWS.map(({ key, label }) => {
                    const item = usage[key];
                    if (!item) return null;
                    const { pct, color, text } = getUsageStatus(item.used, item.limit);
                    
                    return (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between items-center text-sm font-semibold">
                          <span className="text-slate-700">{label}</span>
                          <span className={text}>{item.used} / {item.limit === -1 ? 'Unlimited' : item.limit}</span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${color} transition-all duration-500 rounded-full`} 
                            style={{ width: `${item.limit === -1 ? 0 : pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center p-8 text-slate-500">Usage data unavailable.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div className="space-y-6">
          <Card className="border-slate-200/60 shadow-sm rounded-xl h-full">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 pt-6">
              <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" /> Included Features
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                {featureEntries.map(([key, meta]) => {
                  const enabled = features[key] === true;
                  return (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-md ${enabled ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
                          <meta.icon className="w-4 h-4" />
                        </div>
                        <span className={`font-semibold text-sm ${enabled ? 'text-slate-700 group-hover:text-slate-900' : 'text-slate-400'}`}>
                          {meta.label}
                        </span>
                      </div>
                      {enabled ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-slate-300" />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
