export type AnnouncementSettings = {
  enabled: boolean;
  rate: number;
  volume: number;
  language: string;
  voiceURI: string;
};

export const DEFAULT_ANNOUNCEMENT_SETTINGS: AnnouncementSettings = {
  enabled: false,
  rate: 1,
  volume: 1,
  language: 'en-US',
  voiceURI: '',
};

const STORAGE_KEY = 'queue-display-announcements:v1';
const MAX_QUEUE = 5;
const MAX_RECENT_KEYS = 200;
const UTTERANCE_WATCHDOG_MS = 15_000;

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function loadAnnouncementSettings(): AnnouncementSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_ANNOUNCEMENT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ANNOUNCEMENT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AnnouncementSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_ANNOUNCEMENT_SETTINGS.enabled,
      rate: clampNumber(parsed.rate, 0.5, 2, DEFAULT_ANNOUNCEMENT_SETTINGS.rate),
      volume: clampNumber(parsed.volume, 0, 1, DEFAULT_ANNOUNCEMENT_SETTINGS.volume),
      language: typeof parsed.language === 'string' ? parsed.language : DEFAULT_ANNOUNCEMENT_SETTINGS.language,
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : '',
    };
  } catch {
    return { ...DEFAULT_ANNOUNCEMENT_SETTINGS };
  }
}

export function saveAnnouncementSettings(settings: AnnouncementSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, disabled); announcements stay session-only.
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds the spoken sentence for a token based on the selected language.
 */
export function renderAnnouncementText(
  token: { tokenLabel: string; counter: string; service?: string },
  language: string = 'en-US'
): string {
  const isHindi = language.toLowerCase().startsWith('hi');

  if (isHindi) {
    let counterText = token.counter;
    if (/counter/i.test(counterText)) {
      counterText = counterText.replace(/counter/i, 'काउंटर').trim();
    } else {
      counterText = `काउंटर ${counterText}`;
    }

    const base = `टोकन ${token.tokenLabel}, कृपया ${counterText} पर जाएँ।`;
    return token.service
      ? `टोकन ${token.tokenLabel}, कृपया ${token.service} के लिए ${counterText} पर जाएँ।`
      : base;
  }

  const base = `Token ${token.tokenLabel}, please proceed to ${token.counter}.`;
  return token.service
    ? `Token ${token.tokenLabel}, please proceed to ${token.counter} for ${token.service}.`
    : base;
}

type QueueItem = { eventKey: string; text: string };

/**
 * Serialized browser announcement queue. Announcements never overlap: the next
 * utterance starts only after the previous one ends (or times out). Duplicate
 * events are dropped via a bounded recent-event key cache, and a watchdog
 * prevents stale utterances from blocking the queue indefinitely.
 */
export class AnnouncementSpeaker {
  private readonly queue: QueueItem[] = [];
  private readonly recentKeys: string[] = [];
  private speaking = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private voicesLoaded = false;

  constructor(
    private readonly synth: SpeechSynthesis,
    private readonly getSettings: () => AnnouncementSettings,
  ) {
    // Preload voices if possible
    if (this.synth.getVoices().length > 0) {
      this.voicesLoaded = true;
    }
  }

  private async waitForVoices(): Promise<void> {
    if (this.voicesLoaded || this.synth.getVoices().length > 0) {
      this.voicesLoaded = true;
      return;
    }

    return new Promise<void>((resolve) => {
      const handleVoicesChanged = () => {
        this.voicesLoaded = true;
        this.synth.removeEventListener('voiceschanged', handleVoicesChanged);
        resolve();
      };
      this.synth.addEventListener('voiceschanged', handleVoicesChanged);
      
      // Fallback timeout in case voiceschanged never fires (e.g. no voices or broken browser)
      setTimeout(() => {
        this.synth.removeEventListener('voiceschanged', handleVoicesChanged);
        resolve();
      }, 2000);
    });
  }

  enqueue(eventKey: string, text: string): void {
    if (this.recentKeys.includes(eventKey)) return;
    this.recentKeys.push(eventKey);
    if (this.recentKeys.length > MAX_RECENT_KEYS) this.recentKeys.shift();
    this.queue.push({ eventKey, text });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    void this.flush();
  }

  cancel(): void {
    this.queue.length = 0;
    this.speaking = false;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    this.synth.cancel();
  }

  private async flush(): Promise<void> {
    if (this.speaking) return;
    const item = this.queue.shift();
    if (!item) return;
    const settings = this.getSettings();
    if (!settings.enabled) return;
    this.speaking = true;
    try {
      await this.speak(item.text, settings);
    } finally {
      this.speaking = false;
      void this.flush();
    }
  }

  private async speak(text: string, settings: AnnouncementSettings): Promise<void> {
    // Ensure cancel is called before starting new speech for reliability
    this.synth.cancel();
    await this.waitForVoices();

    const isHindi = settings.language.toLowerCase().startsWith('hi');
    const voice = this.pickVoice(settings, isHindi);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Audio] Language: ${settings.language}`);
      console.log(`[Audio] Available voices:`, this.synth.getVoices().map(v => v.lang).join(', '));
      console.log(`[Audio] Voice:`, voice ? voice.name : 'None');
      console.log(`[Audio] Text: ${text}`);
    }

    if (isHindi && !voice) {
      console.warn("Hindi speech voice is not available in this browser/device.");
      // Do not falsely report or pretend it's working with an English voice
      return; 
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.watchdog !== null) {
          clearTimeout(this.watchdog);
          this.watchdog = null;
        }
        resolve();
      };

      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = voice ? voice.lang : settings.language;
      utterance.rate = settings.rate;
      utterance.volume = settings.volume;
      utterance.onend = finish;
      utterance.onerror = finish;

      // Watchdog: browsers occasionally fail to fire onend; never let a stale
      // utterance block the announcement queue indefinitely.
      this.watchdog = setTimeout(finish, UTTERANCE_WATCHDOG_MS);
      this.synth.speak(utterance);
    });
  }

  private pickVoice(settings: AnnouncementSettings, isHindi: boolean): SpeechSynthesisVoice | null {
    const voices = this.synth.getVoices();
    if (!voices.length) return null;
    
    if (settings.voiceURI) {
      const chosen = voices.find((voice) => voice.voiceURI === settings.voiceURI);
      if (chosen) return chosen;
    }

    if (isHindi) {
      return voices.find(v => v.lang === 'hi-IN') || voices.find(v => v.lang.toLowerCase().startsWith('hi')) || null;
    }

    const languagePrefix = settings.language.toLowerCase().split('-')[0] ?? 'en';
    return (
      voices.find((voice) => voice.lang.toLowerCase().startsWith(settings.language.toLowerCase())) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(languagePrefix)) ??
      voices[0] ??
      null
    );
  }
}
