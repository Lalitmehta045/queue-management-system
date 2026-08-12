'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Branch, Patient, Department, Service, PriorityConfig } from '../../../types/queue';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { CardSkeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { EmptyState } from '../../../components/ui/EmptyState';

type PageState = 'loading' | 'ready' | 'error' | 'forbidden';
type GeneratedToken = { id: string; displayNumber: string };
type Step = 'customer' | 'service' | 'confirm' | 'success';

type ServiceWithDept = Service & { departmentId: string };
type PriorityWithDept = PriorityConfig & { departmentId: string };

const systemFont = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", sans-serif'
};

export default function ReceptionPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');

  // Data
  const [patients, setPatients] = useState<Patient[]>([]);
  // Removed departments since it's only used to fetch services/priorities
  const [allServices, setAllServices] = useState<ServiceWithDept[]>([]);
  const [allPriorities, setAllPriorities] = useState<PriorityWithDept[]>([]);

  // Wizard State
  const [step, setStep] = useState<Step>('customer');
  const [patientMode, setPatientMode] = useState<'existing' | 'walkin'>('existing');
  const [patientSearch, setPatientSearch] = useState('');
  
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [newPatientData, setNewPatientData] = useState({ firstName: '', lastName: '', phone: '' });
  
  const [selectedService, setSelectedService] = useState<ServiceWithDept | null>(null);
  const [priority, setPriority] = useState('NORMAL');

  // UI State
  const [state, setState] = useState<PageState>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [generatedToken, setGeneratedToken] = useState<{ token: GeneratedToken; serviceName: string; priority: string; customerName: string } | null>(null);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

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

  const availablePrioritiesForSelectedService = useMemo(() => {
    if (!selectedService) return [];
    return allPriorities.filter(p => p.departmentId === selectedService.departmentId);
  }, [selectedService, allPriorities]);

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
  }, [router]);

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
        const depts = deptList.data || [];

        const svcPromises = depts.map((d: Department) => 
          fetchWithAuth(`/api/departments/${d.id}/services?page=1&limit=100`, { headers })
            .then(r => r.ok ? r.json() : { data: [] })
            .then(res => (res.data || []).map((s: Service) => ({ ...s, departmentId: d.id })))
            .catch(() => [])
        );

        const prPromises = depts.map((d: Department) => 
          fetchWithAuth(`/api/priority-configurations?departmentId=${d.id}`, { headers })
            .then(r => r.ok ? r.json() : { data: [] })
            .then(res => (res.data || []).map((p: PriorityConfig) => ({ ...p, departmentId: d.id })))
            .catch(() => [])
        );

        const svcsArray = await Promise.all(svcPromises);
        const prsArray = await Promise.all(prPromises);

        const activeServices = svcsArray.flat().filter(s => s.status === 'ACTIVE');
        const activePriorities = prsArray.flat().filter(p => p.active);

        if (isMounted.current) {
          setPatients(patientList.data || []);
          // Note: departments were fetched and mapped, but don't need to be saved to state.
          setAllServices(activeServices);
          setAllPriorities(activePriorities);
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadBranchData();
  }, [branchId, organizationId]);

  useEffect(() => {
    if (selectedService) {
      const pr = allPriorities.filter(p => p.departmentId === selectedService.departmentId);
      const hasNormal = pr.some(p => p.level === 'NORMAL');
      setPriority(hasNormal ? 'NORMAL' : (pr[0]?.level || 'NORMAL'));
    }
  }, [selectedService, allPriorities]);

  function showMessage(text: string, type: 'error' | 'success' = 'error') {
    setMessage(text);
    setMessageType(type);
  }

  function handleExistingCustomerSelect(id: string) {
    setSelectedPatientId(id);
    setStep('service');
  }

  function handleNewCustomerContinue() {
    if (!newPatientData.firstName || !newPatientData.lastName) {
      showMessage('First name and last name are required for new customers.');
      return;
    }
    setMessage('');
    setStep('service');
  }
  
  function handleServiceSelect(service: ServiceWithDept) {
    setSelectedService(service);
    setStep('confirm');
  }

  async function handleGenerateToken() {
    showMessage('');
    setIsSubmitting(true);

    let targetPatientId = selectedPatientId;
    let customerName = '';

    if (patientMode === 'walkin') {
      try {
        const response = await fetchWithAuth(`/api/branches/${branchId}/patients`, {
          method: 'POST',
          headers: { 'x-organization-id': organizationId },
          body: JSON.stringify(newPatientData)
        });
        if (!response.ok) {
          showMessage('Failed to register new customer. Please check the details.');
          setIsSubmitting(false);
          return;
        }
        const newPatient = await response.json();
        setPatients(prev => [newPatient, ...prev]);
        targetPatientId = newPatient.id;
        customerName = `${newPatient.firstName} ${newPatient.lastName}`;
      } catch {
        showMessage('Network error during customer registration.');
        setIsSubmitting(false);
        return;
      }
    } else {
      const p = patients.find(p => p.id === selectedPatientId);
      if (p) customerName = `${p.firstName} ${p.lastName}`;
    }

    if (!targetPatientId || !selectedService) {
      showMessage('Please ensure a customer and service are selected.');
      setIsSubmitting(false);
      return;
    }

    try {
      const headers = { 'x-organization-id': organizationId };

      const qResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ patientId: targetPatientId, serviceId: selectedService.id, priority })
      });

      if (qResponse.status === 403) { showMessage('Forbidden: You do not have permission.'); return; }
      if (qResponse.status === 409) { showMessage('Customer already has an active queue entry for this service.'); return; }
      if (!qResponse.ok) { showMessage('Failed to create queue entry.'); return; }

      const queueEntry = await qResponse.json();

      const tResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${queueEntry.id}/token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });

      if (!tResponse.ok) { showMessage('Queue entry created, but token generation failed.'); return; }

      const token = await tResponse.json();

      setGeneratedToken({ token, serviceName: selectedService.name, priority, customerName });
      setStep('success');
    } catch {
      showMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setGeneratedToken(null);
    setSelectedPatientId('');
    setPatientSearch('');
    setPatientMode('existing');
    setSelectedService(null);
    setMessage('');
    setNewPatientData({ firstName: '', lastName: '', phone: '' });
    setPriority('NORMAL');
    setStep('customer');
  }

  function printTicket() {
    if (generatedToken) {
      window.open(`/dashboard/tokens/${generatedToken.token.id}/print?branch=${branchId}`, '_blank');
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-2xl mx-auto mt-8" style={systemFont}>
        <ErrorState title="Access Denied" message="You do not have permission to access reception for this branch." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-2xl mx-auto mt-8" style={systemFont}>
        <ErrorState title="Failed to load" message="Unable to load reception management." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const getCustomerName = () => {
    if (patientMode === 'walkin') return `${newPatientData.firstName} ${newPatientData.lastName}`;
    const p = patients.find(p => p.id === selectedPatientId);
    return p ? `${p.firstName} ${p.lastName}` : 'Unknown';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12" style={systemFont}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Reception</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">Fast-track workflow for customer walk-ins and token generation.</p>
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

      {message && (
        <div className={`p-4 rounded-xl text-sm font-semibold shadow-sm ${messageType === 'error' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
          {message}
        </div>
      )}

      {state === 'loading' && (
        <div className="space-y-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {state === 'ready' && step === 'customer' && (
        <Card className="shadow-sm border-slate-200 rounded-2xl overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-slate-50/50 p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Who is here?</h2>
              <p className="text-sm text-slate-500 mt-1">Search for an existing customer or add a new one.</p>
            </div>
            
            <div className="p-6">
              <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-max mb-6">
                <button
                  type="button"
                  className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all ${patientMode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setPatientMode('existing')}
                >
                  Existing Customer
                </button>
                <button
                  type="button"
                  className={`flex-1 sm:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all ${patientMode === 'walkin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setPatientMode('walkin')}
                >
                  New Customer
                </button>
              </div>

              {patientMode === 'existing' ? (
                <div className="space-y-4">
                  <Input
                    placeholder="Search by name or phone..."
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    className="max-w-md bg-slate-50 border-slate-200"
                  />
                  <div className="mt-4 border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                    {filteredPatients.length === 0 ? (
                      <EmptyState title="No customers found" description={patientSearch ? "Try a different search." : "Create a new customer to get started."} className="border-0 shadow-none" />
                    ) : (
                      <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
                        {filteredPatients.slice(0, 10).map(p => (
                          <button 
                            key={p.id}
                            onClick={() => handleExistingCustomerSelect(p.id)}
                            className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 transition-colors text-left focus:outline-none focus:bg-slate-50"
                          >
                            <div>
                              <div className="font-bold text-slate-800">{p.firstName} {p.lastName}</div>
                              <div className="text-xs text-slate-500 mt-1 font-medium">{p.phone ? p.phone : 'No phone'} &bull; {p.patientNumber}</div>
                            </div>
                            <div className="text-teal-600">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </button>
                        ))}
                        {filteredPatients.length > 10 && (
                          <div className="p-3 text-center text-xs font-semibold text-slate-500 bg-slate-50">
                            Showing top 10 results. Keep typing to refine.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-w-md space-y-5">
                  <Input label="First Name" value={newPatientData.firstName} onChange={e => setNewPatientData({ ...newPatientData, firstName: e.target.value })} />
                  <Input label="Last Name" value={newPatientData.lastName} onChange={e => setNewPatientData({ ...newPatientData, lastName: e.target.value })} />
                  <Input label="Phone (optional)" type="tel" value={newPatientData.phone} onChange={e => setNewPatientData({ ...newPatientData, phone: e.target.value })} />
                  <div className="pt-2">
                    <Button size="lg" className="w-full sm:w-auto shadow-md" onClick={handleNewCustomerContinue}>
                      Continue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && step === 'service' && (
        <div className="space-y-6">
          <button onClick={() => setStep('customer')} className="text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Customer
          </button>
          
          <div className="text-center py-6">
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">What do you need today?</h2>
            <p className="text-slate-500 mt-2 font-medium text-lg">For: {getCustomerName()}</p>
          </div>

          {allServices.length === 0 ? (
            <EmptyState title="No services available" description="Ask your administrator to configure services." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {allServices.map(service => (
                <button 
                  key={service.id} 
                  onClick={() => handleServiceSelect(service)}
                  className="p-8 bg-white border border-slate-200 rounded-2xl hover:border-teal-500 hover:shadow-lg transition-all text-center flex flex-col items-center justify-center gap-3 focus:ring-4 focus:ring-teal-500/20 focus:outline-none group"
                >
                  <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-teal-50 group-hover:text-teal-600 transition-colors">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">{service.name}</h3>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {state === 'ready' && step === 'confirm' && selectedService && (
        <div className="space-y-6">
          <button onClick={() => setStep('service')} className="text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Services
          </button>
          
          <Card className="max-w-md mx-auto shadow-lg border-slate-200 rounded-2xl overflow-hidden">
            <div className="bg-slate-50 p-6 text-center border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">Confirm Details</h2>
            </div>
            <CardContent className="p-8 space-y-6">
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Customer</p>
                <p className="text-lg font-bold text-slate-900">{getCustomerName()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Service</p>
                <p className="text-lg font-bold text-slate-900">{selectedService.name}</p>
              </div>
              
              {availablePrioritiesForSelectedService.length > 1 && (
                <div className="pt-2">
                  <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {availablePrioritiesForSelectedService.map(p => <option key={p.level} value={p.level}>{p.level.replace('_', ' ')}</option>)}
                  </Select>
                </div>
              )}

              <div className="pt-6">
                <Button
                  size="lg"
                  className="w-full shadow-lg shadow-teal-600/20 text-lg font-bold h-14"
                  onClick={() => void handleGenerateToken()}
                  disabled={isSubmitting}
                  isLoading={isSubmitting}
                >
                  {isSubmitting ? 'Generating token...' : 'Generate Token'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {state === 'ready' && step === 'success' && generatedToken && (
        <Card className="max-w-md mx-auto border-teal-100 bg-white shadow-xl rounded-2xl overflow-hidden text-center">
          <div className="bg-teal-600 text-white py-3 text-xs font-black uppercase tracking-[0.2em]">
            Token Generated
          </div>
          <CardContent className="pt-10 pb-10 flex flex-col items-center">
            <div className="text-[6rem] font-black text-slate-900 leading-none tracking-tighter mb-6">
              {generatedToken.token.displayNumber}
            </div>
            <p className="text-xl font-bold text-slate-800">{generatedToken.customerName}</p>
            <p className="text-md font-semibold text-slate-500 mt-1">{generatedToken.serviceName}</p>
            
            <div className="w-12 h-1 bg-slate-200 rounded-full my-6"></div>
            
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-10">Please wait for your turn</p>
            
            <div className="flex flex-col gap-3 w-full px-6">
              <Button size="lg" onClick={printTicket} className="w-full shadow-lg shadow-teal-600/20 h-14 text-lg font-bold">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print Token
              </Button>
              <Button size="lg" variant="secondary" onClick={handleReset} className="w-full h-14 text-lg font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 border-0">
                Create Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
