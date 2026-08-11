'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Department = { id: string; name: string };
type Service = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; departmentId: string };
type Token = { id: string; queueEntryId: string; sequenceNumber: number; displayNumber: string; businessDate: string; status: 'WAITING' | 'CANCELLED'; issuedAt: string; queueEntry: { priority: string; patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } } } };
type TokenList = { data: Token[]; meta: { total: number; page: number; limit: number; totalPages: number; businessDate: string } };

async function fetchTokenList(branchId: string, organizationId: string, page: number, status: string, serviceId: string, businessDate: string) {
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (businessDate) params.set('businessDate', businessDate);
  if (status) params.set('status', status);
  if (serviceId) params.set('serviceId', serviceId);
  return fetchWithAuth(`/api/branches/${branchId}/tokens?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
}

export default function TokensPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [tokens, setTokens] = useState<TokenList | null>(null);
  const [selected, setSelected] = useState<Token | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState('WAITING');
  const [businessDate, setBusinessDate] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadContext() {
      const response = await fetchWithAuth('/api/auth/me');
      if (response.status === 401) { router.push('/login'); return; }
      if (!response.ok) { setState('error'); return; }
      const user = await response.json() as User;
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      setOrganizationId(membership.organization.id);
      if (membership.branchId) {
        setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
        setBranchId(membership.branchId);
        return;
      }
      const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
      if (branchResponse.status === 403) { setState('forbidden'); return; }
      if (!branchResponse.ok) { setState('error'); return; }
      const branchList = await branchResponse.json() as { data: Branch[] };
      setBranches(branchList.data);
      setBranchId(branchList.data[0]?.id ?? '');
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadServices() {
      const headers = { 'x-organization-id': organizationId };
      const departmentsResponse = await fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers });
      if (departmentsResponse.status === 403) { setState('forbidden'); return; }
      if (!departmentsResponse.ok) { setState('error'); return; }
      const departmentList = await departmentsResponse.json() as { data: Department[] };
      const lists = await Promise.all(departmentList.data.map(async (department) => {
        const response = await fetchWithAuth(`/api/departments/${department.id}/services?page=1&limit=100`, { headers });
        if (!response.ok) throw new Error('Unable to load services');
        const result = await response.json() as { data: Service[] };
        return result.data.map((service) => ({ ...service, departmentId: department.id }));
      }));
      setDepartments(departmentList.data);
      setServices(lists.flat());
    }
    void loadServices().catch(() => setState('error'));
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    void fetchTokenList(branchId, organizationId, page, status, serviceId, businessDate).then(async (response) => {
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) throw new Error('Unable to load tokens');
      const tokenList = await response.json() as TokenList;
      setTokens(tokenList);
      setBusinessDate((current) => current || tokenList.meta.businessDate);
      setState('ready');
    }).catch(() => setState('error'));
  }, [branchId, organizationId, page, router, status, serviceId, businessDate]);

  async function cancelToken(token: Token) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/${token.id}/cancel`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to cancel token.'); return; }
    setMessage('Token cancelled.');
    const refreshed = await fetchTokenList(branchId, organizationId, page, status, serviceId, businessDate);
    if (refreshed.ok) setTokens(await refreshed.json() as TokenList);
  }

  if (state === 'loading' && !tokens) return <main className="page-shell"><p>Loading tokens...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to access tokens in this branch.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load token management.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/queue-entries">Queue entries</a><a href="/dashboard/notifications">Notifications</a></nav>
      <section className="content-panel">
        <p className="eyebrow">Token engine</p><h1>Tokens</h1><p className="muted">Daily service tokens. Calling and counter assignment are not enabled.</p>
        {branches.length > 1 && <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}</select></label>}
        <div className="token-filter-grid"><label>Business date<input type="date" value={businessDate} onChange={(event) => { setBusinessDate(event.target.value); setPage(1); }} /></label><label>Service<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setPage(1); }}><option value="">All services</option>{services.map((service) => <option key={service.id} value={service.id}>{departments.find((department) => department.id === service.departmentId)?.name} · {service.name}</option>)}</select></label><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="WAITING">Waiting</option><option value="CANCELLED">Cancelled</option><option value="">All statuses</option></select></label></div>
        {message && <p className="success-text" role="status">{message}</p>}
        {!tokens?.data.length ? <p className="muted empty-state">No tokens found for this view.</p> : <div className="patient-list">{tokens.data.map((token) => <button type="button" className={`token-row ${selected?.id === token.id ? 'selected' : ''}`} key={token.id} onClick={() => setSelected(token)}><span><strong>{token.displayNumber}</strong><small>{token.queueEntry.patient.firstName} {token.queueEntry.patient.lastName} · {token.queueEntry.patient.patientNumber} · Priority: {token.queueEntry.priority} · {token.queueEntry.service.name}</small></span><span className="row-actions"><span className={`status status-${token.status.toLowerCase()}`}>{token.status}</span><span role="button" tabIndex={0} className="secondary-button compact-button" onClick={(event) => { event.stopPropagation(); router.push(`/dashboard/tokens/${token.id}/print?branch=${branchId}`); }}>Print</span>{token.status === 'WAITING' && <span role="button" tabIndex={0} className="secondary-button compact-button" onClick={(event) => { event.stopPropagation(); void cancelToken(token); }}>Cancel</span>}</span></button>)}</div>}
        {selected && <div className="token-detail"><p className="eyebrow">Token details</p><h2>{selected.displayNumber}</h2><p>{selected.queueEntry.patient.firstName} {selected.queueEntry.patient.lastName} · Priority: {selected.queueEntry.priority} · {selected.queueEntry.service.department.name} · {selected.queueEntry.service.name}</p><p className="muted">Issued {new Date(selected.issuedAt).toLocaleString()}</p></div>}
        {tokens && tokens.meta.totalPages > 1 && <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {tokens.meta.totalPages}</span><button type="button" disabled={page >= tokens.meta.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
      </section>
    </main>
  );
}
