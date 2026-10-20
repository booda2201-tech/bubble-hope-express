import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { LanguageService } from './services/language.service';
import { LoadingService } from './services/loading.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  isLoading$: Observable<boolean>;

  constructor(loading: LoadingService, language: LanguageService) {
    this.isLoading$ = loading.isLoading$;
    void language.current;
  }
}
