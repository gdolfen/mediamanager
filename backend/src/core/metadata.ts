import exifr from 'exifr';
import { execFile } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import { promisify } from 'node:util';
import { normalizeDate, toLocalIso } from './dates.js';

const execFileP = promisify(execFile);

export interface ImageMeta {
  /** Local ISO string */
  takenAt: string | null;
  make: string | null;
  model: string | null;
  /** Full metadata blob stored in the DB for later analysis without rescan. */
  meta: Record<string, unknown>;
}

export interface VideoMeta {
  /** Local ISO string */
  takenAt: string | null;
  make: string | null;
  model: string | null;
  duration: number | null;
  /** Full metadata blob stored in the DB for later analysis without rescan. */
  meta: Record<string, unknown>;
}

function pickDate(exifDate: Date | string | number | undefined | null): string | null {
  if (exifDate == null) return null;
  const d = exifDate instanceof Date ? exifDate : new Date(exifDate as string | number);
  return normalizeDate(d);
}

const IMAGE_META_PICK = [
  'Make',
  'Model',
  'Software',
  'LensModel',
  'LensMake',
  'Orientation',
  'ImageWidth',
  'ImageHeight',
  'ExposureTime',
  'FNumber',
  'ISOSpeedRatings',
  'FocalLength',
  'Artist',
  'Copyright',
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'DateTimeOriginal',
  'CreateDate',
  'ModifyDate',
] as const;

export async function readImageMeta(filePath: string): Promise<ImageMeta> {
  try {
    const data = await exifr.parse(filePath, {
      pick: [...IMAGE_META_PICK],
    });
    if (!data) return { takenAt: null, make: null, model: null, meta: {} };
    const make = typeof data.Make === 'string' ? data.Make.trim() : null;
    const model = typeof data.Model === 'string' ? data.Model.trim() : null;
    const takenAt =
      pickDate(data.DateTimeOriginal as Date | string | undefined) ??
      pickDate(data.CreateDate as Date | string | undefined) ??
      pickDate(data.ModifyDate as Date | string | undefined);
    const meta: Record<string, unknown> = {};
    for (const key of IMAGE_META_PICK) {
      if (data[key] !== undefined) meta[key] = data[key];
    }
    return { takenAt, make, model, meta };
  } catch {
    return { takenAt: null, make: null, model: null, meta: {} };
  }
}

async function runFfprobe(filePath: string): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await execFileP(ffprobe.path, ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], { maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function readVideoMeta(filePath: string): Promise<VideoMeta> {
  const info = await runFfprobe(filePath);
  const format = (info.format ?? {}) as Record<string, unknown>;
  const tags = (format.tags ?? {}) as Record<string, string>;
  const make = (tags['com.apple.quicktime.make'] ?? null)?.trim() || null;
  const model = (tags['com.apple.quicktime.model'] ?? null)?.trim() || null;

  let takenAt: string | null = null;
  const creationTime = tags.creation_time ?? tags['com.apple.quicktime.creationdate'];
  if (creationTime) {
    const d = new Date(creationTime);
    if (!Number.isNaN(d.getTime())) takenAt = toLocalIso(d);
  }

  const durationRaw = format.duration;
  const duration = typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null;

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tags)) {
    meta[key] = value;
  }
  if (format.duration !== undefined) meta.duration = format.duration;
  if (format.bit_rate !== undefined) meta.bit_rate = format.bit_rate;
  if (format.format_long_name !== undefined) meta.format_long_name = format.format_long_name;

  return { takenAt, make, model, duration, meta };
}