'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Counter, Token, WaitingResponse, CounterPageState } from '../../../types/queue';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

export default function CounterWorkspacePage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterId, setCounterId] = useState('');
  const [current, setCurrent] = useState<Token | null>(null);
  const [waiting, setWaiting] = useState<WaitingResponse | null>(null);
  const [state, setState] = useState<CounterPageState>('loading');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const isReconnecting = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function loadContext() {
      try {
        const meResponse = await fetchWithAuth('/api/auth/me');
        if (meResponse.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (!meResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const user = await meResponse.json();
        const membership = user.memberships?.[0];
        if (!membership?.branchId) { if (isMounted.current) setState('empty'); return; }
        
        if (isMounted.current) {
          setOrganizationId(membership.organization.id);
          setBranchId(membership.branchId);
        }
        
        const countersResponse = await fetchWithAuth(`/api/branches/${membership.branchId}/counters/assigned`, { headers: { 'x-organization-id': membership.organization.id } });
        if (countersResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!countersResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const assigned = await countersResponse.json();
        if (isMounted.current) {
          setCounters(assigned);
          setCounterId(assigned[0]?.id ?? '');
          if (!assigned.length) setState('empty');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once

  useEffect(() => {
    if (!organizationId || !branchId || !counterId) return;
    let closed = false;

    async function refresh() {
      try {
        const headers = { 'x-organization-id': organizationId };
        const [currentResponse, waitingResponse] = await Promise.all([
          fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/current`, { headers }),
          fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/waiting`, { headers }),
        ]);
        
        if (currentResponse.status === 401 || waitingResponse.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (currentResponse.status === 403 || waitingResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!currentResponse.ok || !waitingResponse.ok) throw new Error('Unable to load counter state');
        
        const currentData = await currentResponse.json();
        const waitingData = await waitingResponse.json();
        
        if (isMounted.current && !closed) {
          setCurrent(currentData);
          setWaiting(waitingData);
          setState('ready');
          isReconnecting.current = false;
        }
      } catch {
        if (isMounted.current && !closed) setState('error');
      }
    }

    if (isMounted.current) setState('loading');
    void refresh();

    const source = new EventSource(`/api/branches/${branchId}/counters/${counterId}/events`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.eventType && !closed) void refresh();
    };
    source.onerror = () => {
      if (!closed) {
        isReconnecting.current = true;
        if (isMounted.current) {
          setMessage(prev => prev); // Force re-render
        }
      }
    };
    source.onopen = () => {
      if (!closed && isReconnecting.current) {
        isReconnecting.current = false;
        void refresh();
      }
    };

    return () => {
      closed = true;
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, counterId, organizationId]); // removed router

  async function refreshState() {
    try {
      const headers = { 'x-organization-id': organizationId };
      const [currentResponse, waitingResponse] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/current`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/waiting`, { headers }),
      ]);
      if (currentResponse.ok && waitingResponse.ok && isMounted.current) {
        setCurrent(await currentResponse.json());
        setWaiting(await waitingResponse.json());
      }
    } catch {
      // ignore
    }
  }

  async function handleAction(action: 'call-next' | 'serve' | 'recall' | 'skip' | 'complete') {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage('');
    try {
      const url = action === 'call-next'
        ? `/api/branches/${branchId}/counters/${counterId}/call-next`
        : `/api/branches/${branchId}/counters/${counterId}/current/${action}`;
      const response = await fetchWithAuth(url, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('Counter state changed. Refreshing...'); await refreshState(); return; }
      if (!response.ok) { setMessage('Unable to complete that operation.'); return; }
      
      setMessage('');
      await refreshState();
    } catch {
      setMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCallSpecific(tokenId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage('');
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/tokens/${tokenId}/call`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('Counter state changed. Refreshing...'); await refreshState(); return; }
      if (!response.ok) { setMessage('Unable to call that specific token.'); return; }
      
      setMessage('');
      await refreshState();
    } catch {
      setMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function getStatusBadgeVariant(status: string) {
    switch(status) {
      case 'WAITING': return 'warning';
      case 'CALLED': return 'info';
      case 'SERVING': return 'success';
      case 'COMPLETED': return 'neutral';
      case 'SKIPPED': 
      case 'CANCELLED': return 'danger';
      default: return 'neutral';
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to operate this counter." />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <EmptyState 
          title="No Counter Assigned" 
          description="You have not been assigned to operate any counters in this branch."
          icon={
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z" />
            </svg>
          }
        />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load counter workspace." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const counterName = counters.find(c => c.id === counterId)?.name ?? 'Counter';
  const counterCode = counters.find(c => c.id === counterId)?.code ?? '';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{counterName}</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            <span className="font-semibold text-slate-700">{counterCode}</span>
            <span>·</span>
            <span>{waiting?.meta.total ?? 0} waiting</span>
            {isReconnecting.current && (
              <>
                <span>·</span>
                <span className="text-amber-600 font-semibold animate-pulse flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span> Reconnecting...
                </span>
              </>
            )}
          </p>
        </div>
        {counters.length > 1 && (
          <div className="w-full md:w-64">
            <Select value={counterId} onChange={(e) => setCounterId(e.target.value)} disabled={isSubmitting}>
              {counters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </Select>
          </div>
        )}
      </div>

      {message && (
        <div className="p-4 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm font-medium" role="alert">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Token Section */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="bg-slate-50/50">
              <CardTitle>Current Token</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center p-8 sm:p-12 min-h-[400px]">
              {state === 'loading' ? (
                <div className="w-full max-w-sm space-y-6 text-center flex flex-col items-center">
                  <Skeleton className="h-24 w-48 rounded-xl" />
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-10 w-full mt-4" />
                </div>
              ) : !current ? (
                <div className="text-center w-full max-w-sm space-y-8">
                  <div className="mx-auto w-24 h-24 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center border-4 border-slate-50 shadow-inner">
                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">No active token</h2>
                    <p className="text-slate-500 text-sm mt-1">Ready to call the next customer in line.</p>
                  </div>
                  <Button
                    size="lg"
                    className="w-full text-lg h-14 shadow-md shadow-teal-500/20"
                    onClick={() => void handleAction('call-next')}
                    disabled={isSubmitting || !waiting?.meta.total}
                    isLoading={isSubmitting}
                  >
                    Call Next Customer
                  </Button>
                </div>
              ) : (
                <div className="text-center w-full">
                  <Badge variant={getStatusBadgeVariant(current.status)} className="mb-6 px-3 py-1 text-sm shadow-sm border border-black/5">
                    {current.status}
                  </Badge>
                  
                  <div className="text-6xl sm:text-[5rem] font-black text-teal-600 tracking-tight leading-none mb-4">
                    {current.displayNumber}
                  </div>
                  
                  <div className="space-y-1 mb-8">
                    <h2 className="text-2xl font-bold text-slate-900">
                      {current.queueEntry.patient.firstName} {current.queueEntry.patient.lastName}
                    </h2>
                    <p className="text-slate-500 font-medium text-lg">
                      {current.queueEntry.service.department.name} · {current.queueEntry.service.name}
                    </p>
                  </div>
                  
                  {current.recallCount > 0 && (
                    <p className="text-sm font-semibold text-amber-600 bg-amber-50 inline-block px-3 py-1 rounded-md border border-amber-100 mb-8">
                      Recalled {current.recallCount} time{current.recallCount > 1 ? 's' : ''}
                    </p>
                  )}

                  <div className="flex flex-wrap justify-center gap-3">
                    {current.status === 'CALLED' && (
                      <Button size="lg" className="px-8 shadow-md" disabled={isSubmitting} isLoading={isSubmitting} onClick={() => void handleAction('serve')}>
                        Serve
                      </Button>
                    )}
                    
                    {['CALLED', 'SERVING'].includes(current.status) && (
                      <>
                        <Button size="lg" variant="secondary" className="px-6 border border-slate-200" disabled={isSubmitting} onClick={() => void handleAction('recall')}>
                          Recall
                        </Button>
                        <Button size="lg" className="px-8 bg-emerald-600 hover:bg-emerald-700 shadow-md" disabled={isSubmitting} onClick={() => void handleAction('complete')}>
                          Complete
                        </Button>
                        <Button size="lg" variant="danger" className="px-6" disabled={isSubmitting} onClick={() => void handleAction('skip')}>
                          Skip
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Waiting Queue Section */}
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader className="bg-slate-50/50">
              <div className="flex justify-between items-center w-full">
                <CardTitle>Waiting Queue</CardTitle>
                <Badge variant="neutral">{waiting?.meta.total ?? 0}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 flex flex-col">
              {state === 'loading' ? (
                <div className="p-6 space-y-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : !waiting?.data.length ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium">No customers waiting.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-[500px]">
                  {waiting.data.map(token => (
                    <div key={token.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                      <div className="flex flex-col min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-teal-600 text-lg">{token.displayNumber}</span>
                          <span className="truncate font-semibold text-slate-900 text-sm">
                            {token.queueEntry.patient.firstName} {token.queueEntry.patient.lastName}
                          </span>
                        </div>
                        <span className="truncate text-xs text-slate-500 font-medium">
                          {token.queueEntry.service.name}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 shrink-0 border border-slate-200"
                        disabled={isSubmitting}
                        onClick={() => void handleCallSpecific(token.id)}
                      >
                        Call
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
