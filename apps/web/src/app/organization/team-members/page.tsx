'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Skeleton, TableSkeleton } from '../../../components/ui/Skeleton';
import { fetchWithAuth } from '../../../lib/auth-client';

type Role = 'BRANCH_ADMIN' | 'RECEPTIONIST' | 'COUNTER_OPERATOR' | 'DISPLAY_OPERATOR' | 'DOCTOR';
type Status = 'ACTIVE' | 'SUSPENDED' | 'INVITED' | 'REMOVED';
type Branch = { id: string; name: string; code: string | null; status: string };
type Counter = { id: string; branchId: string; name: string; code: string; status: 'ACTIVE' | 'INACTIVE' };
type TeamMember = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  status: Status;
  branchId: string | null;
  branch: Branch | null;
  counterAssignment: { id: string; counterId: string; counter: Counter } | null;
};
type Membership = { organization: { id: string }; role: string };
type User = { memberships: Membership[] };
type FormState = { displayName: string; email: string; role: Role; branchId: string; counterId: string };

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: 'COUNTER_OPERATOR', label: 'Counter Operator' },
  { value: 'RECEPTIONIST', label: 'Receptionist' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'DISPLAY_OPERATOR', label: 'Display Operator' },
  { value: 'DOCTOR', label: 'Doctor' },
];

const emptyForm: FormState = {
  displayName: '',
  email: '',
  role: 'COUNTER_OPERATOR',
  branchId: '',
  counterId: '',
};

function formatRole(role: string) {
  return role.toLowerCase().split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function statusVariant(status: Status) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  if (status === 'REMOVED') return 'danger';
  return 'neutral';
}

export default function TeamMembersPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const activeCounters = useMemo(() => counters.filter((counter) => counter.status === 'ACTIVE'), [counters]);

  const loadMembers = useCallback(async (id: string) => {
    const response = await fetchWithAuth('/api/organizations/current/team-members', { headers: { 'x-organization-id': id } });
    if (response.status === 401) { router.push('/login'); return; }
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setState('error'); return; }
    setMembers(await response.json() as TeamMember[]);
    setState('ready');
  }, [router]);

  useEffect(() => {
    async function load() {
      const meResponse = await fetchWithAuth('/api/auth/me');
      if (meResponse.status === 401) { router.push('/login'); return; }
      if (!meResponse.ok) { setState('error'); return; }
      const user = await meResponse.json() as User;
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      if (membership.role !== 'ORG_ADMIN') { setState('forbidden'); return; }

      const headers = { 'x-organization-id': membership.organization.id };
      const branchesResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers });
      if (branchesResponse.status === 403) { setState('forbidden'); return; }
      if (!branchesResponse.ok) { setState('error'); return; }

      const branchBody = await branchesResponse.json() as { data: Branch[] };
      setOrganizationId(membership.organization.id);
      setBranches(branchBody.data);
      setForm((current) => ({ ...current, branchId: branchBody.data[0]?.id ?? '' }));
      await loadMembers(membership.organization.id);
    }

    void load().catch(() => setState('error'));
  }, [loadMembers, router]);

  useEffect(() => {
    if (!organizationId || !form.branchId) {
      setCounters([]);
      return;
    }

    async function loadCounters() {
      const response = await fetchWithAuth(`/api/branches/${form.branchId}/counters?page=1&limit=100`, {
        headers: { 'x-organization-id': organizationId },
      });
      if (!response.ok) {
        setCounters([]);
        return;
      }
      const body = await response.json() as { data: Counter[] };
      setCounters(body.data);
    }

    void loadCounters();
  }, [form.branchId, organizationId]);

  function resetForm(branchId = branches[0]?.id ?? '') {
    setEditingMember(null);
    setForm({ ...emptyForm, branchId });
    setTemporaryPassword('');
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setMessage('');
  }

  function startEdit(member: TeamMember) {
    setEditingMember(member);
    setForm({
      displayName: member.displayName,
      email: member.email,
      role: member.role,
      branchId: member.branchId ?? '',
      counterId: member.counterAssignment?.counterId ?? '',
    });
    setTemporaryPassword('');
    setMessage('');
    setShowForm(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setTemporaryPassword('');

    const payload = {
      displayName: form.displayName,
      email: form.email,
      role: form.role,
      branchId: form.branchId,
      ...(form.role === 'COUNTER_OPERATOR' && form.counterId ? { counterId: form.counterId } : {}),
      ...(editingMember && form.role !== 'COUNTER_OPERATOR' ? { counterId: null } : {}),
      ...(editingMember && form.role === 'COUNTER_OPERATOR' && !form.counterId ? { counterId: null } : {}),
    };

    const path = editingMember
      ? `/api/organizations/current/team-members/${editingMember.id}`
      : '/api/organizations/current/team-members';

    try {
      const response = await fetchWithAuth(path, {
        method: editingMember ? 'PATCH' : 'POST',
        headers: { 'x-organization-id': organizationId },
        body: JSON.stringify(payload),
      });

      if (response.status === 403) { setState('forbidden'); return; }
      if (response.status === 409) { setMessage('A member with that email already exists.'); return; }
      if (!response.ok) { setMessage('Unable to save team member.'); return; }

      if (editingMember) {
        setMessage('Team member updated.');
      } else {
        const body = await response.json() as { temporaryPassword: string };
        setTemporaryPassword(body.temporaryPassword);
        setMessage('Team member created.');
      }
      await loadMembers(organizationId);
      if (editingMember) {
        resetForm(form.branchId);
        setShowForm(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(member: TeamMember) {
    const action = member.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/organizations/current/team-members/${member.id}/${action}`, {
      method: 'POST',
      headers: { 'x-organization-id': organizationId },
    });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage(`Unable to ${action} member.`); return; }
    setMessage(member.status === 'ACTIVE' ? 'Team member deactivated.' : 'Team member activated.');
    await loadMembers(organizationId);
  }

  if (state === 'forbidden') {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl">
          <ErrorState title="Access denied" message="You do not have permission to manage organization team members." />
        </div>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl">
          <ErrorState title="Failed to load" message="Unable to load team members." onRetry={() => window.location.reload()} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <nav className="flex flex-wrap gap-3 text-sm font-semibold text-slate-500">
          <a className="hover:text-slate-900" href="/dashboard">Dashboard</a>
          <span>/</span>
          <a className="hover:text-slate-900" href="/organization">Organization</a>
          <span>/</span>
          <span className="text-slate-900">Team Members</span>
        </nav>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Team Members</h1>
            <p className="mt-2 text-sm text-slate-500">Manage staff accounts, roles, branches and counter assignments.</p>
          </div>
          <Button type="button" onClick={startCreate}>
            <span className="mr-2 text-lg leading-none">+</span>
            Add Member
          </Button>
        </div>

        {message && (
          <div className="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-700">
            {message}
          </div>
        )}

        {temporaryPassword && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-amber-900">Temporary password</p>
              <p className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-sm text-slate-900">{temporaryPassword}</p>
              <p className="mt-2 text-xs font-medium text-amber-800">Share it through a secure channel. It will not be shown again.</p>
            </CardContent>
          </Card>
        )}

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingMember ? 'Edit Member' : 'Add Member'}</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { resetForm(); setShowForm(false); }}
              >
                Close
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void save(event)} className="grid grid-cols-1 gap-4 lg:grid-cols-6">
                <div className="lg:col-span-2">
                  <Input required label="Full Name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
                </div>
                <div className="lg:col-span-2">
                  <Input required type="email" label="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </div>
                <div className="lg:col-span-2">
                  <Select label="Role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role, counterId: event.target.value === 'COUNTER_OPERATOR' ? form.counterId : '' })}>
                    {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </Select>
                </div>
                <div className="lg:col-span-3">
                  <Select required label="Branch" value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value, counterId: '' })}>
                    <option value="">Select branch</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}
                  </Select>
                </div>
                {form.role === 'COUNTER_OPERATOR' && (
                  <div className="lg:col-span-3">
                    <Select label="Counter" value={form.counterId} onChange={(event) => setForm({ ...form, counterId: event.target.value })} disabled={!form.branchId}>
                      <option value="">No counter assigned</option>
                      {activeCounters.map((counter) => <option key={counter.id} value={counter.id}>{counter.name} ({counter.code})</option>)}
                    </Select>
                  </div>
                )}
                <div className="flex items-center gap-3 lg:col-span-6">
                  <Button type="submit" disabled={submitting || !form.branchId} isLoading={submitting}>
                    {editingMember ? 'Save Member' : 'Create Member'}
                  </Button>
                  {state === 'loading' && <Skeleton className="h-4 w-36" />}
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {state === 'loading' ? (
              <div className="p-6">
                <TableSkeleton rows={5} />
              </div>
            ) : members.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No team members yet"
                  description="Create staff accounts and assign them to branches before they start serving customers."
                  actionLabel="Add Member"
                  onAction={startCreate}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Email</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Branch</th>
                      <th className="px-6 py-3">Counter</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {members.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-semibold text-slate-900">{member.displayName}</td>
                        <td className="px-6 py-4 text-slate-600">{member.email}</td>
                        <td className="px-6 py-4 text-slate-700">{formatRole(member.role)}</td>
                        <td className="px-6 py-4 text-slate-700">{member.branch?.name ?? 'Unassigned'}</td>
                        <td className="px-6 py-4 text-slate-700">{member.counterAssignment?.counter.name ?? 'Unassigned'}</td>
                        <td className="px-6 py-4">
                          <Badge variant={statusVariant(member.status)}>{formatRole(member.status)}</Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(member)}>Edit</Button>
                            <Button type="button" size="sm" variant={member.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => void toggleStatus(member)}>
                              {member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
