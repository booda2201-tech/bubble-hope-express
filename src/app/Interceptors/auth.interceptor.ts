import { Injectable, inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { TokenService } from '../services/token.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private tokenService = inject(TokenService);
  private router = inject(Router);

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (req.url.includes('/api/Account/DriverLogin')) {
      return next.handle(req);
    }

    const raw = this.tokenService.getDecryptedToken() ?? '';
    const hasValidToken = !!raw && raw !== 'null' && raw !== 'undefined' && raw.trim() !== '';
    const authReq = hasValidToken
      ? req.clone({ setHeaders: { Authorization: `Bearer ${raw}` } })
      : req;

    return next.handle(authReq).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401 && hasValidToken) {
          this.tokenService.removeToken();
          localStorage.removeItem('driver');
          void this.router.navigate(['/auth/login']);
        }
        return throwError(() => error);
      })
    );
  }
}
