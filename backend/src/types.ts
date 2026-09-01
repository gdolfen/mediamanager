export type FileType = 'image' | 'video' | 'other';
export type DateSource = 'exif' | 'quicktime' | 'file' | 'filename' | 'override';
export type OverrideSource = 'file' | 'meta' | 'filename';
export type FileStatus = 'pending' | 'transferred' | 'problem';
export type ProblemType =
  | 'UNKNOWN_DEVICE'
  | 'NO_META_DATE'
  | 'DATE_MISMATCH_META'
  | 'DATE_MISMATCH_FILENAME'
  | 'TARGET_EXISTS'
  | 'UNSUPPORTED_FORMAT'
  | 'READ_ERROR'
  | 'DEVICE_PERIOD_DEVIATION'
  | 'FILE_MTIME_BEFORE_BIRTHTIME'
  | 'LIBRARY_META_FILENAME_MISMATCH'
  | 'LIBRARY_META_FILETIME_MISMATCH'
  | 'LIBRARY_FILENAME_FILETIME_MISMATCH'
  | 'LIBRARY_PATH_MISMATCH';
export type ProblemSeverity = 'info' | 'warning' | 'error';

export interface DeviceIdentifier {
  id: number;
  kind: 'exif' | 'filename' | 'path';
  value: string;
}

export interface Device {
  id: number;
  mappedName: string;
  person: string | null;
  createdAt: string;
  identifiers: DeviceIdentifier[];
  usagePeriod: { min: string | null; max: string | null } | null;
}

export interface FileRecord {
  id: number;
  hash: string | null;
  md5: string | null;
  sourceRoot: string;
  sourceRelPath: string;
  sourceSize: number | null;
  sourceMtime: number | null;
  fileType: FileType;
  ext: string;
  originalName: string;
  targetRoot: string | null;
  targetRelPath: string | null;
  deviceId: number | null;
  deviceRaw: string | null;
  make: string | null;
  model: string | null;
  takenAt: string | null;
  dateSource: DateSource | null;
  overrideDate: string | null;
  overrideSource: OverrideSource | null;
  status: FileStatus;
  transferredAt: string | null;
  createdAt: string;
  updatedAt: string;
  isWhatsApp: boolean;
  meta: Record<string, unknown> | null;
  deviceMappedName?: string | null;
  devicePerson?: string | null;
  problems?: Problem[];
}

export interface Problem {
  id: number;
  fileId: number;
  type: ProblemType;
  severity: ProblemSeverity;
  message: string;
  actionType: string | null;
  actionParams: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export type RunKind = 'transfer' | 'uploadScan' | 'targetScan' | 'recheck';

export interface TransferRun {
  id: number;
  kind: RunKind;
  status: 'running' | 'completed' | 'aborted';
  startedAt: string;
  finishedAt: string | null;
  scanned: number;
  transferred: number;
  indexed: number;
  newFiles: number;
  skipped: number;
  problems: number;
}

export interface ScanSummary {
  formats: { ext: string; count: number; supported: boolean }[];
}

export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'heic', 'heif', 'png', 'tiff', 'tif']);
export const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'mkv', 'avi', '3gp', '3g2', 'webm', 'mts', 'm2ts']);

export function isSupportedImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}
export function isSupportedVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext.toLowerCase());
}
export function isSupportedExt(ext: string): boolean {
  return isSupportedImageExt(ext) || isSupportedVideoExt(ext);
}