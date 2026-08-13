'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/Card';
import { EmptyState } from '../../../../components/ui/EmptyState';
import { ErrorState } from '../../../../components/ui/ErrorState';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Skeleton, TableSkeleton } from '../../../../components/ui/Skeleton';
import { fetchWithAuth } from '../../../../lib/auth-client';
import { LayoutDashboard, Building, Users, ChevronRight, UserPlus, Key, Edit2, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

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
  const [passwordModalMember, setPasswordModalMember] = useState<TeamMember | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

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

  const passwordMinLength = 8;
  const passwordValid = newPassword.length >= passwordMinLength;
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSubmitPassword = passwordValid && passwordsMatch && !passwordSubmitting;

  function openPasswordModal(member: TeamMember) {
    setPasswordModalMember(member);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordMessage('');
    setPasswordError('');
  }

  function closePasswordModal() {
    setPasswordModalMember(null);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordMessage('');
    setPasswordError('');
  }

  async function submitPasswordUpdate() {
    if (!passwordModalMember || !canSubmitPassword) return;
    setPasswordSubmitting(true);
    setPasswordError('');
    setPasswordMessage('');
    try {
      const response = await fetchWithAuth(
        `/api/organizations/current/team-members/${passwordModalMember.id}/password`,
        {
          method: 'PATCH',
          headers: { 'x-organization-id': organizationId },
          body: JSON.stringify({ newPassword }),
        },
      );
      if (response.status === 403) { setPasswordError('You do not have permission to update this password.'); return; }
      if (response.status === 404) { setPasswordError('Team member not found.'); return; }
      if (!response.ok) { setPasswordError('Unable to update password.'); return; }
      setPasswordMessage('Password updated successfully.');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setPasswordSubmitting(false);
    }
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
    <>
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
          <Users className="w-4 h-4 text-indigo-600" /> Team Members
        </span>
      </nav>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Team Members</h1>
            <p className="mt-1 text-slate-500">Manage staff accounts, roles, branches and counter assignments.</p>
          </div>
          <Button type="button" onClick={startCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
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
                            <Button type="button" size="sm" variant="outline" onClick={() => startEdit(member)} className="text-slate-600 hover:text-indigo-600" title="Edit">
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openPasswordModal(member)} className="text-slate-600 hover:text-indigo-600" title="Update Password">
                              <Key className="w-4 h-4" />
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => void toggleStatus(member)} className={member.status === 'ACTIVE' ? 'text-slate-600 hover:text-amber-600' : 'text-slate-600 hover:text-emerald-600'} title={member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}>
                              {member.status === 'ACTIVE' ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
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

      {passwordModalMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h3 className="text-lg font-semibold text-slate-900">Update Password</h3>
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="mb-4 text-sm text-slate-600">
                Set a new password for <span className="font-semibold text-slate-900">{passwordModalMember.displayName}</span>
              </p>

              {passwordMessage && (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  {passwordMessage}
                </div>
              )}
              {passwordError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {passwordError}
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); void submitPasswordUpdate(); }} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm transition-colors hover:border-slate-300 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:ring-offset-1"
                      placeholder="Minimum 8 characters"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {newPassword.length > 0 && !passwordValid && (
                    <p className="mt-1.5 text-xs text-red-600">Password must be at least {passwordMinLength} characters</p>
                  )}
                  {passwordValid && (
                    <p className="mt-1.5 text-xs text-emerald-600">Password strength: Good</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">Confirm Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm transition-colors hover:border-slate-300 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:ring-offset-1"
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                          <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <p className="mt-1.5 text-xs text-red-600">Passwords do not match</p>
                  )}
                  {passwordsMatch && (
                    <p className="mt-1.5 text-xs text-emerald-600">Passwords match</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={closePasswordModal}>Cancel</Button>
                  <Button type="submit" disabled={!canSubmitPassword} isLoading={passwordSubmitting}>
                    Update Password
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      </>
  );
}
