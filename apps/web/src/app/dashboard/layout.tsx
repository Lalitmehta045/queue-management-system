'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { fetchWithAuth } from '../../lib/auth-client';

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

const navSections = [
  {
    label: 'Main',
    items: [
      { href: '/dashboard', label: 'Overview', icon: '📊' },
      { href: '/dashboard/reception', label: 'Reception', icon: '🏥' },
      { href: '/dashboard/patients', label: 'Patients', icon: '👥' },
    ],
  },
  {
    label: 'Queue Operations',
    items: [
      { href: '/dashboard/queue-entries', label: 'Queue Entries', icon: '📋' },
      { href: '/dashboard/tokens', label: 'Tokens', icon: '🎫' },
      { href: '/dashboard/counter', label: 'Counter', icon: '🖥️' },
      { href: '/dashboard/appointments', label: 'Appointments', icon: '📅' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/organization', label: 'Organization', icon: '🏢' },
      { href: '/organization/branches', label: 'Branches', icon: '🏬' },
      { href: '/dashboard/displays', label: 'Displays', icon: '📺' },
      { href: '/dashboard/notifications', label: 'Notifications', icon: '🔔' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/dashboard/analytics', label: 'Analytics', icon: '📈' },
      { href: '/dashboard/audit-logs', label: 'Audit Logs', icon: '📝' },
      { href: '/organization/subscription', label: 'Subscription', icon: '💳' },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    fetchWithAuth('/api/auth/me')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Unauthorized');
      })
      .then((data) => {
        setUser(data);
        setLoading(false);
      })
      .catch(() => {
        router.push('/login');
      });
  }, [router]);

  const handleLogout = async () => {
    await fetchWithAuth('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="dash-loading">
        <div className="dash-loading-spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  const initials = user?.displayName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const orgName = user?.memberships?.[0]?.organization?.name || 'Organization';
  const role = user?.memberships?.[0]?.role?.replace(/_/g, ' ') || 'User';
  const isSuperAdmin = user?.memberships?.[0]?.role === 'SUPER_ADMIN';

  return (
    <div className="dash-shell">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="dash-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`dash-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      >
        {/* Brand */}
        <div className="dash-brand">
          <div className="dash-brand-icon">Q</div>
          {!sidebarCollapsed && (
            <div className="dash-brand-text">
              <span className="dash-brand-name">SmartQueue</span>
              <span className="dash-brand-sub">Management System</span>
            </div>
          )}
          <button
            className="dash-collapse-btn desktop-only"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
          <button
            className="dash-collapse-btn mobile-only"
            onClick={() => setMobileOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="dash-nav">
          {navSections.map((section) => (
            <div key={section.label} className="dash-nav-section">
              {!sidebarCollapsed && (
                <div className="dash-nav-label">{section.label}</div>
              )}
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`dash-nav-item ${isActive ? 'active' : ''}`}
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="dash-nav-icon">{item.icon}</span>
                    {!sidebarCollapsed && (
                      <span className="dash-nav-text">{item.label}</span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}

          {isSuperAdmin && (
            <div className="dash-nav-section">
              {!sidebarCollapsed && (
                <div className="dash-nav-label">Admin</div>
              )}
              <a
                href="/admin/subscriptions"
                className={`dash-nav-item ${pathname.startsWith('/admin') ? 'active' : ''}`}
                title={sidebarCollapsed ? 'SaaS Admin' : undefined}
              >
                <span className="dash-nav-icon">⚙️</span>
                {!sidebarCollapsed && (
                  <span className="dash-nav-text">SaaS Admin</span>
                )}
              </a>
            </div>
          )}
        </nav>

        {/* User card */}
        <div className="dash-user-card">
          <div className="dash-avatar">{initials}</div>
          {!sidebarCollapsed && (
            <div className="dash-user-info">
              <span className="dash-user-name">{user?.displayName}</span>
              <span className="dash-user-role">{role}</span>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={handleLogout}
              className="dash-logout-btn"
              title="Logout"
            >
              ↪
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="dash-main">
        {/* Top bar */}
        <header className="dash-topbar">
          <button
            className="dash-hamburger mobile-only"
            onClick={() => setMobileOpen(true)}
          >
            ☰
          </button>
          <div className="dash-topbar-org">
            <span className="dash-org-name">{orgName}</span>
          </div>
          <div className="dash-topbar-right">
            <div className="dash-topbar-user desktop-only">
              <span>{user?.displayName}</span>
              <div className="dash-topbar-avatar">{initials}</div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="dash-content">{children}</div>
      </div>
    </div>
  );
}
