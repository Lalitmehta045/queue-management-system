'use client';

import { FormEvent, useEffect, useState } from 'react';
import { fetchWithAuth } from '../../../lib/auth-client';

type Branch = { id: string; name: string; code: string | null; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; queueStatus: 'OPEN' | 'PAUSED' };
type Membership = { organization: { id: string }; role: string };
type User = { memberships: Membership[] };

export default function BranchesPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  async function loadBranches(id: string) {
    const response = await fetchWithAuth('/api/organizations/current/branches', { headers: { 'x-organization-id': id } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setState('error'); return; }
    const body = await response.json() as { data: Branch[] };
    setBranches(body.data);
    setState(body.data.length ? 'ready' : 'empty');
  }

  useEffect(() => {
    async function load() {
      const me = await fetchWithAuth('/api/auth/me');
      if (!me.ok) { setState(me.status === 403 ? 'forbidden' : 'error'); return; }
      const user = await me.json() as User;
      const id = user.memberships[0]?.organization.id;
      if (!id) { setState('error'); return; }
      setOrganizationId(id);
      await loadBranches(id);
    }
    void load().catch(() => setState('error'));
  }, []);

  async function saveBranch(event: FormEvent) {
    event.preventDefault();
    const path = editingId ? `/api/organizations/current/branches/${editingId}` : '/api/organizations/current/branches';
    const response = await fetchWithAuth(path, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'x-organization-id': organizationId },
      body: JSON.stringify({ name, code: code || undefined }),
    });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to save branch.'); return; }
    setName(''); setCode(''); setEditingId(null); setMessage('Branch saved.');
    await loadBranches(organizationId);
  }

  async function toggleBranch(branch: Branch) {
    const action = branch.status === 'ACTIVE' ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/organizations/current/branches/${branch.id}/${action}`, {
      method: 'POST', headers: { 'x-organization-id': organizationId },
    });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change branch status.'); return; }
    await loadBranches(organizationId);
  }

  async function toggleQueueStatus(branch: Branch) {
    const action = branch.queueStatus === 'PAUSED' ? 'queue-resume' : 'queue-pause';
    const response = await fetchWithAuth(`/api/organizations/current/branches/${branch.id}/${action}`, {
      method: 'POST', headers: { 'x-organization-id': organizationId },
    });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change queue status.'); return; }
    await loadBranches(organizationId);
  }

  if (state === 'loading') return <main className="page-shell">Loading branches...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage branches.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load branches.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization">Organization settings</a></nav>
      <section className="content-panel">
        <p className="eyebrow">Organization operations</p>
        <h1>Branches</h1>
        <form onSubmit={saveBranch} className="branch-form">
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Code<input value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button type="submit">{editingId ? 'Update branch' : 'Add branch'}</button>
        </form>
        {message && <p className="success-text">{message}</p>}
        {state === 'empty' ? <p className="muted">No branches have been created yet.</p> : <div className="branch-list">{branches.map((branch) => (
          <article className="branch-row" key={branch.id}>
            <div><strong>{branch.name}</strong><span className="muted">{branch.code || 'No code'} · {branch.status} · Queue: {branch.queueStatus}</span></div>
            <div className="row-actions"><a className="link-button" href={`/organization/branches/${branch.id}/departments`}>Departments</a><a className="link-button" href={`/organization/branches/${branch.id}/counters`}>Counters</a><button type="button" onClick={() => { setEditingId(branch.id); setName(branch.name); setCode(branch.code ?? ''); }}>Edit</button><button type="button" onClick={() => void toggleBranch(branch)}>{branch.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button><button type="button" onClick={() => void toggleQueueStatus(branch)}>{branch.queueStatus === 'PAUSED' ? 'Resume Queue' : 'Pause Queue'}</button></div>
          </article>
        ))}</div>}
      </section>
    </main>
  );
}