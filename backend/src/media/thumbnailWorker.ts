import { nextThumbnailBatch, removeThumbnailFromQueue, thumbnailQueueSize, countMediaFiles } from '../db/daos.js';
import { log } from '../db/logger.js';
import { getOrCreateThumbnail, thumbnailExists } from './media.js';
import { scanPace } from '../core/pace.js';

const CONCURRENCY = 2;
let running = false;
let timer: NodeJS.Timeout | null = null;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      let batch: number[];
      try {
        batch = nextThumbnailBatch(CONCURRENCY);
      } catch (err) {
        // Transienter DB-Fehler (z.B. SQLITE_BUSY) – nächsten Tick erneut versuchen,
        // statt den Prozess mit einer unbehandelten Rejection zu beenden.
        log('warn', 'thumbnails', `Queue-Abruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
      if (batch.length === 0) break;
      await Promise.all(
        batch.map(async (id) => {
          try {
            if (!thumbnailExists(id)) await getOrCreateThumbnail(id);
          } catch (err) {
            log('warn', 'thumbnails', `Thumbnail ${id} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            try {
              removeThumbnailFromQueue(id);
            } catch (err) {
              // Eintrag bleibt in der Queue und wird beim nächsten Tick erneut versucht.
              log('warn', 'thumbnails', `Queue-Eintrag ${id} konnte nicht entfernt werden: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }),
      );
      await scanPace();
    }
  } finally {
    running = false;
  }
}

export function startThumbnailWorker(intervalMs = 750): void {
  if (timer) return;
  timer = setInterval(() => {
    void pump();
  }, intervalMs);
}

export function stopThumbnailWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function thumbnailQueueStatus(): { pending: number; total: number } {
  return { pending: thumbnailQueueSize(), total: countMediaFiles() };
}