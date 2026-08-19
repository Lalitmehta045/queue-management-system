'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import { TableSkeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import type { User, Branch, Department, Service, Token, TokenListResponse, PageState } from '../../../types/queue';

type ExtendedService = Service & { departmentId: string };

async function fetchTokenList(branchId: string, organizationId: string, page: number, status: string, serviceId: string, businessDate: string) {
  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (businessDate) params.set('businessDate', businessDate);
  if (status) params.set('status', status);
  if (serviceId) params.set('serviceId', serviceId);
  return fetchWithAuth(`/api/branches/${branchId}/tokens?${params.toString()}`, {
    headers: { 'x-organization-id': organizationId }
  });
}

export default function TokensPage() {
  const router = useRouter();
  
  const [organizationId, setOrganizationId] = useState('');
  const [branchId, setBranchId] = useState('');
  
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<ExtendedService[]>([]);
  
  const [tokens, setTokens] = useState<TokenListResponse | null>(null);
  const [selected, setSelected] = useState<Token | null>(null);
  
  const [page, setPage] = useState(1);
  const [businessDate, setBusinessDate] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState('');
  
  const [state, setState] = useState<PageState>('loading');
  const [message, setMessage] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [activeTokenCount, setActiveTokenCount] = useState(0);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function loadContext() {
      try {
        const response = await fetchWithAuth('/api/auth/me');
        if (response.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const user = await response.json() as User;
        const membership = user.memberships[0];
        if (!membership) { if (isMounted.current) setState('error'); return; }
        
        if (isMounted.current) {
          setOrganizationId(membership.organization.id);
          setUserRole(membership.role);
        }
        
        if (membership.branchId) {
          if (isMounted.current) {
            setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
            setBranchId(membership.branchId);
          }
          return;
        }
        
        const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', {
          headers: { 'x-organization-id': membership.organization.id }
        });
        if (branchResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!branchResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const branchList = await branchResponse.json() as { data: Branch[] };
        if (isMounted.current) {
          const fetchedBranches = branchList.data || [];
          setBranches(fetchedBranches);
          if (fetchedBranches.length === 0) {
            setState('empty');
          } else {
            const firstBranch = fetchedBranches[0];
            if (firstBranch) {
              setBranchId(firstBranch.id);
            }
          }
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    
    async function loadServices() {
      try {
        const headers = { 'x-organization-id': organizationId };
        const depsResponse = await fetchWithAuth(`/api/branches/${branchId}/departments?page=1&limit=100`, { headers });
        
        if (depsResponse.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!depsResponse.ok) { if (isMounted.current) setState('error'); return; }
        
        const depList = await depsResponse.json() as { data: Department[] };
        
        const lists = await Promise.all(depList.data.map(async (department) => {
          const res = await fetchWithAuth(`/api/departments/${department.id}/services?page=1&limit=100`, { headers });
          if (!res.ok) return [];
          const resData = await res.json() as { data: Service[] };
          return resData.data.map(service => ({ ...service, departmentId: department.id }));
        }));
        
        if (isMounted.current) {
          setDepartments(depList.data || []);
          setServices(lists.flat());
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    
    void loadServices();
  }, [branchId, organizationId]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    
    async function loadTokens() {
      if (isMounted.current) setState('loading');
      try {
        const response = await fetchTokenList(branchId, organizationId, page, status, serviceId, businessDate);
        if (response.status === 401) { if (isMounted.current) router.push('/login'); return; }
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const tokenList = await response.json() as TokenListResponse;
        if (isMounted.current) {
          setTokens(tokenList);
          if (!businessDate) setBusinessDate(tokenList.meta.businessDate);
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, organizationId, page, status, serviceId, businessDate]); // removed router

  async function cancelToken(token: Token, e: React.MouseEvent) {
    e.stopPropagation();
    if (isCancelling) return;
    setIsCancelling(true);
    setMessage('');
    
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/${token.id}/cancel`, {
        method: 'POST',
        headers: { 'x-organization-id': organizationId }
      });
      
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setState('forbidden'); return; }
      
      if (!response.ok) {
        if (response.status === 409) {
          setMessage('Conflict: Cannot cancel token in its current state.');
        } else {
          setMessage('Unable to cancel token.');
        }
        return;
      }
      
      setMessage('Token cancelled successfully.');
      
      const refreshed = await fetchTokenList(branchId, organizationId, page, status, serviceId, businessDate);
      if (refreshed.ok) {
        setTokens(await refreshed.json() as TokenListResponse);
      }
    } catch {
      setMessage('An error occurred while cancelling the token.');
    } finally {
      setIsCancelling(false);
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

  function getPriorityBadgeVariant(priority: string) {
    switch(priority) {
      case 'EMERGENCY': return 'danger';
      case 'VIP': return 'warning';
      case 'SENIOR_CITIZEN': return 'info';
      case 'APPOINTMENT': return 'success';
      default: return 'neutral';
    }
  }

  const canReset = ['SUPER_ADMIN', 'ORG_ADMIN', 'BRANCH_ADMIN'].includes(userRole);

  async function handleResetClick() {
    // Fetch active token count for the warning
    try {
      const waitingRes = await fetchTokenList(branchId, organizationId, 1, 'WAITING', '', '');
      const calledRes = await fetchTokenList(branchId, organizationId, 1, 'CALLED', '', '');
      const servingRes = await fetchTokenList(branchId, organizationId, 1, 'SERVING', '', '');
      let count = 0;
      if (waitingRes.ok) { const d = await waitingRes.json() as TokenListResponse; count += d.meta.total; }
      if (calledRes.ok) { const d = await calledRes.json() as TokenListResponse; count += d.meta.total; }
      if (servingRes.ok) { const d = await servingRes.json() as TokenListResponse; count += d.meta.total; }
      setActiveTokenCount(count);
    } catch {
      setActiveTokenCount(0);
    }
    setShowResetDialog(true);
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    setMessage('');
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/tokens/reset`, {
        method: 'POST',
        headers: { 'x-organization-id': organizationId }
      });
      if (response.status === 401) { router.push('/login'); return; }
      if (response.status === 403) { setMessage('You do not have permission to reset tokens.'); return; }
      if (!response.ok) {
        const errData = await response.json().catch(() => null) as { message?: string } | null;
        setMessage(errData?.message || 'Failed to reset token sequence.');
        return;
      }
      const result = await response.json() as { cancelledTokens: number; newBusinessDate: string };
      setMessage(`Token sequence reset successfully. ${result.cancelledTokens} active token${result.cancelledTokens !== 1 ? 's' : ''} cancelled. New tokens will start from T-001.`);
      setBusinessDate('');
      setPage(1);
      // Refresh token list
      const refreshed = await fetchTokenList(branchId, organizationId, 1, status, serviceId, '');
      if (refreshed.ok) {
        const data = await refreshed.json() as TokenListResponse;
        if (isMounted.current) {
          setTokens(data);
          if (data.meta.businessDate) setBusinessDate(data.meta.businessDate);
        }
      }
    } catch {
      setMessage('A network error occurred while resetting tokens.');
    } finally {
      setIsResetting(false);
      setShowResetDialog(false);
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to access tokens in this branch." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load token management. Please try again." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <EmptyState title="No branches assigned" description="You do not have any active branches assigned to your account." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tokens</h1>
          <p className="text-sm text-slate-500 mt-1">Daily service tokens for queues and counters.</p>
        </div>
        <div className="flex items-center gap-3">
          {canReset && branchId && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => void handleResetClick()}
              disabled={isResetting}
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset Tokens
            </Button>
          )}
          {branches.length > 1 && (
            <div className="w-full sm:w-64">
              <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
                <option value="">Select branch</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}{branch.code ? ` (${branch.code})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      {showResetDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowResetDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-red-50 px-6 py-4 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-900">Reset token sequence?</h3>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                All current waiting tokens will be removed from the active queue and the
                next token will start from <span className="font-bold text-slate-900">T-001</span>. Historical records will be preserved.
              </p>
              {activeTokenCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <p className="text-sm text-amber-800 font-medium">
                    There {activeTokenCount === 1 ? 'is' : 'are'} currently <span className="font-bold">{activeTokenCount}</span> active token{activeTokenCount !== 1 ? 's' : ''} (WAITING/CALLED/SERVING) that will be cancelled.
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowResetDialog(false)} disabled={isResetting}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={() => void handleConfirmReset()} disabled={isResetting} isLoading={isResetting}>
                {isResetting ? 'Resetting...' : 'Reset Tokens'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`p-4 rounded-lg text-sm font-medium border ${message.includes('success') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`} role="status">
          {message}
        </div>
      )}

      <Card>
        <div className="p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input 
            type="date"
            label="Business Date"
            value={businessDate} 
            onChange={(e) => { setBusinessDate(e.target.value); setPage(1); }} 
          />
          <Select label="Service" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPage(1); }}>
            <option value="">All services</option>
            {services.map(service => (
              <option key={service.id} value={service.id}>
                {departments.find(dep => dep.id === service.departmentId)?.name} · {service.name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="WAITING">Waiting</option>
            <option value="CALLED">Called</option>
            <option value="SERVING">Serving</option>
            <option value="COMPLETED">Completed</option>
            <option value="SKIPPED">Skipped</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>

        {state === 'loading' && !tokens ? (
          <div className="p-6">
            <TableSkeleton rows={5} />
          </div>
        ) : !tokens?.data.length ? (
          <div className="p-12">
            <EmptyState 
              title="No tokens found" 
              description="There are no tokens matching your current filters."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50/50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3 font-semibold">Token</th>
                  <th className="px-6 py-3 font-semibold">Type</th>
                  <th className="px-6 py-3 font-semibold">Category</th>
                  <th className="px-6 py-3 font-semibold">Customer</th>
                  <th className="px-6 py-3 font-semibold">Service</th>
                  <th className="px-6 py-3 font-semibold">Priority</th>
                  <th className="px-6 py-3 font-semibold">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tokens.data.map((token) => (
                  <tr 
                    key={token.id} 
                    className={`hover:bg-slate-50 cursor-pointer transition-colors ${selected?.id === token.id ? 'bg-teal-50 hover:bg-teal-50' : ''}`}
                    onClick={() => setSelected(token)}
                  >
                    <td className="px-6 py-4">
                      <div className="font-bold text-teal-600 text-lg">{token.displayNumber}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-900">{token.type === 'SPECIAL' ? 'Special' : 'Normal'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-500">{token.specialCategory ? token.specialCategory.replace('_', ' ') : '—'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{token.queueEntry.patient ? `${token.queueEntry.patient.firstName} ${token.queueEntry.patient.lastName}` : 'Walk-in Customer'}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{token.queueEntry.patient?.patientNumber || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-900">{token.queueEntry.service.name}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{token.queueEntry.service.department.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={getPriorityBadgeVariant(token.queueEntry.priority)}>
                        {token.queueEntry.priority.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={getStatusBadgeVariant(token.status)}>
                        {token.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            window.open(`/dashboard/tokens/${token.id}/print?branch=${branchId}`, '_blank');
                          }}
                        >
                          Print
                        </Button>
                        {token.status === 'WAITING' && (
                          <Button 
                            size="sm" 
                            variant="danger"
                            disabled={isCancelling}
                            onClick={(e) => void cancelToken(token, e)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className="p-6 border-t-2 border-teal-500 bg-slate-50 rounded-b-xl flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <div className="text-xs font-bold text-teal-600 uppercase tracking-widest mb-1">Selected Token</div>
              <div className="flex items-end gap-3">
                <h2 className="text-2xl font-black text-slate-900 leading-none">{selected.displayNumber}</h2>
                <div className="text-sm font-medium text-slate-600 pb-0.5">
                  {selected.queueEntry.patient ? `${selected.queueEntry.patient.firstName} ${selected.queueEntry.patient.lastName}` : 'Walk-in Customer'}
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Issued: {new Date(selected.issuedAt).toLocaleString()} · Priority: {selected.queueEntry.priority.replace('_', ' ')}
              </p>
            </div>
            <div className="w-full sm:w-auto text-right">
              <Badge variant={getStatusBadgeVariant(selected.status)}>
                {selected.status}
              </Badge>
            </div>
          </div>
        )}

        {tokens && tokens.meta.totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white rounded-b-xl">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="text-sm text-slate-600 font-medium">Page {page} of {tokens.meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= tokens.meta.totalPages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
