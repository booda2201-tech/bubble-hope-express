import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { LanguageService } from '../../../services/language.service';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
})
export class MainLayoutComponent {
  constructor(
    public auth: AuthService,
    public language: LanguageService,
    private router: Router
  ) {}

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/auth/login']);
  }
}
