import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'mtbscope-theme';

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) || 'system');

  useEffect(() => {
    apply(theme);
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  }, [theme]);

  // Cycle light -> dark -> system.
  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light'));
  return [theme, toggle];
}
