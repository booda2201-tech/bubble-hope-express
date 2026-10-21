import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, finalize } from 'rxjs';
import { LoadingService } from '../services/loading.service';

@Injectable()
export class LoadingInterceptor implements HttpInterceptor {
  constructor(private loading: LoadingService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const skip = req.headers.has('X-Skip-Loading') || req.url.includes('assets/');
    const clean = req.clone({ headers: req.headers.delete('X-Skip-Loading') });
    if (skip) return next.handle(clean);

    this.loading.start();
    return next.handle(clean).pipe(finalize(() => this.loading.stop()));
  }
}
