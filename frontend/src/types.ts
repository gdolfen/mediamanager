export type FileType = 'image' | 'video' | 'other';
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

export interface LibraryGroup {
  year: number;
  month: number;
  day: number;
  count: number;
  images: number;
  videos: number;
}

export interface TargetScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  linked: number;
  newFiles: number;
  problems: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
}

export interface UploadScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  indexed: number;
  skipped: number;
  problems: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
  canResume: boolean;
}

export type ScheduleMode = 'scan' | 'scan_and_transfer';

export interface ScheduleState {
  enabled: boolean;
  intervalMinutes: number;
  mode: ScheduleMode;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogPage {
  rows: LogEntry[];
  total: number;
  page: number;
  limit: number;
  offset: number;
}

export interface LogStats {
  total: number;
  error: number;
  warn: number;
  info: number;
}

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

export interface UnknownDeviceCandidate {
  identifierKind: 'exif' | 'path';
  identifierValue: string;
  make: string | null;
  model: string | null;
  count: number;
  sampleName: string | null;
  samplePath: string | null;
  sampleFileId: number | null;
  person: string | null;
}

export interface FileRecord {
  id: number;
  hash: string | null;
  md5: string | null;
  sourceRoot: string;
  sourceRelPath: string;
  sourceSize: number | null;
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
  dateSource: string | null;
  overrideDate: string | null;
  overrideSource: string | null;
  status: FileStatus;
  transferredAt: string | null;
  isWhatsApp: boolean;
  meta?: Record<string, unknown> | null;
  deviceMappedName?: string | null;
  devicePerson?: string | null;
  problems?: Problem[];
}

export interface Problem {
  id: number;
  fileId: number;
  type: ProblemType;
  severity: 'info' | 'warning' | 'error';
  scope: 'upload' | 'library' | null;
  message: string;
  actionType: string | null;
  actionLabel: string[];
  resolved: boolean;
  createdAt: string;
  file: {
    id: number;
    originalName: string;
    sourceRelPath: string;
    targetRelPath: string | null;
    fileType: FileType;
    takenAt: string | null;
    status: FileStatus;
    isWhatsApp: boolean;
    deviceMappedName: string | null;
    devicePerson: string | null;
  } | null;
}

export interface RecheckState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  total: number;
  checked: number;
  created: number;
  resolved: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TransferState {
  runId: number | null;
  status: 'idle' | 'running' | 'completed' | 'aborted';
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  transferred: number;
  skipped: number;
  problems: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export type RunKind = 'transfer' | 'uploadScan' | 'targetScan' | 'recheck';

export interface RunRecord {
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

export interface ThumbnailStatus {
  pending: number;
  total: number;
}

export interface Settings {
  paths: { upload: string; fotos: string; videos: string };
}

export interface FormatInfo {
  ext: string;
  count: number;
  supported: boolean;
}

export interface Stats {
  counts: Record<FileStatus, number>;
  openProblems: number;
  devices: number;
  formats: number;
  running: boolean;
  paths: Settings['paths'];
  schedule: ScheduleState;
  thumbnailsPending: number;
}

export interface IgnoredItem {
  id: number;
  scope: 'file' | 'folder';
  path: string;
  createdAt: string;
}

export interface UploadGroup {
  key: string;
  label: string;
  path: string;
  count: number;
  images: number;
  videos: number;
  pending: number;
  transferred: number;
  problem: number;
}