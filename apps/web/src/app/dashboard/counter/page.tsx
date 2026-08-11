'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null; role: string };
type User = { memberships: Membership[] };
type Counter = { id: string; branchId: string; name: string; code: string; status: string };
type Token = { id: string; displayNumber: string; sequenceNumber: number; status: 'CALLED' | 'SERVING' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED' | 'WAITING'; calledAt: string | null; servingAt: string | null; completedAt: string | null; recallCount: number; counter: { id: string; name: string; code: string } | null; operator: { id: string; displayName: string } | null; queueEntry: { patient: { patientNumber: string; firstName: string; lastName: string }; service: { name: string; department: { name: string } } } };
type WaitingResponse = { data: Token[]; meta: { total: number } };

export default function CounterWorkspacePage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterId, setCounterId] = useState('');
  const [current, setCurrent] = useState<Token | null>(null);
  const [waiting, setWaiting] = useState<WaitingResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'reconnecting' | 'forbidden' | 'error' | 'empty'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadContext() {
      const meResponse = await fetchWithAuth('/api/auth/me');
      if (meResponse.status === 401) { router.push('/login'); return; }
      if (!meResponse.ok) { setState('error'); return; }
      const user = await meResponse.json() as User;
      const membership = user.memberships[0];
      if (!membership?.branchId) { setState('empty'); return; }
      setOrganizationId(membership.organization.id);
      setBranchId(membership.branchId);
      const countersResponse = await fetchWithAuth(`/api/branches/${membership.branchId}/counters/assigned`, { headers: { 'x-organization-id': membership.organization.id } });
      if (countersResponse.status === 403) { setState('forbidden'); return; }
      if (!countersResponse.ok) { setState('error'); return; }
      const assigned = await countersResponse.json() as Counter[];
      setCounters(assigned);
      setCounterId(assigned[0]?.id ?? '');
      if (!assigned.length) setState('empty');
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!organizationId || !branchId || !counterId) return;
    let closed = false;

    async function refresh() {
      const headers = { 'x-organization-id': organizationId };
      const [currentResponse, waitingResponse] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/current`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/waiting`, { headers }),
      ]);
      if (currentResponse.status === 401 || waitingResponse.status === 401) { router.push('/login'); return; }
      if (currentResponse.status === 403 || waitingResponse.status === 403) { setState('forbidden'); return; }
      if (!currentResponse.ok || !waitingResponse.ok) throw new Error('Unable to load counter state');
      setCurrent(await currentResponse.json() as Token | null);
      setWaiting(await waitingResponse.json() as WaitingResponse);
      setState('ready');
    }

    void refresh().catch(() => setState('error'));

    const source = new EventSource(`/api/branches/${branchId}/counters/${counterId}/events`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.eventType) void refresh();
    };
    source.onerror = () => {
      if (!closed) setState('reconnecting');
    };
    source.onopen = () => {
      if (!closed && state === 'reconnecting') void refresh();
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [branchId, counterId, organizationId, router, state]);

  async function operate(action: 'call-next' | 'recall' | 'skip' | 'complete' | 'serve', tokenId?: string) {
    const url = action === 'call-next' 
      ? `/api/branches/${branchId}/counters/${counterId}/call-next`
      : tokenId && action === 'serve' ? `/api/branches/${branchId}/counters/${counterId}/tokens/${tokenId}/call` // Using 'serve' as placeholder for call-specific here via parameters, but actually let's make a dedicated function for call-specific
      : `/api/branches/${branchId}/counters/${counterId}/current/${action}`;
    const response = await fetchWithAuth(url, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('The counter state changed. Refreshing...'); await refreshState(); return; }
    if (!response.ok) { setMessage('Unable to complete that operation.'); return; }
    setMessage('');
    await refreshState();
  }

  async function callSpecific(tokenId: string) {
    const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/tokens/${tokenId}/call`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (response.status === 409) { setMessage('The counter state changed. Refreshing...'); await refreshState(); return; }
    if (!response.ok) { setMessage('Unable to call that specific token.'); return; }
    setMessage('');
    await refreshState();
  }

  async function refreshState() {
    const headers = { 'x-organization-id': organizationId };
    const [currentResponse, waitingResponse] = await Promise.all([
      fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/current`, { headers }),
      fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/waiting`, { headers }),
    ]);
    if (currentResponse.ok && waitingResponse.ok) {
      setCurrent(await currentResponse.json() as Token | null);
      setWaiting(await waitingResponse.json() as WaitingResponse);
    }
  }

  if (state === 'loading') return <main className="page-shell"><p>Loading counter workspace...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to operate this counter.</p></main>;
  if (state === 'empty') return <main className="page-shell"><p className="muted">No active counter assignment is available.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load counter workspace.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/queue-entries">Queue</a><a href="/dashboard/tokens">Tokens</a></nav>
      <section className="content-panel counter-workspace">
        <div className="section-heading"><div><p className="eyebrow">Counter operations</p><h1>{counters.find((counter) => counter.id === counterId)?.name ?? 'Counter'}</h1><p className="muted">{counters.find((counter) => counter.id === counterId)?.code} · {waiting?.meta.total ?? 0} waiting {state === 'reconnecting' ? ' (Reconnecting...)' : ''}</p></div>{counters.length > 1 && <label>Assigned counter<select value={counterId} onChange={(event) => setCounterId(event.target.value)}>{counters.map((counter) => <option key={counter.id} value={counter.id}>{counter.name} ({counter.code})</option>)}</select></label>}</div>
        {message && <p className="error-text" role="alert">{message}</p>}
        {!current ? <div className="current-token empty-state"><p className="eyebrow">Current token</p><h2>No active token</h2><button type="button" onClick={() => void operate('call-next')} disabled={!waiting?.meta.total}>Call next</button></div> : <div className="current-token"><p className="eyebrow">Current token</p><h2>{current.displayNumber}</h2><p className="patient-name">{current.queueEntry.patient.firstName} {current.queueEntry.patient.lastName}</p><p className="muted">{current.queueEntry.patient.patientNumber} · {current.queueEntry.service.department.name} · {current.queueEntry.service.name}</p><p className="status-line">{current.status} · Recall count {current.recallCount}</p><div className="row-actions"><button type="button" onClick={() => void operate('serve')} disabled={current.status !== 'CALLED'}>Serve</button><button type="button" className="secondary-button" onClick={() => void operate('recall')} disabled={!['CALLED', 'SERVING'].includes(current.status)}>Recall</button><button type="button" className="secondary-button" onClick={() => void operate('skip')} disabled={!['CALLED', 'SERVING'].includes(current.status)}>Skip</button><button type="button" onClick={() => void operate('complete')} disabled={!['CALLED', 'SERVING'].includes(current.status)}>Complete</button><button type="button" className="secondary-button" onClick={() => router.push(`/dashboard/tokens/${current.id}/print?branch=${branchId}`)}>Print</button></div></div>}
        <div className="waiting-panel"><p className="eyebrow">Waiting queue</p>{!waiting?.data.length ? <p className="muted">No waiting tokens.</p> : <div className="patient-list">{waiting.data.map((token) => <div className="queue-entry-row" key={token.id}><span><strong>{token.displayNumber}</strong><small>{token.queueEntry.patient.patientNumber} · {token.queueEntry.patient.firstName} {token.queueEntry.patient.lastName} · {token.queueEntry.service.name}</small></span><span className="status status-waiting"><button type="button" className="secondary-button" onClick={() => void callSpecific(token.id)}>Call</button></span></div>)}</div>}</div>
      </section>
    </main>
  );
}
