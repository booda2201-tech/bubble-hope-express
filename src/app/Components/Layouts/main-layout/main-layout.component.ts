import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { LanguageService } from '../../../services/language.service';
import { PushService } from '../../../services/push.service';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
})
export class MainLayoutComponent {
  constructor(
    public auth: AuthService,
    public language: LanguageService,
    private router: Router,
    private push: PushService
  ) {}

  /** Drops this phone's push subscription first, while the token can still authorize the request. */
  async logout(): Promise<void> {
    await Promise.race([this.push.unsubscribe(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    this.auth.logout();
    void this.router.navigate(['/auth/login']);
  }
}
