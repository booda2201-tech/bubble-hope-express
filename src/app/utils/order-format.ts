import { OrderItem } from '../models/order.model';

export function isArabic(lang: string | null | undefined): boolean {
  return lang === 'ar';
}

export function pickLocalized(
  lang: string,
  english: string | null | undefined,
  arabic: string | null | undefined
): string {
  const en = (english || '').trim();
  const ar = (arabic || '').trim();
  if (isArabic(lang)) return ar || en;
  return en || ar;
}

export function formatClock(createdAt: string): string {
  const match = createdAt?.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

export function loginPhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('20') && digits.length >= 12) digits = '0' + digits.slice(2);
  if (digits.length === 10 && digits.startsWith('1')) digits = '0' + digits;
  return digits;
}

export function dialPhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('200') && digits.length === 13) digits = '20' + digits.slice(3);
  if (digits.startsWith('0')) digits = '2' + digits;
  if (digits.length === 10 && digits.startsWith('1')) digits = '20' + digits;
  return digits ? `+${digits}` : '';
}

export function itemName(lang: string, item: OrderItem): string {
  const name = pickLocalized(lang, item.productName, item.productNameAr);
  const variant = pickLocalized(lang, item.variantName, item.variantNameAr);
  return variant ? `${name} · ${variant}` : name;
}