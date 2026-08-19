'use client';

import { FormEvent, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { TableSkeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

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
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden' | 'empty'>('loading');
  const [message, setMessage] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function loadContext() {
      try {
        const meResponse = await fetchWithAuth('/api/auth/me');
        if (meResponse.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (!meResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const user = await meResponse.json() as User;
        const membership = user.memberships[0];
        if (!membership) { if (isMounted.current) setState('error'); return; }
        
        if (isMounted.current) setOrganizationId(membership.organization.id);
        
        if (membership.branchId) {
          if (isMounted.current) {
            setBranchId(membership.branchId);
            setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
          }
          return;
        }
        
        const response = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const branchList = await response.json();
        if (isMounted.current) {
          const fetchedBranches = branchList.data || [];
          setBranches(fetchedBranches);
          if (fetchedBranches.length === 0) {
            setState('empty');
          } else {
            setBranchId(fetchedBranches[0].id);
          }
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadPatients() {
      if (isMounted.current) setState('loading');
      try {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (search.trim()) params.set('search', search.trim());
        
        const response = await fetchWithAuth(`/api/branches/${branchId}/patients?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
        if (response.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const data = await response.json();
        if (isMounted.current) {
          setPatients(data);
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, organizationId, page, search]); // removed router

  function choosePatient(patient: Patient) {
    setSelected(patient);
    setForm({ firstName: patient.firstName, lastName: patient.lastName, phone: patient.phone ?? '', email: patient.email ?? '' });
    setFormOpen(false);
    setMessage('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const url = selected ? `/api/branches/${branchId}/patients/${selected.id}` : `/api/branches/${branchId}/patients`;
      const response = await fetchWithAuth(url, { method: selected ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify(form) });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('A patient with these details could not be saved.'); return; }
      if (!response.ok) { setMessage('Unable to save patient. Check the form and try again.'); return; }
      
      const patient = await response.json();
      setSelected(patient);
      setFormOpen(false);
      setMessage(selected ? 'Patient updated successfully.' : 'Patient registered successfully.');
      setPage(1);
      setSearch('');
      
      const refresh = await fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=20`, { headers: { 'x-organization-id': organizationId } });
      if (refresh.ok) setPatients(await refresh.json());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeStatus(status: 'activate' | 'deactivate') {
    if (!selected) return;
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/patients/${selected.id}/${status}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to change patient status.'); return; }
      
      const patient = await response.json();
      setSelected(patient);
      setPatients((current) => current ? { ...current, data: current.data.map((item) => item.id === patient.id ? patient : item) } : current);
      setMessage(`Patient ${status}d successfully.`);
    } catch {
      // ignore
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to manage patients in this branch." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load patient management. Please try again." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <EmptyState title="No branches assigned" description="You do not have any active branches assigned to your account." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
          <p className="text-sm text-slate-500 mt-1">Identity records for registration and queue workflows.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          {branches.length > 1 && (
            <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); setSelected(null); }}>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
            </Select>
          )}
          <Button onClick={() => { setSelected(null); setForm(emptyForm); setFormOpen(true); setMessage(''); }}>
            Register Patient
          </Button>
        </div>
      </div>

      {message && (
        <div className="p-4 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-medium">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl">
              <Input
                placeholder="Search by name, phone, or ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>

            {state === 'loading' && !patients ? (
              <div className="p-6">
                <TableSkeleton rows={5} />
              </div>
            ) : !patients?.data.length ? (
              <div className="p-12">
                <EmptyState 
                  title="No patients found" 
                  description="There are no patients matching your current search."
                  actionLabel="Add new patient"
                  onAction={() => { setSelected(null); setForm(emptyForm); setFormOpen(true); }}
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {patients.data.map((patient) => (
                  <div
                    key={patient.id}
                    className={`flex items-center justify-between p-4 cursor-pointer transition-colors hover:bg-slate-50 ${selected?.id === patient.id ? 'bg-teal-50/50 hover:bg-teal-50' : ''}`}
                    onClick={() => choosePatient(patient)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm">
                        {patient.firstName[0]}{patient.lastName[0]}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{patient.firstName} {patient.lastName}</div>
                        <div className="text-sm text-slate-500">{patient.patientNumber} {patient.phone ? `· ${patient.phone}` : ''}</div>
                      </div>
                    </div>
                    <div>
                      <Badge variant={patient.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {patient.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {patients && patients.meta.totalPages > 1 && (
              <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-xl">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-slate-600 font-medium">Page {page} of {patients.meta.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= patients.meta.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          {formOpen && (
            <Card>
              <CardHeader>
                <CardTitle>{selected ? 'Edit Patient' : 'New Registration'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => void submit(e)} className="space-y-4">
                  <Input required label="First Name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  <Input required label="Last Name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  <Input label="Phone (optional)" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  <Input label="Email (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  
                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
                    <Button type="submit" className="w-full" isLoading={isSubmitting}>
                      Save
                    </Button>
                    <Button type="button" variant="outline" className="w-full" onClick={() => setFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {selected && !formOpen && (
            <Card>
              <CardHeader>
                <CardTitle>Patient Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
                  <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-lg">
                    {selected.firstName[0]}{selected.lastName[0]}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-none">{selected.firstName} {selected.lastName}</h3>
                    <p className="text-sm text-slate-500 mt-1">{selected.patientNumber}</p>
                  </div>
                </div>
                
                <div className="space-y-3 py-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Phone</span>
                    <span className="text-slate-900 font-semibold">{selected.phone || '—'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Email</span>
                    <span className="text-slate-900 font-semibold">{selected.email || '—'}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 font-medium">Status</span>
                    <Badge variant={selected.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {selected.status}
                    </Badge>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
                  <Button className="w-full" variant="secondary" onClick={() => setFormOpen(true)}>
                    Edit Profile
                  </Button>
                  {selected.status === 'ACTIVE' ? (
                    <Button className="w-full" variant="outline" onClick={() => void changeStatus('deactivate')}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button className="w-full" variant="outline" onClick={() => void changeStatus('activate')}>
                      Activate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
