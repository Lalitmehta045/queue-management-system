'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../../../lib/auth-client';

type Counter = { id: string; name: string; code: string; status: 'ACTIVE' | 'INACTIVE' };
type Operator = { id: string; displayName: string; email: string };
type Assigned = { id: string; user: Operator & { role: string | null; status: string | null } };
type User = { memberships: { organization: { id: string } }[] };

export default function CountersPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [counters, setCounters] = useState<Counter[]>([]);
  const [eligible, setEligible] = useState<Operator[]>([]);
  const [assigned, setAssigned] = useState<Record<string, Assigned[]>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async (id: string) => {
    const headers = { 'x-organization-id': id };
    const [counterResponse, operatorResponse] = await Promise.all([
      fetchWithAuth(`/api/branches/${branchId}/counters`, { headers }),
      fetchWithAuth(`/api/branches/${branchId}/operators`, { headers }),
    ]);
    if (counterResponse.status === 401) { router.push('/login'); return; }
    if (counterResponse.status === 403 || operatorResponse.status === 403) { setState('forbidden'); return; }
    if (!counterResponse.ok || !operatorResponse.ok) { setState('error'); return; }
    const counterBody = await counterResponse.json() as { data: Counter[] };
    setCounters(counterBody.data);
    setEligible(await operatorResponse.json() as Operator[]);
    await Promise.all(counterBody.data.map(async (counter) => {
      const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counter.id}/operators`, { headers });
      if (response.ok) {
        const operators = await response.json() as Assigned[];
        setAssigned((current) => ({ ...current, [counter.id]: operators }));
      }
    }));
    setState(counterBody.data.length ? 'ready' : 'empty');
  }, [branchId, router]);

  useEffect(() => {
    async function initialize() {
      const me = await fetchWithAuth('/api/auth/me');
      if (!me.ok) { setState(me.status === 403 ? 'forbidden' : 'error'); return; }
      const user = await me.json() as User;
      const id = user.memberships[0]?.organization.id;
      if (!id) { setState('error'); return; }
      setOrganizationId(id);
      await load(id);
    }
    void initialize().catch(() => setState('error'));
  }, [branchId, load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const path = editingId ? `/api/branches/${branchId}/counters/${editingId}` : `/api/branches/${branchId}/counters`;
    const response = await fetchWithAuth(path, { method: editingId ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ name, code }) });
    if (response.status === 409) { setMessage('A counter with that code already exists in this branch.'); return; }
    if (!response.ok) { setMessage('Unable to save counter.'); return; }
    setName(''); setCode(''); setEditingId(null); setMessage('Counter saved.'); await load(organizationId);
  }

  async function toggle(counter: Counter) {
    const action = counter.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counter.id}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (!response.ok) { setMessage('Unable to change counter status.'); return; }
    await load(organizationId);
  }

  async function assign(counterId: string) {
    if (!operatorId) return;
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/operators`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ userId: operatorId }) });
    if (response.status === 409) { setMessage('That operator is already assigned.'); return; }
    if (!response.ok) { setMessage('Unable to assign operator.'); return; }
    setOperatorId(''); setMessage('Operator assigned.'); await load(organizationId);
  }

  async function unassign(counterId: string, userId: string) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/operators/${userId}`, { method: 'DELETE', headers: { 'x-organization-id': organizationId } });
    if (!response.ok) { setMessage('Unable to unassign operator.'); return; }
    await load(organizationId);
  }

  if (state === 'loading') return <main className="page-shell">Loading counters...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage counters.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load counters.</p></main>;

  return <main className="page-shell"><nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization/branches">Branches</a></nav><section className="content-panel"><p className="eyebrow">Branch operations</p><h1>Counters</h1><form onSubmit={save} className="branch-form"><label>Name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Code<input required maxLength={40} value={code} onChange={(event) => setCode(event.target.value)} /></label><button type="submit">{editingId ? 'Update counter' : 'Add counter'}</button></form>{message && <p className="success-text">{message}</p>}{state === 'empty' ? <p className="muted">No counters have been created yet.</p> : <div className="branch-list">{counters.map((counter) => <article className="branch-row" key={counter.id}><div><strong>{counter.name}</strong><span className="muted">{counter.code} · {counter.status}</span>{(assigned[counter.id] ?? []).map((assignment) => <span className="muted" key={assignment.id}>{assignment.user.displayName} ({assignment.user.role}) <button type="button" onClick={() => void unassign(counter.id, assignment.user.id)}>Unassign</button></span>)}</div><div className="row-actions"><select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}><option value="">Assign operator</option>{eligible.map((operator) => <option value={operator.id} key={operator.id}>{operator.displayName} ({operator.email})</option>)}</select><button type="button" onClick={() => void assign(counter.id)}>Assign</button><button type="button" onClick={() => { setEditingId(counter.id); setName(counter.name); setCode(counter.code); }}>Edit</button><button type="button" onClick={() => void toggle(counter)}>{counter.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></div></article>)}</div>}</section></main>;
}