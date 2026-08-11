'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Patient = { id: string; patientNumber: string; firstName: string; lastName: string; status: 'ACTIVE' | 'INACTIVE' };
type Department = { id: string; name: string };
type Service = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; departmentId: string };
type QueueEntry = { id: string; patientId: string; serviceId: string; status: 'WAITING' | 'CANCELLED'; priority: string; priorityWeight: number; createdAt: string; patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } }; token: { id: string; displayNumber: string; status: 'WAITING' | 'CANCELLED' } | null };
type QueueList = { data: QueueEntry[]; meta: { page: number; limit: number; total: number; totalPages: number } };

export default function QueueEntriesPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [entries, setEntries] = useState<QueueList | null>(null);
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [status, setStatus] = useState('WAITING');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadContext() {
      const meResponse = await fetchWithAuth('/api/auth/me');
      if (meResponse.status === 401) { router.push('/login'); return; }
      if (!meResponse.ok) { setState('error'); return; }
      const user = await meResponse.json() as User;
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      setOrganizationId(membership.organization.id);
      if (membership.branchId) {
        setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
        setBranchId(membership.branchId);
        return;
      }
      const response = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      const branchList = await response.json() as { data: Branch[] };
      setBranches(branchList.data);
      setBranchId(branchList.data[0]?.id ?? '');
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadBranchData() {
      setState('loading');
      const headers = { 'x-organization-id': organizationId };
      const [patientResponse, departmentResponse] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=100`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers }),
      ]);
      if (patientResponse.status === 403 || departmentResponse.status === 403) { setState('forbidden'); return; }
      if (!patientResponse.ok || !departmentResponse.ok) { setState('error'); return; }
      const patientList = await patientResponse.json() as { data: Patient[] };
      const departmentList = await departmentResponse.json() as { data: Department[] };
      const serviceLists = await Promise.all(departmentList.data.map(async (department) => {
        const response = await fetchWithAuth(`/api/departments/${department.id}/services?page=1&limit=100`, { headers });
        if (!response.ok) throw new Error('Unable to load services');
        const result = await response.json() as { data: Service[] };
        return result.data.map((service) => ({ ...service, departmentId: department.id }));
      }));
      setPatients(patientList.data.filter((patient) => patient.status === 'ACTIVE'));
      setDepartments(departmentList.data);
      setServices(serviceLists.flat());
      setPatientId((current) => current || patientList.data.find((patient) => patient.status === 'ACTIVE')?.id || '');
      setServiceId((current) => current || serviceLists.flat().find((service) => service.status === 'ACTIVE')?.id || '');
    }
    void loadBranchData().catch(() => setState('error'));
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadEntries() {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      setEntries(await response.json() as QueueList);
      setState('ready');
    }
    void loadEntries().catch(() => setState('error'));
  }, [branchId, organizationId, page, router, status]);

  async function createEntry() {
    if (!patientId || !serviceId) return;
    const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ patientId, serviceId, priority }) });
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('This patient is already waiting for that service.'); return; }
    if (!response.ok) { setMessage('The patient and service must be active and belong to this branch.'); return; }
    setMessage('Queue entry created.');
    setStatus('WAITING');
    setPage(1);
    await reloadEntries(1, 'WAITING');
  }

  async function cancelEntry(entry: QueueEntry) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${entry.id}/cancel`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to cancel this queue entry.'); return; }
    setMessage('Queue entry cancelled.');
    await reloadEntries(page, status);
  }

  async function generateToken(entry: QueueEntry) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${entry.id}/token`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({}) });
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('Token generation is busy or this entry already has a token.'); return; }
    if (!response.ok) { setMessage('This queue entry is not eligible for a token.'); return; }
    setMessage('Token generated.');
    await reloadEntries(page, status);
  }

  async function reloadEntries(nextPage: number, nextStatus: string) {
    const params = new URLSearchParams({ page: String(nextPage), limit: '20' });
    if (nextStatus) params.set('status', nextStatus);
    const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
    if (response.ok) setEntries(await response.json() as QueueList);
  }

  if (state === 'loading' && !entries) return <main className="page-shell"><p>Loading queue entries...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to access this branch queue.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load queue entry management.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/patients">Patients</a></nav>
      <section className="content-panel">
        <div className="section-heading"><div><p className="eyebrow">Service booking</p><h1>Queue entries</h1><p className="muted">Register a patient request without assigning a token or counter.</p></div></div>
        {branches.length > 1 && <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}</select></label>}
        <div className="queue-booking-grid">
          <label>Patient<select value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.patientNumber} · {patient.firstName} {patient.lastName}</option>)}</select></label>
          <label>Service<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">Select service</option>{services.filter((service) => service.status === 'ACTIVE').map((service) => <option key={service.id} value={service.id}>{departments.find((department) => department.id === service.departmentId)?.name} · {service.name}</option>)}</select></label>
          <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="NORMAL">Normal</option><option value="APPOINTMENT">Appointment</option><option value="SENIOR_CITIZEN">Senior Citizen</option><option value="VIP">VIP</option><option value="EMERGENCY">Emergency</option></select></label>
          <button type="button" onClick={() => void createEntry()} disabled={!patientId || !serviceId}>Enter queue</button>
        </div>
        {message && <p className="success-text" role="status">{message}</p>}
        <div className="filter-row"><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="WAITING">Waiting</option><option value="CANCELLED">Cancelled</option><option value="">All statuses</option></select></label></div>
        {!entries?.data.length ? <p className="muted empty-state">No queue entries found.</p> : <div className="patient-list">{entries.data.map((entry) => <div className="queue-entry-row" key={entry.id}><span><strong>{entry.patient.firstName} {entry.patient.lastName}</strong><small>{entry.patient.patientNumber} · {entry.service.name} · {entry.service.department.name} · Priority: {entry.priority}</small></span><span className="row-actions">{entry.token ? <a className="token-label" href={`/dashboard/tokens?tokenId=${entry.token.id}`}>{entry.token.displayNumber}</a> : entry.status === 'WAITING' && <button type="button" onClick={() => void generateToken(entry)}>Generate token</button>}<span className={`status status-${entry.status.toLowerCase()}`}>{entry.status}</span>{entry.status === 'WAITING' && <button type="button" className="secondary-button compact-button" onClick={() => void cancelEntry(entry)}>Cancel</button>}</span></div>)}</div>}
        {entries && entries.meta.totalPages > 1 && <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {entries.meta.totalPages}</span><button type="button" disabled={page >= entries.meta.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
      </section>
    </main>
  );
}
