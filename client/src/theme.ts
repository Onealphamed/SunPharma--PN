// Light / dark theme. public/theme-init.js sets the starting theme before first paint;
// this keeps it in sync: a choice made with the toggle is remembered on this device,
// otherwise the device setting is followed (including when it changes).
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'sunpm.theme';

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const deviceDark = () => !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const apply = (t: Theme) => document.documentElement.setAttribute('data-theme', t);

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => saved() ?? (deviceDark() ? 'dark' : 'light'));

  useEffect(() => apply(theme), [theme]);

  // Follow the device setting until the user picks a theme.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      if (!saved()) setTheme(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () =>
    setTheme(t => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage unavailable: the choice lasts for this visit */
      }
      return next;
    });

  return [theme, toggle];
}
