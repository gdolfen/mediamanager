import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { getFileById } from '../db/daos.js';
import { rootBase, thumbnailsDir } from '../db/database.js';
import { resolveBase, pathExists } from '../core/paths.js';
import type { FileRecord } from '../types.js';

const execFileP = promisify(execFile);

export async function resolveFileAbsolute(f: FileRecord): Promise<string | null> {
  if (f.targetRoot && f.targetRelPath) {
    const p = resolveBase(rootBase(f.targetRoot as 'fotos' | 'videos'), f.targetRelPath);
    if (await pathExists(p)) return p;
  }
  const p = resolveBase(rootBase(f.sourceRoot as 'upload'), f.sourceRelPath);
  return (await pathExists(p)) ? p : null;
}

export function thumbnailCachePath(fileId: number): string {
  return path.join(thumbnailsDir(), `${fileId}.jpg`);
}

export function thumbnailExists(fileId: number): boolean {
  return fs.existsSync(thumbnailCachePath(fileId));
}

/** In-flight generation promises: deduplicates concurrent requests for the same file. */
const pending = new Map<number, Promise<string | null>>();

/** Generate (or reuse cached) thumbnail for a file. Returns cache path or null on failure.
 *  Concurrent calls for the same fileId share a single generation. */
export function getOrCreateThumbnail(fileId: number): Promise<string | null> {
  const cache = thumbnailCachePath(fileId);
  if (fs.existsSync(cache)) return Promise.resolve(cache);
  const existing = pending.get(fileId);
  if (existing) return existing;
  const p = generateThumbnail(fileId, cache).finally(() => pending.delete(fileId));
  pending.set(fileId, p);
  return p;
}

async function generateThumbnail(fileId: number, cache: string): Promise<string | null> {
  const file = getFileById(fileId);
  if (!file) return null;
  const abs = await resolveFileAbsolute(file);
  if (!abs) return null;
  try {
    if (file.fileType === 'image') {
      await sharp(abs, { failOn: 'none' }).rotate().resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(cache);
      return fs.existsSync(cache) ? cache : null;
    }
    if (file.fileType === 'video' && ffmpegPath) {
      await execFileP(ffmpegPath, ['-ss', '1', '-i', abs, '-frames:v', '1', '-vf', 'scale=320:-2', '-y', cache], { maxBuffer: 8 * 1024 * 1024 });
      if (fs.existsSync(cache)) return cache;
    }
  } catch {
    try { fs.rmSync(cache, { force: true }); } catch { /* ignore */ }
  }
  return null;
}

export const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
  png: 'image/png',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
};

export function mimeFor(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}