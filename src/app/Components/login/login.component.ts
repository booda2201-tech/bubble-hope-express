import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { loginPhone } from '../../utils/order-format';

function egyptianMobile(control: AbstractControl): ValidationErrors | null {
  return /^01[0125]\d{8}$/.test(loginPhone(String(control.value || ''))) ? null : { phone: true };
}

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  submitting = false;
  showPassword = false;
  errorMessage = '';

  form = this.fb.group({
    phoneNumber: ['', [Validators.required, egyptianMobile]],
    password: ['', [Validators.required, Validators.minLength(4)]],
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private translate: TranslateService
  ) {}

  submit(): void {
    this.errorMessage = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const phoneNumber = loginPhone(this.form.controls.phoneNumber.value || '');
    const password = (this.form.controls.password.value || '').trim();
    this.submitting = true;

    this.auth
      .driverLogin(phoneNumber, password)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: (response) => {
          if (!this.auth.isDriverAccount(response)) {
            this.errorMessage = this.translate.instant('login.notDriver');
            return;
          }
          if (this.auth.persistSession(response, phoneNumber)) {
            void this.router.navigate(['/orders']);
            return;
          }
          this.errorMessage = this.readMessage(response) || this.translate.instant('login.noToken');
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = this.readMessage(error.error) || this.translate.instant('login.failed');
        },
      });
  }

  private readMessage(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const bag = payload as Record<string, unknown>;
    const arabic = this.translate.currentLang === 'ar';
    const preferred = arabic
      ? bag['messageAr'] || bag['message_ar'] || bag['message']
      : bag['message'] || bag['messageAr'] || bag['message_ar'];
    return typeof preferred === 'string' ? preferred : '';
  }
}
