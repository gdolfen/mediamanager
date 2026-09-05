export type RunKind = 'transfer' | 'uploadScan' | 'targetScan' | 'recheck' | 'rescan' | 'transferredCheck';

const EXCLUSIVE_KINDS: readonly RunKind[] = ['transfer', 'recheck', 'rescan', 'transferredCheck'];

const active = new Set<RunKind>();

/**
 * Ziel-Scan und Upload-Scan dürfen parallel laufen; Transfer und
 * Neubewertung sind exklusiv und warten, bis keine Scans mehr aktiv sind,
 * damit I/O, CPU und Netzwerk nicht überlastet werden.
 */
export function tryAcquire(kind: RunKind): boolean {
  if (active.has(kind)) return false;
  const anyExclusive = [...active].some((k) => EXCLUSIVE_KINDS.includes(k));
  if (anyExclusive) return false;
  if (EXCLUSIVE_KINDS.includes(kind) && active.size > 0) return false;
  active.add(kind);
  return true;
}

export function release(kind: RunKind): void {
  active.delete(kind);
}

/** First active kind or null (kept for compatibility). */
export function getActive(): RunKind | null {
  return active.values().next().value ?? null;
}

export function hasActiveScans(): boolean {
  return [...active].some((k) => !EXCLUSIVE_KINDS.includes(k));
}

export function activeKinds(): RunKind[] {
  return [...active];
}