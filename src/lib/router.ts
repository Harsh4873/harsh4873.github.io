import { useEffect, useState } from 'react';

// Minimal hash router. Hash keeps everything static-host friendly under
// /genes/ with no server rewrites, and makes comparison sets shareable by URL.

export interface Route {
  path: string; // e.g. 'home', 'browse', 'gene', 'compare', 'about'
  params: Record<string, string>;
  raw: string;
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const path = segments[0] || 'home';
  const params: Record<string, string> = {};
  if (segments[1]) params.id = decodeURIComponent(segments[1]);
  if (queryPart) {
    for (const kv of queryPart.split('&')) {
      const [k, v = ''] = kv.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { path, params, raw: clean };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  const target = to.startsWith('#') ? to : `#/${to}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function href(to: string): string {
  return to.startsWith('#') ? to : `#/${to}`;
}
