import type { PartOfSpeech } from './types';

export type Theme = 'light' | 'dark';

/** Dictionary entries are colored by part of speech, like the labels in a printed dictionary. */
export const POS_INK: Record<PartOfSpeech, string> = {
  noun: 'prussian',
  verb: 'viridian',
  adjective: 'ochre',
  adverb: 'violet',
  phrase: 'teal',
  abbreviation: 'sepia',
  other: 'slate',
};
export const posColor = (pos: PartOfSpeech, theme: Theme) => inkColor(POS_INK[pos] ?? 'slate', theme);

// Technical-pen inks. Light values sit on engineering paper, dark values on blueprint.
export const INKS: Record<string, { light: string; dark: string; label: string }> = {
  prussian: { light: '#1F5A96', dark: '#8CBDF0', label: 'Prussian blue' },
  viridian: { light: '#22765A', dark: '#74D5A8', label: 'Viridian' },
  oxblood: { light: '#983248', dark: '#F394A8', label: 'Oxblood' },
  ochre: { light: '#9A6A10', dark: '#F1C460', label: 'Ochre' },
  violet: { light: '#5D449E', dark: '#BEA9F4', label: 'Violet' },
  teal: { light: '#10727D', dark: '#66D3DC', label: 'Teal' },
  sepia: { light: '#7A5230', dark: '#E0B892', label: 'Sepia' },
  slate: { light: '#4B5C6F', dark: '#BAC9D9', label: 'Slate' },
  olive: { light: '#5F6E16', dark: '#CCDB70', label: 'Olive' },
  magenta: { light: '#9C2F7C', dark: '#F093D6', label: 'Magenta' },
};

export function inkColor(color: string | undefined, theme: Theme): string {
  if (color && INKS[color]) return INKS[color][theme];
  if (color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color;
  return INKS.slate[theme];
}

export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
