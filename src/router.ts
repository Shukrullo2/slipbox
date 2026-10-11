import { useCallback, useEffect, useState } from 'react';

export type View = 'graph' | 'dictionary' | 'review' | 'timeline';
export interface Route {
  view: View;
  note?: string;
  domain?: string;
  word?: string;
  field?: string;
}

const VIEWS: View[] = ['graph', 'dictionary', 'review', 'timeline'];

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const view = (VIEWS as string[]).includes(path) ? (path as View) : 'graph';
  return {
    view,
    note: params.get('note') ?? undefined,
    domain: params.get('domain') ?? undefined,
    word: params.get('word') ?? undefined,
    field: params.get('field') ?? undefined,
  };
}

export function toHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.note) params.set('note', route.note);
  else if (route.domain) params.set('domain', route.domain);
  if (route.word) params.set('word', route.word);
  if (route.field) params.set('field', route.field);
  const qs = params.toString();
  return `#/${route.view}${qs ? `?${qs}` : ''}`;
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Route, opts: { replace?: boolean } = {}) => {
    const hash = toHash(next);
    if (hash === location.hash) return;
    if (opts.replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
    setRoute(parse(hash));
  }, []);

  return { route, navigate };
}
