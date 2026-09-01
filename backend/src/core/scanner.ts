import fs from 'node:fs';
import path from 'node:path';
import { extOf } from './naming.js';
import { isSupportedExt } from '../types.js';
import { bumpFormat } from '../db/daos.js';

export interface ScannedFile {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  /** File creation time in ms; null when the filesystem does not provide one. */
  birthtimeMs: number | null;
}

export interface WalkStats {
  dirs: number;
  files: number;
}

/** Verzeichnisse, die vom Scan komplett übersprungen werden (z. B. Papierkorb-Ordner). */
const SKIP_DIR_NAMES = new Set(['@Recycle']);

export interface WalkOptions {
  /**
   * Relative Verzeichnispfad (posix, z.B. '2024/01 Januar'), bis zu dem der Walk
   * in einem früheren Lauf bereits abgeschlossen wurde. Beim Fortsetzen werden
   * Teilbäume übersprungen, die garantiert vollständig abgelaufen wurden
   * (lexikografisch vor dem Resume-Punkt und keine Vorfahren davon).
   */
  skipDirsBefore?: string;
  /** Wird beim Betreten jedes Unterverzeichnisses (relativer Pfad) aufgerufen. */
  onDir?: (relDir: string) => void | Promise<void>;
}

/**
 * Stream a recursive directory walk (read-only) without collecting anything.
 * `onFile` is awaited for every file so callers can skip already-scanned files
 * on the fly instead of buffering the whole tree first (fast on big/network volumes).
 * `stats` is mutated live so the caller can show progress while walking.
 * When `shouldAbort` returns true the walk stops immediately.
 * Entries are visited in sorted order so a resumed walk can skip the subtrees
 * that were already completed (see `WalkOptions.skipDirsBefore`).
 */
export async function walkTree(base: string, onFile: (f: ScannedFile, stats: WalkStats) => void | Promise<void>, shouldAbort?: () => boolean, opts?: WalkOptions): Promise<WalkStats> {
  const stats: WalkStats = { dirs: 0, files: 0 };

  async function walk(dir: string, rel: string): Promise<void> {
    if (shouldAbort?.()) return;
    const skip = opts?.skipDirsBefore;
    if (rel && skip && rel < skip && !skip.startsWith(rel + '/')) return; // Teilbaum war schon vollständig abgelaufen
    if (rel !== '' && opts?.onDir) await opts.onDir(rel);
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (shouldAbort?.()) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        stats.dirs++;
        await walk(abs, rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = await fs.promises.stat(abs);
        } catch {
          continue;
        }
        stats.files++;
        const f: ScannedFile = {
          absPath: abs,
          relPath: path.relative(base, abs).replace(/\\/g, '/'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
        };
        await onFile(f, stats);
      }
    }
  }

  await walk(base, '');
  return stats;
}

/**
 * Stream the upload directory (read-only), updating the formats overview on the way.
 * Every file is handed to `onFile` immediately – no pre-collection, no sorting.
 * `shouldAbort` is forwarded to the walker so aborts stop the traversal.
 * `opts` is forwarded to the walker (resume support).
 */
export async function scanUpload(uploadBase: string, onFile: (f: ScannedFile, stats: WalkStats) => void | Promise<void>, shouldAbort?: () => boolean, opts?: WalkOptions): Promise<WalkStats> {
  return walkTree(uploadBase, (f, stats) => {
    const ext = extOf(path.basename(f.absPath));
    bumpFormat(ext, isSupportedExt(ext));
    return onFile(f, stats);
  }, shouldAbort, opts);
}