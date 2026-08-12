'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/Card';
import { EmptyState } from '../../../../../components/ui/EmptyState';
import { ErrorState } from '../../../../../components/ui/ErrorState';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { Skeleton } from '../../../../../components/ui/Skeleton';
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
  const [operatorByCounter, setOperatorByCounter] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
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
    const operatorBody = await operatorResponse.json() as Operator[];
    const assignmentPairs = await Promise.all(counterBody.data.map(async (counter) => {
      const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counter.id}/operators`, { headers });
      if (!response.ok) return [counter.id, []] as const;
      return [counter.id, await response.json() as Assigned[]] as const;
    }));
    setCounters(counterBody.data);
    setEligible(operatorBody);
    setAssigned(Object.fromEntries(assignmentPairs));
    setState(counterBody.data.length ? 'ready' : 'empty');
  }, [branchId, router]);

  useEffect(() => {
    async function initialize() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState(me.status === 403 ? 'forbidden' : 'error'); return; }
      const user = await me.json() as User;
      const id = user.memberships[0]?.organization.id;
      if (!id) { setState('error'); return; }
      setOrganizationId(id);
      await load(id);
    }
    void initialize().catch(() => setState('error'));
  }, [load, router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const path = editingId ? `/api/branches/${branchId}/counters/${editingId}` : `/api/branches/${branchId}/counters`;
    const response = await fetchWithAuth(path, { method: editingId ? 'PATCH' : 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ name, code }) });
    if (response.status === 409) { setMessage('A counter with that code already exists in this branch.'); return; }
    if (!response.ok) { setMessage('Unable to save counter.'); return; }
    setName('');
    setCode('');
    setEditingId(null);
    setMessage('Counter saved.');
    await load(organizationId);
  }

  async function toggle(counter: Counter) {
    const action = counter.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counter.id}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (!response.ok) { setMessage('Unable to change counter status.'); return; }
    await load(organizationId);
  }

  async function assign(counterId: string) {
    const selectedOperatorId = operatorByCounter[counterId];
    if (!selectedOperatorId) return;
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/operators`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ userId: selectedOperatorId }) });
    if (response.status === 403) { setMessage('Only active counter operators from this branch can be assigned.'); return; }
    if (response.status === 409) { setMessage('That operator is already assigned to a counter in this branch.'); return; }
    if (!response.ok) { setMessage('Unable to assign operator.'); return; }
    setOperatorByCounter((current) => ({ ...current, [counterId]: '' }));
    setMessage('Operator assigned.');
    await load(organizationId);
  }

  async function unassign(counterId: string, userId: string) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/operators/${userId}`, { method: 'DELETE', headers: { 'x-organization-id': organizationId } });
    if (!response.ok) { setMessage('Unable to unassign operator.'); return; }
    setMessage('Operator unassigned.');
    await load(organizationId);
  }

  if (state === 'loading') {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </main>
    );
  }
  if (state === 'forbidden') return <main className="min-h-screen bg-slate-50 p-6"><ErrorState title="Access denied" message="You do not have permission to manage counters." /></main>;
  if (state === 'error') return <main className="min-h-screen bg-slate-50 p-6"><ErrorState title="Failed to load" message="Unable to load counters." onRetry={() => window.location.reload()} /></main>;

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav className="flex flex-wrap gap-3 text-sm font-semibold text-slate-500">
          <a className="hover:text-slate-900" href="/dashboard">Dashboard</a>
          <span>/</span>
          <a className="hover:text-slate-900" href="/organization/branches">Branches</a>
          <span>/</span>
          <span className="text-slate-900">Counters</span>
        </nav>

        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Counters</h1>
          <p className="mt-2 text-sm text-slate-500">Manage counter stations and assign active counter operators from this branch.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Counter' : 'Add Counter'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input required minLength={2} maxLength={120} label="Name" value={name} onChange={(event) => setName(event.target.value)} />
              <Input required maxLength={40} label="Code" value={code} onChange={(event) => setCode(event.target.value)} />
              <div className="flex items-end gap-2">
                <Button type="submit">{editingId ? 'Update Counter' : 'Add Counter'}</Button>
                {editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setName(''); setCode(''); }}>Cancel</Button>}
              </div>
            </form>
            {message && <p className="mt-4 text-sm font-semibold text-teal-700">{message}</p>}
          </CardContent>
        </Card>

        {state === 'empty' ? (
          <EmptyState title="No counters yet" description="Create a counter before assigning operators." />
        ) : (
          <div className="space-y-3">
            {counters.map((counter) => {
              const counterAssignments = assigned[counter.id] ?? [];
              return (
                <Card key={counter.id}>
                  <CardContent className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-lg font-bold text-slate-900">{counter.name}</h2>
                          <Badge variant={counter.status === 'ACTIVE' ? 'success' : 'warning'}>{counter.status}</Badge>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-500">{counter.code}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {counterAssignments.length === 0 ? (
                            <Badge>Unassigned</Badge>
                          ) : counterAssignments.map((assignment) => (
                            <span key={assignment.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                              {assignment.user.displayName}
                              <button type="button" className="text-red-600 hover:text-red-700" onClick={() => void unassign(counter.id, assignment.user.id)}>Unassign</button>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_auto_auto_auto] lg:w-auto">
                        <Select value={operatorByCounter[counter.id] ?? ''} onChange={(event) => setOperatorByCounter((current) => ({ ...current, [counter.id]: event.target.value }))} disabled={counter.status !== 'ACTIVE' || eligible.length === 0}>
                          <option value="">Assign operator</option>
                          {eligible.map((operator) => <option value={operator.id} key={operator.id}>{operator.displayName} ({operator.email})</option>)}
                        </Select>
                        <Button type="button" variant="secondary" disabled={counter.status !== 'ACTIVE' || !operatorByCounter[counter.id]} onClick={() => void assign(counter.id)}>Assign</Button>
                        <Button type="button" variant="outline" onClick={() => { setEditingId(counter.id); setName(counter.name); setCode(counter.code); }}>Edit</Button>
                        <Button type="button" variant={counter.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => void toggle(counter)}>{counter.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
