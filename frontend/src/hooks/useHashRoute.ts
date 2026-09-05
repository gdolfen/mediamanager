import { useCallback, useEffect, useRef, useState } from 'react';

function parseHash(): { page: string; params: URLSearchParams } {
  const raw = window.location.hash.slice(1) || '/';
  const qIdx = raw.indexOf('?');
  const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const qs = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
  const page = path.replace(/^\//, '') || 'dashboard';
  return { page, params: new URLSearchParams(qs) };
}

function writeHash(page: string, params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null) as [string, string | number][];
  const qs = entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
  const hash = `#/${page}${qs}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash);
  }
}

export function useHashRoute(): [string, Record<string, string>, (page: string, params?: Record<string, string | number | undefined>) => void] {
  const [route, setRoute] = useState(() => {
    const { page, params } = parseHash();
    const obj: Record<string, string> = {};
    params.forEach((v, k) => { obj[k] = v; });
    return [page, obj] as [string, Record<string, string>];
  });

  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    const onHash = () => {
      const { page, params } = parseHash();
      const obj: Record<string, string> = {};
      params.forEach((v, k) => { obj[k] = v; });
      const next = [page, obj] as [string, Record<string, string>];
      if (JSON.stringify(next) !== JSON.stringify(routeRef.current)) {
        setRoute(next);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((page: string, params?: Record<string, string | number | undefined>) => {
    writeHash(page, params ?? {});
    const newRoute = parseHash();
    const obj: Record<string, string> = {};
    newRoute.params.forEach((v, k) => { obj[k] = v; });
    setRoute([newRoute.page, obj]);
  }, []);

  return [...route, navigate];
}
