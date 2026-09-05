import type {
  Device,
  FileRecord,
  FileStatus,
  FormatInfo,
  IgnoredItem,
  LibraryGroup,
  LogLevel,
  LogPage,
  LogStats,
  Problem,
  RecheckState,
  RescanInput,
  RescanState,
  RunRecord,
  ScheduleMode,
  ScheduleState,
  Settings,
  Stats,
  TargetScanState,
  ThumbnailStatus,
  TransferState,
  TransferredCheckState,
  UnknownDeviceCandidate,
  UploadGroup,
  UploadScanState,
} from '../types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  getSettings: () => request<Settings>('GET', '/settings'),
  putSettings: (settings: Settings) => request<Settings>('PUT', '/settings', settings),

  getSchedule: () => request<ScheduleState>('GET', '/schedule'),
  putSchedule: (schedule: { enabled: boolean; intervalMinutes: number; mode: ScheduleMode }) =>
    request<ScheduleState>('PUT', '/schedule', schedule),

  listDevices: () => request<Device[]>('GET', '/devices'),
  getDevice: (id: number) => request<Device>('GET', `/devices/${id}`),
  deviceFiles: (id: number) => request<FileRecord[]>('GET', `/devices/${id}/files`),
  createDevice: (data: { mappedName: string; person?: string | null; identifiers: { kind: 'exif' | 'filename' | 'path'; value: string }[] }) =>
    request<Device>('POST', '/devices', data),
  updateDevice: (id: number, data: { mappedName: string; person?: string | null; identifiers: { kind: 'exif' | 'filename' | 'path'; value: string }[] }) =>
    request<Device>('PUT', `/devices/${id}`, data),
  deleteDevice: (id: number) => request<void>('DELETE', `/devices/${id}`),

  listUnknownDevices: () => request<UnknownDeviceCandidate[]>('GET', '/devices/unknown'),
  adoptDevice: (data: { mappedName?: string; identifierValue: string; identifierKind?: 'exif' | 'path'; person?: string | null; deviceId?: number }) =>
    request<{ ok: boolean; device: Device; assigned: number; added?: boolean }>('POST', '/devices/adopt', data),

  listFiles: (params: { status?: FileStatus; search?: string; root?: string; sourceRoot?: string; type?: string; ext?: string; identifierKind?: 'exif' | 'path'; identifierValue?: string; includeIgnored?: boolean; excludeUnsupported?: boolean; year?: number; yearNull?: boolean; deviceId?: number; deviceNull?: boolean; deviceKey?: string; person?: string; personNull?: boolean; sort?: string; sortDir?: 'asc' | 'desc'; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.root) q.set('root', params.root);
    if (params.sourceRoot) q.set('sourceRoot', params.sourceRoot);
    if (params.type) q.set('type', params.type);
    if (params.ext) q.set('ext', params.ext);
    if (params.identifierKind) q.set('identifierKind', params.identifierKind);
    if (params.identifierValue) q.set('identifierValue', params.identifierValue);
    if (params.includeIgnored) q.set('includeIgnored', '1');
    if (params.excludeUnsupported) q.set('excludeUnsupported', '1');
    if (params.year != null) q.set('year', String(params.year));
    else if (params.yearNull) q.set('year', 'null');
    if (params.deviceKey) q.set('deviceKey', params.deviceKey);
    else if (params.deviceId != null) q.set('deviceId', String(params.deviceId));
    else if (params.deviceNull) q.set('deviceId', 'null');
    if (params.person) q.set('person', params.person);
    else if (params.personNull) q.set('person', 'null');
    if (params.sort) q.set('sort', params.sort);
    if (params.sortDir) q.set('sortDir', params.sortDir);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 50));
    return request<{ rows: FileRecord[]; total: number; page: number; limit: number }>('GET', `/files?${q}`);
  },
  getFile: (id: number) => request<FileRecord & { problems?: Problem[] }>('GET', `/files/${id}`),

  listProblems: (params: { resolved?: boolean; type?: string; severity?: 'error' | 'warning' | 'info'; scope?: 'upload' | 'library'; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.resolved !== undefined) q.set('resolved', String(params.resolved));
    if (params.type) q.set('type', params.type);
    if (params.severity) q.set('severity', params.severity);
    if (params.scope) q.set('scope', params.scope);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 50));
    return request<{ rows: Problem[]; total: number; page: number; limit: number }>('GET', `/problems?${q}`);
  },
  resolveProblem: (id: number, action: string) => request<{ ok: boolean }>('POST', `/problems/${id}/resolve`, { action }),
  createDeviceForProblem: (id: number, data: { mappedName: string; identifierKind?: 'exif' | 'filename'; identifierValue?: string }) =>
    request<{ ok: boolean; device: Device }>('POST', `/problems/${id}/device`, data),

  startRecheck: () => request<{ ok: boolean; error?: string }>('POST', '/problems/recheck'),
  abortRecheck: () => request<{ ok: boolean }>('POST', '/problems/recheck/abort'),
  recheckStatus: () => request<RecheckState>('GET', '/problems/recheck/status'),

  startRescan: (input: RescanInput) => request<{ ok: boolean; error?: string; total?: number }>('POST', '/rescan', input),
  abortRescan: () => request<{ ok: boolean }>('POST', '/rescan/abort'),
  rescanStatus: () => request<RescanState>('GET', '/rescan/status'),

  startTransferredCheck: () => request<{ ok: boolean; error?: string; total?: number }>('POST', '/transferred/check'),
  abortTransferredCheck: () => request<{ ok: boolean }>('POST', '/transferred/check/abort'),
  transferredCheckStatus: () => request<TransferredCheckState>('GET', '/transferred/check/status'),

  startTransfer: () => request<{ ok: boolean; error?: string; runId?: number }>('POST', '/transfer'),
  abortTransfer: () => request<{ ok: boolean }>('POST', '/transfer/abort'),
  transferStatus: () => request<TransferState>('GET', '/transfer/status'),
  runHistory: () => request<RunRecord[]>('GET', '/runs'),
  deleteRun: (id: number) => request<{ ok: boolean }>('DELETE', `/runs/${id}`),
  thumbnailStatus: () => request<ThumbnailStatus>('GET', '/thumbnails/status'),

  formats: () => request<FormatInfo[]>('GET', '/formats'),
  stats: () => request<Stats>('GET', '/stats'),

  libraryGroups: (filters?: { status?: string; type?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (filters?.status) q.set('status', filters.status);
    if (filters?.type) q.set('type', filters.type);
    if (filters?.search) q.set('search', filters.search);
    const qs = q.toString();
    return request<LibraryGroup[]>('GET', `/library/groups${qs ? `?${qs}` : ''}`);
  },
  libraryFiles: (params: { year?: number; yearNull?: boolean; month?: number; day?: number; type?: string; status?: string; search?: string; sort?: string; sortDir?: 'asc' | 'desc'; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.year !== undefined) q.set('year', String(params.year));
    else if (params.yearNull) q.set('year', 'null');
    if (params.month !== undefined) q.set('month', String(params.month));
    if (params.day !== undefined) q.set('day', String(params.day));
    if (params.type) q.set('type', params.type);
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.sort) q.set('sort', params.sort);
    if (params.sortDir) q.set('sortDir', params.sortDir);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 100));
    return request<{ rows: FileRecord[]; total: number; page: number; limit: number }>('GET', `/library?${q}`);
  },

  startTargetScan: (resume?: boolean) => request<{ ok: boolean; error?: string }>('POST', '/scan/targets', resume ? { resume: true } : undefined),
  abortTargetScan: () => request<{ ok: boolean }>('POST', '/scan/targets/abort'),
  targetScanStatus: () => request<TargetScanState>('GET', '/scan/targets/status'),

  startUploadScan: (resume?: boolean) => request<{ ok: boolean; error?: string }>('POST', '/scan/upload', resume ? { resume: true } : undefined),
  abortUploadScan: () => request<{ ok: boolean }>('POST', '/scan/upload/abort'),
  uploadScanStatus: () => request<UploadScanState>('GET', '/scan/upload/status'),

  ignored: () => request<IgnoredItem[]>('GET', '/ignored'),
  toggleIgnoreFile: (path: string) => request<{ ignored: boolean }>('POST', '/ignored/file', { path }),
  toggleIgnoreFolder: (path: string) => request<{ ignored: boolean }>('POST', '/ignored/folder', { path }),
  uploadGroups: (level: 1 | 2 | 3, filters?: { person?: string; deviceKey?: string; status?: string; type?: string; search?: string }) => {
    const q = new URLSearchParams();
    q.set('level', String(level));
    if (filters?.person) q.set('person', filters.person);
    if (filters?.deviceKey) q.set('deviceKey', filters.deviceKey);
    if (filters?.status) q.set('status', filters.status);
    if (filters?.type) q.set('type', filters.type);
    if (filters?.search) q.set('search', filters.search);
    return request<UploadGroup[]>('GET', `/upload/groups?${q}`);
  },

  logs: (params: { level?: LogLevel; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params.level) q.set('level', params.level);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 100));
    return request<LogPage>('GET', `/logs?${q}`);
  },
  logStats: () => request<LogStats>('GET', '/logs/stats'),
  clearLogs: () => request<{ ok: boolean }>('DELETE', '/logs'),

  devSql: (sql: string) => request<{ rows: Record<string, unknown>[]; count: number; changes?: number; lastInsertRowid?: number | null }>('POST', '/dev/sql', { sql }),
  devTables: () => request<string[]>('GET', '/dev/tables'),
  devTableInfo: (name: string) => request<{ columns: { name: string; type: string; notnull: boolean; pk: boolean }[]; count: number }>('GET', `/dev/table/${name}`),
};

export const mediaUrl = {
  thumbnail: (fileId: number) => `/api/media/thumbnail/${fileId}`,
  file: (fileId: number) => `/api/media/file/${fileId}`,
};