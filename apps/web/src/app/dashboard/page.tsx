'use client';
import { useEffect, useState, useRef } from 'react';
import { fetchWithAuth } from '../../lib/auth-client';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { 
  Ticket, 
  Users, 
  CheckCircle2, 
  Clock, 
  Building2, 
  UserPlus, 
  Monitor, 
  Stethoscope,
  ChevronRight
} from 'lucide-react';
import Link from 'next/link';

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
    <div className="space-y-8 pb-8">
      {/* Welcome header */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white overflow-hidden relative rounded-2xl">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-96 h-96 bg-indigo-500 opacity-10 rounded-full blur-3xl mix-blend-screen pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-80 h-80 bg-blue-500 opacity-10 rounded-full blur-3xl mix-blend-screen pointer-events-none"></div>
        
        <CardContent className="p-8 sm:p-12 relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          {state === 'loading' ? (
            <div className="space-y-4 w-full">
              <Skeleton className="h-10 w-64 bg-white/10 rounded-lg" />
              <Skeleton className="h-5 w-96 bg-white/10 rounded-lg" />
            </div>
          ) : (
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                {greeting}, <span className="text-indigo-300">{user?.displayName?.split(' ')[0] || 'there'}</span>
              </h1>
              <p className="text-indigo-100/80 font-medium text-lg max-w-2xl">
                Here&apos;s an overview of your queue operations today.
              </p>
            </div>
          )}
          {state === 'ready' && (
            <div className="hidden sm:flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 border border-white/20 shadow-inner backdrop-blur-sm">
              <span className="text-2xl font-bold text-white">
                 {user?.displayName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          { label: 'Active Tokens', value: '—', icon: Ticket, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100' },
          { label: 'In Queue', value: '—', icon: Users, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
          { label: 'Served Today', value: '—', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
          { label: 'Avg Wait', value: '—', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
        ].map((stat, i) => (
          <Card key={i} className="hover:shadow-lg hover:-translate-y-1 transition-all duration-300 border-slate-200/60 rounded-xl overflow-hidden group">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${stat.bg} ${stat.color} ${stat.border} group-hover:scale-110 transition-transform duration-300`}>
                  <stat.icon className="w-6 h-6 stroke-[2.5px]" />
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-slate-900 tracking-tight">{stat.value}</div>
                <div className="text-sm font-semibold text-slate-500 mt-1">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        {/* Quick actions */}
        <Card className="lg:col-span-7 border-slate-200/60 rounded-xl shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4 pt-5 px-6">
            <CardTitle className="text-lg font-bold text-slate-800">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link href="/dashboard/reception" className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Stethoscope className="w-5 h-5" />
                  </div>
                  <div className="font-semibold text-slate-700 group-hover:text-indigo-700 transition-colors">Open Reception</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
              </Link>
              <Link href="/dashboard/counter" className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Monitor className="w-5 h-5" />
                  </div>
                  <div className="font-semibold text-slate-700 group-hover:text-indigo-700 transition-colors">Counter View</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
              </Link>
              <Link href="/dashboard/patients" className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div className="font-semibold text-slate-700 group-hover:text-indigo-700 transition-colors">Manage Patients</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
              </Link>
              <Link href="/dashboard/tokens" className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <Ticket className="w-5 h-5" />
                  </div>
                  <div className="font-semibold text-slate-700 group-hover:text-indigo-700 transition-colors">View Tokens</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* User / Org info */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border-slate-200/60 rounded-xl shadow-sm h-full flex flex-col">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4 pt-5 px-6 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-bold text-slate-800">Your Organizations</CardTitle>
              <Link href="/dashboard/organization" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
                Manage Organization &rarr;
              </Link>
            </CardHeader>
            <CardContent className="p-6 flex-1">
              {state === 'loading' ? (
                <div className="space-y-4">
                  <Skeleton className="h-16 w-full rounded-xl bg-slate-100" />
                  <Skeleton className="h-16 w-full rounded-xl bg-slate-100" />
                </div>
              ) : (
                <div className="space-y-4">
                  {user?.memberships?.length === 0 ? (
                    <div className="text-center p-6 text-slate-500">
                      You are not part of any organization yet.
                    </div>
                  ) : (
                    user?.memberships?.map((m: Membership) => (
                      <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-200 transition-colors">
                        <div className="w-12 h-12 rounded-lg bg-white shadow-sm text-slate-700 flex items-center justify-center border border-slate-100">
                          <Building2 className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 truncate">{m.organization.name}</div>
                          <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mt-0.5">{m.role.replace(/_/g, ' ')}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
