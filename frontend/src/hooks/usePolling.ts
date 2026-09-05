import { useEffect, useRef, useCallback } from 'react';

/**
 * Shared polling hook.
 * - Only polls when `active` is true (data needed on current page)
 * - Skips if previous poll is still in-flight (mutex)
 * - Cleans up on unmount / deactivate
 */
export function usePolling(fn: () => Promise<void>, intervalMs: number, active: boolean): void {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await fnRef.current(); } finally { inFlight.current = false; }
  }, []);

  useEffect(() => {
    if (!active) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    tick();
    pollRef.current = setInterval(tick, intervalMs);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [active, intervalMs, tick]);
}
