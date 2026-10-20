import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private languageSubject = new BehaviorSubject<string>('ar');
  languageChanged$ = this.languageSubject.asObservable();

  constructor(private translate: TranslateService) {
    this.translate.addLangs(['ar', 'en']);
    this.translate.setDefaultLang('ar');
    const saved = localStorage.getItem('lang') || 'ar';
    this.switchLanguage(saved === 'en' ? 'en' : 'ar');
  }

  get current(): string {
    return this.languageSubject.value;
  }

  switchLanguage(language: string): void {
    const next = language === 'en' ? 'en' : 'ar';
    localStorage.setItem('lang', next);
    this.translate.use(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
    this.languageSubject.next(next);
  }

  toggle(): void {
    this.switchLanguage(this.current === 'ar' ? 'en' : 'ar');
  }
}
