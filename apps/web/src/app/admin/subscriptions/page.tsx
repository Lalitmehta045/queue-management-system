'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Plan = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  active: boolean;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  createdAt: string;
};

type OrgSubscription = {
  organization: { id: string; name: string };
  subscription: {
    id: string;
    planId: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    trialEndsAt: string | null;
    plan: { id: string; name: string; code: string; active: boolean };
  } | null;
};

const LIMIT_KEYS = [
  'maxBranches',
  'maxUsers',
  'maxCounters',
  'maxServices',
  'maxDisplays',
  'maxMonthlyTokens',
  'maxDailyTokens',
  'maxWaitingQueueSize',
];

const FEATURE_KEYS = [
  'ANALYTICS',
  'APPOINTMENTS',
  'PRIORITY_QUEUE',
  'QR_STATUS',
  'SELF_SERVICE_CHECKIN',
  'THERMAL_PRINTING',
  'PUBLIC_DISPLAY',
  'NOTIFICATIONS',
  'AUDIT_LOGS',
];

const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'];

const EMPTY_LIMITS = Object.fromEntries(LIMIT_KEYS.map((key) => [key, 0]));
const EMPTY_FEATURES = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function errorCode(body: { message?: unknown; errorCode?: string } | null): string {
  const message = body?.message;
  if (message && typeof message === 'object' && message !== null && 'errorCode' in message) {
    return String((message as { errorCode: string }).errorCode);
  }
  if (body?.errorCode) return body.errorCode;
  if (message && typeof message === 'string') return message;
  return 'Request failed';
}

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<{
    name: string; code: string; description: string; monthlyPrice: number; yearlyPrice: number; active: boolean;
    limits: Record<string, number>; features: Record<string, boolean>;
  }>({ name: '', code: '', description: '', monthlyPrice: 0, yearlyPrice: 0, active: true, limits: { ...EMPTY_LIMITS }, features: { ...EMPTY_FEATURES } });
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Organization subscription assignment
  const [orgId, setOrgId] = useState('');
  const [orgSub, setOrgSub] = useState<OrgSubscription | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [assignForm, setAssignForm] = useState<{ planId: string; status: string; startsAt: string; endsAt: string; trialEndsAt: string }>({ planId: '', status: 'TRIAL', startsAt: '', endsAt: '', trialEndsAt: '' });
  const [assignMessage, setAssignMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadPlans = useCallback(async () => {
    const response = await fetchWithAuth('/api/admin/subscription-plans');
    if (!response.ok) return;
    const data = await response.json() as Plan[];
    setPlans(data);
  }, []);

  useEffect(() => {
    async function load() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState('error'); return; }
      const user = await me.json();
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      const headers = { 'x-organization-id': membership.organization.id };
      const response = await fetchWithAuth('/api/admin/subscription-plans', { headers });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      setPlans(await response.json() as Plan[]);
      setState('ready');
    }
    void load().catch(() => setState('error'));
  }, [router]);

  function startCreate() {
    setEditing(null);
    setForm({ name: '', code: '', description: '', monthlyPrice: 0, yearlyPrice: 0, active: true, limits: { ...EMPTY_LIMITS }, features: { ...EMPTY_FEATURES } });
    setFormMessage(null);
  }

  function startEdit(plan: Plan) {
    setEditing(plan);
    setForm({
      name: plan.name,
      code: plan.code,
      description: plan.description ?? '',
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      active: plan.active,
      limits: { ...EMPTY_LIMITS, ...plan.limits },
      features: { ...EMPTY_FEATURES, ...plan.features },
    });
    setFormMessage(null);
  }

  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormMessage(null);
    const payload = {
      name: form.name,
      code: form.code,
      description: form.description || null,
      monthlyPrice: form.monthlyPrice,
      yearlyPrice: form.yearlyPrice,
      active: form.active,
      limits: form.limits,
      features: form.features,
    };
    const url = editing ? `/api/admin/subscription-plans/${editing.id}` : '/api/admin/subscription-plans';
    const response = await fetchWithAuth(url, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    if (response.ok) {
      setFormMessage({ kind: 'ok', text: editing ? 'Plan updated.' : 'Plan created.' });
      await loadPlans();
      startCreate();
    } else {
      let body: { message?: unknown; errorCode?: string } | null = null;
      try { body = await response.json() as { message?: unknown; errorCode?: string }; } catch { /* ignore */ }
      setFormMessage({ kind: 'error', text: errorCode(body) });
    }
    setSaving(false);
  }

  async function togglePlanActive(plan: Plan, active: boolean) {
    const response = await fetchWithAuth(`/api/admin/subscription-plans/${plan.id}/${active ? 'activate' : 'deactivate'}`, { method: 'PATCH' });
    if (response.ok) await loadPlans();
  }

  async function loadOrgSubscription() {
    if (!orgId.trim()) return;
    setOrgLoading(true);
    setAssignMessage(null);
    const response = await fetchWithAuth(`/api/admin/organizations/${orgId.trim()}/subscription`);
    if (!response.ok) {
      setOrgSub(null);
      let body: { message?: unknown; errorCode?: string } | null = null;
      try { body = await response.json() as { message?: unknown; errorCode?: string }; } catch { /* ignore */ }
      setAssignMessage({ kind: 'error', text: errorCode(body) });
    } else {
      const data = await response.json() as OrgSubscription;
      setOrgSub(data);
      const sub = data.subscription;
      if (sub) {
        setAssignForm({
          planId: sub.planId,
          status: sub.status,
          startsAt: sub.startsAt ? sub.startsAt.slice(0, 10) : '',
          endsAt: sub.endsAt ? sub.endsAt.slice(0, 10) : '',
          trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.slice(0, 10) : '',
        });
      }
    }
    setOrgLoading(false);
  }

  async function submitOrgSubscription(event: FormEvent) {
    event.preventDefault();
    if (!orgId.trim() || !orgSub) return;
    setAssignMessage(null);
    const payload = {
      planId: assignForm.planId || undefined,
      status: assignForm.status,
      startsAt: assignForm.startsAt ? new Date(`${assignForm.startsAt}T00:00:00.000Z`).toISOString() : undefined,
      endsAt: assignForm.endsAt ? new Date(`${assignForm.endsAt}T00:00:00.000Z`).toISOString() : undefined,
      trialEndsAt: assignForm.trialEndsAt ? new Date(`${assignForm.trialEndsAt}T00:00:00.000Z`).toISOString() : undefined,
    };
    const method = orgSub.subscription ? 'PATCH' : 'POST';
    const response = await fetchWithAuth(`/api/admin/organizations/${orgId.trim()}/subscription`, { method, body: JSON.stringify(payload) });
    if (response.ok) {
      setAssignMessage({ kind: 'ok', text: orgSub.subscription ? 'Subscription updated.' : 'Subscription assigned.' });
      await loadOrgSubscription();
    } else {
      let body: { message?: unknown; errorCode?: string } | null = null;
      try { body = await response.json() as { message?: unknown; errorCode?: string }; } catch { /* ignore */ }
      setAssignMessage({ kind: 'error', text: errorCode(body) });
    }
  }

  if (state === 'loading') return <main className="page-shell">Loading SaaS administration...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">Only SUPER_ADMIN users can manage subscriptions.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load subscription administration.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/admin/subscriptions">SaaS Admin</a>
      </nav>

      <section className="content-panel" style={{ maxWidth: '72rem' }}>
        <p className="eyebrow">SaaS Administration</p>
        <h1>Subscription Plans</h1>
        <p className="section-desc">Manage plan pricing, resource limits, and feature entitlements. Changes affect only new provisioning — existing resources are never altered.</p>

        <div className="section-heading">
          <h2>Plans</h2>
          <button onClick={startCreate}>+ New plan</button>
        </div>

        <div className="plan-grid">
          {plans.map((plan) => (
            <div key={plan.id} className={`plan-card ${plan.active ? 'plan-active' : 'plan-inactive'}`}>
              <div className="plan-name-row">
                <h3>{plan.name}</h3>
                <span className={`status-badge ${plan.active ? 'sb-active' : 'sb-inactive'}`}>{plan.active ? 'Active' : 'Inactive'}</span>
              </div>
              <span className="plan-code">{plan.code}</span>
              <div className="plan-price">
                {money(Number(plan.monthlyPrice))}<small> /month</small>
                <span style={{ marginLeft: '.75rem', fontSize: '.85rem' }}>{money(Number(plan.yearlyPrice))}<small> /year</small></span>
              </div>
              {plan.description && <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>{plan.description}</p>}
              <div style={{ display: 'grid', gap: '.2rem' }}>
                {LIMIT_KEYS.slice(0, 7).map((key) => (
                  <div className="plan-limit-line" key={key}>
                    <span>{key.replace('max', 'Max ')}</span>
                    <strong>{plan.limits?.[key] ?? 0}</strong>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
                {FEATURE_KEYS.map((feature) => (
                  <span key={feature} className="feature-chip" style={{ padding: '.25rem .5rem', fontSize: '.72rem' }} data-on={plan.features?.[feature]}>
                    {plan.features?.[feature] ? '✓' : '✗'} {feature}
                  </span>
                ))}
              </div>
              <div className="plan-actions">
                <button className="mini-button outline" onClick={() => startEdit(plan)}>Edit</button>
                {plan.active
                  ? <button className="mini-button danger" onClick={() => togglePlanActive(plan, false)}>Deactivate</button>
                  : <button className="mini-button muted" onClick={() => togglePlanActive(plan, true)}>Activate</button>}
              </div>
            </div>
          ))}
        </div>

        <div className="form-panel">
          <h3>{editing ? `Edit plan: ${editing.name}` : 'Create a new plan'}</h3>
          <form onSubmit={submitPlan} className="form-stack" style={{ marginTop: 0 }}>
            <div className="form-grid">
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label>Code (e.g. PRO_MONTHLY)<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required pattern="[A-Z0-9_]+" /></label>
              <label>Monthly price (USD)<input type="number" min={0} step="0.01" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: Number(e.target.value) })} /></label>
              <label>Yearly price (USD)<input type="number" min={0} step="0.01" value={form.yearlyPrice} onChange={(e) => setForm({ ...form, yearlyPrice: Number(e.target.value) })} /></label>
            </div>
            <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexDirection: 'row' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} style={{ width: 'auto' }} />
              Active
            </label>

            <div>
              <strong style={{ fontSize: '.875rem' }}>Resource limits</strong>
              <div className="plan-limits-editor">
                {LIMIT_KEYS.map((key) => (
                  <label key={key}>{key.replace('max', 'Max ')}
                    <input type="number" min={0} value={form.limits[key] ?? 0}
                      onChange={(e) => setForm({ ...form, limits: { ...form.limits, [key]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <strong style={{ fontSize: '.875rem' }}>Feature entitlements</strong>
              <div className="plan-features-editor">
                {FEATURE_KEYS.map((feature) => (
                  <label key={feature} className="feature-toggle">
                    <input type="checkbox" checked={form.features[feature] !== false}
                      onChange={(e) => setForm({ ...form, features: { ...form.features, [feature]: e.target.checked } })} />
                    {feature}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
              <button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}</button>
              {editing && <button type="button" className="mini-button muted" onClick={startCreate}>Cancel edit</button>}
            </div>
            {formMessage && <p className={formMessage.kind === 'ok' ? 'success-text' : 'error-text'}>{formMessage.text}</p>}
          </form>
        </div>

        <div className="admin-section">
          <h2>Organization Subscription</h2>
          <p className="section-desc">View or assign a subscription for a specific organization (SUPER_ADMIN only).</p>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
            <label style={{ minWidth: '24rem', flex: 1 }}>Organization ID
              <input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
            </label>
            <button onClick={loadOrgSubscription} disabled={orgLoading || !orgId.trim()}>{orgLoading ? 'Loading…' : 'Load'}</button>
          </div>

          {orgSub && (
            <div className="form-panel" style={{ background: 'white' }}>
              <p className="muted"><strong>{orgSub.organization.name}</strong> · {orgSub.organization.id}</p>
              {orgSub.subscription ? (
                <p>
                  Current: <strong>{orgSub.subscription.plan.name}</strong> ({orgSub.subscription.plan.code}) ·{' '}
                  <span className={`status-badge ${orgSub.subscription.status === 'ACTIVE' || orgSub.subscription.status === 'TRIAL' ? 'sb-active' : orgSub.subscription.status === 'PAST_DUE' ? 'sb-warn' : 'sb-danger'}`}>{orgSub.subscription.status}</span>
                </p>
              ) : (
                <p className="muted">This organization has no subscription — it operates on the legacy default plan.</p>
              )}
              <form onSubmit={submitOrgSubscription} className="form-stack" style={{ marginTop: '.75rem' }}>
                <div className="form-grid">
                  <label>Plan
                    <select value={assignForm.planId} onChange={(e) => setAssignForm({ ...assignForm, planId: e.target.value })} required>
                      <option value="">Select plan…</option>
                      {plans.filter((plan) => plan.active || plan.id === orgSub.subscription?.planId).map((plan) => (
                        <option key={plan.id} value={plan.id}>{plan.name} ({plan.code}){plan.active ? '' : ' — inactive'}</option>
                      ))}
                    </select>
                  </label>
                  <label>Status
                    <select value={assignForm.status} onChange={(e) => setAssignForm({ ...assignForm, status: e.target.value })}>
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label>Starts<input type="date" value={assignForm.startsAt} onChange={(e) => setAssignForm({ ...assignForm, startsAt: e.target.value })} /></label>
                  <label>Ends<input type="date" value={assignForm.endsAt} onChange={(e) => setAssignForm({ ...assignForm, endsAt: e.target.value })} /></label>
                  <label>Trial ends<input type="date" value={assignForm.trialEndsAt} onChange={(e) => setAssignForm({ ...assignForm, trialEndsAt: e.target.value })} /></label>
                </div>
                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <button type="submit">{orgSub.subscription ? 'Update subscription' : 'Assign subscription'}</button>
                </div>
                {assignMessage && <p className={assignMessage.kind === 'ok' ? 'success-text' : 'error-text'}>{assignMessage.text}</p>}
              </form>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
