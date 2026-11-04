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

/** "lat,lng" when both values are real coordinates, otherwise null. */
export function coordinates(lat: unknown, lng: unknown): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const valid =
    lat != null &&
    lng != null &&
    lat !== '' &&
    lng !== '' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  return valid ? `${latitude},${longitude}` : null;
}

/** Turn-by-turn driving directions from the driver's current position; opens the Maps app on phones. */
export function directionsUrl(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export function isMapLink(url: string | null | undefined): boolean {
  return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i.test(
    (url || '').trim()
  );
}

/** Building letters follow the abjad order used for blocks and zones (أ ب ج د ه و ز ح), mapped to A–H. */
const LATIN_TO_ARABIC: Record<string, string> = { A: 'أ', B: 'ب', C: 'ج', D: 'د', E: 'ه', F: 'و', G: 'ز', H: 'ح' };
const ARABIC_TO_LATIN: Record<string, string> = {
  أ: 'A', ا: 'A', إ: 'A', آ: 'A', ب: 'B', ج: 'C', د: 'D', ه: 'E', ة: 'E', و: 'F', ز: 'G', ح: 'H',
};
const UNIT_PATTERN = /^(\d+)\s*[-/.]?\s*([A-Za-z\u0621-\u064A])$|^([A-Za-z\u0621-\u064A])\s*[-/.]?\s*(\d+)$/;

/**
 * Customers type building / apartment numbers like "4B", "4-b", "B4" or "٤ ب"; this shows them the way
 * the driver reads them: "4 ب" in Arabic, "4B" in English. Anything else is returned as typed.
 */
export function unitNumber(lang: string, raw: string | null | undefined): string {
  const value = toWesternDigits((raw || '').trim().replace(/\s+/g, ' '));
  const match = value.match(UNIT_PATTERN);
  if (!match) return value;

  const number = match[1] ?? match[4];
  const letter = match[2] ?? match[3];
  if (isArabic(lang)) return `${number} ${LATIN_TO_ARABIC[letter.toUpperCase()] ?? letter}`;
  return `${number}${ARABIC_TO_LATIN[letter] ?? letter.toUpperCase()}`;
}

/**
 * The block / zone letter of an address in Arabic ("ب"), e.g. "منطقة ب" / "Area B" in the given texts,
 * or the letter attached to the building number ("4B", "4 ب"). Null when there is none.
 */
export function zoneLetter(zoneTexts: (string | null | undefined)[], building: string | null | undefined): string | null {
  for (const text of zoneTexts) {
    const named = (text || '').match(/(?:^|\s|،|,)(?:ال)?(?:منطق[ةه]|area|zone|block)\s*[(\-]?\s*([A-Za-z\u0621-\u064A])\s*\)?(?=\s|$|،|,)/i);
    if (named) return toArabicLetter(named[1]);
  }
  const unit = toWesternDigits((building || '').trim()).match(UNIT_PATTERN);
  const letter = unit && (unit[2] ?? unit[3]);
  return letter ? toArabicLetter(letter) : null;
}

function toArabicLetter(letter: string): string | null {
  const latin = LATIN_TO_ARABIC[letter.toUpperCase()];
  if (latin) return latin;
  if (/[اإآأ]/.test(letter)) return 'أ';
  if (letter === 'ة') return 'ه';
  return Object.prototype.hasOwnProperty.call(ARABIC_TO_LATIN, letter) ? letter : null;
}

function toWesternDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function itemName(lang: string, item: OrderItem): string {
  const name = pickLocalized(lang, item.productName, item.productNameAr);
  const variant = pickLocalized(lang, item.variantName, item.variantNameAr);
  return variant ? `${name} · ${variant}` : name;
}