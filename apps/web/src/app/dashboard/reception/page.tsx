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

type PageState = 'loading' | 'ready' | 'error' | 'forbidden';
type GeneratedToken = { id: string; displayNumber: string };
type Step = 'form' | 'success';

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
  const [allServices, setAllServices] = useState<ServiceWithDept[]>([]);
  const [allPriorities, setAllPriorities] = useState<PriorityWithDept[]>([]);

  // Form State
  const [step, setStep] = useState<Step>('form');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [priority, setPriority] = useState('NORMAL');
  const [quantity, setQuantity] = useState<number>(1);
  
  // Customer optional
  const [patientMode, setPatientMode] = useState<'none' | 'existing' | 'new'>('none');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [newPatientData, setNewPatientData] = useState({ firstName: '', lastName: '', phone: '' });

  // UI State
  const [state, setState] = useState<PageState>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('error');
  const [generatedTokens, setGeneratedTokens] = useState<{ tokens: GeneratedToken[]; serviceName: string; priority: string; customerName: string } | null>(null);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const selectedService = useMemo(() => {
    return allServices.find(s => s.id === selectedServiceId) || null;
  }, [allServices, selectedServiceId]);

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
          setPatients((patientList.data || []).filter((p: Patient) => p.status === 'ACTIVE'));
          setAllServices(activeServices);
          setAllPriorities(activePriorities);
          if (activeServices.length > 0) {
            setSelectedServiceId(activeServices[0].id);
          }
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

  async function handleGenerateToken() {
    showMessage('');
    setIsSubmitting(true);

    let targetPatientId: string | null = null;
    let customerName = 'Walk-in Customer';

    if (patientMode === 'new') {
      if (!newPatientData.firstName || !newPatientData.lastName) {
        showMessage('First name and last name are required for new customers.');
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
    } else if (patientMode === 'existing') {
      if (!selectedPatientId) {
        showMessage('Please select an existing customer.');
        setIsSubmitting(false);
        return;
      }
      targetPatientId = selectedPatientId;
      const p = patients.find(p => p.id === selectedPatientId);
      if (p) customerName = `${p.firstName} ${p.lastName}`;
    }

    if (!selectedService) {
      showMessage('Please select a service.');
      setIsSubmitting(false);
      return;
    }

    try {
      const headers = { 'x-organization-id': organizationId };

      if (quantity > 1) {
        const body: Record<string, unknown> = { serviceId: selectedService.id, priority, quantity };
        if (targetPatientId) {
          body.patientId = targetPatientId;
        }

        const bResponse = await fetchWithAuth(`/api/branches/${branchId}/tokens/bulk`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (bResponse.status === 403) { showMessage('Forbidden: You do not have permission.'); return; }
        if (!bResponse.ok) { 
          const errData = await bResponse.json().catch(() => null);
          showMessage(errData?.message || 'Failed to generate bulk tokens.'); 
          return; 
        }

        const result = await bResponse.json();
        setGeneratedTokens({ tokens: result.tokens, serviceName: selectedService.name, priority, customerName });
        setStep('success');
      } else {
        const body: Record<string, string> = { serviceId: selectedService.id, priority };
        if (targetPatientId) {
          body.patientId = targetPatientId;
        }

        const qResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
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

        setGeneratedTokens({ tokens: [token], serviceName: selectedService.name, priority, customerName });
        setStep('success');
      }
    } catch {
      showMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setGeneratedTokens(null);
    setSelectedPatientId('');
    setPatientMode('none');
    setMessage('');
    setQuantity(1);
    setNewPatientData({ firstName: '', lastName: '', phone: '' });
    // Keep the service and priority as is for faster generation of next token
    setStep('form');
  }

  function printTicket() {
    if (generatedTokens && generatedTokens.tokens.length > 0) {
      if (generatedTokens.tokens.length === 1) {
        window.open(`/dashboard/tokens/${generatedTokens.tokens[0]!.id}/print?branch=${branchId}`, '_blank');
      } else {
        // Simplistic print for multiple tokens: open print pages for each, or just the first one if multiple tabs is blocked by popup blockers
        // For now, we will open the first one. Alternatively a combined print view could be built.
        window.open(`/dashboard/tokens/${generatedTokens.tokens[0]!.id}/print?branch=${branchId}`, '_blank');
        if (generatedTokens.tokens.length > 1) {
          showMessage('Multiple tokens generated. Only printing the first token to avoid popup blocking.', 'success');
        }
      }
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

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12" style={systemFont}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Generate Token</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">Fast-track workflow for walk-in token generation.</p>
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
        </div>
      )}

      {state === 'ready' && step === 'form' && (
        <Card className="shadow-sm border-slate-200 rounded-2xl overflow-visible">
          <CardContent className="p-8 space-y-8">
            
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Service</label>
              <Select 
                value={selectedServiceId} 
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="w-full text-lg h-12 shadow-sm"
              >
                {allServices.length === 0 && <option value="">No services available</option>}
                {allServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>

            {availablePrioritiesForSelectedService.length > 1 && (
              <div className="space-y-3">
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Priority</label>
                <Select 
                  value={priority} 
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full text-lg h-12 shadow-sm"
                >
                  {availablePrioritiesForSelectedService.map(p => <option key={p.level} value={p.level}>{p.level.replace('_', ' ')}</option>)}
                </Select>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Quantity</label>
              <Input 
                type="number" 
                min={1} 
                max={50} 
                step={1}
                value={quantity} 
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setQuantity(isNaN(val) ? 1 : val);
                }}
                className="w-full text-lg h-12 shadow-sm"
              />
            </div>

            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Customer <span className="text-slate-400 font-normal lowercase">(Optional)</span></label>
                
                <div className="flex space-x-2 bg-slate-100 p-1 rounded-md">
                  <button type="button" onClick={() => setPatientMode('none')} className={`px-3 py-1 text-xs font-bold rounded ${patientMode === 'none' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>None</button>
                  <button type="button" onClick={() => setPatientMode('existing')} className={`px-3 py-1 text-xs font-bold rounded ${patientMode === 'existing' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Existing</button>
                  <button type="button" onClick={() => setPatientMode('new')} className={`px-3 py-1 text-xs font-bold rounded ${patientMode === 'new' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>New</button>
                </div>
              </div>

              {patientMode === 'existing' && (
                <div className="space-y-3 mt-4">
                  <Select value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)} className="w-full">
                    <option value="">-- Select Customer --</option>
                    {patients.map(p => (
                      <option key={p.id} value={p.id}>{p.firstName} {p.lastName} {p.phone ? `(${p.phone})` : ''}</option>
                    ))}
                  </Select>
                </div>
              )}

              {patientMode === 'new' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <Input label="First Name" value={newPatientData.firstName} onChange={e => setNewPatientData({ ...newPatientData, firstName: e.target.value })} />
                  <Input label="Last Name" value={newPatientData.lastName} onChange={e => setNewPatientData({ ...newPatientData, lastName: e.target.value })} />
                  <div className="sm:col-span-2">
                    <Input label="Phone (optional)" type="tel" value={newPatientData.phone} onChange={e => setNewPatientData({ ...newPatientData, phone: e.target.value })} />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6">
              <Button
                size="lg"
                className="w-full shadow-lg shadow-teal-600/20 text-lg font-bold h-14"
                onClick={() => void handleGenerateToken()}
                disabled={isSubmitting || !selectedServiceId || quantity < 1 || quantity > 50}
                isLoading={isSubmitting}
              >
                {isSubmitting ? 'Generating...' : `GENERATE ${quantity > 1 ? quantity + ' ' : ''}TOKEN${quantity > 1 ? 'S' : ''}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && step === 'success' && generatedTokens && (
        <Card className="max-w-md mx-auto border-teal-100 bg-white shadow-xl rounded-2xl overflow-hidden text-center">
          <div className="bg-teal-600 text-white py-3 text-xs font-black uppercase tracking-[0.2em]">
            {generatedTokens.tokens.length > 1 ? `${generatedTokens.tokens.length} Tokens Generated` : 'Token Generated'}
          </div>
          <CardContent className="pt-10 pb-10 flex flex-col items-center">
            {generatedTokens.tokens.length === 1 ? (
              <div className="text-[6rem] font-black text-slate-900 leading-none tracking-tighter mb-6">
                {generatedTokens.tokens[0]!.displayNumber}
              </div>
            ) : (
              <div className="mb-6 space-y-2 max-h-64 overflow-y-auto w-full px-4 text-center">
                <p className="text-sm font-semibold text-teal-600 uppercase mb-4">Successfully generated:</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {generatedTokens.tokens.map(t => (
                    <span key={t.id} className="inline-block bg-slate-100 px-4 py-2 rounded-lg text-2xl font-black text-slate-800">
                      {t.displayNumber}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {generatedTokens.customerName !== 'Walk-in Customer' && (
              <p className="text-xl font-bold text-slate-800">{generatedTokens.customerName}</p>
            )}
            <p className="text-md font-semibold text-slate-500 mt-1">{generatedTokens.serviceName}</p>
            
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
                Generate Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
