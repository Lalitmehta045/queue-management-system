'use client';

import { useEffect, useRef, useState } from 'react';
import type { DisplaySnapshot, DisplayPageState } from '../../../types/queue';
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

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function AutoScrollList({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [duration, setDuration] = useState(20);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && contentRef.current) {
        const overflow = contentRef.current.scrollHeight > containerRef.current.clientHeight;
        setIsOverflowing(overflow);
        if (overflow) {
          // Calculate duration based on height to maintain consistent speed
          setDuration(Math.max(contentRef.current.scrollHeight / 20, 10));
        }
      }
    };
    
    checkOverflow();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(checkOverflow);
    if (containerRef.current) observer.observe(containerRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    
    return () => observer.disconnect();
  }, [children]);

  return (
    <div 
      ref={containerRef} 
      className="w-full flex-1 min-h-0 overflow-hidden relative group"
      style={{
         maskImage: isOverflowing ? 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)' : 'none',
         WebkitMaskImage: isOverflowing ? 'linear-gradient(to bottom, transparent, black 5%, black 95%, transparent)' : 'none'
      }}
    >
      <div 
        className={isOverflowing ? 'animate-marquee-vertical group-hover:[animation-play-state:paused]' : ''}
        style={{
          '--marquee-duration': `${duration}s`
        } as React.CSSProperties}
      >
        <div ref={contentRef} className="w-full flex flex-col items-center gap-3 pb-3">
          {children}
        </div>
        
        {isOverflowing && (
          <div aria-hidden="true" className="w-full flex flex-col items-center gap-3 pb-3">
            {children}
          </div>
        )}
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes marquee-vertical {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        .animate-marquee-vertical {
          animation: marquee-vertical var(--marquee-duration) linear infinite;
        }
      `}} />
    </div>
  );
}

export default function PublicDisplayClient({
  displayId,
  initialSnapshot,
  initialError = false,
}: {
  displayId: string;
  initialSnapshot: DisplaySnapshot | null;
  initialError?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(initialSnapshot);
  const [state, setState] = useState<DisplayPageState>(() => {
    if (initialSnapshot) return 'ready';
    if (initialError) return 'error';
    return 'loading';
  });
  const [lastToken, setLastToken] = useState('');
  const [announcementSettings, setAnnouncementSettings] = useState<AnnouncementSettings>(() => loadAnnouncementSettings());
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  const snapshotRef = useRef<DisplaySnapshot | null>(initialSnapshot);
  const speakerRef = useRef<AnnouncementSpeaker | null>(null);
  const settingsRef = useRef<AnnouncementSettings>(announcementSettings);

  const supportsSpeech = speechSupported();

  useEffect(() => {
    setCurrentTime(new Date());
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      if (
        prefersReducedMotion() &&
        typeof window !== 'undefined' &&
        !window.localStorage.getItem('queue-display-announcements:v1')
      ) {
        setAnnouncementSettings((current) => ({ ...current, enabled: false }));
      }
    } catch {
      // Some TV browsers block storage APIs.
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
    if (!speakerRef.current) {
      speakerRef.current = new AnnouncementSpeaker(synth, () => settingsRef.current);
    }
    return () => {
      speakerRef.current?.cancel();
      speakerRef.current = null;
    };
  }, [supportsSpeech]);

  useEffect(() => {
    if (!displayId) return;
    let cancelled = false;
    let loadTimedOut = false;

    // If neither HTTP snapshot nor SSE delivers data, leave the skeleton.
    const loadTimeout = window.setTimeout(() => {
      if (cancelled || snapshotRef.current) return;
      loadTimedOut = true;
      setState('error');
    }, 8_000);

    // Fetch initial snapshot immediately via HTTP to bypass potential SSE buffering
    async function fetchInitial() {
      if (snapshotRef.current) {
        window.clearTimeout(loadTimeout);
        return;
      }
      try {
        const response = await fetch(`/api/public/displays/${encodeURIComponent(displayId)}`, { cache: 'no-store', signal: abortAfter(8_000) });
        if (!response.ok) {
          if (!cancelled && !snapshotRef.current) {
            window.clearTimeout(loadTimeout);
            setState('error');
          }
          return;
        }
        const next = await response.json() as DisplaySnapshot;
        if (!cancelled && !snapshotRef.current) {
          snapshotRef.current = next;
          setSnapshot(next);
          setState('ready');
          window.clearTimeout(loadTimeout);
        }
      } catch (e) {
        console.error('Failed to fetch initial snapshot', e);
        if (!cancelled && !snapshotRef.current) setState('error');
      }
    }
    void fetchInitial();

    let source: EventSource | null = null;
    try {
      if (typeof EventSource !== 'undefined') {
        source = new EventSource(`/api/public/displays/${encodeURIComponent(displayId)}/events`);
      }
    } catch (e) {
      console.error('EventSource unavailable', e);
    }
    if (!source) {
      return () => {
        cancelled = true;
        window.clearTimeout(loadTimeout);
      };
    }

    const handleSnapshot = (eventType: (typeof displayEventTypes)[number]) => (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as DisplaySnapshot;
      if (cancelled) return;

      setSnapshot((previous) => {
        if (previous?.current?.tokenLabel !== next.current?.tokenLabel || previous?.current?.recallCount !== next.current?.recallCount) {
          setLastToken(next.current?.tokenLabel ?? '');
          window.setTimeout(() => { if (!cancelled) setLastToken(''); }, 3000);
        }
        snapshotRef.current = next;
        return next;
      });

      setState('ready');
      window.clearTimeout(loadTimeout);

      if ((eventType === 'TOKEN_CALLED' || eventType === 'TOKEN_RECALLED') && next.current) {
        const current = next.current;
        const settings = settingsRef.current;
        if (settings.enabled && speakerRef.current) {
          const eventKey = `${eventType}:${current.tokenLabel}:${current.calledAt ?? ''}:${current.recalled}:${current.recallCount}`;
          speakerRef.current.enqueue(eventKey, renderAnnouncementText(current, settings.language));
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
      if (cancelled || !source) return;
      // EventSource fires error during reconnect attempts; only fail if we never got data
      // (or the initial load already timed out / HTTP failed).
      if (snapshotRef.current) {
        setState('reconnecting');
      } else if (loadTimedOut || source.readyState === EventSource.CLOSED) {
        setState('error');
      }
    };

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
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
        const response = await fetch(`/api/public/displays/${encodeURIComponent(displayId)}`, { cache: 'no-store', signal: abortAfter(8_000) });
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

  if (state === 'error' && !snapshot) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans gap-3 px-6 text-center">
        <p className="text-slate-500 text-2xl font-medium">Display unavailable</p>
        <p className="text-slate-400 text-sm max-w-md">
          Check that this display is Active in Dashboard → Displays, and that the TV is using the correct Open Screen link.
        </p>
      </div>
    );
  }

  if (state === 'loading' || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans p-6 overflow-hidden">
        <div className="animate-pulse h-20 bg-white rounded-xl mb-6 border border-slate-100 flex items-center px-8">
          <div className="w-12 h-12 bg-slate-200 rounded mr-4"></div>
          <div className="h-6 w-64 bg-slate-200 rounded"></div>
          <div className="ml-auto h-6 w-48 bg-slate-200 rounded"></div>
        </div>
        <div className="animate-pulse flex-1 bg-white rounded-xl mb-6 border border-slate-100 flex items-center justify-center">
          <div className="h-32 w-64 bg-slate-200 rounded-lg"></div>
        </div>
        <div className="animate-pulse h-64 bg-white rounded-xl border border-slate-100 flex gap-4 p-6">
          <div className="flex-1 bg-slate-100 rounded-lg"></div>
          <div className="flex-1 bg-slate-100 rounded-lg"></div>
          <div className="flex-1 bg-slate-100 rounded-lg"></div>
          <div className="flex-1 bg-slate-100 rounded-lg"></div>
        </div>
      </div>
    );
  }

  const { display, current } = snapshot;
  const counters = Array.isArray(snapshot.counters) ? snapshot.counters : [];

  const formattedDate = currentTime?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '';
  const formattedTime = currentTime?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) ?? '';

  const normalCounters = counters.filter(c => c.tokenType !== 'SPECIAL');
  const specialCounters = counters.filter(c => c.tokenType === 'SPECIAL');
  const allVisibleCounters = [...normalCounters, ...specialCounters];

  const enableAudio = () => {
    if (!announcementSettings.enabled && !voiceUnavailable) {
      setAnnouncementSettings(s => ({ ...s, enabled: true }));
      saveAnnouncementSettings({ ...announcementSettings, enabled: true });
    }
  };

  const renderCounterGrid = (gridCounters: typeof counters, title: string, titleGradient: string) => {
    if (gridCounters.length === 0) return null;
    return (
      <div className="flex-1 min-h-0 flex flex-col mb-4 last:mb-0">
        <h2 className={`text-[clamp(0.8rem,1.5vh,1.2rem)] font-black text-transparent bg-clip-text bg-gradient-to-r ${titleGradient} uppercase tracking-[0.2em] px-2 mb-2`}>
          {title}
        </h2>
        <div 
          className="grid w-full gap-2 lg:gap-3 min-h-0 auto-rows-fr max-md:grid-cols-2 md:grid-cols-[var(--cols)]"
          style={{ '--cols': `repeat(${gridCounters.length || 1}, minmax(0, 1fr))` } as React.CSSProperties}
        >
          {gridCounters.map((c, idx) => (
            <div key={c.id || idx} className="@container flex flex-col bg-white rounded-2xl lg:rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden min-h-0 transform transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_40px_rgb(79,70,229,0.12)]">
              <div className="flex-shrink-0 py-1 flex flex-col items-center justify-center bg-gradient-to-r from-slate-50 to-indigo-50/30 border-b border-indigo-50 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500"></div>
                <h3 className="font-bold text-slate-500 text-[clamp(0.5rem,1vh,0.65rem)] uppercase tracking-[0.2em]">{c.name || 'Counter'}</h3>
                <span className="font-black text-slate-800 text-[clamp(0.9rem,1.5vh,1.1rem)] uppercase tracking-widest mt-0.5">{c.code || c.counter}</span>
                {c.tokenType === 'SPECIAL' && (
                  <span className="bg-purple-100 text-purple-700 text-[clamp(0.45rem,0.8vh,0.6rem)] px-2 py-0.5 mt-0.5 rounded-sm uppercase tracking-widest font-black border border-purple-200 shadow-sm z-10">
                    Special
                  </span>
                )}
              </div>
              <div className="flex-shrink-0 py-1 2xl:py-1.5 flex flex-col items-center justify-center relative border-b border-slate-50">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-50/50 via-transparent to-transparent opacity-50"></div>
                <p className="font-bold text-blue-600 text-[clamp(0.5rem,1vh,0.65rem)] tracking-[0.2em] uppercase mb-0.5 z-10 bg-blue-50 px-3 py-0.5 rounded-full border border-blue-100">Now Serving</p>
                <p className="font-black text-[clamp(2rem,6vh,3.5rem)] leading-none text-transparent bg-clip-text bg-gradient-to-br from-slate-800 to-slate-600 drop-shadow-sm z-10">
                  {c.now?.tokenLabel || '—'}
                </p>
              </div>
              <div className="flex-shrink-0 py-1 2xl:py-1.5 flex flex-col items-center justify-center bg-slate-50/80 border-y border-slate-100">
                <p className="font-bold text-purple-600 text-[clamp(0.5rem,1vh,0.65rem)] tracking-[0.2em] uppercase mb-0.5">Next</p>
                <p className="font-black text-[clamp(1.5rem,4vh,2.5rem)] leading-none text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-500">
                  {c.next?.tokenLabel || '—'}
                </p>
              </div>
              <div className="flex-1 flex flex-col bg-white min-h-0 overflow-hidden">
                <div className="py-1 bg-slate-50/50 border-b border-slate-100 shrink-0 flex justify-center items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                  <p className="text-[clamp(0.5rem,1vh,0.65rem)] font-bold text-slate-500 tracking-[0.2em] uppercase">Waiting Queue</p>
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                </div>
                <div className="w-full flex-1 min-h-0 p-1 flex flex-col items-center overflow-hidden">
                  {c.waitingTokens && c.waitingTokens.length > 0 ? (
                    <AutoScrollList>
                      {c.waitingTokens.map((wt, i) => (
                         <div key={i} className="text-[clamp(0.8rem,1.8vh,1rem)] font-bold text-slate-700 bg-slate-50 w-full text-center py-0.5 2xl:py-1 rounded-lg border border-slate-100 shadow-sm">
                          {wt.tokenLabel}
                        </div>
                      ))}
                      <div className="mt-1 w-full">
                        <div className="text-[clamp(0.6rem,1.2vh,0.75rem)] font-bold text-white uppercase tracking-widest bg-gradient-to-r from-slate-700 to-slate-600 py-1 2xl:py-1.5 rounded-md text-center shadow-md">
                          {c.waitingTokens.length} Waiting
                        </div>
                      </div>
                    </AutoScrollList>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-300 font-medium py-2 text-[clamp(0.6rem,1.2vh,0.75rem)] uppercase tracking-wider">
                      No waiting tokens
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="w-screen h-screen bg-[#f8fafc] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50 via-white to-cyan-50 flex flex-col font-sans text-slate-900 overflow-hidden" onClick={enableAudio}>
      {/* HEADER */}
      <header className="flex justify-between items-center px-4 py-2 2xl:px-6 2xl:py-3 bg-gradient-to-r from-blue-900 via-indigo-900 to-purple-900 shrink-0 shadow-lg z-10 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 2xl:w-12 2xl:h-12 bg-white/10 backdrop-blur-md flex flex-col justify-end items-center rounded-xl overflow-hidden pb-1 border border-white/20 shadow-inner">
            <div className="flex space-x-1 mb-1">
              <div className="w-2 h-2 rounded-full bg-blue-300 shadow-[0_0_8px_rgba(147,197,253,0.8)]"></div>
              <div className="w-2 h-2 rounded-full bg-purple-300 shadow-[0_0_8px_rgba(216,180,254,0.8)]"></div>
              <div className="w-2 h-2 rounded-full bg-pink-300 shadow-[0_0_8px_rgba(249,168,212,0.8)]"></div>
            </div>
            <div className="w-8 h-2 bg-white/30 rounded-t-sm"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg 2xl:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-100 to-purple-200 tracking-tight leading-none uppercase drop-shadow-sm">
              {display.name || 'SMARTQUEUE'}
            </h1>
            <p className="text-[0.6rem] 2xl:text-xs font-bold text-blue-300 tracking-[0.2em] mt-0.5 uppercase">
              Queue Management System
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm 2xl:text-base font-bold text-white/90">
          <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-sm shadow-inner">
            <svg className="w-4 h-4 2xl:w-5 2xl:h-5 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span suppressHydrationWarning className="tracking-wide">{formattedDate}</span>
          </div>
          <div className="flex items-center gap-2 w-28 2xl:w-32 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-sm shadow-inner justify-center">
            <svg className="w-4 h-4 2xl:w-5 2xl:h-5 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span suppressHydrationWarning className="tracking-wider">{formattedTime}</span>
          </div>
        </div>
      </header>

      {/* NOW SERVING AREA */}
      <section className="flex-shrink-0 flex px-6 py-2 border-b border-indigo-100/50 bg-white/40 backdrop-blur-xl shadow-[0_4px_30px_rgba(0,0,0,0.02)]">
        <div className="w-1/4 flex flex-col items-center justify-center text-center border-r border-indigo-100/50 pr-4">
          <div className={`p-2 2xl:p-3 rounded-2xl mb-1 transition-all duration-500 shadow-lg ${announcementSettings.enabled ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-blue-500/30' : 'bg-slate-100 text-slate-400 shadow-slate-200/50'}`}>
            {announcementSettings.enabled ? (
              <svg className="w-6 h-6 2xl:w-8 2xl:h-8 drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M13 5v14l-5-4H3V9h5l5-4zm2.5 7c0-1.7-.9-3.2-2.3-4l-.7 1.4c1 1.6.3 3.6-1.3 4.6l.7 1.4c1.8-1 3-2.9 3-3.4zM18 12c0-3.3-1.8-6.2-4.5-7.7l-.8 1.4c2.1 1.2 3.5 3.5 3.5 6s-1.4 4.8-3.5 6l.8 1.4C16.2 17.6 18 14.8 18 12z" /></svg>
            ) : (
              <svg className="w-6 h-6 2xl:w-8 2xl:h-8 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
            )}
          </div>
          <h3 className="font-extrabold text-slate-800 text-[clamp(0.7rem,1.2vh,0.9rem)] tracking-tight">Audio Announcement</h3>
          <p className={`font-bold text-[clamp(0.6rem,1vh,0.75rem)] mt-0.5 px-3 py-0.5 rounded-full ${announcementSettings.enabled ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
            {voiceUnavailable ? 'Unavailable' : announcementSettings.enabled ? 'Active' : 'Muted'}
          </p>
        </div>

        <div className="w-1/2 flex flex-col items-center justify-center px-4 relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent blur-xl pointer-events-none"></div>
          <h2 className="text-[clamp(0.8rem,1.5vh,1.2rem)] font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 uppercase tracking-[0.3em] z-10 drop-shadow-sm">Now Serving</h2>
          <div className="flex items-center justify-center my-1 z-10">
            <span className={`text-[clamp(2.5rem,8vh,4.5rem)] leading-none font-black tracking-tighter transition-all duration-500 ${lastToken === current?.tokenLabel ? 'scale-110 text-transparent bg-clip-text bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 drop-shadow-2xl' : 'text-slate-800 drop-shadow-lg'}`}>
              {current?.tokenLabel || '—'}
            </span>
          </div>
          {current?.counter && (
            <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white text-[clamp(0.8rem,1.5vh,1.2rem)] font-black uppercase tracking-widest px-4 py-1 2xl:px-6 2xl:py-1.5 rounded-lg shadow-[0_8px_30px_rgb(79,70,229,0.3)] z-10 border border-white/20 transform transition-transform hover:scale-105">
              {current.counter}
            </div>
          )}
        </div>

        <div className="w-1/4 flex flex-col items-center justify-center border-l border-indigo-100/50 pl-4 relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-pink-100/40 via-transparent to-transparent blur-xl pointer-events-none"></div>
          <svg className="w-full max-w-[80px] 2xl:max-w-[100px] drop-shadow-xl z-10" viewBox="0 0 100 80" fill="none">
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
              <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <circle cx="25" cy="30" r="7" fill="url(#grad1)" opacity="0.9" />
            <circle cx="50" cy="25" r="7" fill="url(#grad1)" opacity="0.7" />
            <circle cx="75" cy="30" r="7" fill="url(#grad1)" opacity="0.9" />
            <path d="M15 50 Q25 38 35 50 Z" fill="url(#grad2)" opacity="0.8" />
            <path d="M40 45 Q50 33 60 45 Z" fill="url(#grad2)" opacity="0.6" />
            <path d="M65 50 Q75 38 85 50 Z" fill="url(#grad2)" opacity="0.8" />
            <rect x="5" y="50" width="90" height="12" rx="4" fill="url(#grad2)" />
            <rect x="0" y="62" width="100" height="4" rx="2" fill="#e2e8f0" />

            <path d="M85 70 Q90 60 88 50 Q92 52 95 65 Z" fill="url(#grad1)" opacity="0.8" />
            <path d="M85 70 Q80 60 82 50 Q78 52 75 65 Z" fill="url(#grad1)" opacity="0.6" />
            <rect x="83" y="66" width="4" height="14" rx="2" fill="#312e81" />
          </svg>
        </div>
      </section>

      {/* COUNTER GRID */}
      <section className="bg-transparent flex-1 min-h-0 overflow-y-auto p-3 lg:p-4 flex flex-col">
        {renderCounterGrid(allVisibleCounters, 'Live Queue', 'from-blue-600 to-purple-600')}
      </section>

      {/* FOOTER & LEGEND */}
      <footer className="shrink-0 flex flex-col mt-auto pb-2 2xl:pb-3 px-4">
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-purple-900 text-white py-2 px-6 flex items-center justify-center gap-3 shadow-2xl rounded-2xl border border-white/10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.1)_50%,transparent_75%,transparent_100%)] bg-[length:250px_250px] animate-[gradient_3s_linear_infinite]"></div>
          <svg className="w-5 h-5 2xl:w-6 2xl:h-6 text-blue-300 z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-[clamp(1rem,2vh,1.25rem)] font-black tracking-[0.15em] uppercase z-10 drop-shadow-md bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100">
            Thank you. Please wait for your turn.
          </span>
        </div>
      </footer>
    </div>
  );
}
