// Languages a dictionary entry can be in, and that translations can be given in.
// Codes are ISO 639-1 where one exists. Shared by the server and the client.

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbekcha' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
  { code: 'kk', name: 'Kazakh', native: 'Қазақша' },
  { code: 'ky', name: 'Kyrgyz', native: 'Кыргызча' },
  { code: 'tg', name: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ur', name: 'Urdu', native: 'اردو', rtl: true },
  { code: 'other', name: 'Other', native: 'Other' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));
const byName = new Map(LANGUAGES.flatMap((l) => [[l.name.toLowerCase(), l.code], [l.native.toLowerCase(), l.code]]));

/** Accepts a code ("uz"), an English name ("Uzbek") or a native name ("Oʻzbekcha"); unknown → "other". */
export function languageCode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (byCode.has(v)) return v;
  return byName.get(v) ?? 'other';
}

/** @param {string} code */
export function languageName(code) {
  return byCode.get(code)?.name ?? code;
}

export function isRtl(code) {
  return !!byCode.get(code)?.rtl;
}

/** The default set of languages to translate into. */
export const DEFAULT_TARGETS = ['en', 'uz', 'ru', 'ar'];

/** A guess at a word's language from its script, for entries that don't say. */
export function detectLanguage(text) {
  const s = String(text ?? '');
  if (/[Ѐ-ӿ]/.test(s)) return 'ru';
  if (/[؀-ۿݐ-ݿ]/.test(s)) return 'ar';
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[ऀ-ॿ]/.test(s)) return 'hi';
  return 'en';
}

// ---------- Arabic script ----------

const ARABIC_LETTER = /[ء-يٱ-ۓۺ-ۿ]/;
/** Harakat and other Arabic vowel and Quranic marks, plus tatweel. */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const HARAKAT = /[ً-ْ]/;

export const hasArabic = (text) => ARABIC_LETTER.test(String(text ?? ''));
export const stripHarakat = (text) => String(text ?? '').replace(ARABIC_MARKS, '');
/** Arabic letters present but no vowel marks at all. */
export const needsHarakat = (text) => hasArabic(text) && !HARAKAT.test(String(text ?? ''));

/**
 * The same letters, ignoring vowel marks, hamza seats on alef and spacing. Used to
 * check that adding harakat changed nothing else.
 */
export function sameLetters(a, b) {
  const base = (s) => stripHarakat(s).replace(/[آأإٱ]/g, 'ا').replace(/\s+/g, ' ').trim();
  return base(a) === base(b);
}

/** Lowercased, with Arabic vowel marks removed: «مَفْهُوم» and «مفهوم» match. */
export function foldText(text) {
  return stripHarakat(String(text ?? '')).toLowerCase();
}
