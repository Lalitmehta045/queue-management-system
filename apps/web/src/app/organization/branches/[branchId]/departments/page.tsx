'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../../../lib/auth-client';

type Department = { id: string; branchId: string; name: string; status: 'ACTIVE' | 'INACTIVE' };
type ListResponse = { data: Department[]; meta: { total: number; totalPages: number } };

export default function DepartmentsPage() {
  const params = useParams<{ branchId: string }>();
  const router = useRouter();
  const branchId = params.branchId;
  const [organizationId, setOrganizationId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async (id: string) => {
    const response = await fetchWithAuth(`/api/branches/${branchId}/departments`, { headers: { 'x-organization-id': id } });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setState('error'); return; }
    const body = await response.json() as ListResponse;
    setDepartments(body.data);
    setState(body.data.length ? 'ready' : 'empty');
  }, [branchId, router]);

  useEffect(() => {
    async function initialize() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState('error'); return; }
      const user = await me.json() as { memberships: { organization: { id: string } }[] };
      const id = user.memberships[0]?.organization.id;
      if (!id) { setState('error'); return; }
      setOrganizationId(id);
      await load(id);
    }
    void initialize().catch(() => setState('error'));
  }, [load, router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const path = editingId ? `/api/branches/${branchId}/departments/${editingId}` : `/api/branches/${branchId}/departments`;
    const response = await fetchWithAuth(path, { method: editingId ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ name }) });
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('A department with that name already exists.'); return; }
    if (!response.ok) { setMessage('Unable to save department.'); return; }
    setName(''); setEditingId(null); setMessage('Department saved.'); await load(organizationId);
  }

  async function toggle(department: Department) {
    const action = department.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/branches/${branchId}/departments/${department.id}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change department status.'); return; }
    await load(organizationId);
  }

  if (state === 'loading') return <main className="page-shell">Loading departments...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage departments.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load departments.</p></main>;

  return <main className="page-shell"><nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization/branches">Branches</a></nav><section className="content-panel"><p className="eyebrow">Branch operations</p><h1>Departments</h1><form onSubmit={save} className="branch-form"><label>Name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><span /><button type="submit">{editingId ? 'Update department' : 'Add department'}</button></form>{message && <p className="success-text">{message}</p>}{state === 'empty' ? <p className="muted">No departments have been created yet.</p> : <div className="branch-list">{departments.map((department) => <article className="branch-row" key={department.id}><div><strong>{department.name}</strong><span className="muted">{department.status}</span></div><div className="row-actions"><a className="link-button" href={`/organization/departments/${department.id}/services`}>Services</a><button type="button" onClick={() => { setEditingId(department.id); setName(department.name); }}>Edit</button><button type="button" onClick={() => void toggle(department)}>{department.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></div></article>)}</div>}</section></main>;
}