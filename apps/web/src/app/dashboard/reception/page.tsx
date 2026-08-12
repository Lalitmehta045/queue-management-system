'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Branch, Patient, Department, Service, PriorityConfig } from '../../../types/queue';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';

type PageState = 'loading' | 'ready' | 'error' | 'forbidden';
type GeneratedToken = { id: string; displayNumber: string };

export default function ReceptionPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');

  // Data
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [priorities, setPriorities] = useState<PriorityConfig[]>([]);

  // Form State
  const [patientMode, setPatientMode] = useState<'existing' | 'walkin'>('existing');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [newPatientData, setNewPatientData] = useState({ firstName: '', lastName: '', phone: '', email: '' });

  const [departmentId, setDepartmentId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState('NORMAL');

  // UI State
  const [state, setState] = useState<PageState>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [generatedToken, setGeneratedToken] = useState<{ token: GeneratedToken; serviceName: string; priority: string } | null>(null);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Filter patients client-side
  const filteredPatients = useMemo(() => {
    const active = patients.filter(p => p.status === 'ACTIVE');
    if (!patientSearch.trim()) return active;
    const q = patientSearch.toLowerCase();
    return active.filter(p =>
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.patientNumber.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q))
    );
  }, [patients, patientSearch]);

  useEffect(() => {
    async function loadContext() {
      try {
        const response = await fetchWithAuth('/api/auth/me');
        if (response.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const user = await response.json();
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

        const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
        if (branchResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!branchResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const branchList = await branchResponse.json();
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
  }, []); // Intentionally left empty

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadBranchData() {
      if (isMounted.current) setState('loading');
      try {
        const headers = { 'x-organization-id': organizationId };
        const [patientRes, deptRes] = await Promise.all([
          fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=100`, { headers }),
          fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers })
        ]);
        if (patientRes.status === 403 || deptRes.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!patientRes.ok || !deptRes.ok) { if (isMounted.current) setState('error'); return; }

        const patientList = await patientRes.json();
        const deptList = await deptRes.json();

        if (isMounted.current) {
          setPatients(patientList.data || []);
          setDepartments(deptList.data || []);
          setState('ready'); // BUG FIX: Added setState('ready') here
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadBranchData();
  }, [branchId, organizationId]);

  // Load services and priorities when department changes
  useEffect(() => {
    if (!departmentId || !organizationId) {
      if (isMounted.current) {
        setServices([]);
        setPriorities([]);
      }
      return;
    }
    async function loadDeptData() {
      try {
        const headers = { 'x-organization-id': organizationId };
        const [svcRes, priRes] = await Promise.all([
          fetchWithAuth(`/api/departments/${departmentId}/services?page=1&limit=100`, { headers }),
          fetchWithAuth(`/api/priority-configurations?departmentId=${departmentId}`, { headers })
        ]);
        
        if (isMounted.current) {
          if (svcRes.ok) {
            const list = await svcRes.json();
            setServices((list.data || []).filter((s: Service) => s.status === 'ACTIVE'));
          }
          if (priRes.ok) {
            const list = await priRes.json();
            const active = (list.data || []).filter((p: PriorityConfig) => p.active);
            setPriorities(active);
            const hasNormal = active.some((p: PriorityConfig) => p.level === 'NORMAL');
            setPriority(hasNormal ? 'NORMAL' : (active[0]?.level || 'NORMAL'));
          }
        }
      } catch {
        // ignore
      }
    }
    void loadDeptData();
  }, [departmentId, organizationId]);

  function showMessage(text: string, type: 'error' | 'success' = 'error') {
    setMessage(text);
    setMessageType(type);
  }

  async function handleCreateToken() {
    showMessage('');
    setIsSubmitting(true);

    let targetPatientId = patientId;

    if (patientMode === 'walkin') {
      if (!newPatientData.firstName || !newPatientData.lastName) {
        showMessage('First name and last name are required for walk-in patients.');
        setIsSubmitting(false);
        return;
      }
      try {
        const response = await fetchWithAuth(`/api/branches/${branchId}/patients`, {
          method: 'POST',
          headers: { 'x-organization-id': organizationId },
          body: JSON.stringify(newPatientData)
        });
        if (!response.ok) {
          showMessage('Failed to register walk-in patient. Please check the details.');
          setIsSubmitting(false);
          return;
        }
        const newPatient = await response.json();
        setPatients(prev => [newPatient, ...prev]);
        targetPatientId = newPatient.id;
      } catch {
        showMessage('Network error during patient registration.');
        setIsSubmitting(false);
        return;
      }
    }

    if (!targetPatientId || !serviceId) {
      showMessage('Please select a patient and a service.');
      setIsSubmitting(false);
      return;
    }

    try {
      const headers = { 'x-organization-id': organizationId };

      // 1. Create Queue Entry
      const qResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ patientId: targetPatientId, serviceId, priority })
      });

      if (qResponse.status === 403) { showMessage('Forbidden: You do not have permission.'); return; }
      if (qResponse.status === 409) { showMessage('Patient already has an active queue entry for this service.'); return; }
      if (!qResponse.ok) { showMessage('Failed to create queue entry.'); return; }

      const queueEntry = await qResponse.json();

      // 2. Generate Token
      const tResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${queueEntry.id}/token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });

      if (!tResponse.ok) { showMessage('Queue entry created, but token generation failed.'); return; }

      const token = await tResponse.json();
      const serviceName = services.find(s => s.id === serviceId)?.name || 'Unknown Service';

      setGeneratedToken({ token, serviceName, priority });
    } catch {
      showMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setGeneratedToken(null);
    setPatientId('');
    setPatientSearch('');
    setPatientMode('existing');
    setDepartmentId('');
    setServiceId('');
    setMessage('');
    setNewPatientData({ firstName: '', lastName: '', phone: '', email: '' });
    setPriority('NORMAL');
  }

  function printTicket() {
    if (generatedToken) {
      window.open(`/dashboard/tokens/${generatedToken.token.id}/print?branch=${branchId}`, '_blank');
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to access reception for this branch." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load reception management." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reception</h1>
          <p className="text-sm text-slate-500 mt-1">Fast-track workflow for patient walk-ins and token generation.</p>
        </div>
        {branches.length > 1 && (
          <div className="w-full sm:w-64">
            <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); handleReset(); }}>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
            </Select>
          </div>
        )}
      </div>

      {generatedToken ? (
        <Card className="border-teal-200 bg-teal-50 shadow-sm overflow-hidden text-center">
          <div className="bg-teal-600 text-white py-2 text-xs font-bold uppercase tracking-widest">
            Token Generated
          </div>
          <CardContent className="pt-8 pb-10 flex flex-col items-center">
            <div className="text-[5rem] font-black text-teal-700 leading-none tracking-tight mb-2">
              {generatedToken.token.displayNumber}
            </div>
            <p className="text-lg font-bold text-slate-800 mb-1">{generatedToken.serviceName}</p>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-8">Priority: {generatedToken.priority.replace('_', ' ')}</p>
            
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Button size="lg" onClick={printTicket} className="w-full sm:w-48 shadow-lg shadow-teal-600/20">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print Ticket
              </Button>
              <Button size="lg" variant="secondary" onClick={handleReset} className="w-full sm:w-48">
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          {message && (
            <div className={`p-4 border-b text-sm font-medium ${messageType === 'error' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
              {message}
            </div>
          )}
          
          <CardContent className="space-y-8 p-6 sm:p-8">
            {state === 'loading' ? (
              <div className="space-y-8">
                <div className="space-y-4">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <div className="space-y-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ) : (
              <>
                {/* Step 1: Customer */}
                <div className="space-y-5">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
                    <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">1</div>
                    <h2 className="text-lg font-bold text-slate-800">Find or add customer</h2>
                  </div>
                  
                  <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-auto self-start">
                    <button
                      type="button"
                      className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${patientMode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setPatientMode('existing')}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${patientMode === 'walkin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      onClick={() => setPatientMode('walkin')}
                    >
                      New Walk-in
                    </button>
                  </div>

                  {patientMode === 'existing' ? (
                    <div className="space-y-4">
                      <Input
                        placeholder="Search by name, number, or phone..."
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                      />
                      <Select label="Select Customer" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                        <option value="">-- Choose from list --</option>
                        {filteredPatients.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.patientNumber} · {p.firstName} {p.lastName} {p.phone ? `(${p.phone})` : ''}
                          </option>
                        ))}
                      </Select>
                      {filteredPatients.length === 0 && patientSearch && (
                        <p className="text-sm text-slate-500">No patients match your search.</p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input label="First Name" value={newPatientData.firstName} onChange={e => setNewPatientData({ ...newPatientData, firstName: e.target.value })} />
                      <Input label="Last Name" value={newPatientData.lastName} onChange={e => setNewPatientData({ ...newPatientData, lastName: e.target.value })} />
                      <Input label="Phone (optional)" type="tel" value={newPatientData.phone} onChange={e => setNewPatientData({ ...newPatientData, phone: e.target.value })} />
                      <Input label="Email (optional)" type="email" value={newPatientData.email} onChange={e => setNewPatientData({ ...newPatientData, email: e.target.value })} />
                    </div>
                  )}
                </div>

                {/* Step 2: Service */}
                <div className="space-y-5">
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-2">
                    <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold">2</div>
                    <h2 className="text-lg font-bold text-slate-800">Select service</h2>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select label="Department" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setServiceId(''); }}>
                      <option value="">-- Select Department --</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Select>
                    
                    <Select label="Service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!departmentId}>
                      <option value="">-- Select Service --</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </div>

                  {priorities.length > 1 && (
                    <div className="mt-4 w-full sm:w-1/2">
                      <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                        {priorities.map(p => <option key={p.level} value={p.level}>{p.level.replace('_', ' ')}</option>)}
                      </Select>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto shadow-md"
                    onClick={() => void handleCreateToken()}
                    disabled={isSubmitting || (patientMode === 'existing' && !patientId) || !departmentId || !serviceId}
                    isLoading={isSubmitting}
                  >
                    Generate Token
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
