'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Counter, Token, WaitingResponse, CounterPageState } from '../../../types/queue';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

const systemFont = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Segoe UI", sans-serif'
};

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
  const [messageType, setMessageType] = useState<'error' | 'success' | 'info'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  
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
  }, []);

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
        
        const currentData = await currentResponse.json() as Token | null;
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

    const source = new EventSource(`/api/branches/${branchId}/counters/${counterId}/events?organizationId=${encodeURIComponent(organizationId)}`);
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.eventType && !closed) void refresh();
    };
    source.onerror = () => {
      if (!closed) {
        isReconnecting.current = true;
        if (isMounted.current) {
          setState(prev => prev);
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
  }, [branchId, counterId, organizationId]); 

  async function refreshState() {
    try {
      const headers = { 'x-organization-id': organizationId };
      const [currentResponse, waitingResponse] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/current`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/waiting`, { headers }),
      ]);
      if (currentResponse.ok && waitingResponse.ok && isMounted.current) {
        setCurrent(await currentResponse.json() as Token | null);
        setWaiting(await waitingResponse.json());
      }
    } catch {
      // ignore
    }
  }

  function showMessage(text: string, type: 'error' | 'success' | 'info' = 'info') {
    setMessage(text);
    setMessageType(type);
    
    if (type !== 'error') {
      setTimeout(() => {
        if (isMounted.current) {
          setMessage(prev => prev === text ? '' : prev);
        }
      }, 5000);
    }
  }

  async function handleAction(action: 'call-next' | 'serve' | 'recall' | 'skip' | 'complete') {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmittingAction(action);
    setMessage('');
    
    const currentNumber = current?.displayNumber;

    try {
      const url = action === 'call-next'
        ? `/api/branches/${branchId}/counters/${counterId}/call-next`
        : `/api/branches/${branchId}/counters/${counterId}/current/${action}`;
      const response = await fetchWithAuth(url, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      
      if (response.status === 409) { 
        let errorData: { message?: string } = {};
        try { errorData = (await response.json()) as { message?: string }; } catch { /* ignore */ }
        
        if (action === 'call-next' && errorData.message === 'No waiting token is available') {
           showMessage('No customers waiting', 'info');
        } else {
           showMessage('Another counter action happened. Refreshing the queue…', 'error'); 
        }
        await refreshState(); 
        return; 
      }

      if (response.status === 404 && action === 'call-next') {
        showMessage('No customers waiting', 'info');
        await refreshState();
        return;
      }
      
      if (!response.ok) { 
        showMessage('Unable to complete that operation.', 'error'); 
        return; 
      }
      
      if (action === 'skip' && currentNumber) {
        showMessage(`Token ${currentNumber} skipped`, 'info');
      } else if (action === 'recall' && currentNumber) {
        showMessage(`Token ${currentNumber} recalled`, 'info');
      }
      
      await refreshState();
    } catch {
      showMessage('A network error occurred.', 'error');
    } finally {
      setIsSubmitting(false);
      setSubmittingAction(null);
    }
  }

  async function handleCallSpecific(tokenId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmittingAction(`call-${tokenId}`);
    setMessage('');
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/counters/${counterId}/tokens/${tokenId}/call`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { 
        showMessage('Another counter action happened. Refreshing the queue…', 'error'); 
        await refreshState(); 
        return; 
      }
      if (!response.ok) { 
        showMessage('Unable to call that specific token.', 'error'); 
        return; 
      }
      
      await refreshState();
    } catch {
      showMessage('A network error occurred.', 'error');
    } finally {
      setIsSubmitting(false);
      setSubmittingAction(null);
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8 px-4" style={systemFont}>
        <ErrorState title="Access Denied" message="You do not have permission to operate this counter." />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="max-w-3xl mx-auto mt-8 px-4" style={systemFont}>
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
      <div className="max-w-3xl mx-auto mt-8 px-4" style={systemFont}>
        <ErrorState title="Failed to load" message="Unable to load counter workspace." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const counterName = counters.find(c => c.id === counterId)?.name ?? 'Counter';
  const counterCode = counters.find(c => c.id === counterId)?.code ?? '';

  const getMessageStyles = () => {
    if (messageType === 'error') return 'bg-red-50 text-red-700 border-red-200';
    if (messageType === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8" style={systemFont}>
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* HEADER */}
        {state === 'loading' ? (
          <div className="flex justify-between items-center mb-8 pb-6 border-b border-slate-200">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        ) : (
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-6 mb-8">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{counterName}</h1>
              <p className="text-sm font-medium text-slate-500 mt-1">
                {counterCode ? `Branch Code: ${counterCode}` : 'Operational Workspace'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-slate-200 shadow-sm">
                <span className="relative flex h-2.5 w-2.5">
                  {isReconnecting.current ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  )}
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {isReconnecting.current ? 'Reconnecting' : 'Online'}
                </span>
              </div>
            </div>
          </header>
        )}

        {message && (
          <div className={`px-4 py-3 rounded-lg border text-sm font-semibold shadow-sm animate-in fade-in slide-in-from-top-2 ${getMessageStyles()}`} role="alert">
            {message}
          </div>
        )}

        {/* CURRENT TOKEN & PRIMARY ACTIONS */}
        {state === 'loading' ? (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[400px]">
            <Skeleton className="h-4 w-48 mb-8" />
            <Skeleton className="h-32 w-64 mb-8" />
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-6 w-32 mb-12" />
            <Skeleton className="h-14 w-48 rounded-xl" />
          </div>
        ) : (
          <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden text-center flex flex-col items-center justify-center p-8 sm:p-16 min-h-[400px]">
            {!current ? (
              <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in-95 duration-300">
                <div className="space-y-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.25em]">READY FOR NEXT CUSTOMER</p>
                  <h2 className="text-4xl font-bold text-slate-800 tracking-tight">No active token</h2>
                </div>
                
                <div className="pt-8">
                  <Button
                    size="lg"
                    className="w-full h-16 text-lg font-bold bg-teal-600 hover:bg-teal-700 shadow-xl shadow-teal-600/20 rounded-2xl transition-all active:scale-[0.98]"
                    onClick={() => void handleAction('call-next')}
                    disabled={isSubmitting}
                    isLoading={isSubmitting && submittingAction === 'call-next'}
                  >
                    {isSubmitting && submittingAction === 'call-next' ? 'Calling next...' : 'NEXT CUSTOMER'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-2xl animate-in fade-in zoom-in-95 duration-300">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.25em] mb-8">NOW SERVING</p>
                
                <div className="text-[7rem] sm:text-[9rem] font-black text-teal-600 leading-none tracking-tighter mb-8 drop-shadow-sm">
                  {current.displayNumber}
                </div>
                
                <div className="space-y-3 mb-12">
                  <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">
                    {current.queueEntry.patient ? `${current.queueEntry.patient.firstName} ${current.queueEntry.patient.lastName}` : 'Walk-in Customer'}
                  </h2>
                  <p className="text-slate-500 font-medium text-lg">
                    {current.queueEntry.service.name}
                  </p>
                  <div className="inline-flex items-center gap-2 mt-4 px-4 py-1.5 bg-slate-50 text-slate-600 font-semibold text-sm rounded-full tracking-wide border border-slate-200">
                    <div className={`w-2 h-2 rounded-full ${current.status === 'SERVING' ? 'bg-teal-500' : 'bg-amber-500'}`} />
                    Status: {current.status}
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-lg mx-auto">
                  {current.status === 'CALLED' && (
                    <Button 
                      size="lg" 
                      className="w-full h-14 text-base font-bold bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-600/20 rounded-xl transition-all active:scale-[0.98]" 
                      disabled={isSubmitting} 
                      isLoading={isSubmitting && submittingAction === 'serve'} 
                      onClick={() => void handleAction('serve')}
                    >
                      SERVE
                    </Button>
                  )}
                  {current.status === 'SERVING' && (
                    <Button 
                      size="lg" 
                      className="w-full h-14 text-base font-bold bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-600/20 rounded-xl transition-all active:scale-[0.98]" 
                      disabled={isSubmitting} 
                      isLoading={isSubmitting && submittingAction === 'complete'} 
                      onClick={() => void handleAction('complete')}
                    >
                      COMPLETE
                    </Button>
                  )}
                  
                  <div className="flex w-full gap-4">
                    <Button 
                      size="lg" 
                      variant="secondary" 
                      className="flex-1 h-14 text-base font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl transition-all" 
                      disabled={isSubmitting} 
                      isLoading={isSubmitting && submittingAction === 'recall'}
                      onClick={() => void handleAction('recall')}
                    >
                      RECALL
                    </Button>
                    <Button 
                      size="lg" 
                      variant="secondary" 
                      className="flex-1 h-14 text-base font-bold bg-white hover:bg-red-50 text-red-600 border border-slate-200 hover:border-red-200 rounded-xl transition-all" 
                      disabled={isSubmitting} 
                      isLoading={isSubmitting && submittingAction === 'skip'}
                      onClick={() => void handleAction('skip')}
                    >
                      SKIP
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* WAITING QUEUE */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-white p-6 sm:px-8 sm:py-6 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Waiting Queue</h3>
            {state !== 'loading' && (
              <div className="px-3 py-1 bg-slate-50 text-slate-600 border border-slate-200 rounded-full text-xs font-semibold tracking-wide">
                {waiting?.meta.total ?? 0} waiting
              </div>
            )}
          </div>
          
          <div className="p-0">
            {state === 'loading' ? (
              <div className="p-6 sm:p-8 space-y-4">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            ) : !waiting?.data.length ? (
              <div className="p-12 sm:p-16 text-center">
                <p className="text-slate-500 font-medium text-lg">No customers waiting</p>
                <p className="text-slate-400 text-sm mt-1">You&apos;re all caught up.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {waiting.data.map(token => (
                  <div key={token.id} className="p-5 sm:px-8 sm:py-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors group">
                    <div className="flex items-center gap-6">
                      <span className="w-16 font-bold text-2xl text-slate-800 tracking-tight">{token.displayNumber}</span>
                      <div>
                        <h4 className="font-semibold text-slate-900">
                          {token.queueEntry.patient ? `${token.queueEntry.patient.firstName} ${token.queueEntry.patient.lastName}` : 'Walk-in Customer'}
                        </h4>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {token.queueEntry.service.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:block">Waiting</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity bg-white border border-slate-200 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 shadow-sm"
                        disabled={isSubmitting}
                        isLoading={isSubmitting && submittingAction === `call-${token.id}`}
                        onClick={() => void handleCallSpecific(token.id)}
                      >
                        Call
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
