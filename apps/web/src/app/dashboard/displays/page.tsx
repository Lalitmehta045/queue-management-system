'use client';

import { FormEvent, useEffect, useState, useRef } from 'react';
import { fetchWithAuth } from '../../../lib/auth-client';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import { Select } from '../../../components/ui/Select';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';

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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'forbidden'>('loading');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const meResponse = await fetchWithAuth('/api/auth/me');
        if (!meResponse.ok) { if (isMounted.current) setState(meResponse.status === 403 ? 'forbidden' : 'error'); return; }
        
        const user = await meResponse.json() as User;
        const organization = user.memberships[0]?.organization;
        if (!organization) { if (isMounted.current) setState('error'); return; }
        
        if (isMounted.current) setOrganizationId(organization.id);
        
        const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': organization.id } });
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
    void load();
  }, []);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    
    async function loadDisplays() {
      if (isMounted.current) setState('loading');
      try {
        const response = await fetchWithAuth(`/api/branches/${branchId}/displays`, { headers: { 'x-organization-id': organizationId } });
        if (response.status === 403) { if (isMounted.current) setState('forbidden'); return; }
        if (!response.ok) { if (isMounted.current) setState('error'); return; }
        
        const result = await response.json() as Display[];
        if (isMounted.current) {
          setDisplays(result || []);
          setState(result && result.length ? 'ready' : 'empty');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    
    void loadDisplays();
  }, [branchId, organizationId]);

  async function createDisplay(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    setMessage('');
    
    try {
      let logoUrl: string | undefined;

      if (logoFile) {
        const formData = new FormData();
        formData.append('file', logoFile);
        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          const err = await uploadResponse.json();
          setMessage(err.error || 'Failed to upload logo.');
          setIsSubmitting(false);
          return;
        }

        const data = await uploadResponse.json();
        logoUrl = data.url;
      }

      const response = await fetchWithAuth(`/api/branches/${branchId}/displays`, { 
        method: 'POST', 
        headers: { 'x-organization-id': organizationId }, 
        body: JSON.stringify({ name, logoUrl }) 
      });
      
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to create display.'); return; }
      
      setName(''); 
      setLogoFile(null);
      setLogoPreview(null);
      setMessage('Display created successfully.');
      
      const result = await response.json() as Display;
      setDisplays((current) => [...current, { ...result, publicPath: `/display/${result.publicId}` }]);
      setState('ready');
    } catch {
      setMessage('A network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleDisplay(display: Display) {
    const action = display.active ? 'deactivate' : 'activate';
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/displays/${display.id}/${action}`, { 
        method: 'POST', 
        headers: { 'x-organization-id': organizationId } 
      });
      
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) { setMessage('Unable to change display status.'); return; }
      
      setDisplays((current) => current.map((item) => item.id === display.id ? { ...item, active: !display.active } : item));
    } catch {
      setMessage('A network error occurred.');
    }
  }

  if (state === 'forbidden') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Access Denied" message="You do not have permission to manage displays." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load displays." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Displays</h1>
          <p className="text-sm text-slate-500 mt-1">Manage public read-only TV screens for branches.</p>
        </div>
        {branches.length > 1 && (
          <div className="w-full sm:w-64">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((branch) => (
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="bg-slate-50/50">
              <CardTitle>Configured Displays</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {state === 'loading' ? (
                <div className="p-6 space-y-4">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : state === 'empty' ? (
                <div className="p-12">
                  <EmptyState 
                    title="No displays" 
                    description="No displays have been configured for this branch yet."
                  />
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {displays.map((display) => (
                    <div key={display.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 gap-4 hover:bg-slate-50 transition-colors overflow-hidden">
                      <div className="flex items-start gap-4 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center text-xl shrink-0 mt-1">
                          📺
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-lg flex items-center gap-2 flex-wrap">
                            <span className="truncate">{display.name}</span>
                            <Badge variant={display.active ? 'success' : 'neutral'} className="shrink-0">
                              {display.active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <div className="text-sm font-medium text-slate-500 mt-1 flex items-center gap-2">
                            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-mono break-all">
                              {display.publicPath}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 mt-2 sm:mt-0">
                        <a 
                          href={display.publicPath} 
                          target="_blank" 
                          rel="noreferrer"
                          className="px-4 py-2 text-sm font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors border border-teal-200"
                        >
                          Open Screen
                        </a>
                        <Button 
                          variant={display.active ? 'outline' : 'secondary'}
                          size="sm"
                          onClick={() => void toggleDisplay(display)}
                        >
                          {display.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Create Display</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void createDisplay(e)} className="space-y-4">
                <Input 
                  label="Display Name" 
                  required 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="e.g. Waiting Area TV" 
                />
                
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Logo <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  {logoPreview ? (
                    <div className="flex items-center gap-4 p-3 border rounded-lg bg-slate-50">
                      <div className="relative w-16 h-16 bg-white border rounded-md flex items-center justify-center overflow-hidden shrink-0">
                        <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{logoFile?.name}</p>
                        <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null); }} className="text-xs text-red-600 hover:text-red-700 font-medium mt-1">Remove</button>
                      </div>
                    </div>
                  ) : (
                    <input 
                      type="file" 
                      accept="image/png, image/jpeg, image/webp, image/svg+xml"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 2 * 1024 * 1024) {
                            setMessage('File size exceeds 2MB limit');
                            return;
                          }
                          setLogoFile(file);
                          setLogoPreview(URL.createObjectURL(file));
                          setMessage('');
                        }
                      }}
                      className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer border border-slate-200 rounded-md p-1"
                    />
                  )}
                  <p className="text-xs text-slate-500">Supported formats: PNG, JPG, WebP, SVG. Max 2MB.</p>
                </div>
                <Button type="submit" className="w-full" isLoading={isSubmitting} disabled={!name.trim()}>
                  Create Display
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
