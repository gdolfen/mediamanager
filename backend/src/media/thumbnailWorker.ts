import { nextThumbnailBatch, removeThumbnailFromQueue, thumbnailQueueSize, countMediaFiles } from '../db/daos.js';
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
      const batch = nextThumbnailBatch(CONCURRENCY);
      if (batch.length === 0) break;
      await Promise.all(
        batch.map(async (id) => {
          try {
            if (!thumbnailExists(id)) await getOrCreateThumbnail(id);
          } finally {
            removeThumbnailFromQueue(id);
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