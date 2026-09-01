/**
 * Pacing-Helfer für Scans/Transfers: gibt dem Event-Loop zwischen einzelnen
 * Dateien Zeit (setImmediate) und wartet optional ein paar Millisekunden,
 * damit I/O, CPU und Netzwerk (NAS) nicht überlastet werden, gerade wenn
 * mehrere Scans parallel laufen.
 */
export const PACING_MS = 3;

export async function scanPace(): Promise<void> {
  if (PACING_MS > 0) await new Promise((r) => setTimeout(r, PACING_MS));
  await new Promise((r) => setImmediate(r));
}

/** Nur dem Event-Loop Platz geben, ohne Verzögerung. */
export async function yieldToEventLoop(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}