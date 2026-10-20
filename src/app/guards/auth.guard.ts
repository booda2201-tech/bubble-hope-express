import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TokenService } from '../services/token.service';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const tokenService = inject(TokenService);
  if (tokenService.hasToken()) return true;
  return router.parseUrl('/auth/login');
};

export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  const tokenService = inject(TokenService);
  if (!tokenService.hasToken()) return true;
  return router.parseUrl('/orders');
};
