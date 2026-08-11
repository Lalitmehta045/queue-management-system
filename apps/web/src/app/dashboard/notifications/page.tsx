'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithAuth } from '../../../lib/auth-client';

type Membership = { organization: { id: string }; branchId: string | null; role: string };
type User = { memberships: Membership[] };
type Branch = { id: string; name: string; code: string | null };
type Settings = {
  branchId: string;
  announcementEnabled: boolean;
  soundEnabled: boolean;
  language: string;
  speechRate: number;
  announcementVolume: number;
  announcementTemplate: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
};
type NotificationRecord = {
  id: string;
  channel: 'SMS' | 'WHATSAPP';
  eventType: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  provider: string;
  attempts: number;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
  token: { displayNumber: string };
};
type NotificationList = { data: NotificationRecord[]; meta: { total: number; page: number; limit: number; totalPages: number } };

const LANGUAGE_LABELS: Record<string, string> = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'hi-IN': 'हिन्दी',
  'mr-IN': 'मराठी',
  'ta-IN': 'தமிழ்',
  'te-IN': 'తెలుగు',
  'kn-IN': 'ಕನ್ನಡ',
  'bn-IN': 'বাংলা',
  'gu-IN': 'ગુજરાતી',
  'pa-IN': 'ਪੰਜਾਬੀ',
  'ml-IN': 'മലയാളം',
};

export default function NotificationsDashboardPage() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<NotificationList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function loadContext() {
      const meResponse = await fetchWithAuth('/api/auth/me');
      if (meResponse.status === 401) { router.push('/login'); return; }
      if (!meResponse.ok) { setState('error'); return; }
      const user = await meResponse.json() as User;
      const membership = user.memberships[0];
      if (!membership) { setState('error'); return; }
      setOrganizationId(membership.organization.id);
      if (membership.branchId) {
        setBranches([{ id: membership.branchId, name: 'Assigned branch', code: null }]);
        setBranchId(membership.branchId);
        return;
      }
      const branchResponse = await fetchWithAuth('/api/organizations/current/branches?page=1&limit=100', { headers: { 'x-organization-id': membership.organization.id } });
      if (branchResponse.status === 403) { setState('forbidden'); return; }
      if (!branchResponse.ok) { setState('error'); return; }
      const branchList = await branchResponse.json() as { data: Branch[] };
      setBranches(branchList.data);
      setBranchId(branchList.data[0]?.id ?? '');
    }
    void loadContext().catch(() => setState('error'));
  }, [router]);

  useEffect(() => {
    if (!organizationId || !branchId) return;
    async function loadData() {
      const headers = { 'x-organization-id': organizationId };
      const [settingsResponse, historyResponse] = await Promise.all([
        fetchWithAuth(`/api/branches/${branchId}/notification-settings`, { headers }),
        fetchWithAuth(`/api/branches/${branchId}/notifications?page=${page}&limit=20`, { headers }),
      ]);
      if (settingsResponse.status === 401 || historyResponse.status === 401) { router.push('/login'); return; }
      if (settingsResponse.status === 403 || historyResponse.status === 403) { setState('forbidden'); return; }
      if (!settingsResponse.ok || !historyResponse.ok) { setState('error'); return; }
      setSettings(await settingsResponse.json() as Settings);
      setHistory(await historyResponse.json() as NotificationList);
      setState('ready');
    }
    void loadData().catch(() => setState('error'));
  }, [branchId, organizationId, page, router]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const response = await fetchWithAuth(`/api/branches/${branchId}/notification-settings`, {
        method: 'PATCH',
        headers: { 'x-organization-id': organizationId },
        body: JSON.stringify({
          announcementEnabled: settings.announcementEnabled,
          soundEnabled: settings.soundEnabled,
          language: settings.language,
          speechRate: settings.speechRate,
          announcementVolume: settings.announcementVolume,
          announcementTemplate: settings.announcementTemplate,
          smsEnabled: settings.smsEnabled,
          whatsappEnabled: settings.whatsappEnabled,
        }),
      });
      if (response.status === 403) { setState('forbidden'); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
        setMessage(Array.isArray(body?.message) ? body!.message[0] ?? 'Unable to save settings.' : body?.message ?? 'Unable to save settings.');
        return;
      }
      setSettings(await response.json() as Settings);
      setMessage('Settings saved.');
    } finally {
      setSaving(false);
    }
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  if (state === 'loading') return <main className="page-shell"><p>Loading notification settings...</p></main>;
  if (state === 'forbidden') return <main className="page-shell"><p className="error-text">You do not have permission to manage notifications in this branch.</p></main>;
  if (state === 'error') return <main className="page-shell"><p className="error-text">Unable to load notification management.</p></main>;
  if (!settings) return <main className="page-shell"><p>Loading...</p></main>;

  return (
    <main className="page-shell">
      <nav className="top-nav"><a href="/dashboard">Dashboard</a><a href="/dashboard/tokens">Tokens</a><a href="/dashboard/counter">Counter</a></nav>
      <section className="content-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Phase 7 · Customer notifications</p><h1>Notifications</h1><p className="muted">Branch announcement and delivery settings. SMS/WhatsApp delivery stays disabled until a real provider is configured.</p></div>
          {branches.length > 1 && <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.code ? ` (${branch.code})` : ''}</option>)}</select></label>}
        </div>

        <div className="notifications-grid">
          <section className="settings-panel">
            <h2>Announcement & delivery settings</h2>
            {message && <p className={message === 'Settings saved.' ? 'success-text' : 'error-text'} role="status">{message}</p>}
            <div className="settings-fields">
              <label className="toggle-row"><input type="checkbox" checked={settings.announcementEnabled} onChange={(event) => updateSetting('announcementEnabled', event.target.checked)} />Announcements enabled</label>
              <label className="toggle-row"><input type="checkbox" checked={settings.soundEnabled} onChange={(event) => updateSetting('soundEnabled', event.target.checked)} />Sound enabled</label>
              <label className="toggle-row"><input type="checkbox" checked={settings.smsEnabled} onChange={(event) => updateSetting('smsEnabled', event.target.checked)} />SMS notifications enabled</label>
              <label className="toggle-row"><input type="checkbox" checked={settings.whatsappEnabled} onChange={(event) => updateSetting('whatsappEnabled', event.target.checked)} />WhatsApp notifications enabled</label>
              <label>Announcement language<select value={settings.language} onChange={(event) => updateSetting('language', event.target.value)}>{Object.entries(LANGUAGE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
              <label>Speech rate: {settings.speechRate.toFixed(1)}x<input type="range" min={0.5} max={2} step={0.1} value={settings.speechRate} onChange={(event) => updateSetting('speechRate', Number(event.target.value))} /></label>
              <label>Announcement volume: {Math.round(settings.announcementVolume * 100)}%<input type="range" min={0} max={1} step={0.05} value={settings.announcementVolume} onChange={(event) => updateSetting('announcementVolume', Number(event.target.value))} /></label>
              <label>Announcement template<textarea rows={3} value={settings.announcementTemplate} onChange={(event) => updateSetting('announcementTemplate', event.target.value)} /> <small className="muted">Allowed variables: {`{token}`}, {`{counter}`}, {`{service}`}.</small></label>
            </div>
            <button type="button" onClick={() => void saveSettings()} disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
          </section>

          <section className="history-panel">
            <div className="display-section-heading"><h2>Notification history</h2><span>{history?.meta.total ?? 0}</span></div>
            {!history?.data.length ? <p className="muted empty-state">No notifications have been sent yet. Generate or call a token to see history here.</p> : (
              <div className="notification-table">
                <div className="notification-row notification-head"><span>Token</span><span>Event</span><span>Channel</span><span>Status</span><span>Provider</span><span>Attempts</span><span>Created</span></div>
                {history.data.map((record) => (
                  <div className="notification-row" key={record.id}>
                    <strong>{record.token.displayNumber}</strong>
                    <span>{record.eventType}</span>
                    <span>{record.channel}</span>
                    <span className={`status status-${record.status.toLowerCase()}`}>{record.status}</span>
                    <span>{record.provider}</span>
                    <span>{record.attempts}</span>
                    <span className="muted">{new Date(record.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            {history && history.meta.totalPages > 1 && (
              <div className="pagination">
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page} of {history.meta.totalPages}</span>
                <button type="button" disabled={page >= history.meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
