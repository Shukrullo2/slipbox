import { hasArabic } from '../shared/languages.js';

/**
 * Attributes for an element showing a word or translation: Arabic text gets
 * lang="ar" (the Naskh font, sized so harakat are legible) and right-to-left.
 */
export function textProps(text: string | undefined, language?: string): { lang?: string; dir?: 'rtl' | 'auto' } {
  if (language === 'ar' || hasArabic(text)) return { lang: 'ar', dir: 'rtl' };
  if (language === 'fa' || language === 'ur') return { lang: language, dir: 'rtl' };
  return {};
}
