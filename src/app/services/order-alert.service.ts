import { Injectable, NgZone } from '@angular/core';

export interface OrderAlert {
  id: number;
  title: string;
  body: string;
}

type PermissionState = NotificationPermission | 'unsupported';

const STORAGE_KEY = 'order_alerts';
const ICON = '/assets/brand/logo.png';

/** One "ding-dong" round; each hit drives both a bell tone and a vibration burst so they land together. */
const ROUND_MS = 1000;
const HITS = [
  { at: 0, freq: 1318.5, buzz: 200 },
  { at: 240, freq: 987.8, buzz: 280 },
];
const ALERT_ROUNDS = 3;

function vibrationPattern(rounds: number): number[] {
  const pattern: number[] = [];
  for (let round = 0; round < rounds; round++) {
    HITS.forEach((hit, index) => {
      const next = HITS[index + 1]?.at ?? ROUND_MS;
      pattern.push(hit.buzz, next - hit.at - hit.buzz);
    });
  }
  pattern.pop();
  return pattern;
}

@Injectable({
  providedIn: 'root',
})
export class OrderAlertService {
  enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  audioReady = false;

  private ctx: AudioContext | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private baseTitle = document.title;
  private unseen = 0;

  constructor(private zone: NgZone) {
    const unlock = () => this.zone.run(() => this.unlockAudio());
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.clearBadge();
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/assets/sw.js')
        .then((registration) => (this.registration = registration))
        .catch(() => (this.registration = null));
    }

    this.unlockAudio();
  }

  get permission(): PermissionState {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  get needsSetup(): boolean {
    return this.enabled && (!this.audioReady || this.permission === 'default');
  }

  /** Must be called from a user gesture so the browser lets us play audio and ask for permission. */
  async enable(): Promise<void> {
    this.enabled = true;
    localStorage.setItem(STORAGE_KEY, 'on');
    this.unlockAudio();
    if (this.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Older Safari only supports the callback form; the chime still works.
      }
    }
    this.ring(1);
  }

  disable(): void {
    this.enabled = false;
    localStorage.setItem(STORAGE_KEY, 'off');
  }

  notify(alerts: OrderAlert[]): void {
    if (!this.enabled || !alerts.length) return;

    this.ring(ALERT_ROUNDS);

    if (document.visibilityState !== 'visible') {
      this.unseen += alerts.length;
      document.title = `(${this.unseen}) ${this.baseTitle}`;
    }

    if (this.permission !== 'granted') return;
    for (const alert of alerts.slice(0, 3)) this.showSystemNotification(alert);
  }

  private showSystemNotification(alert: OrderAlert): void {
    const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body: alert.body,
      icon: ICON,
      badge: ICON,
      tag: `order-${alert.id}`,
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: vibrationPattern(ALERT_ROUNDS),
    };

    if (this.registration) {
      this.registration.showNotification(alert.title, options).catch(() => this.showPageNotification(alert, options));
      return;
    }
    this.showPageNotification(alert, options);
  }

  private showPageNotification(alert: OrderAlert, options: NotificationOptions): void {
    try {
      const notification = new Notification(alert.title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Mobile browsers without a service worker reject the constructor; sound and vibration still fire.
    }
  }

  private unlockAudio(): void {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    this.ctx ??= new AudioCtor();
    if (this.ctx.state === 'running') {
      this.audioReady = true;
      return;
    }
    this.ctx
      .resume()
      .then(() => this.zone.run(() => (this.audioReady = this.ctx?.state === 'running')))
      .catch(() => (this.audioReady = false));
  }

  private ring(rounds: number): void {
    navigator.vibrate?.(vibrationPattern(rounds));

    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 6;
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(compressor).connect(ctx.destination);

    for (let round = 0; round < rounds; round++) {
      for (const hit of HITS) {
        const start = ctx.currentTime + (round * ROUND_MS + hit.at) / 1000;
        this.bell(ctx, master, hit.freq, start);
      }
    }
  }

  /** Triangle fundamental plus an inharmonic partial gives a sharp bell that cuts through street noise. */
  private bell(ctx: AudioContext, out: AudioNode, frequency: number, start: number): void {
    const partials = [
      { ratio: 1, level: 1, type: 'triangle' as OscillatorType, decay: 0.7 },
      { ratio: 2.76, level: 0.35, type: 'sine' as OscillatorType, decay: 0.35 },
      { ratio: 5.4, level: 0.12, type: 'sine' as OscillatorType, decay: 0.18 },
    ];

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = partial.type;
      osc.frequency.value = frequency * partial.ratio;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(partial.level, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + partial.decay + 0.05);
    }
  }

  private clearBadge(): void {
    this.unseen = 0;
    document.title = this.baseTitle;
  }
}
