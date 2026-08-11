'use client';

import { useEffect, useRef, useState } from 'react';

type QueueStatusSnapshot = {
  tokenLabel: string;
  status: 'WAITING' | 'CALLED' | 'SERVING' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';
  serviceName: string;
  departmentName: string;
  businessDate: string;
  currentServingToken: string | null;
  peopleAhead: number | null;
  estimatedWaitMinutes: number | null;
  lastUpdated: string;
};

const STATUS_CONFIG: Record<QueueStatusSnapshot['status'], { label: string; emoji: string; color: string; bg: string; glow: string }> = {
  WAITING:   { label: 'Waiting',           emoji: '⏳', color: '#b45309', bg: 'rgba(251,191,36,0.15)',  glow: 'rgba(251,191,36,0.3)' },
  CALLED:    { label: 'Your Turn!',        emoji: '📣', color: '#1d4ed8', bg: 'rgba(59,130,246,0.15)',  glow: 'rgba(59,130,246,0.4)' },
  SERVING:   { label: 'Being Served',      emoji: '✅', color: '#065f46', bg: 'rgba(16,185,129,0.15)', glow: 'rgba(16,185,129,0.3)' },
  COMPLETED: { label: 'Completed',         emoji: '🎉', color: '#374151', bg: 'rgba(156,163,175,0.15)', glow: 'rgba(156,163,175,0.2)' },
  SKIPPED:   { label: 'Skipped',           emoji: '⏭️', color: '#991b1b', bg: 'rgba(239,68,68,0.15)',  glow: 'rgba(239,68,68,0.2)' },
  CANCELLED: { label: 'Cancelled',         emoji: '❌', color: '#991b1b', bg: 'rgba(239,68,68,0.15)',  glow: 'rgba(239,68,68,0.2)' },
};

export default function QueueStatusClient({ params }: { params: Promise<{ publicTokenId: string }> }) {
  const [publicTokenId, setPublicTokenId] = useState('');
  const [snapshot, setSnapshot] = useState<QueueStatusSnapshot | null>(null);
  const [connState, setConnState] = useState<'loading' | 'live' | 'reconnecting' | 'error'>('loading');
  const snapshotRef = useRef<QueueStatusSnapshot | null>(null);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  useEffect(() => {
    void params.then(({ publicTokenId: id }) => setPublicTokenId(id));
  }, [params]);

  // SSE subscription
  useEffect(() => {
    if (!publicTokenId) return;
    let cancelled = false;

    const source = new EventSource(`/api/public/queue/${encodeURIComponent(publicTokenId)}/events`);

    const handleSnapshot = (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as QueueStatusSnapshot;
      if (cancelled) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setLastEventTime(new Date());
      setConnState('live');
    };

    // Listen to all relevant event types from the SSE stream
    for (const eventType of ['QUEUE_UPDATED', 'TOKEN_CALLED', 'TOKEN_SERVED', 'TOKEN_RECALLED', 'TOKEN_SKIPPED', 'TOKEN_COMPLETED']) {
      source.addEventListener(eventType, handleSnapshot);
    }

    source.onopen = () => {
      if (!cancelled && snapshotRef.current) setConnState('live');
    };
    source.onerror = () => {
      if (!cancelled) setConnState(snapshotRef.current ? 'reconnecting' : 'error');
    };

    return () => {
      cancelled = true;
      for (const eventType of ['QUEUE_UPDATED', 'TOKEN_CALLED', 'TOKEN_SERVED', 'TOKEN_RECALLED', 'TOKEN_SKIPPED', 'TOKEN_COMPLETED']) {
        source.removeEventListener(eventType, handleSnapshot);
      }
      source.close();
    };
  }, [publicTokenId]);

  // Fallback HTTP poll if SSE fails and no snapshot yet
  useEffect(() => {
    if (snapshot || !publicTokenId || connState !== 'error') return;
    let cancelled = false;
    async function loadFallback() {
      try {
        const res = await fetch(`/api/public/queue/${encodeURIComponent(publicTokenId)}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const next = await res.json() as QueueStatusSnapshot;
        if (!cancelled) {
          snapshotRef.current = next;
          setSnapshot(next);
          setLastEventTime(new Date());
          setConnState('reconnecting');
        }
      } catch { /* silent */ }
    }
    void loadFallback();
    return () => { cancelled = true; };
  }, [publicTokenId, snapshot, connState]);

  if (connState === 'loading') {
    return (
      <main className="qs-page">
        <div className="qs-loading-ring" aria-label="Loading queue status">
          <div className="qs-ring-spin" />
          <p className="qs-loading-text">Loading queue status…</p>
        </div>
      </main>
    );
  }

  if (connState === 'error' && !snapshot) {
    return (
      <main className="qs-page">
        <div className="qs-error-card">
          <span className="qs-error-icon">🔍</span>
          <h1 className="qs-error-title">Token Not Found</h1>
          <p className="qs-error-body">Your queue status link may have expired or is invalid. Please check the QR code on your printed ticket.</p>
        </div>
      </main>
    );
  }

  if (!snapshot) return null;

  const statusCfg = STATUS_CONFIG[snapshot.status];

  return (
    <main className="qs-page" id="queue-status-main">
      {/* Connection banner */}
      <div className={`qs-conn-banner qs-conn-${connState}`} role="status" aria-live="polite">
        {connState === 'live' && <><span className="qs-conn-dot qs-dot-live" />Live</>}
        {connState === 'reconnecting' && <><span className="qs-conn-dot qs-dot-reconnecting" />Reconnecting…</>}
      </div>

      {/* Hero token card */}
      <div className="qs-hero-card" style={{ '--glow': statusCfg.glow } as React.CSSProperties}>
        <p className="qs-dept-label" aria-label="Department and service">
          {snapshot.departmentName} &middot; {snapshot.serviceName}
        </p>

        <div className="qs-token-number" aria-label={`Your token number is ${snapshot.tokenLabel}`}>
          {snapshot.tokenLabel}
        </div>

        <div className="qs-status-pill" style={{ background: statusCfg.bg, color: statusCfg.color }}>
          <span className="qs-status-emoji">{statusCfg.emoji}</span>
          {statusCfg.label}
        </div>

        <p className="qs-date-label">Date: {snapshot.businessDate}</p>
      </div>

      {/* Detail cards */}
      <div className="qs-cards-grid">

        {/* WAITING state */}
        {snapshot.status === 'WAITING' && (
          <>
            <div className="qs-detail-card">
              <span className="qs-card-icon">🪑</span>
              <p className="qs-card-label">Now Serving</p>
              <p className="qs-card-value">{snapshot.currentServingToken ?? '—'}</p>
            </div>
            <div className="qs-detail-card">
              <span className="qs-card-icon">👥</span>
              <p className="qs-card-label">People Ahead</p>
              <p className="qs-card-value">{snapshot.peopleAhead ?? 0}</p>
            </div>
            <div className="qs-detail-card">
              <span className="qs-card-icon">⏱️</span>
              <p className="qs-card-label">Estimated Wait</p>
              <p className="qs-card-value">
                {snapshot.estimatedWaitMinutes !== null
                  ? `~${snapshot.estimatedWaitMinutes} min`
                  : 'Unavailable'}
              </p>
            </div>
          </>
        )}

        {/* CALLED state */}
        {snapshot.status === 'CALLED' && (
          <>
            <div className="qs-detail-card qs-card-urgent">
              <span className="qs-card-icon">🚶</span>
              <p className="qs-card-label">Action Required</p>
              <p className="qs-card-value-sm">Please proceed to the counter now</p>
            </div>
            <div className="qs-detail-card">
              <span className="qs-card-icon">🪑</span>
              <p className="qs-card-label">Serving</p>
              <p className="qs-card-value">{snapshot.currentServingToken ?? snapshot.tokenLabel}</p>
            </div>
          </>
        )}

        {/* SERVING state */}
        {snapshot.status === 'SERVING' && (
          <div className="qs-detail-card qs-card-success">
            <span className="qs-card-icon">🩺</span>
            <p className="qs-card-label">Status</p>
            <p className="qs-card-value-sm">You are currently being served</p>
          </div>
        )}

        {/* COMPLETED state */}
        {snapshot.status === 'COMPLETED' && (
          <div className="qs-detail-card qs-card-completed">
            <span className="qs-card-icon">🎊</span>
            <p className="qs-card-label">Status</p>
            <p className="qs-card-value-sm">Your service is complete. Thank you!</p>
          </div>
        )}

        {/* SKIPPED / CANCELLED states */}
        {(snapshot.status === 'SKIPPED' || snapshot.status === 'CANCELLED') && (
          <div className="qs-detail-card qs-card-inactive">
            <span className="qs-card-icon">{snapshot.status === 'SKIPPED' ? '⏭️' : '❌'}</span>
            <p className="qs-card-label">{snapshot.status === 'SKIPPED' ? 'Skipped' : 'Cancelled'}</p>
            <p className="qs-card-value-sm">This token is no longer active. Please visit reception for assistance.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="qs-footer">
        <p>Last updated: {lastEventTime ? lastEventTime.toLocaleTimeString() : new Date(snapshot.lastUpdated).toLocaleTimeString()}</p>
        <p className="qs-footer-note">This page does not store or display any personal information.</p>
      </footer>
    </main>
  );
}
