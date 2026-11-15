import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { TokenService } from './token.service';

/**
 * Registers this device for Web Push so the backend can wake it up when a new order arrives,
 * even after the driver leaves the page. Without the backend Push endpoints it stays inactive.
 */
@Injectable({
  providedIn: 'root',
})
export class PushService {
  /** True once the backend has stored this device's subscription. */
  active = false;

  constructor(private api: ApiService, private tokenService: TokenService) {}

  get supported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  /** iOS only delivers web push to apps added to the home screen. */
  get needsInstallOnIos(): boolean {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return ios && !standalone;
  }

  async sync(): Promise<void> {
    if (!this.supported || Notification.permission !== 'granted' || !this.tokenService.hasToken()) return;

    try {
      const publicKey = await firstValueFrom(this.api.getVapidPublicKey());
      if (!publicKey) return;

      const registration = await navigator.serviceWorker.ready;
      const serverKey = base64UrlToBytes(publicKey);
      let subscription = await registration.pushManager.getSubscription();

      if (subscription && !sameKey(subscription.options.applicationServerKey, serverKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: serverKey,
      });

      await firstValueFrom(this.api.savePushSubscription(subscription.toJSON()));
      this.active = true;
    } catch {
      this.active = false;
    }
  }

  /** Call before the auth token is cleared so the backend can drop this device. */
  async unsubscribe(): Promise<void> {
    this.active = false;
    if (!this.supported) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await firstValueFrom(this.api.removePushSubscription(subscription.endpoint)).catch(() => undefined);
      await subscription.unsubscribe();
    } catch {
      // Nothing to clean up on this device.
    }
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index]);
}
