'use client';

import { FormEvent, useEffect, useState } from 'react';
import { fetchWithAuth } from '../../../../lib/auth-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { Badge } from '../../../../components/ui/Badge';
import { GitBranch, MapPin, Edit2, PlayCircle, PauseCircle, Power, PowerOff, Building, MonitorSmartphone, Plus, Save, ChevronRight, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

type Branch = { id: string; name: string; code: string | null; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; queueStatus: 'OPEN' | 'PAUSED' };
type Membership = { organization: { id: string }; role: string };
type User = { memberships: Membership[] };

export default function BranchesPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function loadBranches(id: string) {
    const response = await fetchWithAuth('/api/organizations/current/branches', { headers: { 'x-organization-id': id } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setState('error'); return; }
    const body = await response.json() as { data: Branch[] };
    setBranches(body.data);
    setState('ready');
  }

  useEffect(() => {
    async function load() {
      try {
        const me = await fetchWithAuth('/api/auth/me');
        if (!me.ok) { setState(me.status === 403 ? 'forbidden' : 'error'); return; }
        const user = await me.json() as User;
        const id = user.memberships[0]?.organization.id;
        if (!id) { setState('error'); return; }
        setOrganizationId(id);
        await loadBranches(id);
      } catch {
        setState('error');
      }
    }
    void load();
  }, []);

  async function saveBranch(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setMessage('');
    try {
      const path = editingId ? `/api/organizations/current/branches/${editingId}` : '/api/organizations/current/branches';
      const response = await fetchWithAuth(path, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'x-organization-id': organizationId },
        body: JSON.stringify({ name, code: code || undefined }),
      });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to save branch.'); return; }
      setName(''); setCode(''); setEditingId(null); 
      setMessage(editingId ? 'Branch updated successfully.' : 'Branch added successfully.');
      await loadBranches(organizationId);
    } catch {
      setMessage('An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleBranch(branch: Branch) {
    try {
      const action = branch.status === 'ACTIVE' ? 'deactivate' : 'activate';
      const response = await fetchWithAuth(`/api/organizations/current/branches/${branch.id}/${action}`, {
        method: 'POST', headers: { 'x-organization-id': organizationId },
      });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to change branch status.'); return; }
      await loadBranches(organizationId);
    } catch {
      setMessage('Error toggling branch status.');
    }
  }

  async function toggleQueueStatus(branch: Branch) {
    try {
      const action = branch.queueStatus === 'PAUSED' ? 'queue-resume' : 'queue-pause';
      const response = await fetchWithAuth(`/api/organizations/current/branches/${branch.id}/${action}`, {
        method: 'POST', headers: { 'x-organization-id': organizationId },
      });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to change queue status.'); return; }
      await loadBranches(organizationId);
    } catch {
      setMessage('Error toggling queue status.');
    }
  }

  if (state === 'loading') {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64 mb-8" />
        <Skeleton className="h-[200px] w-full rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-[100px] w-full rounded-xl" />
          <Skeleton className="h-[100px] w-full rounded-xl" />
        </div>
      </div>
    );
  }
  
  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to manage branches." />
      </div>
    );
  }
  
  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Error Loading Branches" message="Unable to load branch data." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <nav className="flex items-center gap-2 text-sm font-medium text-slate-500 overflow-x-auto pb-2 scrollbar-hide">
        <Link href="/dashboard" className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-indigo-50 whitespace-nowrap">
          <LayoutDashboard className="w-4 h-4" /> Dashboard
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
        <Link href="/dashboard/organization" className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-indigo-50 whitespace-nowrap">
          <Building className="w-4 h-4" /> Organization Settings
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
        <span className="text-slate-900 font-semibold px-2 py-1 whitespace-nowrap flex items-center gap-1.5">
          <GitBranch className="w-4 h-4 text-indigo-600" /> Manage Branches
        </span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Manage Branches</h1>
          <p className="mt-1 text-slate-500">Add, edit, and manage your organization&apos;s physical branches.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Form Column */}
        <div className="lg:col-span-4 lg:order-2 space-y-6">
          <Card className="border-slate-200/60 shadow-sm rounded-xl overflow-hidden sticky top-8">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 pt-6">
              <CardTitle className="text-lg text-slate-800 flex items-center gap-2">
                {editingId ? <><Edit2 className="w-5 h-5 text-indigo-600" /> Edit Branch</> : <><Plus className="w-5 h-5 text-indigo-600" /> Add New Branch</>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={saveBranch} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Branch Name <span className="text-rose-500">*</span></label>
                  <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Downtown Clinic" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Branch Code</label>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DTC-01" />
                </div>
                
                <div className="pt-2">
                  <Button type="submit" disabled={isSaving} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                    {editingId ? <><Save className="w-4 h-4 mr-2" /> Update Branch</> : <><Plus className="w-4 h-4 mr-2" /> Add Branch</>}
                  </Button>
                </div>
                
                {message && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${message.includes('successfully') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
                    {message}
                  </div>
                )}

                {editingId && (
                  <Button type="button" variant="outline" className="w-full mt-2" onClick={() => { setEditingId(null); setName(''); setCode(''); setMessage(''); }}>
                    Cancel Editing
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {/* List Column */}
        <div className="lg:col-span-8 lg:order-1 space-y-4">
          {branches.length === 0 ? (
            <Card className="border-slate-200/60 shadow-sm border-dashed">
              <CardContent className="p-12">
                <EmptyState 
                  title="No branches found" 
                  description="You haven't added any branches to your organization yet." 
                  icon={<MapPin className="w-12 h-12 text-slate-300" />} 
                />
              </CardContent>
            </Card>
          ) : (
            branches.map((branch) => (
              <Card key={branch.id} className="border-slate-200/60 shadow-sm hover:shadow-md transition-shadow rounded-xl overflow-hidden group">
                <CardContent className="p-0">
                  <div className="p-5 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${branch.status === 'ACTIVE' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                          {branch.name}
                          {branch.code && <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">{branch.code}</span>}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <Badge variant={branch.status === 'ACTIVE' ? 'success' : 'neutral'} className="text-xs">
                            {branch.status}
                          </Badge>
                          <Badge variant={branch.queueStatus === 'OPEN' ? 'info' : 'warning'} className="text-xs">
                            Queue: {branch.queueStatus}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button variant="outline" size="sm" onClick={() => { setEditingId(branch.id); setName(branch.name); setCode(branch.code ?? ''); setMessage(''); }} className="text-slate-600 hover:text-indigo-600">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void toggleBranch(branch)} className={branch.status === 'ACTIVE' ? 'text-slate-600 hover:text-amber-600' : 'text-slate-600 hover:text-emerald-600'} title={branch.status === 'ACTIVE' ? 'Deactivate Branch' : 'Activate Branch'}>
                        {branch.status === 'ACTIVE' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void toggleQueueStatus(branch)} className={branch.queueStatus === 'OPEN' ? 'text-slate-600 hover:text-amber-600' : 'text-slate-600 hover:text-indigo-600'} title={branch.queueStatus === 'OPEN' ? 'Pause Queue' : 'Resume Queue'}>
                        {branch.queueStatus === 'OPEN' ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50/50 border-t border-slate-100 px-5 py-3 flex flex-wrap items-center gap-6">
                    <Link href={`/dashboard/organization/branches/${branch.id}/departments`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors">
                      <Building className="w-4 h-4" /> Departments
                    </Link>
                    <Link href={`/dashboard/organization/branches/${branch.id}/counters`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition-colors">
                      <MonitorSmartphone className="w-4 h-4" /> Counters
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}