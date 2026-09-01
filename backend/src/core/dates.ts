/** Local wall-clock helpers. All dates are stored as local ISO "YYYY-MM-DDTHH:mm:ss" (no offset). */

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parseLocalIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localDateKey(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Convert an arbitrary date (e.g. from exif) to a local ISO string. */
export function normalizeDate(d: Date): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return toLocalIso(d);
}

/**
 * Try to extract a date from a filename.
 * Supports: IMG_20240101_123456, VID_20240101_123456, PXL_20240101_123456789,
 * 20240101_123456, 2024-01-01_12-34-56, 20240101-123456, IMG-20240101-WA0001, DSC_0001 (none).
 */
export function parseDateFromFilename(name: string): Date | null {
  const base = name.replace(/\.[^.]+$/, '');
  const patterns: RegExp[] = [
    /(?:^|_)(?:IMG|VID)-(\d{4})(\d{2})(\d{2})-WA\d+/,
    /(?:^|_)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,
    /(?:^|_)(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})/,
    /(?:^|_)(\d{4})-(\d{2})-(\d{2})[_\s](\d{2})-(\d{2})-(\d{2})/,
    /(?:^|_)(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/,
    /(?:^|_)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})/,
    /(?:^|_)(\d{4})-(\d{2})-(\d{2})[_\s](\d{2})[.:](\d{2})/,
    /(?:^|_)(\d{4})(\d{2})(\d{2})/,
    /(?:^|_)(\d{4})-(\d{2})-(\d{2})/,
    /(?:^|_)(\d{4})-(\d{2})-(\d{2})[T](\d{2}):(\d{2}):(\d{2})/,
  ];
  for (const re of patterns) {
    const m = re.exec(base);
    if (!m) continue;
    const [y, mo, d, h = '0', mi = '0', s = '0'] = [m[1], m[2], m[3], m[4], m[5], m[6]];
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 1980 && date.getFullYear() <= 2100) {
      return date;
    }
  }
  return null;
}

/** Different calendar day? */
export function differsByDay(a: string, b: string): boolean {
  const ka = localDateKey(a);
  const kb = localDateKey(b);
  return ka !== null && kb !== null && ka !== kb;
}

/** WhatsApp media can be recognized by its filename: IMG-YYYYMMDD-WA#### or VID-YYYYMMDD-WA####. */
export function isWhatsAppFilename(name: string): boolean {
  return /^(?:IMG|VID)-\d{8}-WA\d+/i.test(name.replace(/\.[^.]+$/, ''));
}

export function dayDiff(a: string, b: string): number {
  const da = parseLocalIso(a);
  const db = parseLocalIso(b);
  if (!da || !db) return Infinity;
  return Math.abs(da.getTime() - db.getTime());
}