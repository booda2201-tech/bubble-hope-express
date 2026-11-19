import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable, retry, throwError, timer } from 'rxjs';
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
      .get<unknown>(`${this.baseUrl}/api/Orders/GetDriverOrdersByDate`, {
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

  registerDevice(token: string): Observable<unknown> {
    return this.http.post(
      `${this.baseUrl}/api/notifications/devices`,
      { token, platform: 'Web' },
      { headers: this.skipLoading }
    );
  }

  removeDevice(token: string): Observable<unknown> {
    return this.http.request('DELETE', `${this.baseUrl}/api/notifications/devices`, {
      body: { token },
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
