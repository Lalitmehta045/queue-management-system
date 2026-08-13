'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton, TableSkeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Select } from '../../../components/ui/Select';

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
        
        const user = await meResponse.json();
        const membership = user.memberships?.[0];
        if (!membership) { if (isMounted.current) setState('error'); return; }
        
        if (isMounted.current) setOrganizationId(membership.organization.id);
        
        if (membership.branchId) {
          if (isMounted.current) {
            setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
            setBranchId(membership.branchId);
          }
          return;
        }
        
        const response = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const branchList = await response.json();
        if (isMounted.current) {
          setBranches(branchList.data || []);
          setBranchId(branchList.data?.[0]?.id ?? '');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadBranchData() {
      if (isMounted.current) setState('loading');
      try {
        const headers = { 'x-organization-id': organizationId };
        const [patientResponse, departmentResponse] = await Promise.all([
          fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=100`, { headers }),
          fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers }),
        ]);
        
        if (patientResponse.status === 403 || departmentResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!patientResponse.ok || !departmentResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const patientList = await patientResponse.json();
        const departmentList = await departmentResponse.json();
        
        const serviceLists = await Promise.all((departmentList.data || []).map(async (department: Department) => {
          const response = await fetchWithAuth(`/api/departments/${department.id}/services?page=1&limit=100`, { headers });
          if (!response.ok) return [];
          const result = await response.json();
          return (result.data || []).map((service: Service) => ({ ...service, departmentId: department.id }));
        }));
        
        if (isMounted.current) {
          const activePatients = (patientList.data || []).filter((p: Patient) => p.status === 'ACTIVE');
          setPatients(activePatients);
          setDepartments(departmentList.data || []);
          const flatServices = serviceLists.flat();
          setServices(flatServices);
          
          setPatientId((current) => current || activePatients[0]?.id || '');
          setServiceId((current) => current || flatServices.find(s => s.status === 'ACTIVE')?.id || '');
          setState('ready'); // BUG FIX: Added setState('ready') here
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadBranchData();
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadEntries() {
      try {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (status) params.set('status', status);
        const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
        
        if (response.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const data = await response.json();
        if (isMounted.current) {
          setEntries(data);
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, organizationId, page, status]); // Removed router from deps

  async function createEntry() {
    if (!patientId || !serviceId) return;
    setIsSubmitting(true);
    setMessage('');
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries`, { 
        method: 'POST', 
        headers: { 'x-organization-id': organizationId }, 
        body: JSON.stringify({ patientId, serviceId, priority }) 
      });
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('This customer is already waiting for that service.'); return; }
      if (!response.ok) { setMessage('Failed to create queue entry.'); return; }
      
      setStatus('WAITING');
      setPage(1);
      await reloadEntries(1, 'WAITING');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelEntry(entry: QueueEntry) {
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${entry.id}/cancel`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to cancel this queue entry.'); return; }
      await reloadEntries(page, status);
    } catch {
      // ignore
    }
  }

  async function generateToken(entry: QueueEntry) {
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${entry.id}/token`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({}) });
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('Token generation is busy or this entry already has a token.'); return; }
      if (!response.ok) { setMessage('This queue entry is not eligible for a token.'); return; }
      await reloadEntries(page, status);
    } catch {
      // ignore
    }
  }

  async function reloadEntries(nextPage: number, nextStatus: string) {
    const params = new URLSearchParams({ page: String(nextPage), limit: '20' });
    if (nextStatus) params.set('status', nextStatus);
    const response = await fetchWithAuth(`/api/branches/${branchId}/queue-entries?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
    if (response.ok) setEntries(await response.json() as QueueList);
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to access this branch queue." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load queue entry management." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Queue Entries</h1>
          <p className="text-sm text-slate-500 mt-1">Register a customer request without assigning a token or counter.</p>
        </div>
        {branches.length > 1 && (
          <div className="w-full sm:w-64">
            <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
              <option value="">Select branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Queue Entry</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && !patients.length ? (
            <div className="flex gap-4">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-10 w-1/4" />
              <Skeleton className="h-10 w-24" />
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-end gap-4">
              <Select label="Customer" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">Select customer</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>{patient.patientNumber} · {patient.firstName} {patient.lastName}</option>
                ))}
              </Select>
              
              <Select label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Select service</option>
                {services.filter(s => s.status === 'ACTIVE').map((service) => (
                  <option key={service.id} value={service.id}>
                    {departments.find((d) => d.id === service.departmentId)?.name} · {service.name}
                  </option>
                ))}
              </Select>
              
              <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="NORMAL">Normal</option>
                <option value="APPOINTMENT">Appointment</option>
                <option value="SENIOR_CITIZEN">Senior</option>
                <option value="VIP">VIP</option>
                <option value="EMERGENCY">Emergency</option>
              </Select>
              
              <Button onClick={() => void createEntry()} disabled={!patientId || !serviceId || isSubmitting} isLoading={isSubmitting}>
                Enter Queue
              </Button>
            </div>
          )}
          {message && <p className="mt-4 text-sm font-medium text-red-600">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
          <h3 className="font-semibold text-slate-700 text-sm">Recent Entries</h3>
          <div className="w-40">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="WAITING">Waiting</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="">All statuses</option>
            </Select>
          </div>
        </div>
        
        {state === 'loading' && !entries ? (
          <div className="p-6">
            <TableSkeleton rows={4} />
          </div>
        ) : !entries?.data.length ? (
          <EmptyState 
            title="No queue entries found" 
            description="There are no entries matching your current filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 font-semibold">Customer</th>
                  <th className="px-6 py-3 font-semibold">Service</th>
                  <th className="px-6 py-3 font-semibold">Priority</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.data.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{entry.patient ? `${entry.patient.firstName} ${entry.patient.lastName}` : 'Walk-in Customer'}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{entry.patient?.patientNumber || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-900">{entry.service.name}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{entry.service.department.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={entry.priority === 'NORMAL' ? 'neutral' : 'warning'}>
                        {entry.priority.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      {entry.token ? (
                        <a href={`/dashboard/tokens?tokenId=${entry.token.id}`} className="font-bold text-teal-600 hover:underline">
                          {entry.token.displayNumber}
                        </a>
                      ) : (
                        <Badge variant={entry.status === 'WAITING' ? 'info' : 'neutral'}>
                          {entry.status}
                        </Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {!entry.token && entry.status === 'WAITING' && (
                          <Button size="sm" variant="outline" onClick={() => void generateToken(entry)}>
                            Token
                          </Button>
                        )}
                        {entry.status === 'WAITING' && (
                          <Button size="sm" variant="danger" onClick={() => void cancelEntry(entry)}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {entries && entries.meta.totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-xl">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="text-sm text-slate-600 font-medium">Page {page} of {entries.meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= entries.meta.totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
