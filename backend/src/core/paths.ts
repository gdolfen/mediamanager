import path from 'node:path';
import fs from 'node:fs';

export type RootKey = 'upload' | 'fotos' | 'videos';

export const ROOTS: RootKey[] = ['upload', 'fotos', 'videos'];

/** Async, non-blocking existence check (libuv thread pool) – keine Synchron-Prüfung auf Netzwerk-Shares. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface LogicalPath {
  root: RootKey;
  rel: string;
}

/** Normalize a relative path to forward slashes, no leading/trailing slash. */
export function normalizeRel(p: string): string {
  const cleaned = p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned;
}

/** Join a base path with a normalized relative path using platform separators. */
export function resolveBase(base: string, rel: string): string {
  const normalized = normalizeRel(rel);
  if (!normalized) return base;
  return path.join(base, ...normalized.split('/'));
}

/**
 * Convert an absolute path that lives under `base` into a normalized relative
 * path (forward slashes). Returns null if `abs` is not inside `base`.
 */
export function toRel(base: string, abs: string): string | null {
  const rel = path.relative(base, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return normalizeRel(rel);
}

export function toLogical(basePath: string, abs: string): LogicalPath | null {
  for (const root of ROOTS) {
    const base = basePath;
    const rel = toRel(base, abs);
    if (rel !== null) return { root, rel };
  }
  return null;
}

/** Build target relative path: year/month/day folders + filename. */
export function targetRelPath(year: number, month: number, day: number, filename: string): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year)}/${mm} ${MONTHS_GERMAN[month - 1]}/${year}_${mm}_${dd}/${filename}`;
}

export const MONTHS_GERMAN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Replace characters that are invalid in file/folder names. */
export function sanitizeFilenamePart(input: string, maxLen = 50): string {
  let s = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s || 'UNBENANNT';
}