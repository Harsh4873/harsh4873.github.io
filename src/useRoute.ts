import { useEffect, useState } from 'react';
import { navigation, routeTitles, type RouteId } from './content';

const validRoutes = new Set<RouteId>(navigation.map((item) => item.id));

function routeFromHash(): RouteId {
  const candidate = window.location.hash.replace(/^#\/?/, '').split('/')[0] as RouteId;
  return validRoutes.has(candidate) ? candidate : 'start';
}

export function routeHref(route: RouteId): string {
  return '#/' + route;
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(routeFromHash);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', routeHref('start'));
    }

    const handleHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', handleHashChange);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.title = routeTitles[route];
  }, [route]);

  return route;
}
