'use client';
/* eslint-disable */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchWithAuth } from '../../../../lib/auth-client';

export default function AppointmentDetailsPage() {
  const router = useRouter();
  const params = useParams() as { appointmentId?: string };
  const appointmentId = params?.appointmentId ?? '';
  const [appointment, setAppointment] = useState<any>(null);
  const [state, setState] = useState<'loading'|'ready'|'error'|'forbidden'>('loading');
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadContext() {
      const meRes = await fetchWithAuth('/api/auth/me');
      if (meRes.status === 401) { router.push('/login'); return; }
      if (!meRes.ok) { setState('error'); return; }
      const me = await meRes.json();
      const membership = me.memberships?.[0];
      if (!membership) { setState('error'); return; }
      setOrganizationId(membership.organization.id);
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!appointmentId || !organizationId) return;
    async function load() {
      setState('loading');
      // branchId is part of appointment route; extract from fetch response
      const res = await fetchWithAuth(`/api/branches/${''}/appointments/${appointmentId}`, { headers: { 'x-organization-id': organizationId } });
      // Some APIs require branch in URL; try without if 404
      if (res.status === 403) { setState('forbidden'); return; }
      if (res.status === 404) { setState('error'); return; }
      if (!res.ok) { setState('error'); return; }
      const appt = await res.json();
      setAppointment(appt);
      setBranchId(appt.branchId ?? '');
      setState('ready');
    }
    void load().catch(() => setState('error'));
  }, [appointmentId, organizationId]);

  async function doAction(action: 'confirm'|'cancel'|'no-show'|'check-in') {
    if (!branchId || !appointmentId) return;
    setMessage('Processing...');
    const res = await fetchWithAuth(`/api/branches/${branchId}/appointments/${appointmentId}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (res.status === 403) { setState('forbidden'); return; }
    if (res.status === 409) { setMessage('Action conflict or invalid state'); return; }
    if (!res.ok) { setMessage('Action failed'); return; }
    const result = await res.json();
    setAppointment(result);
    if (action === 'check-in') {
      // The check-in endpoint returns queueEntry and token
      setMessage('Checked in');
    } else {
      setMessage('Done');
    }
  }

  if (state === 'loading') return <main className="page-shell"><p>Loading...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to access this appointment.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load appointment.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/appointments">Appointments</a></nav>
      <section className="content-panel">
        <div className="section-heading"><div><p className="eyebrow">Appointment</p><h1>Appointment details</h1></div></div>
        {appointment && (
          <div>
            <p><strong>{appointment.patient?.firstName} {appointment.patient?.lastName}</strong> · {appointment.patient?.patientNumber}</p>
            <p>{appointment.service?.department?.name} · {appointment.service?.name}</p>
            <p>Date: {appointment.appointmentDate}</p>
            <p>Time: {new Date(appointment.startAt).toISOString().slice(11,16)} - {new Date(appointment.endAt).toISOString().slice(11,16)}</p>
            <p>Status: <span className={`status status-${appointment.status?.toLowerCase()}`}>{appointment.status}</span></p>
            <div className="action-row">
              {appointment.status === 'SCHEDULED' && <button onClick={() => void doAction('confirm')}>Confirm</button>}
              {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') && <button onClick={() => void doAction('cancel')} className="secondary-button">Cancel</button>}
              {appointment.status === 'CONFIRMED' && <button onClick={() => void doAction('no-show')} className="secondary-button">No-show</button>}
              {appointment.status === 'CONFIRMED' && <button onClick={() => void doAction('check-in')}>Check-in</button>}
            </div>
            {message && <p className="muted">{message}</p>}
            {appointment.queueEntry && appointment.token && (
              <div className="token-block"><p>Queue entry: {appointment.queueEntry.id}</p><p>Token: {appointment.token.displayNumber}</p></div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}