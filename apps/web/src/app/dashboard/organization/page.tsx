'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Save, LayoutDashboard, Users, CreditCard, ChevronRight, MapPin, Building } from 'lucide-react';
import Link from 'next/link';

type Organization = { id: string; name: string; slug: string; status: string; timezone: string };
type Membership = { organization: Organization; role: string; status: string };
type User = { memberships: Membership[] };

export default function OrganizationPage() {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
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
        setState('ready');
      } catch {
        setState('error');
      }
    }
    void load();
  }, [router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organization) return;
    setIsSaving(true);
    setMessage('');
    try {
      const response = await fetchWithAuth('/api/organizations/current', {
        method: 'PATCH',
        headers: { 'x-organization-id': organization.id },
        body: JSON.stringify({ name, slug, timezone }),
      });
      if (response.status === 403) { setState('forbidden'); return; }
      setMessage(response.ok ? 'Organization updated successfully.' : 'Unable to update organization.');
      if (response.ok) setOrganization(await response.json() as Organization);
    } catch {
      setMessage('An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48 mb-8" />
        <Card>
          <CardContent className="p-8 space-y-6">
            <Skeleton className="h-8 w-64" />
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to manage this organization." />
      </div>
    );
  }
  if (state === 'error' || !organization) {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Error Loading Organization" message="Unable to load organization details." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-12 space-y-8">
      {/* Navigation */}
      <nav className="flex items-center gap-2 text-sm font-medium text-slate-500 overflow-x-auto pb-2 scrollbar-hide">
        <Link href="/dashboard" className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-indigo-50 whitespace-nowrap">
          <LayoutDashboard className="w-4 h-4" /> Dashboard
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
        <span className="text-slate-900 font-semibold px-2 py-1 whitespace-nowrap flex items-center gap-1.5">
          <Building className="w-4 h-4 text-indigo-600" /> Organization Settings
        </span>
      </nav>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Organization Settings</h1>
          <p className="mt-1 text-slate-500">Manage your organization&apos;s core details and preferences.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-200/60 shadow-sm rounded-xl overflow-hidden">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 pt-6">
              <CardTitle className="text-lg text-slate-800">Organization Settings</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={save} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Organization Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Corp" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">URL Slug</label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. acme-corp" />
                  <p className="text-xs text-slate-500">This will be used in your public facing URLs.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Timezone</label>
                  <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
                </div>
                
                <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                  <Button type="submit" disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                    <Save className="w-4 h-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Save changes'}
                  </Button>
                  
                  {message && (
                    <span className={`text-sm font-medium ${message.includes('successfully') ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {message}
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-slate-200/60 shadow-sm rounded-xl">
            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 pt-6">
              <CardTitle className="text-lg text-slate-800">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Link href="/dashboard/organization/branches" className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-700 group-hover:text-slate-900">Manage Branches</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
                </Link>
                
                <Link href="/dashboard/organization/team-members" className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Users className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-700 group-hover:text-slate-900">Team Members</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
                </Link>

                <Link href="/dashboard/organization/subscription" className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-700 group-hover:text-slate-900">Subscription</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
