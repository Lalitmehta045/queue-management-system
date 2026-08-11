'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Patient = { id: string; patientNumber: string; firstName: string; lastName: string; phone: string | null; email: string | null; status: 'ACTIVE' | 'INACTIVE' };
type Department = { id: string; name: string };
type Service = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; departmentId: string };
type PriorityConfig = { level: string; weight: number; active: boolean };
type Token = { id: string; displayNumber: string };

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
  const [patientId, setPatientId] = useState('');
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  
  const [departmentId, setDepartmentId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  
  // UI State
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [generatedToken, setGeneratedToken] = useState<{ token: Token, serviceName: string, priority: string } | null>(null);

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
    async function loadBranchData() {
      setState('loading');
      const headers = { 'x-organization-id': organizationId };
      const [patientRes, deptRes] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=100`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers })
      ]);
      if (patientRes.status === 403 || deptRes.status === 403) { setState('forbidden'); return; }
      if (!patientRes.ok || !deptRes.ok) { setState('error'); return; }
      
      const patientList = await patientRes.json() as { data: Patient[] };
      const deptList = await deptRes.json() as { data: Department[] };
      
      setPatients(patientList.data.filter(p => p.status === 'ACTIVE'));
      setDepartments(deptList.data);
      setState('ready');
    }
    void loadBranchData().catch(() => setState('error'));
  }, [branchId, organizationId]);

  // Load services and priorities when department changes
  useEffect(() => {
    if (!departmentId || !organizationId || !branchId) {
      setServices([]);
      setPriorities([]);
      return;
    }
    async function loadDeptData() {
      const headers = { 'x-organization-id': organizationId };
      const [svcRes, priRes] = await Promise.all([
        fetchWithAuth(`/api/departments/${departmentId}/services?page=1&limit=100`, { headers }),
        fetchWithAuth(`/api/priority-configurations?departmentId=${departmentId}`, { headers })
      ]);
      if (svcRes.ok) {
        const list = await svcRes.json() as { data: Service[] };
        setServices(list.data.filter(s => s.status === 'ACTIVE'));
      }
      if (priRes.ok) {
        const list = await priRes.json() as { data: PriorityConfig[] };
        setPriorities(list.data.filter(p => p.active));
        // Reset priority to default NORMAL or first available
        const hasNormal = list.data.some(p => p.level === 'NORMAL' && p.active);
        setPriority(hasNormal ? 'NORMAL' : (list.data[0]?.level || 'NORMAL'));
      }
    }
    void loadDeptData();
  }, [departmentId, organizationId, branchId]);

  async function handleRegisterWalkIn() {
    setMessage('');
    if (!newPatientData.firstName || !newPatientData.lastName) {
      setMessage('First name and last name are required for new patients.');
      return null;
    }
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/patients`, {
        method: 'POST',
        headers: { 'x-organization-id': organizationId },
        body: JSON.stringify(newPatientData)
      });
      if (!response.ok) {
        setMessage('Failed to register new patient. Please check the details.');
        return null;
      }
      const newPatient = await response.json() as Patient;
      setPatients(prev => [newPatient, ...prev]);
      setPatientId(newPatient.id);
      setIsNewPatient(false);
      setNewPatientData({ firstName: '', lastName: '', phone: '', email: '' });
      return newPatient.id;
    } catch {
      setMessage('Network error during patient registration.');
      return null;
    }
  }

  async function handleCreateToken() {
    setMessage('');
    setIsSubmitting(true);
    
    let targetPatientId = patientId;
    
    if (isNewPatient) {
      const createdId = await handleRegisterWalkIn();
      if (!createdId) {
        setIsSubmitting(false);
        return;
      }
      targetPatientId = createdId;
    }
    
    if (!targetPatientId || !serviceId) {
      setMessage('Please select a patient and a service.');
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
      
      if (qResponse.status === 403) {
        setMessage('Forbidden: You do not have permission.');
        setIsSubmitting(false);
        return;
      }
      if (qResponse.status === 409) {
        setMessage('Patient already has an active queue entry for this service.');
        setIsSubmitting(false);
        return;
      }
      if (!qResponse.ok) {
        setMessage('Failed to create queue entry.');
        setIsSubmitting(false);
        return;
      }
      
      const queueEntry = await qResponse.json() as { id: string };
      
      // 2. Generate Token
      const tResponse = await fetchWithAuth(`/api/branches/${branchId}/queue-entries/${queueEntry.id}/token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      
      if (!tResponse.ok) {
        setMessage('Queue entry created, but token generation failed.');
        setIsSubmitting(false);
        return;
      }
      
      const token = await tResponse.json() as Token;
      const serviceName = services.find(s => s.id === serviceId)?.name || 'Unknown Service';
      
      setGeneratedToken({ token, serviceName, priority });
    } catch {
      setMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setGeneratedToken(null);
    setPatientId('');
    setDepartmentId('');
    setServiceId('');
    setMessage('');
    setIsNewPatient(false);
    setPriority('NORMAL');
  }

  function printTicket() {
    if (generatedToken) {
      window.open(`/dashboard/tokens/${generatedToken.token.id}/print?branch=${branchId}`, '_blank');
    }
  }

  if (state === 'loading') return <main className="page-shell"><p>Loading reception panel...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to access reception for this branch.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load reception management.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/dashboard/queue-entries">Queue</a>
        <a href="/dashboard/tokens">Tokens</a>
      </nav>
      
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Front Desk</p>
            <h1>Reception</h1>
            <p className="muted">Fast-track workflow for patient walk-ins and token generation.</p>
          </div>
        </div>
        
        {branches.length > 1 && (
          <label>Branch
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); handleReset(); }}>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
            </select>
          </label>
        )}

        {generatedToken ? (
          <div className="success-banner" style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#1f2937', borderRadius: '8px', margin: '2rem 0' }}>
            <h2 className="success-text" style={{ fontSize: '2rem', marginBottom: '1rem' }}>TOKEN GENERATED</h2>
            <p style={{ fontSize: '3rem', fontWeight: 'bold', margin: '1rem 0', color: '#60a5fa' }}>{generatedToken.token.displayNumber}</p>
            <p style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Service: {generatedToken.serviceName}</p>
            <p style={{ fontSize: '1.25rem', marginBottom: '2rem', color: '#9ca3af' }}>Priority: {generatedToken.priority}</p>
            
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button type="button" onClick={printTicket} style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }}>PRINT TICKET</button>
              <button type="button" onClick={() => window.open(`/queue/${generatedToken.token.id}`, '_blank')} className="secondary-button" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }}>OPEN QUEUE STATUS</button>
              <button type="button" onClick={handleReset} className="secondary-button" style={{ padding: '0.75rem 2rem', fontSize: '1.1rem' }}>DONE</button>
            </div>
          </div>
        ) : (
          <div className="form-grid" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
            
            <fieldset style={{ padding: '1rem', border: '1px solid #374151', borderRadius: '8px' }}>
              <legend style={{ padding: '0 0.5rem', fontWeight: 'bold', color: '#9ca3af' }}>1. Patient Selection</legend>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="radio" checked={!isNewPatient} onChange={() => setIsNewPatient(false)} /> Existing Patient
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="radio" checked={isNewPatient} onChange={() => setIsNewPatient(true)} /> Walk-in (New)
                </label>
              </div>

              {!isNewPatient ? (
                <label>Find Patient
                  <select value={patientId} onChange={(e) => setPatientId(e.target.value)} style={{ padding: '0.75rem', fontSize: '1.1rem' }}>
                    <option value="">-- Select Patient --</option>
                    {patients.map(p => <option key={p.id} value={p.id}>{p.patientNumber} · {p.firstName} {p.lastName} {p.phone ? `(${p.phone})` : ''}</option>)}
                  </select>
                </label>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <label>First Name <input type="text" value={newPatientData.firstName} onChange={e => setNewPatientData({...newPatientData, firstName: e.target.value})} /></label>
                  <label>Last Name <input type="text" value={newPatientData.lastName} onChange={e => setNewPatientData({...newPatientData, lastName: e.target.value})} /></label>
                  <label>Phone <input type="tel" value={newPatientData.phone} onChange={e => setNewPatientData({...newPatientData, phone: e.target.value})} /></label>
                  <label>Email <input type="email" value={newPatientData.email} onChange={e => setNewPatientData({...newPatientData, email: e.target.value})} /></label>
                </div>
              )}
            </fieldset>

            <fieldset style={{ padding: '1rem', border: '1px solid #374151', borderRadius: '8px' }}>
              <legend style={{ padding: '0 0.5rem', fontWeight: 'bold', color: '#9ca3af' }}>2. Service & Priority</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label>Department
                  <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setServiceId(''); }} style={{ padding: '0.75rem', fontSize: '1.1rem' }}>
                    <option value="">-- Select Department --</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>

                <label>Service
                  <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!departmentId} style={{ padding: '0.75rem', fontSize: '1.1rem' }}>
                    <option value="">-- Select Service --</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>

                <label style={{ gridColumn: '1 / -1' }}>Priority (Queue Weight)
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!departmentId || priorities.length === 0} style={{ padding: '0.75rem', fontSize: '1.1rem' }}>
                    {priorities.length === 0 && <option value="NORMAL">NORMAL (Default)</option>}
                    {priorities.map(p => <option key={p.level} value={p.level}>{p.level.replace('_', ' ')} (Weight: {p.weight})</option>)}
                  </select>
                </label>
              </div>
            </fieldset>

            {message && <p className={message.includes('success') ? 'success-text' : 'error-text'} role="status" style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{message}</p>}
            
            <button 
              type="button" 
              onClick={() => void handleCreateToken()} 
              disabled={isSubmitting || (!isNewPatient && !patientId) || !departmentId || !serviceId}
              style={{ padding: '1rem', fontSize: '1.25rem', fontWeight: 'bold', marginTop: '1rem' }}
            >
              {isSubmitting ? 'PROCESSING...' : 'GENERATE TOKEN'}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
