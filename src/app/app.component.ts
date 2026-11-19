import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthService } from './services/auth.service';
import { LanguageService } from './services/language.service';
import { LoadingService } from './services/loading.service';
import { PushService } from './services/push.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  isLoading$: Observable<boolean>;

  constructor(loading: LoadingService, language: LanguageService, auth: AuthService, push: PushService) {
    this.isLoading$ = loading.isLoading$;
    void language.current;
    if (auth.isLoggedIn()) void push.register(false);
  }
}
