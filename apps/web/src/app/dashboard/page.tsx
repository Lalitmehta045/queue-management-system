'use client';
import { useEffect, useState, useRef } from 'react';
import { fetchWithAuth } from '../../lib/auth-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';

interface Membership {
  id: string;
  role: string;
  organization: { name: string };
}

interface User {
  displayName: string;
  email: string;
  memberships: Membership[];
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetchWithAuth('/api/auth/me');
        if (!res.ok) {
          if (isMounted.current) setState('error');
          return;
        }
        const data = await res.json();
        if (isMounted.current) {
          setUser(data);
          setState('ready');
        }
      } catch {
        if (isMounted.current) setState('error');
      }
    }
    void loadUser();
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  if (state === 'error') {
    return (
      <div className="max-w-3xl mx-auto mt-8">
        <ErrorState title="Failed to load" message="Unable to load dashboard overview." onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <Card className="border-none shadow-sm bg-gradient-to-br from-teal-500 to-emerald-700 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-1/4 w-32 h-32 bg-teal-300 opacity-10 rounded-full blur-2xl"></div>
        
        <CardContent className="p-8 sm:p-10 relative z-10">
          {state === 'loading' ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-64 bg-white/20" />
              <Skeleton className="h-5 w-96 bg-white/20" />
            </div>
          ) : (
            <div>
              <h1 className="text-3xl font-black tracking-tight mb-2">
                {greeting}, {user?.displayName?.split(' ')[0] || 'there'} 👋
              </h1>
              <p className="text-teal-50 font-medium text-lg max-w-2xl">
                Here&apos;s what&apos;s happening with your queue management today.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Tokens', value: '—', icon: '🎫', color: 'text-teal-600', bg: 'bg-teal-50' },
          { label: 'In Queue', value: '—', icon: '👥', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Served Today', value: '—', icon: '✅', color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Avg Wait', value: '—', icon: '⏱️', color: 'text-amber-600', bg: 'bg-amber-50' },
        ].map((stat, i) => (
          <Card key={i} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${stat.bg}`}>
                {stat.icon}
              </div>
              <div>
                <div className={`text-2xl font-black ${stat.color}`}>{stat.value}</div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick actions */}
        <Card>
          <CardHeader className="bg-slate-50/50">
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a href="/dashboard/reception" className="flex items-center gap-3 p-4 rounded-xl bg-teal-50 border border-teal-100 hover:bg-teal-100 hover:border-teal-200 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🏥</div>
                <div className="font-semibold text-teal-900">Open Reception</div>
              </a>
              <a href="/dashboard/counter" className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100 hover:border-slate-200 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🖥️</div>
                <div className="font-semibold text-slate-700">Counter View</div>
              </a>
              <a href="/dashboard/patients" className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100 hover:border-slate-200 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-xl group-hover:scale-110 transition-transform">👥</div>
                <div className="font-semibold text-slate-700">Manage Patients</div>
              </a>
              <a href="/dashboard/tokens" className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100 hover:bg-slate-100 hover:border-slate-200 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-xl group-hover:scale-110 transition-transform">🎫</div>
                <div className="font-semibold text-slate-700">View Tokens</div>
              </a>
            </div>
          </CardContent>
        </Card>

        {/* User / Org info */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="bg-slate-50/50">
              <CardTitle>Your Organizations</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {state === 'loading' ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : (
                <div className="space-y-3">
                  {user?.memberships?.map((m: Membership) => (
                    <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 bg-white">
                      <div className="w-12 h-12 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-2xl border border-indigo-100">
                        🏢
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{m.organization.name}</div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-1">{m.role.replace(/_/g, ' ')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {state === 'loading' ? (
                <div className="p-6 flex items-center gap-4">
                  <Skeleton className="w-14 h-14 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                </div>
              ) : (
                <div className="p-6 flex flex-col sm:flex-row items-center gap-4 justify-between bg-slate-900 text-white">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-slate-700 text-slate-200 font-bold flex items-center justify-center text-xl shadow-inner border border-slate-600">
                      {user?.displayName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg leading-tight">{user?.displayName}</h3>
                      <p className="text-slate-400 text-sm mt-0.5">{user?.email}</p>
                    </div>
                  </div>
                  <a href="/organization" className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg transition-colors border border-slate-700 w-full sm:w-auto text-center mt-4 sm:mt-0">
                    Manage Profile
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
