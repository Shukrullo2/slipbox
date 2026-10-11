import { useEffect, useState } from 'react';
import type { Theme } from './palette';

export type ThemePref = 'system' | Theme;
const KEY = 'slipbox:theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  // Applied during render (not in an effect) so children that read CSS
  // variables while rendering, like the graph canvas, see the new theme.
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;

  const cycle = () => {
    const next: ThemePref = pref === 'system' ? (theme === 'dark' ? 'light' : 'dark') : 'system';
    setPref(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
  };

  return { theme, pref, cycle };
}

/** Reads a CSS custom property from :root, re-read whenever the theme changes. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
