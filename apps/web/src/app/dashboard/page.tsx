
'use client';
import { useEffect, useState } from 'react';
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

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetchWithAuth('/api/auth/me')
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then(data => {
        if (data) setUser(data);
      })
      .catch(() => {});
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="dash-page-overview">
      {/* Welcome header */}
      <div className="overview-welcome">
        <div>
          <h1 className="overview-greeting">
            {greeting}, {user?.displayName?.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="overview-subtitle">
            Here&apos;s what&apos;s happening with your queue management today.
          </p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="overview-stats">
        <div className="stat-card stat-teal">
          <div className="stat-icon">🎫</div>
          <div className="stat-data">
            <span className="stat-value">—</span>
            <span className="stat-label">Active Tokens</span>
          </div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-icon">👥</div>
          <div className="stat-data">
            <span className="stat-value">—</span>
            <span className="stat-label">In Queue</span>
          </div>
        </div>
        <div className="stat-card stat-purple">
          <div className="stat-icon">✅</div>
          <div className="stat-data">
            <span className="stat-value">—</span>
            <span className="stat-label">Served Today</span>
          </div>
        </div>
        <div className="stat-card stat-amber">
          <div className="stat-icon">⏱️</div>
          <div className="stat-data">
            <span className="stat-value">—</span>
            <span className="stat-label">Avg Wait</span>
          </div>
        </div>
      </div>

      {/* Quick actions + org info */}
      <div className="overview-grid">
        <div className="overview-card">
          <h2 className="overview-card-title">Quick Actions</h2>
          <div className="quick-actions">
            <a href="/dashboard/reception" className="quick-action-btn action-primary">
              <span>🏥</span> Open Reception
            </a>
            <a href="/dashboard/counter" className="quick-action-btn action-secondary">
              <span>🖥️</span> Counter View
            </a>
            <a href="/dashboard/patients" className="quick-action-btn action-secondary">
              <span>👥</span> Manage Patients
            </a>
            <a href="/dashboard/tokens" className="quick-action-btn action-secondary">
              <span>🎫</span> View Tokens
            </a>
          </div>
        </div>

        <div className="overview-card">
          <h2 className="overview-card-title">Your Organizations</h2>
          <div className="org-list">
            {user?.memberships?.map((m: Membership) => (
              <div key={m.id} className="org-item">
                <div className="org-icon">🏢</div>
                <div className="org-details">
                  <span className="org-name">{m.organization.name}</span>
                  <span className="org-role">{m.role.replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Profile card */}
      <div className="overview-card profile-card">
        <div className="profile-row">
          <div className="profile-avatar">
            {user?.displayName?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          <div className="profile-info">
            <h3>{user?.displayName}</h3>
            <p>{user?.email}</p>
          </div>
          <a href="/organization" className="profile-link">
            Manage Organization →
          </a>
        </div>
      </div>
    </div>
  );
}
