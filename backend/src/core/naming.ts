import path from 'node:path';
import { isSupportedImageExt, isSupportedVideoExt, type FileType } from '../types.js';
import { sanitizeFilenamePart, targetRelPath } from './paths.js';

export function detectFileType(ext: string): FileType | null {
  if (isSupportedImageExt(ext)) return 'image';
  if (isSupportedVideoExt(ext)) return 'video';
  return null;
}

export function extOf(name: string): string {
  const ext = path.extname(name);
  return ext ? ext.slice(1).toLowerCase() : '';
}

/**
 * Original dateiname beibehalten: Blanks und unzulässige Zeichen werden durch
 * Unterstriche ersetzt, sonst bleibt der Name unverändert.
 */
export function sanitizeOriginalFilename(name: string, maxLen = 180): string {
  const base = path.basename(name);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const cleanStem = sanitizeFilenamePart(stem, maxLen).replace(/\s+/g, '_');
  const cleanExt = sanitizeFilenamePart(ext.slice(1), 20).replace(/\s+/g, '_');
  return cleanExt ? `${cleanStem}.${cleanExt}` : cleanStem;
}

/**
 * Zielnamen-Kandidaten in Reihenfolge der Bevorzugung:
 * 1. der originale Dateiname,
 * 2. der originale Name mit angehängtem Gerätenamen ("name_<gerät>.ext"),
 * 3. derselbe mit fortlaufender Nummer.
 */
export function targetFilenameCandidates(opts: {
  originalName: string;
  deviceMappedName: string | null;
  ext: string;
  maxExtra?: number;
}): string[] {
  const base = sanitizeOriginalFilename(opts.originalName);
  const ext = opts.ext ? `.${opts.ext}` : '';
  const stem = ext ? base.slice(0, -ext.length) : base;
  const rawDevice = opts.deviceMappedName?.trim();
  const device = rawDevice ? sanitizeFilenamePart(rawDevice, 40).replace(/\s+/g, '_') : '';
  const candidates = [base];
  if (device) candidates.push(`${stem}_${device}${ext}`);
  const maxExtra = opts.maxExtra ?? 50;
  for (let i = 2; i <= maxExtra; i++) {
    candidates.push(device ? `${stem}_${device}_${i}${ext}` : `${stem}_${i}${ext}`);
  }
  return candidates;
}

export interface TargetInfo {
  root: 'fotos' | 'videos';
  relPath: string;
  filename: string;
}

export function buildTargetInfo(takenAt: string, fileType: FileType, filename: string, deviceMappedName: string, ext: string): TargetInfo {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(takenAt);
  if (!m) throw new Error(`Invalid takenAt: ${takenAt}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const root = fileType === 'image' ? 'fotos' : 'videos';
  return {
    root,
    relPath: targetRelPath(year, month, day, filename),
    filename,
  };
}