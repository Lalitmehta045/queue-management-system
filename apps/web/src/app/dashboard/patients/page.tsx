'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string; name: string }; role: string; status: string; branchId: string | null };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Patient = { id: string; branchId: string; patientNumber: string; firstName: string; lastName: string; phone: string | null; email: string | null; status: 'ACTIVE' | 'INACTIVE' };
type PatientList = { data: Patient[]; meta: { page: number; limit: number; total: number; totalPages: number } };

type FormState = { firstName: string; lastName: string; phone: string; email: string };
const emptyForm: FormState = { firstName: '', lastName: '', phone: '', email: '' };

export default function PatientsPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [patients, setPatients] = useState<PatientList | null>(null);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');
  const [formOpen, setFormOpen] = useState(false);

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
        setBranchId(membership.branchId);
        setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
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
    async function loadPatients() {
      setState('loading');
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      const response = await fetchWithAuth(`/api/branches/${branchId}/patients?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      setPatients(await response.json() as PatientList);
      setState('ready');
    }
    void loadPatients().catch(() => setState('error'));
  }, [branchId, organizationId, page, router, search]);

  function choosePatient(patient: Patient) {
    setSelected(patient);
    setForm({ firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone ?? '', email: patient.email ?? '' });
    setFormOpen(false);
    setMessage('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const url = selected ? `/api/branches/${branchId}/patients/${selected.id}` : `/api/branches/${branchId}/patients`;
    const response = await fetchWithAuth(url, { method: selected ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify(form) });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('A patient with these details could not be saved.'); return; }
    if (!response.ok) { setMessage('Unable to save patient. Check the form and try again.'); return; }
    const patient = await response.json() as Patient;
    setSelected(patient);
    setFormOpen(false);
    setMessage(selected ? 'Patient updated.' : 'Patient registered.');
    setPage(1);
    setSearch('');
    const refresh = await fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=20`, { headers: { 'x-organization-id': organizationId } });
    if (refresh.ok) setPatients(await refresh.json() as PatientList);
  }

  async function changeStatus(status: 'activate' | 'deactivate') {
    if (!selected) return;
    const response = await fetchWithAuth(`/api/branches/${branchId}/patients/${selected.id}/${status}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change patient status.'); return; }
    const patient = await response.json() as Patient;
    setSelected(patient);
    setPatients((current) => current ? { ...current, data: current.data.map((item) => item.id === patient.id ? patient : item) } : current);
    setMessage(`Patient ${status}d.`);
  }

  if (state === 'loading' && !patients) return <main className="page-shell"><p>Loading patients...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage patients in this branch.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load patient management.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization">Organization</a></nav>
      <section className="content-panel">
        <div className="section-heading"><div><p className="eyebrow">Patient foundation</p><h1>Patients</h1><p className="muted">Identity records for registration and future queue workflows.</p></div><button type="button" onClick={() => { setSelected(null); setForm(emptyForm); setFormOpen(true); setMessage(''); }}>Register patient</button></div>
        {branches.length > 1 && <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); setSelected(null); }}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}</select></label>}
        <div className="search-row"><label className="search-label">Search patients<input value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, phone, or patient number" /></label></div>
        {message && <p className="success-text" role="status">{message}</p>}
        {!patients?.data.length ? <p className="muted empty-state">No patients found.</p> : <div className="patient-list">{patients.data.map((patient) => <button type="button" className={`patient-row ${selected?.id === patient.id ? 'selected' : ''}`} key={patient.id} onClick={() => choosePatient(patient)}><span><strong>{patient.firstName} {patient.lastName}</strong><small>{patient.patientNumber} · {patient.phone ?? 'No phone'}</small></span><span className={`status status-${patient.status.toLowerCase()}`}>{patient.status}</span></button>)}</div>}
        {patients && patients.meta.totalPages > 1 && <div className="pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {patients.meta.totalPages}</span><button type="button" disabled={page >= patients.meta.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
      </section>
      {formOpen && <section className="content-panel patient-form-panel"><p className="eyebrow">{selected ? 'Edit patient' : 'New registration'}</p><h2>{selected ? selected.patientNumber : 'Register patient'}</h2><form onSubmit={submit} className="form-stack"><label>First name<input required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label><label>Last name<input required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label><label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><div className="row-actions"><button type="submit">Save patient</button><button type="button" className="secondary-button" onClick={() => setFormOpen(false)}>Cancel</button></div></form></section>}
      {selected && !formOpen && <section className="content-panel patient-detail"><p className="eyebrow">Patient details</p><h2>{selected.firstName} {selected.lastName}</h2><dl><dt>Patient number</dt><dd>{selected.patientNumber}</dd><dt>Phone</dt><dd>{selected.phone ?? 'Not provided'}</dd><dt>Email</dt><dd>{selected.email ?? 'Not provided'}</dd><dt>Status</dt><dd>{selected.status}</dd></dl><div className="row-actions"><button type="button" onClick={() => setFormOpen(true)}>Edit</button>{selected.status === 'ACTIVE' ? <button type="button" className="secondary-button" onClick={() => void changeStatus('deactivate')}>Deactivate</button> : <button type="button" onClick={() => void changeStatus('activate')}>Activate</button>}</div></section>}
    </main>
  );
}
