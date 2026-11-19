import { Injectable, NgZone } from '@angular/core';
import { initializeApp } from '@firebase/app';
import { MessagePayload, Messaging, getMessaging, getToken, isSupported, onMessage } from '@firebase/messaging';
import { Subject, firstValueFrom } from 'rxjs';
import { environment } from '../Environments/environment';
import { ApiService } from './api.service';
import { TokenService } from './token.service';

export interface PushMessage {
  id: number;
  title: string;
  body: string;
}

const FCM_KEY = 'fcmToken';

@Injectable({
  providedIn: 'root',
})
export class PushService {
  /** True once this browser's Firebase token is stored for the logged-in driver. */
  active = false;

  private readonly messages = new Subject<PushMessage>();
  readonly messages$ = this.messages.asObservable();
  private readonly firebaseApp = initializeApp({
    apiKey: environment.firebase.apiKey,
    authDomain: environment.firebase.authDomain,
    projectId: environment.firebase.projectId,
    storageBucket: environment.firebase.storageBucket,
    messagingSenderId: environment.firebase.messagingSenderId,
    appId: environment.firebase.appId,
  });
  private messaging: Messaging | null = null;
  private listening = false;
  private cancelled = false;
  private inflight: Promise<void> | null = null;

  constructor(private api: ApiService, private tokenService: TokenService, private zone: NgZone) {}

  get supported(): boolean {
    return 'serviceWorker' in navigator && 'Notification' in window;
  }

  /** iOS only delivers web push to apps added to the home screen. */
  get needsInstallOnIos(): boolean {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return ios && !standalone;
  }

  /** Call inside the login click so the browser still treats the permission prompt as a user gesture. */
  prepare(): void {
    if (!environment.firebase.vapidKey || !this.supported || Notification.permission !== 'default') return;
    void Notification.requestPermission().catch(() => undefined);
  }

  /**
   * Ask only when `ask` is true (login click or the alerts button).
   * A restored session registers silently if permission was already granted.
   */
  register(ask = false): Promise<void> {
    this.cancelled = false;
    if (this.inflight) return this.inflight;
    this.inflight = this.run(ask).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Call before the auth token is cleared so the backend can drop this device. */
  async unsubscribe(): Promise<void> {
    this.cancelled = true;
    this.active = false;
    await this.inflight?.catch(() => undefined);
    const token = localStorage.getItem(FCM_KEY);
    if (!token) return;
    try {
      await firstValueFrom(this.api.removeDevice(token));
    } catch {
      // Logout still continues; the next login registers this browser again.
    }
    localStorage.removeItem(FCM_KEY);
  }

  private async run(ask: boolean): Promise<void> {
    if (!this.supported || !this.tokenService.hasToken() || !environment.firebase.vapidKey) return;
    if (!(await isSupported())) return;

    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      if (!ask) return;
      try {
        const result = await Notification.requestPermission();
        if (result !== 'granted') return;
      } catch {
        return;
      }
    }

    try {
      const registration = await this.worker();
      const messaging = await this.client();
      if (!messaging || this.cancelled || !this.tokenService.hasToken()) return;

      const token = await getToken(messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token || this.cancelled || !this.tokenService.hasToken()) return;

      localStorage.setItem(FCM_KEY, token);
      await firstValueFrom(this.api.registerDevice(token));
      if (this.cancelled) return;
      this.active = true;
      this.listen(messaging);
    } catch (error) {
      this.active = false;
      console.error('Firebase device registration failed', error);
    }
  }

  private async worker(): Promise<ServiceWorkerRegistration> {
    const script = new URL('firebase-messaging-sw.js', document.baseURI).href;
    const registration = await navigator.serviceWorker.register(script);
    const others = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      others
        .filter((item) => {
          const url = item.active?.scriptURL || item.installing?.scriptURL || item.waiting?.scriptURL || '';
          return !url.includes('firebase-messaging-sw.js');
        })
        .map((item) => item.unregister())
    );
    await navigator.serviceWorker.ready;
    return registration;
  }

  private async client(): Promise<Messaging | null> {
    if (this.messaging) return this.messaging;
    if (!(await isSupported())) return null;
    this.messaging = getMessaging(this.firebaseApp);
    return this.messaging;
  }

  private listen(messaging: Messaging): void {
    if (this.listening) return;
    this.listening = true;
    onMessage(messaging, (payload) => {
      const message = toMessage(payload);
      this.zone.run(() => this.messages.next(message));
    });
  }
}

function toMessage(payload: MessagePayload): PushMessage {
  const raw = payload.data?.['orderId'];
  const id = Number(raw);
  return {
    id: Number.isFinite(id) && id > 0 ? id : Date.now(),
    title: payload.notification?.title || 'طلب جديد',
    body: payload.notification?.body || '',
  };
}
