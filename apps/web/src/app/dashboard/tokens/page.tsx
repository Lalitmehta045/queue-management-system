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
        
        if (isMounted.current) setOrganizationId(membership.organization.id);
        
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
          setBranches(branchList.data || []);
          setBranchId(branchList.data[0]?.id ?? '');
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
        <ErrorState title="Failed to load" message="Unable to load token management." onRetry={() => window.location.reload()} />
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
