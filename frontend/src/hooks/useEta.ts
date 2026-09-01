import { useEffect, useRef, useState } from 'react';

/** Estimates the remaining time (ms) for a running scan based on observed progress rate. */
export function useEta(processed: number, total: number, active: boolean): number | null {
  const [eta, setEta] = useState<number | null>(null);
  const ref = useRef<{ t: number; processed: number } | null>(null);

  useEffect(() => {
    if (!active || processed <= 0) {
      ref.current = null;
      setEta(null);
      return;
    }
    const now = Date.now();
    const prev = ref.current;
    if (prev) {
      const dt = now - prev.t;
      const dp = processed - prev.processed;
      if (dt > 500 && dp > 0) {
        const remaining = Math.max(0, total - processed);
        setEta((remaining / dp) * dt);
      }
    }
    ref.current = { t: now, processed };
  }, [processed, total, active]);

  return eta;
}

export function formatEta(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '–';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `ca. ${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `ca. ${min} min`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  return `ca. ${h} h ${restMin} min`;
}