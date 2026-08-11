'use client';
/* eslint-disable */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Patient = { id: string; patientNumber: string; firstName: string; lastName: string; status: 'ACTIVE' | 'INACTIVE' };
type Department = { id: string; name: string };
type Service = { id: string; name: string; status: 'ACTIVE' | 'INACTIVE'; department: { id: string; name: string } };

type Appointment = { id: string; patientId: string; serviceId: string; appointmentDate: string; startAt: string; endAt: string; status: string; patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } } };

type AppointmentList = { data: Appointment[]; meta: { page: number; limit: number; total: number; totalPages: number } };

export default function AppointmentsPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchId, setBranchId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
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
  const [state, setState] = useState<'loading'|'ready'|'error'|'forbidden'>('loading');

  useEffect(() => {
    async function loadContext() {
      const meRes = await fetchWithAuth('/api/auth/me');
      if (meRes.status === 401) { router.push('/login'); return; }
      if (!meRes.ok) { setState('error'); return; }
      const me = await meRes.json();
      const membership = me.memberships?.[0];
      if (!membership) { setState('error'); return; }
      setOrganizationId(membership.organization.id);
      if (membership.branchId) {
        setBranches([{ id: membership.branchId, name: 'Assigned branch' }]);
        setBranchId(membership.branchId);
        return;
      }
      const br = await fetchWithAuth(`/api/organizations/current/branches?page=1&limit=100`, { headers: { 'x-organization-id': membership.organization.id } });
      if (br.status === 403) { setState('forbidden'); return; }
      if (!br.ok) { setState('error'); return; }
      const data = await br.json();
      setBranches(data.data);
      setBranchId(data.data[0]?.id ?? '');
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!branchId || !organizationId) return;
    async function loadBranchData() {
      setState('loading');
      const headers = { 'x-organization-id': organizationId };
      const [patientRes, departmentRes] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/patients?page=1&limit=200`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers }),
      ]);
      if (patientRes.status === 403 || departmentRes.status === 403) { setState('forbidden'); return; }
      if (!patientRes.ok || !departmentRes.ok) { setState('error'); return; }
      const patientList = await patientRes.json();
      const departmentList = await departmentRes.json();
      const serviceLists = await Promise.all(departmentList.data.map(async (d:any) => {
        const r = await fetchWithAuth(`/api/departments/${d.id}/services?page=1&limit=100`, { headers });
        if (!r.ok) throw new Error('services');
        const j = await r.json();
        return j.data.map((s:any) => ({ ...s, department: { id: d.id, name: d.name } }));
      }));
      setPatients(patientList.data.filter((p:any) => p.status === 'ACTIVE'));
      setDepartments(departmentList.data);
      setServices(serviceLists.flat());
      setPatientId((c) => c || (patientList.data.find((p:any)=>p.status==='ACTIVE')?.id || ''));
      setServiceId((c) => c || (serviceLists.flat().find((s:any)=>s.status==='ACTIVE')?.id || ''));
      setState('ready');
    }
    void loadBranchData().catch(() => setState('error'));
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!branchId || !organizationId) return;
    async function loadAppointments() {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await fetchWithAuth(`/api/branches/${branchId}/appointments?${params.toString()}`, { headers: { 'x-organization-id': organizationId } });
      if (res.status === 403) { setState('forbidden'); return; }
      if (!res.ok) { setState('error'); return; }
      setAppointments(await res.json());
    }
    void loadAppointments().catch(() => setState('error'));
  }, [branchId, organizationId, page, statusFilter, search]);

  async function loadAvailability() {
    if (!serviceId || !date) { setMessage('Select service and date'); return; }
    setMessage('Loading availability...');
    const res = await fetchWithAuth(`/api/branches/${branchId}/appointments/availability?serviceId=${serviceId}&date=${date}`, { headers: { 'x-organization-id': organizationId } });
    if (res.status === 403) { setState('forbidden'); return; }
    if (res.status === 404) { setMessage('No working hours configured for this day'); setSlots([]); return; }
    if (!res.ok) { setMessage('Unable to load availability'); return; }
    const json = await res.json();
    setSlots(json.slots);
    setMessage('');
  }

  async function createAppointment() {
    if (!patientId || !serviceId || !date || !selectedSlot) { setMessage('Complete all fields and select a slot'); return; }
    const [start, end] = selectedSlot.split('-');
    const body = { patientId, serviceId, appointmentDate: date, startTime: start, notes: '' };
    const res = await fetchWithAuth(`/api/branches/${branchId}/appointments`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify(body) });
    if (res.status === 409) { setMessage('Selected slot was just booked. Refreshing availability.'); await loadAvailability(); return; }
    if (res.status === 403) { setState('forbidden'); return; }
    if (!res.ok) { setMessage('Unable to create appointment'); return; }
    setMessage('Appointment created');
    setSelectedSlot('');
    await loadAvailability();
    setPage(1);
  }

  async function gotoDetails(id: string) { router.push(`/dashboard/appointments/${id}`); }

  if (state === 'loading') return <main className="page-shell"><p>Loading...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to access this branch.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load appointments.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/patients">Patients</a></nav>
      <section className="content-panel">
        <div className="section-heading"><div><p className="eyebrow">Appointments</p><h1>Appointments</h1><p className="muted">Schedule and manage appointments.</p></div></div>
        {branches.length > 1 && <label>Branch<select value={branchId} onChange={(e)=>setBranchId(e.target.value)}><option value="">Select branch</option>{branches.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <div className="grid-3">
          <label>Patient<select value={patientId} onChange={(e)=>setPatientId(e.target.value)}><option value="">Select patient</option>{patients.map(p => <option key={p.id} value={p.id}>{p.patientNumber} · {p.firstName} {p.lastName}</option>)}</select></label>
          <label>Service<select value={serviceId} onChange={(e)=>setServiceId(e.target.value)}><option value="">Select service</option>{services.filter(s=>s.status==='ACTIVE').map(s=> <option key={s.id} value={s.id}>{s.department.name} · {s.name}</option>)}</select></label>
          <label>Date<input type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></label>
        </div>
        <div className="slot-actions"><button onClick={() => void loadAvailability()} disabled={!serviceId || !date}>Load availability</button></div>
        {message && <p className="muted">{message}</p>}
        {slots.length === 0 ? <p className="muted">No slots available.</p> : <div className="slots-grid">{slots.map((s)=> <label key={`${s.startTime}-${s.endTime}`} className={`slot ${s.available ? '' : 'disabled'}`}><input type="radio" name="slot" disabled={!s.available} checked={selectedSlot === `${s.startTime}-${s.endTime}`} onChange={()=>setSelectedSlot(`${s.startTime}-${s.endTime}`)} /> <span>{s.startTime} - {s.endTime} {s.available ? '' : '(unavailable)'}</span></label>)}</div>}
        <div className="action-row"><button onClick={() => void createAppointment()} disabled={!selectedSlot}>Create appointment</button></div>

        <div className="filter-row"><label>Search<input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="patient number or name" /></label><label>Status<select value={statusFilter} onChange={(e)=>{ setStatusFilter(e.target.value); setPage(1); }}><option value="">Any</option><option value="SCHEDULED">Scheduled</option><option value="CONFIRMED">Confirmed</option><option value="CHECKED_IN">Checked in</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label></div>

        {!appointments?.data?.length ? <p className="muted empty-state">No appointments found.</p> : <div className="patient-list">{appointments.data.map((a) => <div key={a.id} className="list-row"><span><strong>{a.patient.firstName} {a.patient.lastName}</strong><small>{a.patient.patientNumber} · {a.service.name} · {a.service.department.name} · {a.appointmentDate} {new Date(a.startAt).toISOString().slice(11,16)}</small></span><span className="row-actions"><button onClick={()=>gotoDetails(a.id)}>Details</button><span className={`status status-${a.status.toLowerCase()}`}>{a.status}</span></span></div>)}</div>}
        {appointments && appointments.meta.totalPages > 1 && <div className="pagination"><button disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} of {appointments.meta.totalPages}</span><button disabled={page>=appointments.meta.totalPages} onClick={()=>setPage(page+1)}>Next</button></div>}
      </section>
    </main>
  );
}
