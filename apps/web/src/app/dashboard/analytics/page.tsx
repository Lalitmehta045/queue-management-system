'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface Summary {
  totalPatients: number;
  totalQueueEntries: number;
  waitingQueueCount: number;
  cancelledQueueCount: number;
  tokensIssued: number;
  tokensCalled: number;
  tokensServing: number;
  tokensCompleted: number;
  tokensSkipped: number;
  tokensCancelled: number;
  currentlyServing: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
  avgHandlingTimeSeconds: number | null;
  completionRate: number;
  cancellationRate: number;
  skipRate: number;
}

interface ServiceRow {
  serviceId: string;
  serviceName: string;
  departmentName: string;
  queueEntries: number;
  tokensIssued: number;
  completed: number;
  cancelled: number;
  skipped: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
  completionRate: number;
}

interface CounterRow {
  counterId: string;
  counterName: string;
  counterCode: string;
  tokensHandled: number;
  completed: number;
  skipped: number;
  avgServiceTimeSeconds: number | null;
  avgWaitingTimeSeconds: number | null;
}

interface TrendRow {
  date: string;
  queueEntries: number;
  tokensIssued: number;
  completed: number;
  cancelled: number;
  skipped: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
}

interface Branch {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
}

interface ServiceOption {
  id: string;
  name: string;
  departmentId: string;
}

interface CounterOption {
  id: string;
  name: string;
  code: string;
}

interface Membership {
  id: string;
  role: string;
  branchId: string | null;
  organization: { id: string; name: string };
}

interface User {
  displayName: string;
  email: string;
  memberships: Membership[];
}

function formatTime(seconds: number | null): string {
  if (seconds === null) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`;
}

export default function AnalyticsPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [counters, setCounters] = useState<CounterOption[]>([]);

  const [businessDate, setBusinessDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [counterId, setCounterId] = useState('');

  const [summary, setSummary] = useState<Summary | null>(null);
  const [serviceData, setServiceData] = useState<ServiceRow[]>([]);
  const [counterData, setCounterData] = useState<CounterRow[]>([]);
  const [trendData, setTrendData] = useState<TrendRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const router = useRouter();

  useEffect(() => {
    async function loadContext() {
      try {
        const meRes = await fetchWithAuth('/api/auth/me');
        if (meRes.status === 401) { router.push('/login'); return; }
        if (!meRes.ok) { setState('error'); return; }
        const meData = await meRes.json() as User;
        setUser(meData);
        const membership = meData.memberships[0];
        if (!membership) { setState('error'); return; }
        setOrganizationId(membership.organization.id);

        if (membership.branchId) {
          setBranchId(membership.branchId);
        }

        const brRes = await fetchWithAuth('/api/organizations/current/branches', {
          headers: { 'x-organization-id': membership.organization.id },
        });
        if (brRes.ok) {
          const brData = await brRes.json() as { data: Branch[] };
          setBranches(brData.data);
          if (!membership.branchId && brData.data.length > 0) {
            setBranchId(brData.data[0]!.id);
          }
        }
        setState('ready');
      } catch {
        setState('error');
      }
    }
    void loadContext();
  }, [router]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (businessDate) params.set('businessDate', businessDate);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (departmentId) params.set('departmentId', departmentId);
    if (serviceId) params.set('serviceId', serviceId);
    if (counterId) params.set('counterId', counterId);
    return params;
  }, [businessDate, startDate, endDate, departmentId, serviceId, counterId]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    const currentOrganizationId = organizationId;
    const currentBranchId = branchId;

    async function loadFilters() {
      const headers = { 'x-organization-id': currentOrganizationId };
      let loadedDepartments: Department[] = [];
      const deptRes = await fetchWithAuth(`/api/branches/${currentBranchId}/departments`, { headers });
      if (deptRes.ok) {
        const deptData = await deptRes.json() as { data: Department[] };
        loadedDepartments = deptData.data;
      }
      setDepartments(loadedDepartments);

      const allServices: ServiceOption[] = [];
      for (const dept of loadedDepartments) {
        const svcRes = await fetchWithAuth(`/api/departments/${dept.id}/services`, { headers });
        if (svcRes.ok) {
          const svcData = await svcRes.json() as { data: Array<{ id: string; name: string; departmentId: string }> };
          allServices.push(...svcData.data);
        }
      }
      setServices(allServices);

      const ctrRes = await fetchWithAuth(`/api/branches/${currentBranchId}/counters`, { headers });
      if (ctrRes.ok) {
        const ctrData = await ctrRes.json() as { data: CounterOption[] };
        setCounters(ctrData.data);
      }
    }
    void loadFilters();
  }, [organizationId, branchId]);

  const loadAnalytics = useCallback(async () => {
    if (!organizationId || !branchId) return;
    setLoadingData(true);
    const headers = { 'x-organization-id': organizationId! };
    const params = buildParams();

    try {
      const [sumRes, svcRes, ctrRes, trendRes] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/analytics/summary?${params}`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/analytics/services?${params}`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/analytics/counters?${params}`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/analytics/trends?${params}`, { headers }),
      ]);

      if (sumRes.status === 403) { setState('forbidden'); setLoadingData(false); return; }
      if (!sumRes.ok) { setState('error'); setLoadingData(false); return; }

      const [sumData, svcData, ctrData, trendDataRaw] = await Promise.all([
        sumRes.json() as Promise<Summary>,
        svcRes.json() as Promise<ServiceRow[]>,
        ctrRes.json() as Promise<CounterRow[]>,
        trendRes.json() as Promise<TrendRow[]>,
      ]);

      setSummary(sumData);
      setServiceData(svcData);
      setCounterData(ctrData);
      setTrendData(trendDataRaw);
    } catch {
      setState('error');
    }
    setLoadingData(false);
  }, [organizationId, branchId, buildParams]);

  useEffect(() => {
    if (state === 'ready' && branchId) void loadAnalytics();
  }, [state, branchId, loadAnalytics]);

  const handleExport = async (type: 'services' | 'counters' | 'trends') => {
    if (!organizationId || !branchId) return;
    const params = buildParams();
    params.set('type', type);
    const headers = { 'x-organization-id': organizationId! };
    const res = await fetchWithAuth(`/api/branches/${branchId}/analytics/export?${params}`, { headers });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  if (state === 'loading') return <main className="page-shell"><p>Loading...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to view analytics.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load analytics data. Please try again.</p></main>;

  const membership = user?.memberships[0];
  const isBranchScoped = !!membership?.branchId;

  return (
    <main className="page-shell">
      <nav className="top-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/dashboard/analytics" style={{ color: '#0f766e' }}>Analytics</a>
      </nav>

      <section className="content-panel" style={{ maxWidth: '72rem' }}>
        <p className="eyebrow">Operational Insights</p>
        <h1>Analytics Dashboard</h1>
        <p className="muted">Branch performance metrics and operational trends.</p>

        {!isBranchScoped && branches.length > 1 && (
          <div className="analytics-filters" style={{ marginTop: '1.5rem' }}>
            <label>Branch
              <select value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="analytics-filters" style={{ marginTop: '1rem' }}>
          <label>Business Date
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </label>
          <label>Start Date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>End Date
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label>Department
            <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setServiceId(''); }}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label>Service
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">All services</option>
              {services.filter((s) => !departmentId || s.departmentId === departmentId).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>Counter
            <select value={counterId} onChange={(e) => setCounterId(e.target.value)}>
              <option value="">All counters</option>
              {counters.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </label>
        </div>

        {loadingData && <p className="muted" style={{ marginTop: '1rem' }}>Loading analytics...</p>}

        {summary && !loadingData && (
          <>
            <div className="kpi-grid" style={{ marginTop: '2rem' }}>
              <div className="kpi-card"><span className="kpi-label">Patients</span><span className="kpi-value">{summary.totalPatients}</span></div>
              <div className="kpi-card"><span className="kpi-label">Queue Entries</span><span className="kpi-value">{summary.totalQueueEntries}</span></div>
              <div className="kpi-card"><span className="kpi-label">Waiting</span><span className="kpi-value">{summary.waitingQueueCount}</span></div>
              <div className="kpi-card"><span className="kpi-label">Cancelled</span><span className="kpi-value">{summary.cancelledQueueCount}</span></div>
              <div className="kpi-card"><span className="kpi-label">Tokens Issued</span><span className="kpi-value">{summary.tokensIssued}</span></div>
              <div className="kpi-card"><span className="kpi-label">Called</span><span className="kpi-value">{summary.tokensCalled}</span></div>
              <div className="kpi-card"><span className="kpi-label">Currently Serving</span><span className="kpi-value">{summary.currentlyServing}</span></div>
              <div className="kpi-card"><span className="kpi-label">Completed</span><span className="kpi-value">{summary.tokensCompleted}</span></div>
              <div className="kpi-card"><span className="kpi-label">Skipped</span><span className="kpi-value">{summary.tokensSkipped}</span></div>
              <div className="kpi-card"><span className="kpi-label">Avg Wait</span><span className="kpi-value">{formatTime(summary.avgWaitingTimeSeconds)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Avg Service</span><span className="kpi-value">{formatTime(summary.avgServiceTimeSeconds)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Avg Handling</span><span className="kpi-value">{formatTime(summary.avgHandlingTimeSeconds)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Completion Rate</span><span className="kpi-value">{formatRate(summary.completionRate)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Cancellation Rate</span><span className="kpi-value">{formatRate(summary.cancellationRate)}</span></div>
              <div className="kpi-card"><span className="kpi-label">Skip Rate</span><span className="kpi-value">{formatRate(summary.skipRate)}</span></div>
            </div>

            {trendData.length > 0 && (
              <div style={{ marginTop: '2.5rem' }}>
                <div className="section-heading">
                  <h2 style={{ margin: 0 }}>Daily Trend</h2>
                  <button className="compact-button secondary-button" onClick={() => void handleExport('trends')}>Export CSV</button>
                </div>
                <div style={{ marginTop: '1rem', height: '20rem' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="tokensIssued" name="Issued" stroke="#0f766e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="completed" name="Completed" stroke="#147a52" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke="#b42318" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="skipped" name="Skipped" stroke="#b45309" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div style={{ marginTop: '2.5rem' }}>
              <div className="section-heading">
                <h2 style={{ margin: 0 }}>Service Performance</h2>
                <button className="compact-button secondary-button" onClick={() => void handleExport('services')}>Export CSV</button>
              </div>
              {serviceData.length === 0 ? (
                <div className="empty-state"><p className="muted">No service data for the selected filters.</p></div>
              ) : (
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Service</th><th>Department</th><th>Entries</th><th>Issued</th>
                        <th>Completed</th><th>Cancelled</th><th>Skipped</th>
                        <th>Avg Wait</th><th>Avg Service</th><th>Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceData.map((s) => (
                        <tr key={s.serviceId}>
                          <td>{s.serviceName}</td>
                          <td>{s.departmentName}</td>
                          <td>{s.queueEntries}</td>
                          <td>{s.tokensIssued}</td>
                          <td>{s.completed}</td>
                          <td>{s.cancelled}</td>
                          <td>{s.skipped}</td>
                          <td>{formatTime(s.avgWaitingTimeSeconds)}</td>
                          <td>{formatTime(s.avgServiceTimeSeconds)}</td>
                          <td>{formatRate(s.completionRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ marginTop: '2.5rem' }}>
              <div className="section-heading">
                <h2 style={{ margin: 0 }}>Counter Performance</h2>
                <button className="compact-button secondary-button" onClick={() => void handleExport('counters')}>Export CSV</button>
              </div>
              {counterData.length === 0 ? (
                <div className="empty-state"><p className="muted">No counter data for the selected filters.</p></div>
              ) : (
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Counter</th><th>Code</th><th>Handled</th>
                        <th>Completed</th><th>Skipped</th>
                        <th>Avg Service</th><th>Avg Wait</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counterData.map((c) => (
                        <tr key={c.counterId}>
                          <td>{c.counterName}</td>
                          <td>{c.counterCode}</td>
                          <td>{c.tokensHandled}</td>
                          <td>{c.completed}</td>
                          <td>{c.skipped}</td>
                          <td>{formatTime(c.avgServiceTimeSeconds)}</td>
                          <td>{formatTime(c.avgWaitingTimeSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
