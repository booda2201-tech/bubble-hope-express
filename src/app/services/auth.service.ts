import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../Environments/environment';
import { DriverProfile } from '../models/order.model';
import { TokenService } from './token.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  baseUrl = environment.apiBaseUrl;
  private driverSubject = new BehaviorSubject<DriverProfile | null>(null);
  driver$ = this.driverSubject.asObservable();

  constructor(private http: HttpClient, private tokenService: TokenService) {
    this.loadDriver();
  }

  driverLogin(phoneNumber: string, password: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/api/Account/DriverLogin`, {
      phoneNumber,
      password,
    });
  }

  isDriverAccount(response: unknown): boolean {
    if (!response || typeof response !== 'object') return true;
    const role = (response as Record<string, unknown>)['role'];
    return typeof role !== 'string' || role.toLowerCase() === 'driver';
  }

  persistSession(response: unknown, phoneNumber: string): boolean {
    const token = extractToken(response);
    if (!token) return false;

    this.tokenService.storeEncryptedToken(token);
    const driver: DriverProfile = {
      fullName: extractName(response) || phoneNumber,
      phoneNumber,
    };
    localStorage.setItem('driver', JSON.stringify(driver));
    this.driverSubject.next(driver);
    return true;
  }

  loadDriver(): void {
    const raw = localStorage.getItem('driver');
    if (!raw || !this.tokenService.hasToken()) {
      this.driverSubject.next(null);
      return;
    }
    try {
      this.driverSubject.next(JSON.parse(raw) as DriverProfile);
    } catch {
      this.driverSubject.next(null);
    }
  }

  logout(): void {
    this.tokenService.removeToken();
    localStorage.removeItem('driver');
    this.driverSubject.next(null);
  }

  isLoggedIn(): boolean {
    return this.tokenService.hasToken();
  }
}

export function extractToken(response: unknown): string | null {
  if (typeof response === 'string') {
    const trimmed = response.trim();
    return looksLikeToken(trimmed) ? trimmed : null;
  }
  if (!response || typeof response !== 'object') return null;

  const bag = response as Record<string, unknown>;
  const keys = ['token', 'Token', 'accessToken', 'access_token', 'jwt', 'jwtToken'];
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'string' && looksLikeToken(value)) return value;
  }

  for (const nest of ['data', 'result', 'value']) {
    const nested = extractToken(bag[nest]);
    if (nested) return nested;
  }
  return null;
}

function looksLikeToken(value: string): boolean {
  return value.length > 20 && !value.includes(' ');
}

function extractName(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const bag = response as Record<string, unknown>;
  for (const key of ['fullName', 'name', 'userName']) {
    const value = bag[key];
    if (typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'string') {
      return value.trim();
    }
  }
  return '';
}
