'use client';

import { use, useEffect, useRef, useState } from 'react';
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

export default function PublicDisplayPage({ params }: { params: Promise<{ displayId: string }> }) {
  const { displayId } = use(params);
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [state, setState] = useState<DisplayPageState>('loading');
  const [lastToken, setLastToken] = useState('');
  const [announcementSettings, setAnnouncementSettings] = useState<AnnouncementSettings>(() => loadAnnouncementSettings());
  const [voiceUnavailable, setVoiceUnavailable] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  
  const snapshotRef = useRef<DisplaySnapshot | null>(null);
  const speakerRef = useRef<AnnouncementSpeaker | null>(null);
  const settingsRef = useRef<AnnouncementSettings>(announcementSettings);
  
  const supportsSpeech = speechSupported();

  useEffect(() => {
    setCurrentTime(new Date());
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

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
    const source = new EventSource(`/api/public/displays/${encodeURIComponent(displayId)}/events`);
    
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

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center font-sans">
        <p className="text-slate-500 text-2xl font-medium">Display unavailable</p>
      </div>
    );
  }

  const { display, current, counters } = snapshot;

  const formattedDate = currentTime?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) ?? '';
  const formattedTime = currentTime?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) ?? '';

  const enableAudio = () => {
    if (!announcementSettings.enabled && !voiceUnavailable) {
      setAnnouncementSettings(s => ({ ...s, enabled: true }));
      saveAnnouncementSettings({ ...announcementSettings, enabled: true });
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-slate-900 overflow-hidden" onClick={enableAudio}>
      {/* HEADER */}
      <header className="flex justify-between items-center px-8 py-5 border-b-4 border-teal-700 bg-white shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-teal-50 flex flex-col justify-end items-center rounded overflow-hidden pb-1 border-b-4 border-teal-200">
             <div className="flex space-x-1.5 mb-1.5">
               <div className="w-2.5 h-2.5 rounded-full bg-teal-800"></div>
               <div className="w-2.5 h-2.5 rounded-full bg-teal-800"></div>
               <div className="w-2.5 h-2.5 rounded-full bg-teal-800"></div>
             </div>
             <div className="w-10 h-2.5 bg-teal-700/80 rounded-t-sm"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-[1.7rem] font-black text-[#041E42] tracking-tight leading-none uppercase">
              {display.name || 'SMARTQUEUE'}
            </h1>
            <p className="text-[0.75rem] font-bold text-teal-600 tracking-[0.2em] mt-1 uppercase">
              Queue Management System
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xl font-bold text-[#041E42]">
          <div className="flex items-center gap-3">
            <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span suppressHydrationWarning>{formattedDate}</span>
          </div>
          <div className="h-8 w-px bg-slate-300"></div>
          <div className="flex items-center gap-3 w-36">
            <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span suppressHydrationWarning>{formattedTime}</span>
          </div>
        </div>
      </header>

      {/* NOW SERVING AREA */}
      <section className="flex-1 flex px-10 py-6 min-h-[300px] border-b border-slate-100">
        <div className="w-1/4 flex flex-col items-center justify-center text-center border-r border-slate-100 pr-8">
          <div className={`p-6 rounded-full mb-4 ${announcementSettings.enabled ? 'text-teal-700' : 'text-slate-400'}`}>
            {announcementSettings.enabled ? (
              <svg className="w-24 h-24 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24"><path d="M13 5v14l-5-4H3V9h5l5-4zm2.5 7c0-1.7-.9-3.2-2.3-4l-.7 1.4c1 1.6.3 3.6-1.3 4.6l.7 1.4c1.8-1 3-2.9 3-3.4zM18 12c0-3.3-1.8-6.2-4.5-7.7l-.8 1.4c2.1 1.2 3.5 3.5 3.5 6s-1.4 4.8-3.5 6l.8 1.4C16.2 17.6 18 14.8 18 12z"/></svg>
            ) : (
              <svg className="w-24 h-24 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            )}
          </div>
          <h3 className="font-bold text-[#041E42] text-xl">Audio Announcement</h3>
          <p className={`font-bold text-lg mt-1 ${announcementSettings.enabled ? 'text-teal-600' : 'text-slate-400'}`}>
            {voiceUnavailable ? 'Unavailable' : announcementSettings.enabled ? 'Active' : 'Muted'}
          </p>
        </div>

        <div className="w-1/2 flex flex-col items-center justify-center px-10 relative">
          <h2 className="text-3xl font-extrabold text-teal-700 uppercase tracking-widest mb-2 z-10">Now Serving</h2>
          <div className="flex items-center justify-center my-4 h-[180px]">
            <span className={`text-[12rem] leading-none font-black text-[#041E42] tracking-tighter transition-all duration-300 ${lastToken === current?.tokenLabel ? 'scale-110 text-teal-600' : ''}`}>
              {current?.tokenLabel || '—'}
            </span>
          </div>
          {current?.counter && (
            <div className="bg-teal-700 text-white text-3xl font-bold uppercase tracking-widest px-10 py-3 rounded-lg shadow-sm z-10">
              {current.counter}
            </div>
          )}
        </div>

        <div className="w-1/4 flex flex-col items-center justify-center border-l border-slate-100 pl-8">
           <svg className="w-full max-w-[220px] text-teal-800 opacity-90 drop-shadow-sm" viewBox="0 0 100 80" fill="currentColor">
              <circle cx="25" cy="30" r="7" />
              <circle cx="50" cy="25" r="7" />
              <circle cx="75" cy="30" r="7" />
              <path d="M15 50 Q25 38 35 50 Z" />
              <path d="M40 45 Q50 33 60 45 Z" />
              <path d="M65 50 Q75 38 85 50 Z" />
              <rect x="5" y="50" width="90" height="12" rx="2" className="text-teal-200" />
              <rect x="0" y="62" width="100" height="4" rx="1" />
              
              <path d="M85 70 Q90 60 88 50 Q92 52 95 65 Z" />
              <path d="M85 70 Q80 60 82 50 Q78 52 75 65 Z" />
              <rect x="83" y="66" width="4" height="14" rx="1" className="text-teal-900" />
           </svg>
        </div>
      </section>

      {/* COUNTER GRID */}
      <section className="bg-slate-50 shrink-0 border-b-4 border-slate-200 overflow-x-auto">
        <div className="flex w-full h-full min-w-min">
          {counters.map((c, idx) => (
            <div key={c.id || idx} className={`flex-1 min-w-[250px] flex flex-col text-center bg-white ${idx < counters.length - 1 ? 'border-r-2 border-slate-200' : ''}`}>
              <div className="py-4 flex flex-col items-center justify-center border-b-2 border-slate-100 bg-white shadow-sm">
                <h3 className="font-bold text-[#041E42] text-sm uppercase tracking-wider">{c.name || 'Counter'}</h3>
                <span className="font-extrabold text-[#041E42] text-lg uppercase tracking-widest mt-0.5">{c.code || c.counter}</span>
              </div>
              <div className="py-8 flex flex-col justify-center border-b-2 border-slate-100 min-h-[160px]">
                <p className="text-sm font-bold text-[#041E42] tracking-widest uppercase mb-2">Now Serving</p>
                <p className="text-7xl font-black text-[#041E42]">
                  {c.now?.tokenLabel || '—'}
                </p>
              </div>
              <div className="py-6 bg-slate-50 flex flex-col justify-center min-h-[120px]">
                <p className="text-sm font-bold text-slate-500 tracking-widest uppercase mb-1">Next</p>
                <p className="text-5xl font-extrabold text-teal-700">
                  {c.next?.tokenLabel || '—'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER & LEGEND */}
      <footer className="shrink-0 bg-slate-100 flex flex-col">
        <div className="bg-[#041E42] text-white py-4 px-6 flex items-center justify-center gap-3 shadow-md">
          <svg className="w-8 h-8 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-3xl font-extrabold tracking-widest uppercase mt-0.5">
            Thank you. Please wait for your turn.
          </span>
        </div>


      </footer>
    </div>
  );
}
