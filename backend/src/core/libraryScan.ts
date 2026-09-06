import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  getFileBySourcePath,
  getUploadFileByHash,
  resolveProblemsForFile,
  updateFile,
  upsertFile,
  upsertProblem,
  enqueueThumbnail,
  saveScanProgress,
  getScanProgress,
  clearScanProgress,
  resetScanQueue,
  listIndexedFileIds,
  createBatchUpsert,
  flushFormats,
  startRun,
  updateRun,
} from '../db/daos.js';
import { hashFile } from './hash.js';
import { readImageMeta, readVideoMeta } from './metadata.js';
import { resolveByExif, resolveByFilename } from './devices.js';
import { detectFileType, extOf } from './naming.js';
import { parseDateFromFilename, toLocalIso, differsByDay, localDateKey, isWhatsAppFilename } from './dates.js';
import { walkTree, type ScannedFile } from './scanner.js';
import { problemTypeDef } from './problemCatalog.js';
import { BIRTHTIME_TOLERANCE_MS } from './evaluator.js';
import { isSupportedExt, type FileRecord, type ProblemType } from '../types.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';
import { enqueueScan } from './analyze.js';
import { perfStart, perfMark, perfLog, type FilePerf } from './perf.js';

export interface TargetScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'stopped';
  runId: number | null;
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  problems: number;
  currentFile: string | null;
  currentDirs: string[];
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const state: TargetScanState = {
  status: 'idle',
  runId: null,
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  problems: 0,
  currentFile: null,
  currentDirs: [],
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;
const LIBRARY_PROBLEM_TYPES: ProblemType[] = [
  'LIBRARY_META_FILENAME_MISMATCH',
  'LIBRARY_META_FILETIME_MISMATCH',
  'LIBRARY_FILENAME_FILETIME_MISMATCH',
  'LIBRARY_PATH_MISMATCH',
  'FILE_MTIME_BEFORE_BIRTHTIME',
];

const WALK_MARKER = 'walk';
const ANALYZE_MARKER = 'analyze';

/** Relatives Verzeichnis (posix) einer Datei; '' für die Wurzel. */
function dirOf(rel: string): string {
  const d = path.posix.dirname(rel);
  return d === '.' ? '' : d;
}

export function getTargetScanState(): TargetScanState {
  return { ...state };
}

export function isTargetScanRunning(): boolean {
  return state.status === 'running';
}

export function requestTargetScanAbort(): boolean {
  if (!isTargetScanRunning()) return false;
  abortRequested = true;
  state.status = 'stopped';
  return true;
}

export function startTargetScan(opts?: { resume?: boolean }): { ok: boolean; error?: string } {
  if (isTargetScanRunning()) return { ok: false, error: 'Ein Zielordner-Scan läuft bereits.' };
  if (!tryAcquire('targetScan')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  try {
    abortRequested = false;
    const resume = Boolean(opts?.resume && ['running', 'aborted', 'stopped'].includes(getScanProgress('target')?.status ?? ''));
    if (resume) {
      const p = getScanProgress('target')!;
      const run = p.runId != null ? { id: p.runId } : startRun('targetScan');
      state.status = 'running';
      state.runId = run.id;
      state.totalDirs = p.totalDirs;
      state.totalFiles = p.totalFiles;
      state.scanned = p.scanned;
      state.problems = p.problems;
      state.currentFile = null;
      state.currentDirs = [];
      state.errors = [];
      state.startedAt = p.startedAt;
      state.finishedAt = null;
      logger.info('scan', `Zielordner-Indexierung wird fortgesetzt (${p.scanned} gescannt).`);
    } else {
      resetScanQueue('target');
      const run = startRun('targetScan');
      saveScanProgress('target', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, problems: 0, current: null, runId: run.id });
      state.status = 'running';
      state.runId = run.id;
      state.totalDirs = 0;
      state.totalFiles = 0;
      state.scanned = 0;
      state.problems = 0;
      state.currentFile = null;
      state.currentDirs = [];
      state.errors = [];
      state.startedAt = new Date().toISOString();
      state.finishedAt = null;
      logger.info('scan', 'Zielordner-Indexierung gestartet.');
    }
    void runTargetScanInternal(resume);
    return { ok: true };
  } catch (err) {
    state.status = 'idle';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('scan', `Zielordner-Scan konnte nicht gestartet werden: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    // Lock nur behalten, wenn der Job wirklich läuft – sonst Geister-Sperre.
    if (state.status !== 'running') release('targetScan');
  }
}

function persistTargetProgress(current: string | null): void {
  saveScanProgress('target', {
    status: 'running',
    totalDirs: state.totalDirs,
    totalFiles: state.totalFiles,
    scanned: state.scanned,
    problems: state.problems,
    current,
  });
  if (state.runId != null) {
    updateRun(state.runId, { totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, problems: state.problems });
  }
}

function finishTargetScan(): void {
  state.currentFile = null;
  state.currentDirs = [];
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : state.status === 'stopped' ? 'stopped' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, problems: state.problems });
    state.runId = null;
  }
  if (state.status === 'completed') {
    clearScanProgress('target');
    logger.info('scan', `Zielordner-Indexierung abgeschlossen: ${state.scanned} gescannt, ${state.problems} Probleme.`);
  } else {
    saveScanProgress('target', { status: finished, finishedAt: new Date().toISOString(), problems: state.problems });
    logger.warn('scan', `Zielordner-Indexierung beendet (${finished}): ${state.scanned} gescannt.`);
  }
  release('targetScan');
}

/** Phase 1: Walk the filesystem and index files (fast metadata only). */
async function runWalkPhase(roots: readonly ('fotos' | 'videos')[], resume: boolean): Promise<boolean> {
  let cumDirs = 0;
  let cumFiles = 0;
  let startIdx = 0;
  const skipDirs = new Map<string, string>();

  if (resume) {
    const cur = getScanProgress('target')?.current ?? null;
    if (cur?.startsWith(WALK_MARKER)) {
      const marker = cur.slice(WALK_MARKER.length + 1);
      const at = marker.indexOf('@');
      const rootPart = at === -1 ? marker : marker.slice(0, at);
      startIdx = Math.max(0, roots.indexOf(rootPart as (typeof roots)[number]));
      if (at !== -1) {
        const dirPart = marker.slice(at + 1);
        if (dirPart) skipDirs.set(rootPart, dirPart);
      }
    }
  }

  const batch = createBatchUpsert();
  for (let i = startIdx; i < roots.length; i++) {
    const root = roots[i];
    const base = rootBase(root);
    if (!fs.existsSync(base)) continue;
    const result = await walkTree(base, async (file, stats) => {
      if (abortRequested) return;
      state.totalDirs = cumDirs + stats.dirs;
      state.totalFiles = cumFiles + stats.files;
      state.currentFile = `${root}/${file.relPath}`;

      // Fast metadata: stat data already available from walkTree
      const ext = extOf(path.basename(file.absPath));
      const fileType = detectFileType(ext);
      const originalName = path.basename(file.absPath);
      const isWhatsApp = isWhatsAppFilename(originalName);

      if (fileType && isSupportedExt(ext)) {
        // Index library file with status='indexed'
        batch.add({
          sourceRoot: root,
          hash: null,
          md5: null,
          sourceRelPath: file.relPath,
          sourceSize: file.size,
          sourceMtime: Math.floor(file.mtimeMs),
          fileType,
          ext,
          originalName,
          targetRoot: null,
          targetRelPath: null,
          deviceId: null,
          deviceRaw: null,
          make: null,
          model: null,
          takenAt: null,
          dateSource: 'file',
          overrideDate: null,
          overrideSource: null,
          status: 'indexed',
          isWhatsApp,
          meta: null,
        });
      }

      if (state.totalFiles % 50 === 0) {
        persistTargetProgress(`${WALK_MARKER}:${root}@${dirOf(file.relPath)}`);
        await scanPace();
      }
    }, () => abortRequested, {
      skipDirsBefore: skipDirs.get(root),
      concurrency: 4,
      onDir: (relDir) => persistTargetProgress(`${WALK_MARKER}:${root}@${relDir}`),
      onWorkerDir: (workerIdx, relDir) => {
        state.currentDirs[workerIdx] = relDir || '(root)';
      },
    });
    cumDirs += result.dirs;
    cumFiles += result.files;
    state.totalDirs = cumDirs;
    state.totalFiles = cumFiles;
    persistTargetProgress(`${WALK_MARKER}:${root}`);
    logger.info('scan', `Zielordner-Scan: ${result.dirs} Ordner, ${result.files} Dateien in "${root}" gefunden.`);
    if (abortRequested) break;
  }
  batch.flush();
  flushFormats();
  persistTargetProgress(`${ANALYZE_MARKER}:0`);
  return !abortRequested;
}

function reportProblem(fileId: number, type: ProblemType, message: string, onProblem?: (fileId: number, type: ProblemType, message: string, isNew: boolean) => void, perf?: FilePerf): void {
  const def = problemTypeDef(type);
  const tDb = performance.now();
  const { active } = upsertProblem({
    fileId,
    type,
    severity: def.severity,
    message,
    actionType: def.actions[0]?.id ?? null,
  });
  if (perf) perf.db += performance.now() - tDb;
  if (active) state.problems++;
  onProblem?.(fileId, type, message, active);
}

/** Analyze a single library file: hash, EXIF, device, consistency checks, upload linking. */
export async function analyzeLibraryFile(
  root: 'fotos' | 'videos',
  base: string,
  file: ScannedFile,
  onProblem?: (fileId: number, type: ProblemType, message: string, isNew: boolean) => void,
): Promise<void> {
  const perf = perfStart();
  const existing = getFileBySourcePath(root, file.relPath);
  const originalName = path.basename(file.absPath);
  const ext = extOf(originalName);
  const nowMtime = Math.floor(file.mtimeMs);
  const reusable = existing != null && existing.sourceSize === file.size && existing.sourceMtime === nowMtime;

  const fileType = detectFileType(ext);
  if (!fileType || !isSupportedExt(ext)) {
    perfLog(root, file.relPath, perf, 'unsupported');
    return;
  }

  /* hash */
  let hash = reusable ? existing.hash : null;
  let md5 = reusable ? existing.md5 : null;
  if (!hash || !md5) {
    const tRead = performance.now();
    const hashes = await hashFile(file.absPath);
    const dtRead = performance.now() - tRead;
    perf.read += dtRead;
    perf.hash += dtRead;
    perf.md5 += dtRead;
    if (!hash) hash = hashes.sha256;
    if (!md5) md5 = hashes.md5;
  }

  /* metadata */
  let make: string | null = reusable ? existing.make : null;
  let model: string | null = reusable ? existing.model : null;
  let metaDate: string | null = reusable && existing.dateSource !== 'file' ? existing.takenAt : null;
  let meta: Record<string, unknown> | null = existing?.meta ?? null;
  if (!reusable || (existing != null && existing.meta == null)) {
    if (fileType === 'image') {
      const m = await perfMark(perf, 'exif', () => readImageMeta(file.absPath));
      make = m.make;
      model = m.model;
      metaDate = m.takenAt;
      meta = m.meta;
    } else if (fileType === 'video') {
      const m = await perfMark(perf, 'exif', () => readVideoMeta(file.absPath));
      make = m.make;
      model = m.model;
      metaDate = m.takenAt;
      meta = m.meta;
    }
  }

  const filenameDate = parseDateFromFilename(originalName);
  const isWhatsApp = isWhatsAppFilename(originalName);
  const birthMs = file.birthtimeMs != null && file.birthtimeMs > 0 ? file.birthtimeMs : null;
  const fileDateIso = toLocalIso(new Date(birthMs ?? nowMtime));
  const takenAt = metaDate ?? (filenameDate ? toLocalIso(filenameDate) : fileDateIso);
  const dateSource: FileRecord['dateSource'] = metaDate ? (fileType === 'image' ? 'exif' : 'quicktime') : filenameDate ? 'filename' : 'file';

  /* device */
  let devRes = await perfMark(perf, 'device', () => resolveByExif(make, model));
  if (!devRes.device) devRes = await perfMark(perf, 'device', () => resolveByFilename(originalName));

  const fileId = existing?.id ?? await perfMark(perf, 'db', () => upsertFile({
    sourceRoot: root,
    hash,
    md5,
    sourceRelPath: file.relPath,
    sourceSize: file.size,
    sourceMtime: nowMtime,
    fileType,
    ext,
    originalName,
    targetRoot: null,
    targetRelPath: null,
    deviceId: devRes.device?.id ?? null,
    deviceRaw: devRes.raw,
    make,
    model,
    takenAt,
    dateSource,
    overrideDate: null,
    overrideSource: null,
    status: 'transferred',
    isWhatsApp,
    meta,
  }));
  if (existing) {
    await perfMark(perf, 'db', () => updateFile(fileId, { hash, md5, make, model, deviceId: devRes.device?.id ?? null, deviceRaw: devRes.raw, takenAt, dateSource, status: 'transferred', isWhatsApp, meta }));
  }
  await perfMark(perf, 'thumb', () => enqueueThumbnail(fileId));

  /* consistency checks */
  const reported = new Set<ProblemType>();
  if (birthMs != null && file.mtimeMs < birthMs - BIRTHTIME_TOLERANCE_MS) {
    reportProblem(fileId, 'FILE_MTIME_BEFORE_BIRTHTIME', `Die Datei-Änderungszeit (${localDateKey(toLocalIso(new Date(file.mtimeMs)))}) liegt vor der Datei-Erstellzeit (${localDateKey(toLocalIso(new Date(birthMs)))}).`, onProblem, perf);
    reported.add('FILE_MTIME_BEFORE_BIRTHTIME');
  }
  if (metaDate && filenameDate && differsByDay(metaDate, toLocalIso(filenameDate))) {
    reportProblem(fileId, 'LIBRARY_META_FILENAME_MISMATCH', `Meta-Datum (${localDateKey(metaDate)}) weicht vom Dateinamen-Datum (${localDateKey(toLocalIso(filenameDate))}) ab.`, onProblem, perf);
    reported.add('LIBRARY_META_FILENAME_MISMATCH');
  }
  if (metaDate && differsByDay(metaDate, fileDateIso)) {
    reportProblem(fileId, 'LIBRARY_META_FILETIME_MISMATCH', `Meta-Datum (${localDateKey(metaDate)}) weicht von der Datei-Erstellzeit (${localDateKey(fileDateIso)}) ab.`, onProblem, perf);
    reported.add('LIBRARY_META_FILETIME_MISMATCH');
  }
  if (!metaDate && filenameDate && differsByDay(toLocalIso(filenameDate), fileDateIso)) {
    reportProblem(fileId, 'LIBRARY_FILENAME_FILETIME_MISMATCH', `Dateinamen-Datum (${localDateKey(toLocalIso(filenameDate))}) weicht von der Datei-Erstellzeit (${localDateKey(fileDateIso)}) ab.`, onProblem, perf);
    reported.add('LIBRARY_FILENAME_FILETIME_MISMATCH');
  }
  const pathDate = dateFromLibraryPath(file.relPath);
  if (pathDate && differsByDay(pathDate, takenAt)) {
    reportProblem(fileId, 'LIBRARY_PATH_MISMATCH', `Zielordner (${pathDate}) passt nicht zum ermittelten Datum (${localDateKey(takenAt)}).`, onProblem, perf);
    reported.add('LIBRARY_PATH_MISMATCH');
  }

  /* resolve library problems that no longer apply */
  if (reported.size > 0) {
    const typesToResolve = LIBRARY_PROBLEM_TYPES.filter((t) => !reported.has(t));
    if (typesToResolve.length) await perfMark(perf, 'db', () => resolveProblemsForFile(fileId, typesToResolve));
  }

  /* link matching upload file as imported */
  if (hash) {
    const uploadRec = await perfMark(perf, 'db', () => getUploadFileByHash(hash));
    if (uploadRec && uploadRec.status !== 'transferred') {
      await perfMark(perf, 'db', () => updateFile(uploadRec.id, {
        status: 'transferred',
        targetRoot: root,
        targetRelPath: file.relPath,
        transferredAt: new Date().toISOString(),
      }));
    }
  }
  perfLog(root, file.relPath, perf, 'ready');
}

async function runTargetScanInternal(resume: boolean): Promise<void> {
  const roots = ['fotos', 'videos'] as const;
  try {
    // Indexierung überspringen, wenn ein früherer Lauf bereits analysiert
    // (der Walk ist dann längst fertig, nur die Analyse steht noch aus).
    const skipWalk = resume && (getScanProgress('target')?.current ?? '').startsWith(ANALYZE_MARKER);
    if (!skipWalk) {
      const t0 = Date.now();
      const walkOk = await runWalkPhase(roots, resume);
      const walkMs = Date.now() - t0;
      logger.info('scan', `[TRACE] Zielordner Walk: ${walkMs}ms, ${state.totalDirs} Ordner, ${state.totalFiles} Dateien, ${state.scanned} gescannt`);
      if (!walkOk || abortRequested) {
        if (state.status !== 'stopped') state.status = 'aborted';
        finishTargetScan();
        return;
      }
    }

    // Indexierung fertig → Analyse als Scan-Auftrag einreihen (eigener Prozess in der Scan-Kachel).
    const ids = listIndexedFileIds([...roots], true);
    if (ids.length > 0) {
      const job = enqueueScan(`Zielordner-Analyse (${ids.length.toLocaleString('de-DE')} Dateien)`, ids);
      logger.info('scan', `Zielordner-Indexierung abgeschlossen: ${ids.length.toLocaleString('de-DE')} Dateien zur Analyse eingereiht (Auftrag #${job.id}).`);
    } else {
      logger.info('scan', 'Zielordner-Indexierung abgeschlossen: keine neuen Dateien zu analysieren.');
    }

    if (abortRequested && state.status !== 'stopped') state.status = 'aborted';
    else if (state.status !== 'stopped') state.status = 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Zielordner-Indexierung fehlgeschlagen: ${msg}`);
  }
  finishTargetScan();
}

/** Extract the YYYY_MM_DD folder date from a path like 2024/01 Januar/2024_01_01/file.jpg */
function dateFromLibraryPath(relPath: string): string | null {
  const m = /\/(\d{4})_(\d{2})_(\d{2})\//.exec(relPath);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return toLocalIso(d);
}
