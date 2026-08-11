'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

interface AuditLogItem {
  id: string;
  organizationId: string;
  branchId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorUser: { id: string; displayName: string } | null;
  branch: { id: string; name: string; code: string | null } | null;
}

interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Membership {
  id: string;
  role: string;
  branchId: string | null;
  organization: { id: string; name: string };
}

interface User {
  displayName: string;
  email: string;
  memberships: Membership[];
}

interface Branch {
  id: string;
  name: string;
}

export default function AuditLogsPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [resourceIdFilter, setResourceIdFilter] = useState('');
  const [actorUserIdFilter, setActorUserIdFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [page, setPage] = useState(1);

  // Data
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [meta, setMeta] = useState<Meta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const router = useRouter();

  useEffect(() => {
    async function loadContext() {
      try {
        const meRes = await fetchWithAuth('/api/auth/me');
        if (meRes.status === 401) { router.push('/login'); return; }
        if (!meRes.ok) { setState('error'); return; }
        const meData = await meRes.json() as User;
        const membership = meData.memberships[0];
        if (!membership) { setState('error'); return; }

        if (membership.role !== 'SUPER_ADMIN' && membership.role !== 'ORG_ADMIN' && membership.role !== 'BRANCH_ADMIN') {
          setState('forbidden');
          return;
        }

        if (membership.branchId) {
          setBranchId(membership.branchId);
        } else {
          const branchesRes = await fetchWithAuth(`/api/organizations/${membership.organization.id}/branches`);
          if (branchesRes.ok) {
            const bData = await branchesRes.json();
            const branchList = bData.data || bData;
            setBranches(branchList);
            if (branchList.length > 0) setBranchId(branchList[0].id);
          }
        }
        setState('ready');
      } catch {
        setState('error');
      }
    }
    loadContext();
  }, [router]);

  const fetchLogs = useCallback(async () => {
    if (!branchId) return;
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (actionFilter) params.set('action', actionFilter);
      if (resourceTypeFilter) params.set('resourceType', resourceTypeFilter);
      if (resourceIdFilter) params.set('resourceId', resourceIdFilter);
      if (actorUserIdFilter) params.set('actorUserId', actorUserIdFilter);
      if (startDateFilter) params.set('startDate', startDateFilter);
      if (endDateFilter) params.set('endDate', endDateFilter);

      const res = await fetchWithAuth(`/api/branches/${branchId}/audit-logs?${params.toString()}`);
      if (res.status === 403) {
        setState('forbidden');
        setLoadingLogs(false);
        return;
      }
      if (!res.ok) {
        setLogs([]);
        setLoadingLogs(false);
        return;
      }
      const data = await res.json();
      setLogs(data.data || []);
      setMeta(data.meta || { page: 1, limit: 20, total: 0, totalPages: 0 });
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [branchId, page, actionFilter, resourceTypeFilter, resourceIdFilter, actorUserIdFilter, startDateFilter, endDateFilter]);

  useEffect(() => {
    if (state === 'ready' && branchId) {
      fetchLogs();
    }
  }, [state, branchId, fetchLogs]);

  if (state === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Loading Audit Logs...</div>;
  }

  if (state === 'forbidden') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-8">
        <div className="bg-gray-800 p-8 rounded-lg max-w-md text-center border border-red-500">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Access Denied</h2>
          <p className="text-gray-300 mb-6">You do not have permission to view audit logs for this organization/branch.</p>
          <a href="/dashboard" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-8">
        <div className="bg-gray-800 p-8 rounded-lg max-w-md text-center border border-yellow-500">
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">System Error</h2>
          <p className="text-gray-300 mb-6">Failed to load audit logging workspace.</p>
          <a href="/dashboard" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gray-800 p-6 rounded-lg shadow">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">Audit Logging & System Activity</h1>
            <p className="text-gray-400 text-sm mt-1">Tenant-isolated, append-only security trace</p>
          </div>
          <div className="flex items-center gap-4">
            {branches.length > 1 && (
              <select
                value={branchId || ''}
                onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
                className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 text-sm"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <a href="/dashboard" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-semibold transition">
              Dashboard
            </a>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <h2 className="text-lg font-semibold text-blue-300">Filters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Action</label>
              <input
                type="text"
                placeholder="e.g. TOKEN_CALLED"
                value={actionFilter}
                onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Resource Type</label>
              <input
                type="text"
                placeholder="e.g. TOKEN"
                value={resourceTypeFilter}
                onChange={(e) => { setResourceTypeFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Resource ID</label>
              <input
                type="text"
                placeholder="UUID"
                value={resourceIdFilter}
                onChange={(e) => { setResourceIdFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Actor User ID</label>
              <input
                type="text"
                placeholder="UUID"
                value={actorUserIdFilter}
                onChange={(e) => { setActorUserIdFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Start Date</label>
              <input
                type="date"
                value={startDateFilter}
                onChange={(e) => { setStartDateFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">End Date</label>
              <input
                type="date"
                value={endDateFilter}
                onChange={(e) => { setEndDateFilter(e.target.value); setPage(1); }}
                className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600"
              />
            </div>
          </div>
        </div>

        {/* Audit Log Table */}
        <div className="bg-gray-800 p-6 rounded-lg shadow space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-blue-300">System Activity Trace</h2>
            <span className="text-sm text-gray-400">Total: {meta.total} events</span>
          </div>

          {loadingLogs ? (
            <div className="py-12 text-center text-gray-400">Loading activity records...</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-gray-400 bg-gray-900/50 rounded-lg">
              No audit records matching criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300 border-collapse">
                <thead className="bg-gray-700 text-gray-200 text-xs uppercase">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Resource</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-750 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-gray-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="bg-blue-900/60 text-blue-300 px-2 py-1 rounded font-mono text-xs border border-blue-700">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-gray-200 font-semibold">{log.resourceType}</span>
                        {log.resourceId && (
                          <span className="block text-xs text-gray-500 font-mono truncate max-w-[120px]" title={log.resourceId}>
                            {log.resourceId}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {log.actorUser ? (
                          <span className="text-gray-200">{log.actorUser.displayName}</span>
                        ) : (
                          <span className="text-gray-500 italic">System / Unauthenticated</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {log.branch ? log.branch.name : <span className="text-gray-500">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="bg-gray-700 hover:bg-gray-600 text-xs px-2 py-1 rounded text-blue-300 transition"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {meta.totalPages > 1 && (
            <div className="flex justify-between items-center pt-4 border-t border-gray-700 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                Previous
              </button>
              <span className="text-gray-400">
                Page {meta.page} of {meta.totalPages}
              </span>
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Details Drawer / Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-lg max-w-xl w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center border-b border-gray-700 pb-3">
              <h3 className="text-lg font-bold text-blue-400">Audit Log Event Details</h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-white text-xl font-bold"
              >
                &times;
              </button>
            </div>
            <div className="space-y-2 text-sm text-gray-300">
              <div><strong className="text-gray-400">ID:</strong> <span className="font-mono text-xs">{selectedLog.id}</span></div>
              <div><strong className="text-gray-400">Action:</strong> <span className="font-mono text-blue-300">{selectedLog.action}</span></div>
              <div><strong className="text-gray-400">Resource Type:</strong> {selectedLog.resourceType}</div>
              <div><strong className="text-gray-400">Resource ID:</strong> <span className="font-mono text-xs">{selectedLog.resourceId || '—'}</span></div>
              <div><strong className="text-gray-400">Actor User:</strong> {selectedLog.actorUser ? `${selectedLog.actorUser.displayName} (${selectedLog.actorUser.id})` : 'System / Unauthenticated'}</div>
              <div><strong className="text-gray-400">Timestamp:</strong> {new Date(selectedLog.createdAt).toISOString()}</div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase text-gray-400 mb-2">Sanitized Metadata Payload</h4>
              <pre className="bg-gray-900 p-3 rounded text-xs font-mono text-green-400 overflow-x-auto border border-gray-700">
                {JSON.stringify(selectedLog.metadata, null, 2)}
              </pre>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
