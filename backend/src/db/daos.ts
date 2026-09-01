import fs from 'node:fs';
import { getDb, thumbnailsDir } from './database.js';
import type {
  Device,
  DeviceIdentifier,
  FileRecord,
  FileStatus,
  Problem,
  ProblemType,
  RunKind,
  TransferRun,
} from '../types.js';

type Row = Record<string, unknown>;

/** In-memory cache for format counts – flushed to DB in bulk. */
const formatCache = new Map<string, { count: number; supported: boolean }>();

function mapFile(r: Row): FileRecord {
  return {
    id: r.id as number,
    hash: (r.hash as string) ?? null,
    md5: (r.md5 as string) ?? null,
    sourceRoot: r.source_root as string,
    sourceRelPath: r.source_rel_path as string,
    sourceSize: (r.source_size as number) ?? null,
    sourceMtime: (r.source_mtime as number) ?? null,
    fileType: r.file_type as FileRecord['fileType'],
    ext: r.ext as string,
    originalName: r.original_name as string,
    targetRoot: (r.target_root as string) ?? null,
    targetRelPath: (r.target_rel_path as string) ?? null,
    deviceId: (r.device_id as number) ?? null,
    deviceRaw: (r.device_raw as string) ?? null,
    make: (r.make as string) ?? null,
    model: (r.model as string) ?? null,
    takenAt: (r.taken_at as string) ?? null,
    dateSource: (r.date_source as FileRecord['dateSource']) ?? null,
    overrideDate: (r.override_date as string) ?? null,
    overrideSource: (r.override_source as FileRecord['overrideSource']) ?? null,
    status: r.status as FileStatus,
    transferredAt: (r.transferred_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    isWhatsApp: (r.is_whatsapp as number) === 1,
    meta: (() => {
      const raw = r.meta_json as string | null | undefined;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    })(),
    deviceMappedName: (r.device_mapped_name as string) ?? null,
    devicePerson: (r.device_person as string) ?? null,
  };
}

function mapProblem(r: Row): Problem {
  return {
    id: r.id as number,
    fileId: r.file_id as number,
    type: r.type as ProblemType,
    severity: r.severity as Problem['severity'],
    message: r.message as string,
    actionType: (r.action_type as string) ?? null,
    actionParams: (r.action_params as string) ?? null,
    resolved: (r.resolved as number) === 1,
    resolvedAt: (r.resolved_at as string) ?? null,
    createdAt: r.created_at as string,
  };
}

/* ---------- files ---------- */

const FILE_COLUMNS = `
  f.*, d.mapped_name AS device_mapped_name, d.person AS device_person
`;

export function getFileById(id: number): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.id = ?`).get(id) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function getFileBySource(sourceRelPath: string): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.source_root = 'upload' AND f.source_rel_path = ?`).get(sourceRelPath) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function getFileBySourcePath(root: string, sourceRelPath: string): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.source_root = ? AND f.source_rel_path = ?`).get(root, sourceRelPath) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function getUploadFileByHash(hash: string): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE (f.hash = ? OR f.md5 = ?) AND f.source_root = 'upload' LIMIT 1`).get(hash, hash) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function getFileByHash(hash: string): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE (f.hash = ? OR f.md5 = ?) AND f.status = 'transferred' LIMIT 1`).get(hash, hash) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function getFileByMd5(md5: string): FileRecord | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.md5 = ? AND f.status = 'transferred' LIMIT 1`).get(md5) as Row | undefined;
  return row ? mapFile(row) : null;
}

export function upsertFile(f: {
  sourceRoot?: string;
  hash: string | null;
  md5: string | null;
  sourceRelPath: string;
  sourceSize: number | null;
  sourceMtime: number | null;
  fileType: FileRecord['fileType'];
  ext: string;
  originalName: string;
  targetRoot: string | null;
  targetRelPath: string | null;
  deviceId: number | null;
  deviceRaw: string | null;
  make: string | null;
  model: string | null;
  takenAt: string | null;
  dateSource: FileRecord['dateSource'];
  overrideDate: string | null;
  overrideSource: FileRecord['overrideSource'];
  status: FileStatus;
  isWhatsApp?: boolean;
  meta?: Record<string, unknown> | null;
}): number {
  const sourceRoot = f.sourceRoot ?? 'upload';
  const metaJson = f.meta ? JSON.stringify(f.meta) : null;
  const stmt = getDb().prepare(`
    INSERT INTO files (
      hash, md5, source_root, source_rel_path, source_size, source_mtime, file_type, ext, original_name,
      target_root, target_rel_path, device_id, device_raw, make, model, taken_at, date_source,
      override_date, override_source, status, is_whatsapp, meta_json, transferred_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
    ON CONFLICT(source_root, source_rel_path) DO UPDATE SET
      hash = excluded.hash,
      md5 = excluded.md5,
      source_size = excluded.source_size,
      source_mtime = excluded.source_mtime,
      file_type = excluded.file_type,
      ext = excluded.ext,
      original_name = excluded.original_name,
      target_root = excluded.target_root,
      target_rel_path = excluded.target_rel_path,
      device_id = excluded.device_id,
      device_raw = excluded.device_raw,
      make = excluded.make,
      model = excluded.model,
      taken_at = excluded.taken_at,
      date_source = excluded.date_source,
      is_whatsapp = excluded.is_whatsapp,
      meta_json = excluded.meta_json,
      status = excluded.status,
      transferred_at = excluded.transferred_at,
      updated_at = datetime('now')
  `);
  const result = stmt.run(
    f.hash, f.md5, sourceRoot, f.sourceRelPath, f.sourceSize, f.sourceMtime, f.fileType, f.ext, f.originalName,
    f.targetRoot, f.targetRelPath, f.deviceId, f.deviceRaw, f.make, f.model, f.takenAt, f.dateSource,
    f.overrideDate, f.overrideSource, f.status, f.isWhatsApp ? 1 : 0, metaJson,
  );
  return Number(result.lastInsertRowid);
}

export type UpsertFileParams = Parameters<typeof upsertFile>[0];

const BATCH_SIZE = 100;

export function createBatchUpsert() {
  const buf: UpsertFileParams[] = [];
  const stmt = getDb().prepare(`
    INSERT INTO files (
      hash, md5, source_root, source_rel_path, source_size, source_mtime, file_type, ext, original_name,
      target_root, target_rel_path, device_id, device_raw, make, model, taken_at, date_source,
      override_date, override_source, status, is_whatsapp, meta_json, transferred_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
    ON CONFLICT(source_root, source_rel_path) DO UPDATE SET
      hash = excluded.hash,
      md5 = excluded.md5,
      source_size = excluded.source_size,
      source_mtime = excluded.source_mtime,
      file_type = excluded.file_type,
      ext = excluded.ext,
      original_name = excluded.original_name,
      target_root = excluded.target_root,
      target_rel_path = excluded.target_rel_path,
      device_id = excluded.device_id,
      device_raw = excluded.device_raw,
      make = excluded.make,
      model = excluded.model,
      taken_at = excluded.taken_at,
      date_source = excluded.date_source,
      is_whatsapp = excluded.is_whatsapp,
      meta_json = excluded.meta_json,
      status = excluded.status,
      transferred_at = excluded.transferred_at,
      updated_at = datetime('now')
  `);

  function flush(): void {
    if (buf.length === 0) return;
    const db = getDb();
    db.exec('BEGIN');
    try {
      for (const f of buf) {
        const sourceRoot = f.sourceRoot ?? 'upload';
        const metaJson = f.meta ? JSON.stringify(f.meta) : null;
        stmt.run(
          f.hash, f.md5, sourceRoot, f.sourceRelPath, f.sourceSize, f.sourceMtime, f.fileType, f.ext, f.originalName,
          f.targetRoot, f.targetRelPath, f.deviceId, f.deviceRaw, f.make, f.model, f.takenAt, f.dateSource,
          f.overrideDate, f.overrideSource, f.status, f.isWhatsApp ? 1 : 0, metaJson,
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    buf.length = 0;
  }

  return {
    add(f: UpsertFileParams): void {
      buf.push(f);
      if (buf.length >= BATCH_SIZE) flush();
    },
    flush,
  };
}

export function updateFile(id: number, patch: Partial<FileRecord>): void {
  const fields: string[] = [];
  const values: Array<string | number | bigint | null> = [];
  const col = (key: string): string => key;
  if (patch.hash !== undefined) { fields.push(col('hash') + ' = ?'); values.push(patch.hash); }
  if (patch.md5 !== undefined) { fields.push(col('md5') + ' = ?'); values.push(patch.md5); }
  if (patch.status !== undefined) { fields.push(col('status') + ' = ?'); values.push(patch.status); }
  if (patch.transferredAt !== undefined) { fields.push(col('transferred_at') + ' = ?'); values.push(patch.transferredAt); }
  if (patch.targetRoot !== undefined) { fields.push(col('target_root') + ' = ?'); values.push(patch.targetRoot); }
  if (patch.targetRelPath !== undefined) { fields.push(col('target_rel_path') + ' = ?'); values.push(patch.targetRelPath); }
  if (patch.takenAt !== undefined) { fields.push(col('taken_at') + ' = ?'); values.push(patch.takenAt); }
  if (patch.dateSource !== undefined) { fields.push(col('date_source') + ' = ?'); values.push(patch.dateSource); }
  if (patch.overrideDate !== undefined) { fields.push(col('override_date') + ' = ?'); values.push(patch.overrideDate); }
  if (patch.overrideSource !== undefined) { fields.push(col('override_source') + ' = ?'); values.push(patch.overrideSource); }
  if (patch.deviceId !== undefined) { fields.push(col('device_id') + ' = ?'); values.push(patch.deviceId); }
  if (patch.deviceRaw !== undefined) { fields.push(col('device_raw') + ' = ?'); values.push(patch.deviceRaw); }
  if (patch.make !== undefined) { fields.push(col('make') + ' = ?'); values.push(patch.make); }
  if (patch.model !== undefined) { fields.push(col('model') + ' = ?'); values.push(patch.model); }
  if (patch.isWhatsApp !== undefined) { fields.push(col('is_whatsapp') + ' = ?'); values.push(patch.isWhatsApp ? 1 : 0); }
  if (patch.meta !== undefined) { fields.push(col('meta_json') + ' = ?'); values.push(patch.meta ? JSON.stringify(patch.meta) : null); }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE files SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function listFiles(opts: {
  status?: FileStatus;
  search?: string;
  root?: 'upload' | 'fotos' | 'videos';
  sourceRoot?: 'upload' | 'fotos' | 'videos';
  type?: 'image' | 'video';
  includeIgnored?: boolean;
  year?: number;
  yearNull?: boolean;
  deviceId?: number;
  deviceNull?: boolean;
  deviceKey?: string;
  person?: string;
  personNull?: boolean;
  limit: number;
  offset: number;
}): { rows: FileRecord[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number | bigint | null> = [];
  if (opts.status) { where.push('f.status = ?'); params.push(opts.status); }
  if (opts.root) { where.push('f.target_root = ?'); params.push(opts.root); }
  if (opts.sourceRoot) { where.push('f.source_root = ?'); params.push(opts.sourceRoot); }
  if (opts.type) { where.push('f.file_type = ?'); params.push(opts.type); }
  if (opts.search) {
    where.push('(f.original_name LIKE ? OR f.source_rel_path LIKE ? OR f.target_rel_path LIKE ? OR COALESCE(d.mapped_name,\'\') LIKE ? OR COALESCE(d.person,\'\') LIKE ?)');
    const like = `%${opts.search}%`;
    params.push(like, like, like, like, like);
  }
  if (opts.year != null) {
    where.push('f.taken_at IS NOT NULL AND f.taken_at != \'\' AND CAST(substr(f.taken_at,1,4) AS INTEGER) = ?');
    params.push(opts.year);
  } else if (opts.yearNull) {
    where.push('(f.taken_at IS NULL OR f.taken_at = \'\')');
  }
  if (opts.deviceKey) {
    where.push(`(d.mapped_name = ?
      OR (f.device_id IS NULL AND SUBSTR(f.source_rel_path, INSTR(f.source_rel_path, '/') + 1, INSTR(SUBSTR(f.source_rel_path, INSTR(f.source_rel_path, '/') + 1), '/') - 1) IN (
        SELECT DISTINCT SUBSTR(f2.source_rel_path, INSTR(f2.source_rel_path, '/') + 1, INSTR(SUBSTR(f2.source_rel_path, INSTR(f2.source_rel_path, '/') + 1), '/') - 1)
        FROM files f2 INNER JOIN devices d2 ON d2.id = f2.device_id
        WHERE d2.mapped_name = ?
      )))`);
    params.push(opts.deviceKey, opts.deviceKey);
  } else if (opts.deviceId != null) {
    where.push('f.device_id = ?');
    params.push(opts.deviceId);
  } else if (opts.deviceNull) {
    where.push('f.device_id IS NULL');
  }
  if (opts.person != null) {
    where.push("SUBSTR(f.source_rel_path, 1, INSTR(f.source_rel_path, '/') - 1) = ?");
    params.push(opts.person);
  } else if (opts.personNull) {
    where.push('d.person IS NULL');
  }
  if (!opts.includeIgnored && opts.sourceRoot === 'upload') {
    where.push(`f.source_rel_path NOT IN (SELECT path FROM ignored WHERE scope = 'file')`);
    where.push(`NOT EXISTS (SELECT 1 FROM ignored ig WHERE ig.scope = 'folder' AND ig.path || '/' LIKE f.source_rel_path || '%')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM files f LEFT JOIN devices d ON d.id = f.device_id ${whereSql}`).get(...params) as Row).c as number;
  const rows = getDb()
    .prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id ${whereSql} ORDER BY f.id DESC LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as Row[];
  return { rows: rows.map(mapFile), total };
}

export function countFilesByStatus(): Record<FileStatus, number> {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS c FROM files GROUP BY status').all() as Row[];
  const out: Record<FileStatus, number> = { indexed: 0, pending: 0, transferred: 0 };
  for (const r of rows) out[r.status as FileStatus] = r.c as number;
  return out;
}

/** Alle Dateien mit einer bestimmten Dateiendung (Upload + Bibliothek), paginiert. */
export function listFilesByExt(ext: string, limit = 200, offset = 0): { rows: FileRecord[]; total: number } {
  const total = (getDb().prepare('SELECT COUNT(*) AS c FROM files f WHERE f.ext = ? COLLATE NOCASE').get(ext) as Row).c as number;
  const rows = getDb()
    .prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.ext = ? COLLATE NOCASE ORDER BY f.taken_at DESC, f.id DESC LIMIT ? OFFSET ?`)
    .all(ext, limit, offset) as Row[];
  const files = rows.map(mapFile);
  attachProblems(files);
  return { rows: files, total };
}

/* ---------- thumbnail queue ---------- */

export function enqueueThumbnail(fileId: number): void {
  getDb().prepare('INSERT OR IGNORE INTO thumbnail_queue (file_id) VALUES (?)').run(fileId);
}

export function nextThumbnailBatch(limit = 5): number[] {
  const rows = getDb().prepare('SELECT file_id FROM thumbnail_queue ORDER BY created_at, file_id LIMIT ?').all(limit) as Row[];
  return rows.map((r) => r.file_id as number);
}

export function removeThumbnailFromQueue(fileId: number): void {
  getDb().prepare('DELETE FROM thumbnail_queue WHERE file_id = ?').run(fileId);
}

export function thumbnailQueueSize(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM thumbnail_queue').get() as Row).c as number;
}

/**
 * Backfill beim Start: nur Dateien einreihen, deren Thumbnail-Datei tatsächlich
 * noch fehlt. Die Queue wird vorher geleert, damit sie nie mit bereits
 * vorhandenen Miniaturen verstopft und beim Neustart unnötig alles erneut prüft.
 * Dateien mit fehlgeschlagener Generierung werden beim nächsten Start erneut
 * versucht (kein Cache-File vorhanden).
 */
export function enqueueAllMissingThumbnails(): void {
  const db = getDb();
  const existing = new Set<string>();
  try {
    for (const name of fs.readdirSync(thumbnailsDir())) existing.add(name);
  } catch {
    // Thumbnail-Verzeichnis existiert noch nicht – es fehlen dann alle.
  }
  const rows = db.prepare("SELECT id FROM files WHERE file_type IN ('image','video')").all() as Row[];
  db.exec('DELETE FROM thumbnail_queue');
  db.exec('BEGIN');
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO thumbnail_queue (file_id) VALUES (?)');
    for (const r of rows) {
      const id = r.id as number;
      if (!existing.has(`${id}.jpg`)) insert.run(id);
    }
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
  }
}

/* ---------- scan progress + queue ---------- */

export interface ScanProgressRow {
  scanType: string;
  status: 'running' | 'completed' | 'aborted' | 'stopped';
  startedAt: string | null;
  finishedAt: string | null;
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  indexed: number;
  skipped: number;
  linked: number;
  newFilesCount: number;
  problems: number;
  current: string | null;
  runId: number | null;
}

function mapScanProgress(r: Row): ScanProgressRow {
  return {
    scanType: r.scan_type as string,
    status: r.status as ScanProgressRow['status'],
    startedAt: r.started_at as string | null,
    finishedAt: r.finished_at as string | null,
    totalDirs: r.total_dirs as number,
    totalFiles: r.total_files as number,
    scanned: r.scanned as number,
    indexed: r.indexed as number,
    skipped: r.skipped as number,
    linked: r.linked as number,
    newFilesCount: r.new_files_count as number,
    problems: r.problems as number,
    current: r.current as string | null,
    runId: r.run_id as number | null,
  };
}

export function saveScanProgress(scanType: string, patch: Partial<Omit<ScanProgressRow, 'scanType'>>): void {
  getDb().prepare(`
    INSERT INTO scan_progress (scan_type, status, started_at, finished_at, total_dirs, total_files, scanned, indexed, skipped, linked, new_files_count, problems, current, run_id)
    VALUES (@scanType, @status, @startedAt, @finishedAt, @totalDirs, @totalFiles, @scanned, @indexed, @skipped, @linked, @newFilesCount, @problems, @current, @runId)
    ON CONFLICT(scan_type) DO UPDATE SET
      status = COALESCE(excluded.status, scan_progress.status),
      started_at = COALESCE(excluded.started_at, scan_progress.started_at),
      finished_at = COALESCE(excluded.finished_at, scan_progress.finished_at),
      total_dirs = COALESCE(excluded.total_dirs, scan_progress.total_dirs),
      total_files = COALESCE(excluded.total_files, scan_progress.total_files),
      scanned = COALESCE(excluded.scanned, scan_progress.scanned),
      indexed = COALESCE(excluded.indexed, scan_progress.indexed),
      skipped = COALESCE(excluded.skipped, scan_progress.skipped),
      linked = COALESCE(excluded.linked, scan_progress.linked),
      new_files_count = COALESCE(excluded.new_files_count, scan_progress.new_files_count),
      problems = COALESCE(excluded.problems, scan_progress.problems),
      current = COALESCE(excluded.current, scan_progress.current),
      run_id = COALESCE(excluded.run_id, scan_progress.run_id),
      updated_at = datetime('now')
  `).run({
    scanType,
    status: patch.status ?? 'running',
    startedAt: patch.startedAt ?? null,
    finishedAt: patch.finishedAt ?? null,
    totalDirs: patch.totalDirs ?? 0,
    totalFiles: patch.totalFiles ?? 0,
    scanned: patch.scanned ?? 0,
    indexed: patch.indexed ?? 0,
    skipped: patch.skipped ?? 0,
    linked: patch.linked ?? 0,
    newFilesCount: patch.newFilesCount ?? 0,
    problems: patch.problems ?? 0,
    current: patch.current ?? null,
    runId: patch.runId ?? null,
  });
}

export function getScanProgress(scanType: string): ScanProgressRow | null {
  const row = getDb().prepare('SELECT * FROM scan_progress WHERE scan_type = ?').get(scanType) as Row | undefined;
  return row ? mapScanProgress(row) : null;
}

export function clearScanProgress(scanType: string): void {
  getDb().prepare('DELETE FROM scan_progress WHERE scan_type = ?').run(scanType);
}

export function resetScanQueue(scanType: string): void {
  getDb().prepare('DELETE FROM scan_queue WHERE scan_type = ?').run(scanType);
}

export function enqueueScanFile(scanType: string, root: string, relPath: string): void {
  getDb().prepare('INSERT OR IGNORE INTO scan_queue (scan_type, root, rel_path) VALUES (?, ?, ?)').run(scanType, root, relPath);
}

export interface PendingScanFile {
  id: number;
  root: string;
  relPath: string;
}

export function nextPendingScanFiles(scanType: string, limit = 10): PendingScanFile[] {
  const rows = getDb().prepare('SELECT id, root, rel_path FROM scan_queue WHERE scan_type = ? AND done = 0 ORDER BY id LIMIT ?').all(scanType, limit) as Row[];
  return rows.map((r) => ({ id: r.id as number, root: r.root as string, relPath: r.rel_path as string }));
}

export function markScanFileDone(id: number): void {
  getDb().prepare("UPDATE scan_queue SET done = 1, processed_at = datetime('now') WHERE id = ?").run(id);
}

export function pendingScanCount(scanType: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM scan_queue WHERE scan_type = ? AND done = 0').get(scanType) as Row).c as number;
}

export interface IndexedFile {
  id: number;
  sourceRoot: string;
  relPath: string;
}

/** Get files with status='indexed' that need analysis (Phase 2). */
export function nextIndexedFiles(sourceRoot: string, limit = 4): IndexedFile[] {
  const rows = getDb().prepare(
    'SELECT id, source_root, source_rel_path FROM files WHERE source_root = ? AND status = ? ORDER BY id LIMIT ?'
  ).all(sourceRoot, 'indexed', limit) as Row[];
  return rows.map((r) => ({ id: r.id as number, sourceRoot: r.source_root as string, relPath: r.source_rel_path as string }));
}

/** Count files with status='indexed' that need analysis. */
export function indexedCount(sourceRoot: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM files WHERE source_root = ? AND status = ?').get(sourceRoot, 'indexed') as Row).c as number;
}

/* ---------- problems ---------- */

export function getProblemById(id: number): Problem | null {
  const row = getDb().prepare('SELECT * FROM problems WHERE id = ?').get(id) as Row | undefined;
  return row ? mapProblem(row) : null;
}

export function listProblems(opts: {
  resolved?: boolean;
  type?: string;
  severity?: Problem['severity'];
  scope?: 'upload' | 'library';
  limit: number;
  offset: number;
}): { rows: Problem[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number | bigint | null> = [];
  if (opts.resolved !== undefined) { where.push('p.resolved = ?'); params.push(opts.resolved ? 1 : 0); }
  if (opts.type) { where.push('p.type = ?'); params.push(opts.type); }
  if (opts.severity) { where.push('p.severity = ?'); params.push(opts.severity); }
  if (opts.scope === 'upload') { where.push('f.source_root = ?'); params.push('upload'); }
  if (opts.scope === 'library') { where.push('f.source_root IN (?, ?)'); params.push('fotos', 'videos'); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'problems p JOIN files f ON f.id = p.file_id';
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM ${from} ${whereSql}`).get(...params) as Row).c as number;
  const rows = getDb()
    .prepare(`
      SELECT p.* FROM ${from} ${whereSql}
      ORDER BY p.resolved ASC,
               CASE p.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               p.id DESC
      LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as Row[];
  return { rows: rows.map(mapProblem), total };
}

export function listProblemsForFile(fileId: number): Problem[] {
  const rows = getDb().prepare('SELECT * FROM problems WHERE file_id = ? ORDER BY resolved ASC, id DESC').all(fileId) as Row[];
  return rows.map(mapProblem);
}

/** Files that currently have at least one active (unresolved) problem. */
export function listFilesWithProblems(): FileRecord[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT ${FILE_COLUMNS}
    FROM files f
    JOIN problems p ON p.file_id = f.id
    LEFT JOIN devices d ON d.id = f.device_id
    WHERE p.resolved = 0
    ORDER BY f.id ASC
  `).all() as Row[];
  return rows.map(mapFile);
}

export function upsertProblem(p: {
  fileId: number;
  type: ProblemType;
  severity: Problem['severity'];
  message: string;
  actionType?: string | null;
  actionParams?: string | null;
}): { id: number; active: boolean } {
  const existing = getDb().prepare('SELECT id, resolved, action_type FROM problems WHERE file_id = ? AND type = ?').get(p.fileId, p.type) as Row | undefined;
  // A previously applied "ignore" stays resolved across runs.
  const keepResolved = existing && existing.resolved === 1 && existing.action_type === 'ignore';
  const stmt = getDb().prepare(`
    INSERT INTO problems (file_id, type, severity, message, action_type, action_params)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id, type) DO UPDATE SET
      severity = excluded.severity,
      message = excluded.message,
      action_type = excluded.action_type,
      action_params = excluded.action_params,
      resolved = ${keepResolved ? 'problems.resolved' : '0'},
      resolved_at = ${keepResolved ? 'problems.resolved_at' : 'NULL'},
      created_at = datetime('now')
  `);
  const result = stmt.run(p.fileId, p.type, p.severity, p.message, p.actionType ?? null, p.actionParams ?? null);
  return { id: Number(result.lastInsertRowid), active: !keepResolved };
}

export function resolveProblem(id: number): void {
  getDb().prepare("UPDATE problems SET resolved = 1, resolved_at = datetime('now') WHERE id = ?").run(id);
}

export function resolveProblemsForFile(fileId: number, types: ProblemType[]): void {
  if (!types.length) return;
  const placeholders = types.map(() => '?').join(',');
  getDb().prepare(`UPDATE problems SET resolved = 1, resolved_at = datetime('now') WHERE file_id = ? AND type IN (${placeholders})`).run(fileId, ...types);
}

/* ---------- devices ---------- */

export function listDevices(): Device[] {
  const rows = getDb().prepare('SELECT * FROM devices ORDER BY mapped_name COLLATE NOCASE').all() as Row[];
  const idents = getDb().prepare('SELECT * FROM device_identifiers ORDER BY id').all() as Row[];
  const periods = getDb()
    .prepare('SELECT device_id, MIN(taken_at) AS min_d, MAX(taken_at) AS max_d FROM files WHERE device_id IS NOT NULL AND taken_at IS NOT NULL GROUP BY device_id')
    .all() as Row[];
  const periodMap = new Map<number, { min: string | null; max: string | null }>();
  for (const p of periods) periodMap.set(p.device_id as number, { min: p.min_d as string, max: p.max_d as string });
  return rows.map((r) => {
    const id = r.id as number;
    return {
      id,
      mappedName: r.mapped_name as string,
      person: (r.person as string) ?? null,
      createdAt: r.created_at as string,
      identifiers: idents.filter((i) => (i.device_id as number) === id).map((i) => ({
        id: i.id as number,
        kind: i.kind as DeviceIdentifier['kind'],
        value: i.value as string,
      })),
      usagePeriod: periodMap.get(id) ?? null,
    };
  });
}

export function getDeviceById(id: number): Device | null {
  return listDevices().find((d) => d.id === id) ?? null;
}

export function createDevice(mappedName: string, identifiers: { kind: DeviceIdentifier['kind']; value: string }[], person: string | null = null): Device {
  const result = getDb().prepare('INSERT INTO devices (mapped_name, person) VALUES (?, ?)').run(mappedName, person);
  const id = Number(result.lastInsertRowid);
  const ins = getDb().prepare('INSERT INTO device_identifiers (device_id, kind, value) VALUES (?, ?, ?)');
  for (const i of identifiers) ins.run(id, i.kind, i.value);
  return getDeviceById(id)!;
}

export function updateDevice(id: number, mappedName: string, identifiers: { kind: DeviceIdentifier['kind']; value: string }[], person: string | null = null): Device | null {
  getDb().prepare('UPDATE devices SET mapped_name = ?, person = ? WHERE id = ?').run(mappedName, person, id);
  getDb().prepare('DELETE FROM device_identifiers WHERE device_id = ?').run(id);
  const ins = getDb().prepare('INSERT INTO device_identifiers (device_id, kind, value) VALUES (?, ?, ?)');
  for (const i of identifiers) ins.run(id, i.kind, i.value);
  return getDeviceById(id);
}

export function deleteDevice(id: number): void {
  getDb().prepare('DELETE FROM devices WHERE id = ?').run(id);
}

/** Find a device by an identifier (exif, filename or path), case-insensitive. */
export function findDeviceByIdentifier(kind: DeviceIdentifier['kind'], value: string): Device | null {
  const row = getDb()
    .prepare('SELECT device_id FROM device_identifiers WHERE kind = ? AND value = ? COLLATE NOCASE LIMIT 1')
    .get(kind, value) as Row | undefined;
  if (!row) return null;
  return getDeviceById(row.device_id as number);
}

export interface UnknownDeviceCandidate {
  identifierKind: DeviceIdentifier['kind'];
  identifierValue: string;
  make: string | null;
  model: string | null;
  count: number;
  sampleName: string | null;
  samplePath: string | null;
  sampleFileId: number | null;
  person: string | null;
}

/** Grouped files that carry EXIF device info but have no mapped device yet –
 *  from pending uploads AND from the library (target folders). */
export function listUnknownDeviceCandidates(): UnknownDeviceCandidate[] {
  const exifRows = getDb().prepare(`
    SELECT id, make, model, original_name, source_root
    FROM files
    WHERE device_id IS NULL
      AND (make IS NOT NULL OR model IS NOT NULL)
      AND ((source_root = 'upload' AND status = 'pending') OR source_root IN ('fotos','videos'))
    ORDER BY id DESC
  `).all() as Row[];
  const exifGroups = new Map<string, UnknownDeviceCandidate>();
  for (const r of exifRows) {
    const make = r.make as string | null;
    const model = r.model as string | null;
    const value = `${make ?? ''} ${model ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    const existing = exifGroups.get(value);
    if (existing) {
      existing.count++;
      if (existing.sampleFileId == null) existing.sampleFileId = r.id as number;
    } else {
      exifGroups.set(value, {
        identifierKind: 'exif',
        identifierValue: value,
        make,
        model,
        count: 1,
        sampleName: r.original_name as string | null,
        samplePath: null,
        sampleFileId: r.id as number,
        person: null,
      });
    }
  }

  const pathRows = getDb().prepare(`
    SELECT id, source_rel_path
    FROM files
    WHERE source_root = 'upload' AND status = 'pending' AND device_id IS NULL
      AND (make IS NULL AND model IS NULL)
      AND instr(source_rel_path, '/') > 0
    ORDER BY id DESC
  `).all() as Row[];
  const pathGroups = new Map<string, UnknownDeviceCandidate>();
  for (const r of pathRows) {
    const relPath = r.source_rel_path as string;
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const folder = parts.slice(0, -1).join('/');
    const existing = pathGroups.get(folder);
    if (existing) {
      existing.count++;
      if (existing.sampleFileId == null) existing.sampleFileId = r.id as number;
    } else {
      pathGroups.set(folder, {
        identifierKind: 'path',
        identifierValue: folder,
        make: null,
        model: null,
        count: 1,
        sampleName: null,
        samplePath: relPath,
        sampleFileId: r.id as number,
        person: parts[0],
      });
    }
  }

  return [...exifGroups.values(), ...pathGroups.values()].sort((a, b) => b.count - a.count);
}

/** Assign a device to the given files (device_id + human readable raw identifier). */
export function assignDeviceToFiles(deviceId: number, deviceRaw: string, fileIds: number[]): void {
  if (!fileIds.length) return;
  const placeholders = fileIds.map(() => '?').join(',');
  getDb()
    .prepare(`
      UPDATE files SET
        device_id = ?,
        device_raw = ?,
        updated_at = datetime('now')
      WHERE id IN (${placeholders})
    `)
    .run(deviceId, deviceRaw, ...fileIds);
}

/** File ids whose identifier matches, without a mapped device yet.
 *  EXIF matches pending uploads AND library files (target folders).
 *  Path matches pending upload files with a nested folder. */
export function findFileIdsByIdentifier(kind: DeviceIdentifier['kind'], identifierValue: string): number[] {
  const rows = getDb().prepare(`
    SELECT id, make, model, source_rel_path, source_root FROM files
    WHERE device_id IS NULL
      AND ((source_root = 'upload' AND status IN ('indexed','pending')) OR source_root IN ('fotos','videos'))
  `).all() as Row[];
  return rows
    .filter((r) => {
      if (kind === 'exif') {
        if (!r.make || !r.model) return false;
        return `${r.make as string} ${r.model as string}`.replace(/\s+/g, ' ').trim().toLowerCase() === identifierValue.toLowerCase();
      }
      if (kind === 'path') {
        if (r.source_root !== 'upload') return false;
        const parts = (r.source_rel_path as string).split('/').filter(Boolean);
        if (parts.length < 2) return false;
        // Gleiche Semantik wie resolveByPath: auch Dateien in Unterordnern
        // (z.B. "Daniela/Galaxy A14/Internal storage/DCIM/Camera/…") zuordnen.
        const dir = parts.slice(0, -1).join('/');
        const needle = identifierValue.replace(/\/+$/, '');
        return dir === needle || dir.startsWith(`${needle}/`);
      }
      return false;
    })
    .map((r) => r.id as number);
}

/** Add an identifier to an existing device (idempotent – returns the identifier). */
export function addDeviceIdentifier(deviceId: number, kind: DeviceIdentifier['kind'], value: string): DeviceIdentifier {
  getDb()
    .prepare('INSERT OR IGNORE INTO device_identifiers (device_id, kind, value) VALUES (?, ?, ?)')
    .run(deviceId, kind, value);
  const row = getDb().prepare('SELECT * FROM device_identifiers WHERE kind = ? AND value = ?').get(kind, value) as Row;
  return {
    id: row.id as number,
    kind: row.kind as DeviceIdentifier['kind'],
    value: row.value as string,
  };
}

/** Attach active (unresolved) problems to the given files. */
function attachProblems(files: FileRecord[]): void {
  if (!files.length) return;
  const ids = files.map((f) => f.id);
  const placeholders = ids.map(() => '?').join(',');
  const problemRows = getDb().prepare(`SELECT * FROM problems WHERE file_id IN (${placeholders}) AND resolved = 0 ORDER BY severity DESC, id DESC`).all(...ids) as Row[];
  const byFile = new Map<number, Problem[]>();
  for (const pr of problemRows) {
    const p = mapProblem(pr);
    const arr = byFile.get(p.fileId) ?? [];
    arr.push(p);
    byFile.set(p.fileId, arr);
  }
  for (const f of files) {
    const list = byFile.get(f.id);
    if (list && list.length) f.problems = list;
  }
}

/** All files assigned to a device (library + upload), newest first. */
export function listFilesByDevice(deviceId: number, limit = 5000): FileRecord[] {
  const rows = getDb()
    .prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.device_id = ? ORDER BY f.taken_at DESC, f.id DESC LIMIT ?`)
    .all(deviceId, limit) as Row[];
  const files = rows.map(mapFile);
  attachProblems(files);
  return files;
}

/** All files (any device state) matching an identifier – EXIF (Make + Model) or upload path folder. */
export function listFilesByIdentifier(kind: DeviceIdentifier['kind'], identifierValue: string, limit = 5000): FileRecord[] {
  const all = getDb().prepare('SELECT id, make, model, source_rel_path, source_root FROM files').all() as Row[];
  const ids = new Set<number>();
  for (const r of all) {
    if (kind === 'exif') {
      if (!r.make || !r.model) continue;
      if (`${r.make as string} ${r.model as string}`.replace(/\s+/g, ' ').trim() !== identifierValue) continue;
    } else if (kind === 'path') {
      if (r.source_root !== 'upload') continue;
      const parts = (r.source_rel_path as string).split('/').filter(Boolean);
      if (parts.length < 2) continue;
      if (parts.slice(0, -1).join('/') !== identifierValue) continue;
    } else {
      continue;
    }
    ids.add(r.id as number);
  }
  const idList = [...ids];
  if (!idList.length) return [];
  const files = getDb()
    .prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id WHERE f.id IN (${idList.map(() => '?').join(',')}) ORDER BY f.taken_at DESC, f.id DESC LIMIT ?`)
    .all(...idList, limit) as Row[];
  const out = files.map(mapFile);
  attachProblems(out);
  return out;
}

/* ---------- transfer runs (general run history) ---------- */

export function startRun(kind: RunKind = 'transfer'): TransferRun {
  const db = getDb();
  // Läufe derselben Art, die durch einen Absturz/Neustart hängen geblieben sind, abschließen.
  db.prepare("UPDATE transfer_runs SET status = 'aborted', finished_at = ? WHERE kind = ? AND status = 'running'").run(new Date().toISOString(), kind);
  const result = db.prepare("INSERT INTO transfer_runs (kind, status, started_at) VALUES (?, 'running', ?)").run(kind, new Date().toISOString());
  const id = Number(result.lastInsertRowid);
  return getRunById(id)!;
}

export function getRunById(id: number): TransferRun | null {
  const row = getDb().prepare('SELECT * FROM transfer_runs WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  return mapRun(row);
}

export function updateRun(id: number, patch: Partial<Omit<TransferRun, 'id' | 'startedAt' | 'finishedAt'>>): void {
  const fields: string[] = [];
  const values: Array<string | number | bigint | null> = [];
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
  if (patch.scanned !== undefined) { fields.push('scanned = ?'); values.push(patch.scanned); }
  if (patch.transferred !== undefined) { fields.push('transferred = ?'); values.push(patch.transferred); }
  if (patch.indexed !== undefined) { fields.push('indexed = ?'); values.push(patch.indexed); }
  if (patch.newFiles !== undefined) { fields.push('new_files = ?'); values.push(patch.newFiles); }
  if (patch.skipped !== undefined) { fields.push('skipped = ?'); values.push(patch.skipped); }
  if (patch.problems !== undefined) { fields.push('problems = ?'); values.push(patch.problems); }
  if (patch.status === 'completed' || patch.status === 'aborted') { fields.push('finished_at = ?'); values.push(new Date().toISOString()); }
  if (!fields.length) return;
  values.push(id);
  getDb().prepare(`UPDATE transfer_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function mapRun(r: Row): TransferRun {
  return {
    id: r.id as number,
    kind: (r.kind as RunKind) ?? 'transfer',
    status: r.status as TransferRun['status'],
    startedAt: r.started_at as string,
    finishedAt: r.finished_at as string | null,
    scanned: r.scanned as number,
    transferred: r.transferred as number,
    indexed: r.indexed as number,
    newFiles: r.new_files as number,
    skipped: r.skipped as number,
    problems: r.problems as number,
  };
}

export function listRuns(limit = 100): TransferRun[] {
  const rows = getDb().prepare(
    'SELECT id, kind, status, started_at, finished_at, scanned, transferred, indexed, new_files, skipped, problems FROM transfer_runs ORDER BY id DESC LIMIT ?'
  ).all(limit) as Row[];
  return rows.map(mapRun);
}

export function getLatestRun(): TransferRun | null {
  const row = getDb().prepare('SELECT * FROM transfer_runs ORDER BY id DESC LIMIT 1').get() as Row | undefined;
  if (!row) return null;
  return mapRun(row);
}

export function countMediaFiles(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM files WHERE file_type IN ('image','video')").get() as Row;
  return Number(row.n);
}

/* ---------- library ---------- */

export interface LibraryGroup {
  year: number;
  month: number;
  day: number;
  count: number;
  images: number;
  videos: number;
}

export function listLibraryGroups(): LibraryGroup[] {
  const rows = getDb().prepare(`
    SELECT CAST(substr(taken_at,1,4) AS INTEGER) AS year,
           CAST(substr(taken_at,6,2) AS INTEGER) AS month,
           CAST(substr(taken_at,9,2) AS INTEGER) AS day,
           COUNT(*) AS count,
           SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) AS images,
           SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) AS videos
    FROM files
    WHERE source_root IN ('fotos','videos') AND taken_at IS NOT NULL
    GROUP BY year, month, day
    ORDER BY year DESC, month DESC, day DESC
  `).all() as Row[];
  return rows.map((r) => ({
    year: r.year as number,
    month: r.month as number,
    day: r.day as number,
    count: r.count as number,
    images: (r.images as number) ?? 0,
    videos: (r.videos as number) ?? 0,
  }));
}

export function listLibraryFiles(opts: {
  year?: number;
  month?: number;
  day?: number;
  type?: string;
  search?: string;
  limit: number;
  offset: number;
}): { rows: FileRecord[]; total: number } {
  const where = ["f.source_root IN ('fotos','videos')"];
  const params: Array<string | number | bigint | null> = [];
  if (opts.year !== undefined) {
    where.push('CAST(substr(f.taken_at,1,4) AS INTEGER) = ?');
    params.push(opts.year);
  }
  if (opts.month !== undefined) {
    where.push('CAST(substr(f.taken_at,6,2) AS INTEGER) = ?');
    params.push(opts.month);
  }
  if (opts.day !== undefined) {
    where.push('CAST(substr(f.taken_at,9,2) AS INTEGER) = ?');
    params.push(opts.day);
  }
  if (opts.type) {
    where.push('f.file_type = ?');
    params.push(opts.type);
  }
  if (opts.search) {
    where.push('(f.original_name LIKE ? OR f.source_rel_path LIKE ? OR COALESCE(d.mapped_name,\'\') LIKE ?)');
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM files f LEFT JOIN devices d ON d.id = f.device_id ${whereSql}`).get(...params) as Row).c as number;
  const rows = getDb()
    .prepare(`SELECT ${FILE_COLUMNS} FROM files f LEFT JOIN devices d ON d.id = f.device_id ${whereSql} ORDER BY f.taken_at DESC, f.id DESC LIMIT ? OFFSET ?`)
    .all(...params, opts.limit, opts.offset) as Row[];
  const files = rows.map(mapFile);
  attachProblems(files);
  return { rows: files, total };
}

/* ---------- formats ---------- */

export function bumpFormat(ext: string, supported: boolean): void {
  const key = ext.toLowerCase();
  const existing = formatCache.get(key);
  if (existing) {
    existing.count++;
    existing.supported = supported;
  } else {
    formatCache.set(key, { count: 1, supported });
  }
}

export function flushFormats(): void {
  if (formatCache.size === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO formats (ext, count, supported, last_seen)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(ext) DO UPDATE SET
      count = count + excluded.count,
      supported = excluded.supported,
      last_seen = datetime('now')
  `);
  db.exec('BEGIN');
  try {
    for (const [ext, data] of formatCache) {
      stmt.run(ext, data.count, data.supported ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  formatCache.clear();
}

export function listFormats(): { ext: string; count: number; supported: boolean }[] {
  const rows = getDb().prepare('SELECT ext, count, supported FROM formats ORDER BY count DESC, ext').all() as Row[];
  return rows.map((r) => ({
    ext: r.ext as string,
    count: r.count as number,
    supported: (r.supported as number) === 1,
  }));
}

/* ---------- ignored files / folders ---------- */

export function isPathIgnored(scope: 'file' | 'folder', path: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM ignored WHERE scope = ? AND path = ?').get(scope, path) as Row | undefined;
  return !!row;
}

export function isPathIgnoredBatch(scope: 'file' | 'folder', paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  const placeholders = paths.map(() => '?').join(',');
  const rows = getDb().prepare(`SELECT path FROM ignored WHERE scope = ? AND path IN (${placeholders})`).all(scope, ...paths) as Row[];
  return new Set(rows.map((r) => r.path as string));
}

export function toggleIgnoreFile(relPath: string): { ignored: boolean } {
  const existing = getDb().prepare('SELECT 1 FROM ignored WHERE scope = ? AND path = ?').get('file', relPath) as Row | undefined;
  if (existing) {
    getDb().prepare('DELETE FROM ignored WHERE scope = ? AND path = ?').run('file', relPath);
    return { ignored: false };
  }
  getDb().prepare('INSERT INTO ignored (scope, path) VALUES (?, ?)').run('file', relPath);
  return { ignored: true };
}

export function toggleIgnoreFolder(relPath: string): { ignored: boolean } {
  const existing = getDb().prepare('SELECT 1 FROM ignored WHERE scope = ? AND path = ?').get('folder', relPath) as Row | undefined;
  if (existing) {
    getDb().prepare('DELETE FROM ignored WHERE scope = ? AND path = ?').run('folder', relPath);
    return { ignored: false };
  }
  getDb().prepare('INSERT INTO ignored (scope, path) VALUES (?, ?)').run('folder', relPath);
  return { ignored: true };
}

export function listIgnored(): { id: number; scope: 'file' | 'folder'; path: string; createdAt: string }[] {
  const rows = getDb().prepare('SELECT * FROM ignored ORDER BY scope, path').all() as Row[];
  return rows.map((r) => ({
    id: r.id as number,
    scope: r.scope as 'file' | 'folder',
    path: r.path as string,
    createdAt: r.created_at as string,
  }));
}

export function isFolderIgnoredForFile(relPath: string): boolean {
  const parts = relPath.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    const folder = parts.slice(0, i).join('/');
    const row = getDb().prepare('SELECT 1 FROM ignored WHERE scope = ? AND path = ?').get('folder', folder) as Row | undefined;
    if (row) return true;
  }
  return false;
}

/* ---------- upload grouping ---------- */

export interface UploadGroup {
  key: string;
  label: string;
  path: string;
  count: number;
  images: number;
  videos: number;
  pending: number;
  transferred: number;
  indexed: number;
}

function resolvePerson(f: Row): string {
  const path = f.source_rel_path as string;
  const parts = path.split('/');
  if (parts[0] && parts[0] !== 'Unbekannt') return parts[0];
  const person = f.person as string | null;
  return person || 'Unbekannt';
}

function resolveDeviceName(f: Row): string {
  const mapped = f.mapped_name as string | null;
  const path = f.source_rel_path as string;
  const parts = path.split('/');
  const folderName = parts[1];
  if (folderName && mapped) return mapped;
  if (folderName) return folderName;
  return mapped || 'Unbekanntes Gerät';
}

function resolveDeviceKey(f: Row): string {
  return resolveDeviceName(f);
}

function resolveYear(f: Row): string {
  const path = f.source_rel_path as string;
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d{4}$/.test(parts[i])) return parts[i];
  }
  const taken = f.taken_at as string | null;
  if (taken && taken.length >= 4) return taken.substring(0, 4);
  return 'Unbekannt';
}

function resolvePath(f: Row, level: 1 | 2 | 3): string {
  const parts = (f.source_rel_path as string).split('/');
  if (level === 1) return parts[0] || 'Unbekannt';
  if (level === 2) return parts[0] + '/' + resolveDeviceName(f);
  return parts[0] + '/' + resolveDeviceName(f) + '/' + resolveYear(f);
}

export function listUploadHierarchy(level: 1 | 2 | 3, filters: { person?: string; deviceKey?: string } = {}): UploadGroup[] {
  const db = getDb();
  const ignoredFiles = db.prepare('SELECT path FROM ignored WHERE scope = \'file\'').all() as Row[];
  const ignoredFolders = db.prepare('SELECT path FROM ignored WHERE scope = \'folder\'').all() as Row[];
  const ignoredFileSet = new Set(ignoredFiles.map((r) => r.path as string));
  const ignoredFolderSet = new Set(ignoredFolders.map((r) => r.path as string));

  function isIgnored(relPath: string): boolean {
    if (ignoredFileSet.has(relPath)) return true;
    const parts = relPath.split('/');
    for (let i = parts.length - 1; i >= 1; i--) {
      if (ignoredFolderSet.has(parts.slice(0, i).join('/'))) return true;
    }
    return false;
  }

  const where = ['f.source_root = \'upload\''];
  const params: Array<string | number> = [];
  if (filters.person) { where.push("SUBSTR(f.source_rel_path, 1, INSTR(f.source_rel_path, '/') - 1) = ?"); params.push(filters.person); }
  if (filters.deviceKey) {
    where.push(`(COALESCE(d.mapped_name, SUBSTR(f.source_rel_path, INSTR(f.source_rel_path, '/') + 1, INSTR(SUBSTR(f.source_rel_path, INSTR(f.source_rel_path, '/') + 1), '/') - 1)) = ?)`);
    params.push(filters.deviceKey);
  }

  const files = db.prepare(`
    SELECT f.source_rel_path, f.file_type, f.status, f.taken_at, f.device_id,
           d.mapped_name, d.person
    FROM files f
    LEFT JOIN devices d ON d.id = f.device_id
    WHERE ${where.join(' AND ')}
  `).all(...params) as Row[];

  const folderDeviceMap = new Map<string, string>();
  for (const f of files) {
    const path = f.source_rel_path as string;
    const parts = path.split('/');
    const folderKey = parts.slice(0, 2).join('/');
    if (f.device_id != null && f.mapped_name && !folderDeviceMap.has(folderKey)) {
      folderDeviceMap.set(folderKey, f.mapped_name as string);
    }
  }

  function resolveDeviceNameMerged(f: Row): string {
    const mapped = f.mapped_name as string | null;
    const path = f.source_rel_path as string;
    const parts = path.split('/');
    const folderName = parts[1];
    if (mapped) return mapped;
    if (folderName) {
      const fallback = folderDeviceMap.get(parts[0] + '/' + folderName);
      if (fallback) return fallback;
      return folderName;
    }
    return 'Unbekanntes Gerät';
  }

  const groups = new Map<string, { label: string; path: string; count: number; images: number; videos: number; pending: number; transferred: number; indexed: number }>();

  for (const f of files) {
    const relPath = f.source_rel_path as string;
    if (isIgnored(relPath)) continue;

    let key: string;
    let label: string;

    if (level === 1) {
      label = resolvePerson(f);
      key = label;
    } else if (level === 2) {
      label = resolveDeviceNameMerged(f);
      key = resolveDeviceNameMerged(f);
    } else {
      label = resolveYear(f);
      key = label;
    }

    if (!groups.has(key)) {
      groups.set(key, { label, path: resolvePath(f, level), count: 0, images: 0, videos: 0, indexed: 0, pending: 0, transferred: 0 });
    }
    const g = groups.get(key)!;
    g.count++;
    if (f.file_type === 'image') g.images++;
    else if (f.file_type === 'video') g.videos++;
    if (f.status === 'indexed') g.indexed++;
    else if (f.status === 'pending') g.pending++;
    else if (f.status === 'transferred') g.transferred++;
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}
