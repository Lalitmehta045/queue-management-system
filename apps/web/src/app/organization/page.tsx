'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../lib/auth-client';

type Organization = { id: string; name: string; slug: string; status: string; timezone: string };
type Membership = { organization: Organization; role: string; status: string };
type User = { memberships: Membership[] };

export default function OrganizationPage() {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function load() {
      const me = await fetchWithAuth('/api/auth/me');
      if (me.status === 401) { router.push('/login'); return; }
      if (!me.ok) { setState('error'); return; }
      const user = await me.json() as User;
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      const headers = { 'x-organization-id': membership.organization.id };
      const response = await fetchWithAuth('/api/organizations/current', { headers });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setState('error'); return; }
      const current = await response.json() as Organization;
      setOrganization(current);
      setName(current.name);
      setSlug(current.slug);
      setTimezone(current.timezone || 'UTC');
      setRole(membership.role);
      setState('ready');
    }
    void load().catch(() => setState('error'));
  }, [router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    const response = await fetchWithAuth('/api/organizations/current', {
      method: 'PATCH',
      headers: { 'x-organization-id': organization.id },
      body: JSON.stringify({ name, slug, timezone }),
    });
    if (response.status === 403) { setState('forbidden'); return; }
    setMessage(response.ok ? 'Organization updated.' : 'Unable to update organization.');
    if (response.ok) setOrganization(await response.json() as Organization);
  }

  if (state === 'loading') return <main className="page-shell">Loading organization...</main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage this organization.</p></main>;
  if (state === 'error' || !organization) return <main className="page-shell"><p className="error-text">Unable to load organization.</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/organization/branches">Branches</a><a href="/organization/team-members">Team Members</a></nav>
      <section className="content-panel">
        <p className="eyebrow">Organization settings</p>
        <h1>{organization.name}</h1>
        <p className="muted">Status: {organization.status} · Role: {role}</p>
        <form onSubmit={save} className="form-stack">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Slug<input value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
          <label>Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="UTC" /></label>
          <button type="submit">Save changes</button>
          {message && <p className="success-text">{message}</p>}
        </form>
        <button type="button" className="link-button" onClick={() => router.push('/organization/branches')}>Manage branches</button>
        <button type="button" className="link-button" onClick={() => router.push('/organization/team-members')} style={{ marginLeft: '1rem' }}>Manage team members</button>
        <button type="button" className="link-button" onClick={() => router.push('/organization/subscription')} style={{ marginLeft: '1rem' }}>View Subscription</button>
      </section>
    </main>
  );
}
