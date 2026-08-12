'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { TableSkeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

type Patient = { id: string; patientNumber: string; firstName: string; lastName: string; status: 'ACTIVE' | 'INACTIVE' };
type Service = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; department: { id: string; name: string } };

type Appointment = { 
  id: string; 
  patientId: string; 
  serviceId: string; 
  appointmentDate: string; 
  startAt: string; 
  endAt: string; 
  status: string; 
  patient: { patientNumber: string; firstName: string; lastName: string }; 
  service: { name: string; department: { name: string } } 
};

type AppointmentList = { data: Appointment[]; meta: { page: number; limit: number; total: number; totalPages: number } };

export default function AppointmentsPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<AppointmentList | null>(null);
  
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<{ startTime: string; endTime: string; available: boolean }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'success'>('success');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  
  const [state, setState] = useState<'loading'|'ready'|'error'|'forbidden'>('loading');

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function loadContext() {
      try {
        const meRes = await fetchWithAuth('/api/auth/me');
        if (meRes.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (!meRes.ok) { if (isMounted.current) setState('error'); return; }
        
        const me = await meRes.json();
        const membership = me.memberships?.[0];
        if (!membership) { if (isMounted.current) setState('error'); return; }
        
        if (isMounted.current) setOrganizationId(membership.organization.id);
        
        if (membership.branchId) {
          if (isMounted.current) {
            setBranches([{ id: membership.branchId, name: 'Assigned branch' }]);
            setBranchId(membership.branchId);
          }
          return;
        }
        
        const br = await fetchWithAuth(`/api/organizations/current/branches?page=1&limit=100`, { headers: { 'x-organization-id': membership.organization.id } });
        if (br.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!br.ok) { if (isMounted.current) setState('error'); return; }
        
        const data = await br.json();
        if (isMounted.current) {
          setBranches(data.data || []);
          setBranchId(data.data[0]?.id ?? '');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once

  useEffect(() => {
    if (!branchId || !organizationId) return;
    async function loadBranchData() {
      if (isMounted.current) setState('loading');
      try {
        const headers = { 'x-organization-id': organizationId };
        const [patientRes, departmentRes] = await Promise.all([
          fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=200`, { headers }),
          fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers }),
        ]);
        
        if (patientRes.status === 403 || departmentRes.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!patientRes.ok || !departmentRes.ok) { if (isMounted.current) setState('error'); return; }
        
        const patientList = await patientRes.json();
        const departmentList = await departmentRes.json();
        
        const serviceLists = await Promise.all(departmentList.data.map(async (d: { id: string, name: string }) => {
          const r = await fetchWithAuth(`/api/departments/${d.id}/services?page=1&limit=100`, { headers });
          if (!r.ok) return [];
          const j = await r.json() as { data: { id: string, name: string, status: string, department: { id: string, name: string } }[] };
          return j.data.map((s) => ({ ...s, department: { id: d.id, name: d.name } }));
        }));
        
        if (isMounted.current) {
          const activePatients = (patientList.data || []).filter((p: { status: string }) => p.status === 'ACTIVE');
          const flatServices = serviceLists.flat();
          
          setPatients(activePatients);
          setServices(flatServices as Service[]);
          
          setPatientId((c) => c || (activePatients[0]?.id || ''));
          setServiceId((c) => c || (flatServices.find((s) => s.status === 'ACTIVE')?.id || ''));
          
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadBranchData();
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!branchId || !organizationId) return;
    async function loadAppointments() {
      try {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (statusFilter) params.set('status', statusFilter);
        if (search) params.set('search', search);
        
        const res = await fetchWithAuth(`/api/branches/${branchId}/appointments?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
        if (res.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!res.ok) { if (isMounted.current) setState('error'); return; }
        
        const data = await res.json();
        if (isMounted.current) setAppointments(data);
      } catch {
        // ignore
      }
    }
    void loadAppointments();
  }, [branchId, organizationId, page, statusFilter, search]);

  function showMessage(text: string, type: 'success'|'error' = 'success') {
    setMessage(text);
    setMessageType(type);
  }

  async function loadAvailability() {
    if (!serviceId || !date) { showMessage('Select service and date', 'error'); return; }
    
    setIsLoadingAvailability(true);
    showMessage('');
    
    try {
      const res = await fetchWithAuth(`/api/branches/${branchId}/appointments/availability?serviceId=${serviceId}&date=${date}`, { headers: { 'x-organization-id': organizationId } });
      
      if (res.status === 403) { setState('forbidden'); return; }
      if (res.status === 404) { showMessage('No working hours configured for this day', 'error'); setSlots([]); return; }
      if (!res.ok) { showMessage('Unable to load availability', 'error'); return; }
      
      const json = await res.json();
      setSlots(json.slots || []);
      setSelectedSlot('');
    } catch {
      showMessage('Network error loading availability', 'error');
    } finally {
      setIsLoadingAvailability(false);
    }
  }

  async function createAppointment() {
    if (!patientId || !serviceId || !date || !selectedSlot) { showMessage('Complete all fields and select a slot', 'error'); return; }
    
    setIsSubmitting(true);
    showMessage('');
    
    try {
      const [start] = selectedSlot.split('-');
      const body = { patientId, serviceId, appointmentDate: date, startTime: start, notes: '' };
      
      const res = await fetchWithAuth(`/api/branches/${branchId}/appointments`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify(body) });
      
      if (res.status === 409) { showMessage('Selected slot was just booked. Refreshing availability.', 'error'); await loadAvailability(); return; }
      if (res.status === 403) { setState('forbidden'); return; }
      if (!res.ok) { showMessage('Unable to create appointment', 'error'); return; }
      
      showMessage('Appointment created successfully');
      setSelectedSlot('');
      await loadAvailability();
      
      // Refresh list
      const refreshParams = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) refreshParams.set('status', statusFilter);
      if (search) refreshParams.set('search', search);
      const refresh = await fetchWithAuth(`/api/branches/${branchId}/appointments?${refreshParams.toString()}`, { headers: { 'x-organization-id': organizationId } });
      if (refresh.ok) setAppointments(await refresh.json());
      
    } catch {
      showMessage('Network error creating appointment', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function gotoDetails(id: string) { router.push(`/dashboard/appointments/${id}`); }

  function getStatusBadgeVariant(status: string) {
    switch(status) {
      case 'SCHEDULED': return 'info';
      case 'CONFIRMED': return 'success';
      case 'CHECKED_IN': return 'warning';
      case 'COMPLETED': return 'neutral';
      case 'CANCELLED': 
      case 'NO_SHOW': return 'danger';
      default: return 'neutral';
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to access appointments in this branch." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load appointments." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Appointments</h1>
          <p className="text-sm text-slate-500 mt-1">Schedule and manage future bookings.</p>
        </div>
        {branches.length > 1 && (
          <div className="w-full sm:w-64">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Select branch</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Appointment Form */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="bg-slate-50/50">
              <CardTitle>New Appointment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-6">
              {message && (
                <div className={`p-3 rounded-lg text-sm font-medium border ${messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {message}
                </div>
              )}
              
              <div className="space-y-4">
                <Select label="Patient" value={patientId} onChange={(e)=>setPatientId(e.target.value)}>
                  <option value="">Select patient</option>
                  {patients.map(p => <option key={p.id} value={p.id}>{p.patientNumber} · {p.firstName} {p.lastName}</option>)}
                </Select>
                
                <Select label="Service" value={serviceId} onChange={(e)=>{ setServiceId(e.target.value); setSlots([]); }}>
                  <option value="">Select service</option>
                  {services.filter(s=>s.status==='ACTIVE').map(s=> <option key={s.id} value={s.id}>{s.department.name} · {s.name}</option>)}
                </Select>
                
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input label="Date" type="date" value={date} onChange={(e)=>{ setDate(e.target.value); setSlots([]); }} />
                  </div>
                  <Button variant="outline" onClick={() => void loadAvailability()} disabled={!serviceId || !date || isLoadingAvailability} isLoading={isLoadingAvailability}>
                    Load Slots
                  </Button>
                </div>
              </div>

              {slots.length > 0 && (
                <div className="pt-4 border-t border-slate-100">
                  <label className="block text-sm font-semibold text-slate-700 mb-3">Available Slots</label>
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1">
                    {slots.map((s) => {
                      const isSelected = selectedSlot === `${s.startTime}-${s.endTime}`;
                      return (
                        <label 
                          key={`${s.startTime}-${s.endTime}`} 
                          className={`flex items-center justify-center py-2 px-3 text-sm font-medium border rounded-md cursor-pointer transition-all ${!s.available ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60' : isSelected ? 'bg-teal-50 border-teal-500 text-teal-700 ring-1 ring-teal-500 shadow-sm' : 'bg-white border-slate-200 text-slate-700 hover:border-teal-300 hover:bg-slate-50'}`}
                        >
                          <input 
                            type="radio" 
                            name="slot" 
                            className="sr-only"
                            disabled={!s.available} 
                            checked={isSelected} 
                            onChange={()=>setSelectedSlot(`${s.startTime}-${s.endTime}`)} 
                          /> 
                          <span>{s.startTime}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button 
                className="w-full mt-6" 
                onClick={() => void createAppointment()} 
                disabled={!selectedSlot || isSubmitting}
                isLoading={isSubmitting}
              >
                Book Appointment
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Appointments List */}
        <div className="lg:col-span-2">
          <Card>
            <div className="p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl flex flex-col sm:flex-row gap-4">
              <Input 
                className="flex-1"
                placeholder="Search patient name or number..." 
                value={search} 
                onChange={(e) => { setSearch(e.target.value); setPage(1); }} 
              />
              <Select className="w-full sm:w-48" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">Any Status</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CHECKED_IN">Checked In</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </div>

            <CardContent className="p-0">
              {state === 'loading' && !appointments ? (
                <div className="p-6">
                  <TableSkeleton rows={4} />
                </div>
              ) : !appointments?.data?.length ? (
                <div className="p-12">
                  <EmptyState 
                    title="No appointments" 
                    description="No appointments found matching your criteria."
                  />
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {appointments.data.map((a) => (
                    <div key={a.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer group" onClick={() => gotoDetails(a.id)}>
                      <div className="flex gap-4">
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold shadow-sm border border-indigo-100 shrink-0">
                          {new Date(a.startAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 text-lg flex items-center gap-2 group-hover:text-teal-600 transition-colors">
                            {a.patient.firstName} {a.patient.lastName}
                          </div>
                          <div className="text-sm font-medium text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                            <span className="text-slate-600">{a.patient.patientNumber}</span>
                            <span className="text-slate-300">•</span>
                            <span>{a.service.name}</span>
                            <span className="text-slate-300">•</span>
                            <span>{new Date(a.appointmentDate).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between w-full sm:w-auto mt-2 sm:mt-0">
                        <Badge variant={getStatusBadgeVariant(a.status)}>
                          {a.status}
                        </Badge>
                        <svg className="w-5 h-5 text-slate-400 sm:ml-4 sm:opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>

            {appointments && appointments.meta.totalPages > 1 && (
              <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-xl">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-slate-600 font-medium">Page {page} of {appointments.meta.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= appointments.meta.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
