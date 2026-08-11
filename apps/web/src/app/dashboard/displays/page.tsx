'use client';

import { FormEvent, useEffect, useState } from 'react';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; role: string };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Display = { id: string; branchId: string; publicId: string; name: string; active: boolean; publicPath: string };

export default function DisplaysPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [displays, setDisplays] = useState<Display[]>([]);
  const [name, setName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      const meResponse = await fetchWithAuth('/api/auth/me');
      if (!meResponse.ok) { setState(meResponse.status === 403 ? 'forbidden' : 'error'); return; }
      const user = await meResponse.json() as User;
      const organization = user.memberships[0]?.organization;
      if (!organization) { setState('error'); return; }
      setOrganizationId(organization.id);
      const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': organization.id } });
      if (branchResponse.status === 403) { setState('forbidden'); return; }
      if (!branchResponse.ok) { setState('error'); return; }
      const branchList = await branchResponse.json() as { data: Branch[] };
      setBranches(branchList.data);
      setBranchId(branchList.data[0]?.id ?? '');
    }
    void load().catch(() => setState('error'));
  }, []);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    void loadDisplays().catch(() => setState('error'));
    async function loadDisplays() {
      const response = await fetchWithAuth(`/api/branches/${branchId}/displays`, { headers: { 'x-organization-id': organizationId } });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      const result = await response.json() as Display[];
      setDisplays(result);
      setState(result.length ? 'ready' : 'empty');
    }
  }, [branchId, organizationId]);

  async function createDisplay(event: FormEvent) {
    event.preventDefault();
    const response = await fetchWithAuth(`/api/branches/${branchId}/displays`, { method: 'POST', headers: { 'x-organization-id': organizationId }, body: JSON.stringify({ name }) });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to create display.'); return; }
    setName(''); setMessage('Display created.');
    const result = await response.json() as Display;
    setDisplays((current) => [...current, { ...result, publicPath: `/display/${result.publicId}` }]);
    setState('ready');
  }

  async function toggleDisplay(display: Display) {
    const action = display.active ? 'deactivate' : 'activate';
    const response = await fetchWithAuth(`/api/branches/${branchId}/displays/${display.id}/${action}`, { method: 'POST', headers: { 'x-organization-id': organizationId } });
    if (response.status === 403) { setState('forbidden'); return; }
    if (!response.ok) { setMessage('Unable to change display status.'); return; }
    setDisplays((current) => current.map((item) => item.id === display.id ? { ...item, active: !display.active } : item));
  }

  if (state === 'loading') return <main className="page-shell">Loading displays...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage displays.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load displays.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization/branches">Branches</a></nav>
      <section className="content-panel">
        <p className="eyebrow">Public experience</p><h1>Displays</h1><p className="muted">Create read-only screens for a branch. Public URLs contain an opaque display identifier.</p>
        <label>Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}</select></label>
        <form onSubmit={createDisplay} className="form-stack"><label>Display name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Reception screen" /></label><button type="submit">Create display</button></form>
        {message && <p className="success-text">{message}</p>}
        {state === 'empty' ? <p className="muted empty-state">No displays have been configured for this branch.</p> : <div className="branch-list">{displays.map((display) => <article className="branch-row" key={display.id}><div><strong>{display.name}</strong><span className="muted">{display.active ? 'Active' : 'Inactive'} - {display.publicPath}</span></div><div className="row-actions"><a className="link-button" href={display.publicPath} target="_blank" rel="noreferrer">Open display</a><button type="button" onClick={() => void toggleDisplay(display)}>{display.active ? 'Deactivate' : 'Activate'}</button></div></article>)}</div>}
      </section>
    </main>
  );
}
