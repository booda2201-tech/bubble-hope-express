import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { TokenService } from './token.service';

/**
 * Silent daily attendance ping. On the first page open each day it sends a stable device
 * fingerprint plus environment details to the backend, so the owner can see when a driver
 * started and whether the account is used from the usual phone. Nothing is shown to the driver.
 * No-ops until the backend exposes /api/DriverActivity, and never collects location.
 */
@Injectable({
  providedIn: 'root',
})
export class AttendanceService {
  private readonly dayKey = 'attendance_day';
  private readonly idKey = 'device_id';
  private sending = false;

  constructor(private api: ApiService, private tokenService: TokenService) {}

  /** Call on every app open; it only reaches the network once per calendar day per device. */
  async checkIn(): Promise<void> {
    if (this.sending || !this.tokenService.hasToken()) return;
    const today = localDate();
    if (localStorage.getItem(this.dayKey) === today) return;

    this.sending = true;
    try {
      await firstValueFrom(this.api.sendAttendance(this.snapshot(today)));
      localStorage.setItem(this.dayKey, today);
    } catch {
      // Backend not ready or offline; try again next open.
    } finally {
      this.sending = false;
    }
  }

  /** Shown only behind the ?check link so the owner can read a driver's setup from a screenshot. */
  diagnostics(): { label: string; value: string; ok?: boolean }[] {
    const env = describeEnvironment();
    const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const permission = 'Notification' in window ? Notification.permission : 'unsupported';
    const installed =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return [
      { label: 'Browser', value: env['browser'] },
      { label: 'OS', value: env['os'] },
      { label: 'Device', value: env['deviceModel'] || '—' },
      { label: 'Background alerts', value: pushOk ? 'Supported' : 'Not supported', ok: pushOk },
      { label: 'Notifications', value: permission, ok: permission === 'granted' },
      { label: 'Installed to home', value: installed ? 'Yes' : 'No', ok: installed },
      { label: 'Fingerprint', value: fingerprint() },
      { label: 'Device ID', value: this.deviceId() },
    ];
  }

  private snapshot(day: string): Record<string, unknown> {
    const env = describeEnvironment();
    return {
      localDate: day,
      at: new Date().toISOString(),
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      deviceId: this.deviceId(),
      fingerprint: fingerprint(),
      ...env,
      notificationsOn: 'Notification' in window ? Notification.permission === 'granted' : false,
      installed:
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    };
  }

  /** A random id kept on the device; paired with the fingerprint it flags a new/shared phone. */
  private deviceId(): string {
    let id = localStorage.getItem(this.idKey);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(this.idKey, id);
    }
    return id;
  }
}

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Stable across sessions on the same phone+browser; changes if the driver switches device. */
function fingerprint(): string {
  const n = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages || []).join(','),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || ''),
    String(n.deviceMemory || ''),
    String(navigator.maxTouchPoints || 0),
    navigator.platform || '',
  ];
  return hash(parts.join('|'));
}

function describeEnvironment(): Record<string, string> {
  const ua = navigator.userAgent;
  return {
    browser: detectBrowser(ua),
    os: detectOs(ua),
    deviceModel: detectModel(ua),
    userAgent: ua,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language || '',
  };
}

function detectBrowser(ua: string): string {
  const tests: [RegExp, string][] = [
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/Edg(?:A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)|Opera/, 'Opera'],
    [/Brave\/([\d.]+)/, 'Brave'],
    [/MiuiBrowser\/([\d.]+)/, 'Mi Browser'],
    [/HuaweiBrowser\/([\d.]+)/, 'Huawei Browser'],
    [/UCBrowser\/([\d.]+)/, 'UC Browser'],
    [/FBAN|FBAV|FB_IAB/, 'Facebook in-app'],
    [/Instagram/, 'Instagram in-app'],
    [/; wv\)/, 'In-app browser (WebView)'],
    [/CriOS\/([\d.]+)/, 'Chrome (iOS)'],
    [/FxiOS\/([\d.]+)/, 'Firefox (iOS)'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/[\d.]+.*Safari/, 'Safari'],
  ];
  for (const [regex, name] of tests) {
    const match = ua.match(regex);
    if (match) return match[1] ? `${name} ${match[1].split('.')[0]}` : name;
  }
  return 'Unknown';
}

function detectOs(ua: string): string {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android ([\d.]+)/.test(ua)) return `Android ${ua.match(/Android ([\d.]+)/)?.[1]}`;
  if (/iPhone OS ([\d_]+)/.test(ua)) return `iOS ${ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, '.')}`;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectModel(ua: string): string {
  const android = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
  if (android) return android[1].trim();
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return '';
}

function hash(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
