import { getDb } from '../db/database.js';
import { logger } from '../db/logger.js';

/**
 * Live-Kalibrierung der Datei-ETAs aus gemessenen Analyse-Zeiten.
 *
 * Pro (Dateityp, Größen-Bucket) wird ein Reservoir-Sample (max 64 Messwerte)
 * in der DB gehalten und mit jedem Scan verbessert (uniformes Reservoir-Sampling
 * über alle je gesehenen Messwerte). Die ETA ist das 75. Perzentil des Buckets –
 * bewusst leicht konservativ, damit Restzeiten eher halten als reißen.
 * Buckets mit < 5 Messwerten fallen auf das statische Prior-Modell zurück
 * (kalibriert 2026-09: NAS bulk ~55 MB/s + Fix-Overhead je Typ).
 */

const RESERVOIR_SIZE = 64;
const MIN_SAMPLES = 5;
const ETA_PERCENTILE = 75;

const FALLBACK_THROUGHPUT_BPS = 55 * 1024 * 1024;
const FALLBACK_OVERHEAD_MS: Record<string, number> = { image: 500, video: 2000, other: 500 };

type Row = Record<string, unknown>;

interface Bucket {
  n: number;
  samples: number[];
}

const buckets = new Map<string, Bucket>();
const pending = new Map<string, number[]>();

export function bucketKey(fileType: string | null, sizeBytes: number | null): string {
  const bucket = sizeBytes == null ? 'na' : Math.min(40, Math.floor(Math.log2(Math.max(1, sizeBytes))));
  return `${fileType ?? 'unknown'}:${bucket}`;
}

function fallbackMs(fileType: string | null, sizeBytes: number | null): number {
  const overhead = FALLBACK_OVERHEAD_MS[fileType ?? ''] ?? 500;
  return Math.round(overhead + (Math.max(0, sizeBytes ?? 0) / FALLBACK_THROUGHPUT_BPS) * 1000);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** ETA für eine Datei: P75 des Buckets oder Fallback-Modell bei zu wenig Daten. */
export function estimateFileMs(fileType: string | null, sizeBytes: number | null): number {
  const b = buckets.get(bucketKey(fileType, sizeBytes));
  if (!b || b.n < MIN_SAMPLES || b.samples.length === 0) return fallbackMs(fileType, sizeBytes);
  return Math.round(percentile([...b.samples].sort((x, y) => x - y), ETA_PERCENTILE));
}

/** Messwert sammeln (nur vollständig analysierte Dateien – kein Skip/Fehler). */
export function recordSample(fileType: string | null, sizeBytes: number | null, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const key = bucketKey(fileType, sizeBytes);
  let arr = pending.get(key);
  if (!arr) {
    arr = [];
    pending.set(key, arr);
  }
  arr.push(ms);
}

/** Kalibrierung aus der DB laden (Boot / Worker-Start). */
export function loadCalibration(): void {
  try {
    const rows = getDb().prepare('SELECT file_type, size_bucket, n, samples FROM eta_buckets').all() as Row[];
    buckets.clear();
    for (const r of rows) {
      try {
        const samples = JSON.parse((r.samples as string) ?? '[]') as number[];
        if (Array.isArray(samples)) {
          buckets.set(`${r.file_type}:${r.size_bucket}`, { n: (r.n as number) ?? 0, samples: samples.filter((v) => Number.isFinite(v)).slice(0, RESERVOIR_SIZE) });
        }
      } catch {
        /* ignore corrupt row */
      }
    }
  } catch (err) {
    logger.warn('scan', `Kalibrierung konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Gesammelte Messwerte in die DB-Reservoirs mergen. */
export function flushCalibration(): void {
  if (pending.size === 0) return;
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const [key, values] of pending) {
      if (!values.length) continue;
      const sep = key.lastIndexOf(':');
      const fileType = key.slice(0, sep);
      const sizeBucket = key.slice(sep + 1);
      const row = db.prepare('SELECT n, samples FROM eta_buckets WHERE file_type = ? AND size_bucket = ?').get(fileType, sizeBucket) as Row | undefined;
      let n = 0;
      let reservoir: number[] = [];
      if (row) {
        n = (row.n as number) ?? 0;
        try {
          const parsed = JSON.parse((row.samples as string) ?? '[]') as number[];
          if (Array.isArray(parsed)) reservoir = parsed.filter((v) => Number.isFinite(v));
        } catch {
          reservoir = [];
        }
      }
      // Uniformes Reservoir-Sampling über alle je gesehenen Werte.
      for (const v of values) {
        n++;
        if (reservoir.length < RESERVOIR_SIZE) {
          reservoir.push(v);
        } else {
          const j = Math.floor(Math.random() * n);
          if (j < RESERVOIR_SIZE) reservoir[j] = v;
        }
      }
      db.prepare(
        `INSERT INTO eta_buckets (file_type, size_bucket, n, samples, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(file_type, size_bucket) DO UPDATE SET n = excluded.n, samples = excluded.samples, updated_at = datetime('now')`,
      ).run(fileType, sizeBucket, n, JSON.stringify(reservoir));
      buckets.set(key, { n, samples: reservoir });
    }
    pending.clear();
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    pending.clear();
    throw err;
  }
}

/** Kompakte Kalibrierungs-Übersicht fürs Log (Vergleich Messung vs. Modell). */
export function calibrationSummary(): string {
  const lines: string[] = [];
  const keys = [...buckets.keys()].sort();
  for (const key of keys) {
    const b = buckets.get(key)!;
    if (b.samples.length === 0) continue;
    const sorted = [...b.samples].sort((x, y) => x - y);
    lines.push(`${key}: n=${b.n} p50=${Math.round(percentile(sorted, 50))}ms p75=${Math.round(percentile(sorted, 75))}ms`);
  }
  return lines.length ? lines.join(' | ') : 'keine Daten';
}
