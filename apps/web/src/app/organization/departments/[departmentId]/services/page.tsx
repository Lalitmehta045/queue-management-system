'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../../../lib/auth-client';

type Service = { id: string; departmentId: string; name: string; status: 'ACTIVE' | 'INACTIVE' };

export default function ServicesPage() {
  const params = useParams<{ departmentId: string }>();
  const router = useRouter();
  const departmentId = params.departmentId;
  const [organizationId, setOrganizationId] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async (id: string) => {
    const response = await fetchWithAuth(`/api/departments/${departmentId}/services`, { headers: { 'x-organization-id': id } });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setState('error'); return; }
    const body = await response.json() as { data: Service[] };
    setServices(body.data); setState(body.data.length ? 'ready' : 'empty');
  }, [departmentId, router]);

  useEffect(() => {
    async function initialize() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState('error'); return; }
      const user = await me.json() as { memberships: { organization: { id: string } }[] };
      const id = user.memberships[0]?.organization.id;
      if (!id) { setState('error'); return; }
      setOrganizationId(id); await load(id);
    }
    void initialize().catch(() => setState('error'));
  }, [load, router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const path = editingId ? `/api/departments/${departmentId}/services/${editingId}` : `/api/departments/${departmentId}/services`;
    const response = await fetchWithAuth(path, { method: editingId ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ name }) });
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('A service with that name already exists.'); return; }
    if (!response.ok) { setMessage('Unable to save service.'); return; }
    setName(''); setEditingId(null); setMessage('Service saved.'); await load(organizationId);
  }

  async function toggle(service: Service) {
    const action = service.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/departments/${departmentId}/services/${service.id}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change service status.'); return; }
    await load(organizationId);
  }

  if (state === 'loading') return <main className="page-shell">Loading services...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage services.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load services.</p></main>;

  return <main className="page-shell"><nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization/branches">Branches</a></nav><section className="content-panel"><p className="eyebrow">Department operations</p><h1>Services</h1><form onSubmit={save} className="branch-form"><label>Name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><span /><button type="submit">{editingId ? 'Update service' : 'Add service'}</button></form>{message && <p className="success-text">{message}</p>}{state === 'empty' ? <p className="muted">No services have been created yet.</p> : <div className="branch-list">{services.map((service) => <article className="branch-row" key={service.id}><div><strong>{service.name}</strong><span className="muted">{service.status}</span></div><div className="row-actions"><button type="button" onClick={() => { setEditingId(service.id); setName(service.name); }}>Edit</button><button type="button" onClick={() => void toggle(service)}>{service.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></div></article>)}</div>}</section></main>;
}