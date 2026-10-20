import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class LoadingService {
  private pending = 0;
  private loadingSubject = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this.loadingSubject.asObservable();

  start(): void {
    this.pending++;
    if (this.pending === 1) this.loadingSubject.next(true);
  }

  stop(): void {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0) this.loadingSubject.next(false);
  }
}
