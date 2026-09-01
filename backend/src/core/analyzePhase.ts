import fs from 'node:fs';
import path from 'node:path';
import { nextIndexedFiles } from '../db/daos.js';
import { rootBase } from '../db/database.js';
import { scanPace } from './pace.js';

const ANALYZE_BATCH = 20;

export interface AnalyzeItem {
  id: number;
  sourceRoot: string;
  relPath: string;
}

export interface AnalyzeFile {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  birthtimeMs: number | null;
}

export interface AnalyzeCallbacks {
  shouldAbort: () => boolean;
  onFile: (item: AnalyzeItem, file: AnalyzeFile) => Promise<void>;
  onProgress: (analyzed: number) => void;
  onError: (msg: string) => void;
  onScanned: () => void;
}

/**
 * Shared Phase 2 analyze loop for all scan types.
 * Fetches indexed files in batches, processes them in parallel.
 */
export async function runAnalyzePhase(
  roots: string[],
  callbacks: AnalyzeCallbacks,
): Promise<number> {
  let analyzed = 0;

  while (!callbacks.shouldAbort()) {
    const batch: AnalyzeItem[] = [];
    for (const root of roots) {
      const remaining = ANALYZE_BATCH - batch.length;
      if (remaining <= 0) break;
      const items = nextIndexedFiles(root, remaining);
      batch.push(...items.map((i) => ({ ...i, sourceRoot: root })));
    }
    if (!batch.length) break;

    await Promise.all(batch.map(async (item) => {
      if (callbacks.shouldAbort()) return;
      const base = rootBase(item.sourceRoot as 'upload' | 'fotos' | 'videos');
      const abs = path.join(base, item.relPath);
      try {
        const stat = await fs.promises.stat(abs);
        if (stat.isFile()) {
          await callbacks.onFile(item, {
            absPath: abs,
            relPath: item.relPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
          });
        }
      } catch (err) {
        callbacks.onError(`${item.sourceRoot}/${item.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      callbacks.onScanned();
      await scanPace();
    }));

    analyzed += batch.length;
    callbacks.onProgress(analyzed);
  }

  return analyzed;
}
