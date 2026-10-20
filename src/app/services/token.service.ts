import { Injectable } from '@angular/core';
import * as CryptoJS from 'crypto-js';

@Injectable({
  providedIn: 'root',
})
export class TokenService {
  private secretKey = 'your-32-character-secret-key';

  storeEncryptedToken(token: string): void {
    const encrypted = CryptoJS.AES.encrypt(token, this.secretKey).toString();
    localStorage.setItem('token', encrypted);
  }

  getDecryptedToken(): string | null {
    const encrypted = localStorage.getItem('token');
    if (!encrypted) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.secretKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted || decrypted === 'null' || decrypted === 'undefined') return null;
      return decrypted;
    } catch {
      return null;
    }
  }

  removeToken(): void {
    localStorage.removeItem('token');
  }

  hasToken(): boolean {
    return !!this.getDecryptedToken();
  }
}
