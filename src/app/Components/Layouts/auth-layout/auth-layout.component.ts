import { Component } from '@angular/core';
import { LanguageService } from '../../../services/language.service';

@Component({
  selector: 'app-auth-layout',
  templateUrl: './auth-layout.component.html',
  styleUrls: ['./auth-layout.component.scss'],
})
export class AuthLayoutComponent {
  constructor(public language: LanguageService) {}
}
