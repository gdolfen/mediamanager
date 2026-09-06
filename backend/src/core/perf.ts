import { logger } from '../db/logger.js';

/**
 * Per-Datei-Timing für die Analyse-Phase (Upload-Scan, Ziel-Scan, Recheck, Rescan).
 * read/hash/md5 teilen sich einen Stream (hashFile berechnet sha256+md5 in einem
 * Durchgang) und tragen daher dieselbe Zeit.
 */
export interface FilePerf {
  t0: number;
  read: number;
  hash: number;
  md5: number;
  exif: number;
  device: number;
  db: number;
  thumb: number;
}

export function perfStart(): FilePerf {
  return { t0: performance.now(), read: 0, hash: 0, md5: 0, exif: 0, device: 0, db: 0, thumb: 0 };
}

export type PerfKey = keyof Omit<FilePerf, 't0'>;

/** Misst einen (ggf. synchronen) Abschnitt und addiert ihn auf den Key. */
export async function perfMark<T>(p: FilePerf, key: PerfKey, fn: () => Promise<T> | T): Promise<T> {
  const s = performance.now();
  try {
    return await fn();
  } finally {
    p[key] += performance.now() - s;
  }
}

export function perfLog(kind: 'upload' | 'fotos' | 'videos', relPath: string, p: FilePerf, extra?: string): void {
  const total = Math.round(performance.now() - p.t0);
  const ms = (n: number) => `${Math.round(n)}ms`;
  logger.info(
    'perf',
    `${kind}/${relPath}: read=${ms(p.read)} hash=${ms(p.hash)} md5=${ms(p.md5)} exif=${ms(p.exif)} device=${ms(p.device)} db=${ms(p.db)} thumb=${ms(p.thumb)} total=${ms(total)}${extra ? ` ${extra}` : ''}`,
    { console: false },
  );
}
