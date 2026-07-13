import { useEffect, useRef } from 'react';
import { Dna, Moon, Sun, MonitorSmartphone } from 'lucide-react';
import type { Gene } from '../lib/types';
import { href, navigate, useRoute } from '../lib/router';
import { useTheme } from '../lib/theme';
import { GeneSearch } from './GeneSearch';

const NAV = [
  { path: 'home', label: 'Overview' },
  { path: 'browse', label: 'Browse' },
  { path: 'compare', label: 'Compare' },
  { path: 'datasets', label: 'Datasets' },
  { path: 'about', label: 'About' },
];

export function Layout({ genes, children }: { genes: Gene[]; children: React.ReactNode }) {
  const route = useRoute();
  const [theme, toggleTheme] = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the global search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = route.path === 'gene' ? 'browse' : route.path;

  return (
    <div className="app">
      <header className="topnav">
        <a className="brand" href={href('home')} aria-label="MtbScope home">
          <span className="logo"><Dna size={18} /></span>
          <span>
            MtbScope<br />
            <small>M. tuberculosis H37Rv</small>
          </span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.path} className={`nav-link${active === n.path ? ' active' : ''}`} href={href(n.path)}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="nav-spacer" />
        <GeneSearch genes={genes} focusRef={searchRef} />
        <button className="icon-btn" onClick={toggleTheme} title={`Theme: ${theme}`} aria-label="Toggle theme">
          {theme === 'light' ? <Sun size={17} /> : theme === 'dark' ? <Moon size={17} /> : <MonitorSmartphone size={16} />}
        </button>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer className="footer">
        <div>
          MtbScope · a faster, comparison-first reimagining of the{' '}
          <a href="https://orca2.tamu.edu/U19/" target="_blank" rel="noopener noreferrer">TB Genome Portal</a>.{' '}
          Gene catalog from the H37Rv reference annotation. Analytical panels are representative demonstration data —{' '}
          <a href={href('about')} onClick={() => navigate('about')}>details</a>.
        </div>
      </footer>
    </div>
  );
}
