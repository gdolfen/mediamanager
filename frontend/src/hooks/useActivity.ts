import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { usePolling } from './usePolling';

/** True, solange irgendein Prozess (Scan, Transfer, Neubewertung, Rescan) läuft. */
export function useActivity(intervalMs = 5000): boolean {
  const [running, setRunning] = useState(false);
  const load = useCallback(async () => {
    try {
      const s = await api.stats();
      setRunning(s.running);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, intervalMs, true);
  return running;
}
