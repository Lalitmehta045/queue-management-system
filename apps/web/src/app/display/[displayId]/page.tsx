'use client';

import { use, useEffect, useRef, useState } from 'react';
import type { PublicToken, DisplaySnapshot, DisplayPageState } from '../../../types/queue';
import {
  AnnouncementSpeaker,
  loadAnnouncementSettings,
  prefersReducedMotion,
  renderAnnouncementText,
  saveAnnouncementSettings,
  speechSupported,
  type AnnouncementSettings,
} from '../../../lib/announcements';

const displayEventTypes = ['QUEUE_UPDATED', 'TOKEN_CALLED', 'TOKEN_SERVED', 'TOKEN_RECALLED', 'TOKEN_SKIPPED', 'TOKEN_COMPLETED'] as const;

export default function PublicDisplayPage({ params }: { params: Promise<{ displayId: string }> }) {
  const { displayId } = use(params);
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [state, setState] = useState<DisplayPageState>('loading');
  const [lastToken, setLastToken] = useState('');
  const [announcementSettings, setAnnouncementSettings] = useState<AnnouncementSettings>(() => loadAnnouncementSettings());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  
  const snapshotRef = useRef<DisplaySnapshot | null>(null);
  const speakerRef = useRef<AnnouncementSpeaker | null>(null);
  const settingsRef = useRef<AnnouncementSettings>(announcementSettings);
  
  const supportsSpeech = speechSupported();

  // Respect prefers-reduced-motion: announcements stay disabled by default for
  // these users unless they explicitly enable them.
  useEffect(() => {
    if (
      prefersReducedMotion() &&
      typeof window !== 'undefined' &&
      !window.localStorage.getItem('queue-display-announcements:v1')
    ) {
      setAnnouncementSettings((current) => ({ ...current, enabled: false }));
    }
  }, []);

  useEffect(() => {
    settingsRef.current = announcementSettings;
  }, [announcementSettings]);

  useEffect(() => {
    if (!supportsSpeech) {
      setVoiceUnavailable(true);
      return;
    }
    const synth = window.speechSynthesis;
    const updateVoices = () => setVoices(synth.getVoices());
    updateVoices();
    synth.addEventListener('voiceschanged', updateVoices);
    if (!speakerRef.current) {
      speakerRef.current = new AnnouncementSpeaker(synth, () => settingsRef.current);
    }
    return () => {
      synth.removeEventListener('voiceschanged', updateVoices);
      speakerRef.current?.cancel();
      speakerRef.current = null;
    };
  }, [supportsSpeech]);

  useEffect(() => {
    if (!displayId) return;
    let cancelled = false;
    const source = new EventSource(`/api/public/displays/${encodeURIComponent(displayId)}/events`);
    
    const handleSnapshot = (eventType: (typeof displayEventTypes)[number]) => (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as DisplaySnapshot;
      if (cancelled) return;
      
      setSnapshot((previous) => {
        if (previous?.current?.tokenLabel !== next.current?.tokenLabel || previous?.current?.recallCount !== next.current?.recallCount) {
          setLastToken(next.current?.tokenLabel ?? '');
          window.setTimeout(() => setLastToken(''), 700);
        }
        snapshotRef.current = next;
        return next;
      });
      
      setState('ready');
      
      if ((eventType === 'TOKEN_CALLED' || eventType === 'TOKEN_RECALLED') && next.current) {
        const current = next.current;
        const settings = settingsRef.current;
        if (settings.enabled && speakerRef.current) {
          const eventKey = `${eventType}:${current.tokenLabel}:${current.calledAt ?? ''}:${current.recalled}:${current.recallCount}`;
          speakerRef.current.enqueue(eventKey, renderAnnouncementText(current));
        }
      }
    };
    
    const handlers = displayEventTypes.map((eventType) => ({ eventType, handler: handleSnapshot(eventType) }));
    for (const { eventType, handler } of handlers) {
      source.addEventListener(eventType, handler);
    }
    
    source.onopen = () => {
      if (!cancelled && snapshotRef.current) setState('ready');
    };
    
    source.onerror = () => {
      if (!cancelled) setState(snapshotRef.current ? 'reconnecting' : 'error');
    };

    return () => {
      cancelled = true;
      for (const { eventType, handler } of handlers) {
        source.removeEventListener(eventType, handler);
      }
      source.close();
    };
  }, [displayId]);

  useEffect(() => {
    if (snapshot || !displayId || state !== 'error') return;
    let cancelled = false;
    async function loadSnapshotFallback() {
      try {
        const response = await fetch(`/api/public/displays/${encodeURIComponent(displayId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = await response.json() as DisplaySnapshot;
        if (!cancelled) {
          snapshotRef.current = next;
          setSnapshot(next);
          setState('reconnecting');
        }
      } catch {
        return;
      }
    }
    void loadSnapshotFallback();
    return () => { cancelled = true; };
  }, [displayId, snapshot, state]);

  function updateSettings(patch: Partial<AnnouncementSettings>) {
    setAnnouncementSettings((current) => {
      const next = { ...current, ...patch };
      saveAnnouncementSettings(next);
      return next;
    });
  }

  function testAnnouncement() {
    if (!speakerRef.current) return;
    speakerRef.current.enqueue(`test:${Date.now()}`, 'This is a test announcement.');
  }

  if (state === 'loading') return <main className="public-display"><p className="display-status">Connecting...</p></main>;
  if (state === 'error') return <main className="public-display"><p className="display-status">Display unavailable</p></main>;
  if (!snapshot) return <main className="public-display"><p className="display-status">Connecting...</p></main>;

  const activeCounters = new Map<string, PublicToken>();
  if (snapshot.current) {
    activeCounters.set(snapshot.current.counter, snapshot.current);
  }
  for (const token of snapshot.recent) {
    if (!activeCounters.has(token.counter)) {
      activeCounters.set(token.counter, token);
    }
  }
  const countersList = Array.from(activeCounters.values());

  return (
    <main className="public-display">
      <header className="display-header">
        <div>
          <p className="display-kicker">SMART QUEUE</p>
          <h1>{snapshot.display.name}</h1>
          {state === 'reconnecting' && <p className="display-status">Reconnecting...</p>}
        </div>
        <div className="display-controls">
          {voiceUnavailable ? (
            <span className="display-control-note" title="Speech synthesis is not available in this browser">🔇 Voice unavailable</span>
          ) : (
            <>
              <button
                type="button"
                className={`display-control-btn ${announcementSettings.enabled ? 'is-on' : ''}`}
                onClick={() => updateSettings({ enabled: !announcementSettings.enabled })}
                title={announcementSettings.enabled ? 'Mute announcements' : 'Enable announcements'}
                aria-pressed={announcementSettings.enabled}
              >
                {announcementSettings.enabled ? '🔊 Announcements ON' : '🔇 Enable Announcements'}
              </button>
              <button type="button" className="display-control-btn" onClick={() => setShowSettings((current) => !current)} title="Announcement settings" aria-expanded={showSettings}>⚙️</button>
            </>
          )}
          {showSettings && !voiceUnavailable && (
            <div className="announcement-popover">
              <p className="display-kicker">ANNOUNCEMENT SETTINGS</p>
              <label>Voice<select value={announcementSettings.voiceURI} onChange={(event) => updateSettings({ voiceURI: event.target.value })}>
                <option value="">Default voice</option>
                {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.lang} · {voice.name}</option>)}
              </select></label>
              <label>Speech rate: {announcementSettings.rate.toFixed(1)}x<input type="range" min={0.5} max={2} step={0.1} value={announcementSettings.rate} onChange={(event) => updateSettings({ rate: Number(event.target.value) })} /></label>
              <label>Volume: {Math.round(announcementSettings.volume * 100)}%<input type="range" min={0} max={1} step={0.05} value={announcementSettings.volume} onChange={(event) => updateSettings({ volume: Number(event.target.value) })} /></label>
              <button type="button" className="display-control-btn" onClick={testAnnouncement}>Test announcement</button>
              <p className="display-control-hint">Announcements start after the first interaction with this screen so the browser permits audio.</p>
            </div>
          )}
        </div>
      </header>

      {countersList.length > 0 && (
        <div className="dsp-counter-grid">
          {countersList.map(token => (
            <div key={token.counter} className={`dsp-counter-cell ${token.tokenLabel === snapshot.current?.tokenLabel ? 'dsp-counter-active' : ''}`}>
              <div className="dsp-counter-label">{token.counter}</div>
              <div className="dsp-counter-token">{token.tokenLabel}</div>
            </div>
          ))}
        </div>
      )}

      <section className={`now-serving ${lastToken ? 'token-changed' : ''}`} aria-live="polite">
        <p className="display-kicker">NOW SERVING</p>
        {snapshot.current ? (
          <>
            <strong>{snapshot.current.tokenLabel}</strong>
            <span>{snapshot.current.counter}</span>
            <small>{snapshot.current.status}{snapshot.current.recalled ? ' - RECALLED' : ''}</small>
          </>
        ) : (
          <p className="no-current">No tokens currently being served</p>
        )}
      </section>

      <section className="display-section">
        <div className="display-section-heading">
          <h2>RECENTLY CALLED</h2>
          <span>{snapshot.recent.length}</span>
        </div>
        {snapshot.recent.length > 0 ? (
          <div className="recent-list">
            {snapshot.recent.map((token, idx) => (
              <div className="recent-item" key={`${token.tokenLabel}-${token.counter}-${idx}`}>
                <strong>{token.tokenLabel}</strong>
                <span>{token.counter}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="display-muted">No recent calls</p>
        )}
      </section>

      <section className="waiting-total">
        <p className="display-kicker">WAITING</p>
        <strong>{snapshot.waitingSummary.total}</strong>
        <span>TOKENS</span>
      </section>
    </main>
  );
}
