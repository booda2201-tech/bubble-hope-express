import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, retry, throwError, timer } from 'rxjs';
import { environment } from '../Environments/environment';
import { DeliveryOrder } from '../models/order.model';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  baseUrl = environment.apiBaseUrl;
  private skipLoading = new HttpHeaders({ 'X-Skip-Loading': '1' });

  constructor(private http: HttpClient) {}

  getOrdersByDate(date: string): Observable<DeliveryOrder[]> {
    return this.http
      .get<unknown>(`${this.baseUrl}/api/Orders/GetOrdersByDate`, {
        params: { date, _: String(Date.now()) },
        headers: this.skipLoading
          .set('Cache-Control', 'no-cache')
          .set('Pragma', 'no-cache'),
      })
      .pipe(
        retry({ count: 4, delay: retryWhenThrottled }),
        map((response) => normalizeOrders(response))
      );
  }

  /** Resolves to null when the backend has no Push endpoints yet. */
  getVapidPublicKey(): Observable<string | null> {
    return this.http
      .get<unknown>(`${this.baseUrl}/api/Push/VapidPublicKey`, { headers: this.skipLoading })
      .pipe(
        map((response) => {
          if (typeof response === 'string') return response.trim() || null;
          const key = (response as Record<string, unknown> | null)?.['publicKey'];
          return typeof key === 'string' && key.trim() ? key.trim() : null;
        }),
        catchError(() => of(null))
      );
  }

  savePushSubscription(subscription: PushSubscriptionJSON): Observable<unknown> {
    return this.http.post(
      `${this.baseUrl}/api/Push/Subscribe`,
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.keys?.['p256dh'], auth: subscription.keys?.['auth'] },
      },
      { headers: this.skipLoading }
    );
  }

  removePushSubscription(endpoint: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/api/Push/Unsubscribe`, { endpoint }, { headers: this.skipLoading });
  }

  /** Silent daily attendance ping; no-ops server-side until /api/DriverActivity exists. */
  sendAttendance(snapshot: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/api/DriverActivity/Check-in`, snapshot, {
      headers: this.skipLoading,
    });
  }

  updateOrderStatus(orderId: number, status: number): Observable<string> {
    return this.http.put(`${this.baseUrl}/api/Orders/UpdateOrderStatus/${orderId}`, {}, {
      params: { status },
      headers: this.skipLoading,
      responseType: 'text',
    });
  }
}

function retryWhenThrottled(error: unknown, attempt: number): Observable<number> {
  if (!(error instanceof HttpErrorResponse) || error.status !== 429) return throwError(() => error);
  const retryAfter = Number(error.headers.get('Retry-After'));
  const wait = retryAfter > 0 ? retryAfter * 1000 : attempt * 1500;
  return timer(Math.min(wait, 15000));
}

function normalizeOrders(response: unknown): DeliveryOrder[] {
  if (Array.isArray(response)) return response as DeliveryOrder[];
  if (response && typeof response === 'object') {
    const bag = response as Record<string, unknown>;
    for (const key of ['data', 'result', 'orders', 'value']) {
      if (Array.isArray(bag[key])) return bag[key] as DeliveryOrder[];
    }
  }
  return [];
}
