import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  getFileBySourcePath,
  getUploadFileByHash,
  listProblemsForFile,
  resolveProblem,
  updateFile,
  upsertFile,
  upsertProblem,
  enqueueThumbnail,
  saveScanProgress,
  getScanProgress,
  clearScanProgress,
  resetScanQueue,
  nextIndexedFiles,
  indexedCount,
  createBatchUpsert,
  flushFormats,
  startRun,
  updateRun,
} from '../db/daos.js';
import { hashFile } from './hash.js';
import { readImageMeta, readVideoMeta } from './metadata.js';
import { resolveByExif, resolveByFilename, cacheDevices, clearDeviceCache } from './devices.js';
import { detectFileType, extOf } from './naming.js';
import { parseDateFromFilename, toLocalIso, differsByDay, localDateKey, isWhatsAppFilename } from './dates.js';
import { walkTree, type ScannedFile } from './scanner.js';
import { problemTypeDef } from './problemCatalog.js';
import { BIRTHTIME_TOLERANCE_MS } from './evaluator.js';
import { isSupportedExt, type FileRecord, type ProblemType } from '../types.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';

export interface TargetScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  runId: number | null;
  phase: 'walk' | 'analyze';
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  indexed: number;
  analyzed: number;
  linked: number;
  newFiles: number;
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
  phase: 'walk',
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  indexed: 0,
  analyzed: 0,
  linked: 0,
  newFiles: 0,
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
  clearScanProgress('target');
  return true;
}

export function startTargetScan(opts?: { resume?: boolean }): { ok: boolean; error?: string } {
  if (isTargetScanRunning()) return { ok: false, error: 'Ein Zielordner-Scan läuft bereits.' };
  if (!tryAcquire('targetScan')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  abortRequested = false;
  const resume = Boolean(opts?.resume && (getScanProgress('target')?.status === 'running' || getScanProgress('target')?.status === 'aborted'));
  if (resume) {
    const p = getScanProgress('target')!;
    const run = p.runId != null ? { id: p.runId } : startRun('targetScan');
    state.status = 'running';
    state.runId = run.id;
    state.phase = p.current?.startsWith(ANALYZE_MARKER) ? 'analyze' : 'walk';
    state.totalDirs = p.totalDirs;
    state.totalFiles = p.totalFiles;
    state.scanned = p.scanned;
    state.indexed = 0;
    state.analyzed = 0;
    // Im Analyse-Phase die tatsaechliche Anzahl indexierter Datei aus der DB neu zaehlen
    if (state.phase === 'analyze') {
      for (const r of ['fotos', 'videos'] as const) state.indexed += indexedCount(r);
    }
    state.linked = p.linked;
    state.newFiles = p.newFilesCount;
    state.problems = p.problems;
    state.currentFile = null;
    state.currentDirs = [];
    state.errors = [];
    state.startedAt = p.startedAt;
    state.finishedAt = null;
    logger.info('scan', `Zielordner-Scan wird fortgesetzt (Phase: ${state.phase}, ${p.scanned} gescannt, ${p.linked} verknüpft, ${p.newFilesCount} neu).`);
  } else {
    resetScanQueue('target');
    const run = startRun('targetScan');
    saveScanProgress('target', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, linked: 0, newFilesCount: 0, problems: 0, current: null, runId: run.id });
    state.status = 'running';
    state.runId = run.id;
    state.phase = 'walk';
    state.totalDirs = 0;
    state.totalFiles = 0;
    state.scanned = 0;
    state.indexed = 0;
    state.analyzed = 0;
    state.linked = 0;
    state.newFiles = 0;
    state.problems = 0;
    state.currentFile = null;
    state.currentDirs = [];
    state.errors = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    logger.info('scan', 'Zielordner-Scan gestartet.');
  }
  void runTargetScanInternal(resume);
  return { ok: true };
}

function persistTargetProgress(current: string | null): void {
  saveScanProgress('target', {
    status: 'running',
    totalDirs: state.totalDirs,
    totalFiles: state.totalFiles,
    scanned: state.scanned,
    linked: state.linked,
    newFilesCount: state.newFiles,
    problems: state.problems,
    current,
  });
  if (state.runId != null) {
    updateRun(state.runId, { scanned: state.scanned, transferred: state.linked, newFiles: state.newFiles, problems: state.problems });
  }
}

function finishTargetScan(): void {
  state.currentFile = null;
  state.currentDirs = [];
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, scanned: state.scanned, transferred: state.linked, newFiles: state.newFiles, problems: state.problems });
    state.runId = null;
  }
  if (state.status === 'completed') {
    clearScanProgress('target');
    logger.info('scan', `Zielordner-Scan abgeschlossen: ${state.scanned} gescannt, ${state.linked} verknüpft, ${state.newFiles} neu, ${state.problems} Probleme.`);
  } else {
    saveScanProgress('target', { status: 'aborted', finishedAt: new Date().toISOString(), linked: state.linked, newFilesCount: state.newFiles, problems: state.problems });
    logger.warn('scan', `Zielordner-Scan abgebrochen: ${state.scanned} gescannt, ${state.linked} verknüpft. Fortsetzen möglich.`);
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

function reportProblem(fileId: number, type: ProblemType, message: string, onProblem?: (fileId: number, type: ProblemType, message: string, isNew: boolean) => void): void {
  const def = problemTypeDef(type);
  const { active } = upsertProblem({
    fileId,
    type,
    severity: def.severity,
    message,
    actionType: def.actions[0]?.id ?? null,
  });
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
  const existing = getFileBySourcePath(root, file.relPath);
  const originalName = path.basename(file.absPath);
  const ext = extOf(originalName);
  const nowMtime = Math.floor(file.mtimeMs);
  const reusable = existing != null && existing.sourceSize === file.size && existing.sourceMtime === nowMtime;

  const fileType = detectFileType(ext);
  if (!fileType || !isSupportedExt(ext)) return;

  /* hash */
  let hash = reusable ? existing.hash : null;
  let md5 = reusable ? existing.md5 : null;
  if (!hash || !md5) {
    const hashes = await hashFile(file.absPath);
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
      const m = await readImageMeta(file.absPath);
      make = m.make;
      model = m.model;
      metaDate = m.takenAt;
      meta = m.meta;
    } else if (fileType === 'video') {
      const m = await readVideoMeta(file.absPath);
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
  let devRes = resolveByExif(make, model);
  if (!devRes.device) devRes = resolveByFilename(originalName);

  const fileId = existing?.id ?? upsertFile({
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
  });
  if (existing) {
    updateFile(fileId, { hash, md5, make, model, deviceId: devRes.device?.id ?? null, deviceRaw: devRes.raw, takenAt, dateSource, status: 'transferred', isWhatsApp, meta });
  }
  enqueueThumbnail(fileId);

  /* consistency checks */
  const reported = new Set<ProblemType>();
  if (birthMs != null && file.mtimeMs < birthMs - BIRTHTIME_TOLERANCE_MS) {
    reportProblem(fileId, 'FILE_MTIME_BEFORE_BIRTHTIME', `Die Datei-Änderungszeit (${localDateKey(toLocalIso(new Date(file.mtimeMs)))}) liegt vor der Datei-Erstellzeit (${localDateKey(toLocalIso(new Date(birthMs)))}).`, onProblem);
    reported.add('FILE_MTIME_BEFORE_BIRTHTIME');
  }
  if (metaDate && filenameDate && differsByDay(metaDate, toLocalIso(filenameDate))) {
    reportProblem(fileId, 'LIBRARY_META_FILENAME_MISMATCH', `Meta-Datum (${localDateKey(metaDate)}) weicht vom Dateinamen-Datum (${localDateKey(toLocalIso(filenameDate))}) ab.`, onProblem);
    reported.add('LIBRARY_META_FILENAME_MISMATCH');
  }
  if (metaDate && differsByDay(metaDate, fileDateIso)) {
    reportProblem(fileId, 'LIBRARY_META_FILETIME_MISMATCH', `Meta-Datum (${localDateKey(metaDate)}) weicht von der Datei-Erstellzeit (${localDateKey(fileDateIso)}) ab.`, onProblem);
    reported.add('LIBRARY_META_FILETIME_MISMATCH');
  }
  if (!metaDate && filenameDate && differsByDay(toLocalIso(filenameDate), fileDateIso)) {
    reportProblem(fileId, 'LIBRARY_FILENAME_FILETIME_MISMATCH', `Dateinamen-Datum (${localDateKey(toLocalIso(filenameDate))}) weicht von der Datei-Erstellzeit (${localDateKey(fileDateIso)}) ab.`, onProblem);
    reported.add('LIBRARY_FILENAME_FILETIME_MISMATCH');
  }
  const pathDate = dateFromLibraryPath(file.relPath);
  if (pathDate && differsByDay(pathDate, takenAt)) {
    reportProblem(fileId, 'LIBRARY_PATH_MISMATCH', `Zielordner (${pathDate}) passt nicht zum ermittelten Datum (${localDateKey(takenAt)}).`, onProblem);
    reported.add('LIBRARY_PATH_MISMATCH');
  }

  /* resolve library problems that no longer apply */
  const openLibProblems = listProblemsForFile(fileId).filter((p) => !p.resolved && LIBRARY_PROBLEM_TYPES.includes(p.type));
  for (const p of openLibProblems) {
    if (!reported.has(p.type)) resolveProblem(p.id);
  }

  /* link matching upload file as imported */
  if (hash) {
    const uploadRec = getUploadFileByHash(hash);
    if (uploadRec && uploadRec.status !== 'transferred') {
      updateFile(uploadRec.id, {
        status: 'transferred',
        targetRoot: root,
        targetRelPath: file.relPath,
        transferredAt: new Date().toISOString(),
      });
      state.linked++;
    } else if (!uploadRec) {
      state.newFiles++;
    }
  }
}

/** Phase 2: Analyze indexed files (hash, EXIF, device, consistency, linking). */
async function runAnalyzePhase(roots: readonly ('fotos' | 'videos')[]): Promise<void> {
  const ANALYZE_BATCH = 4;
  let analyzed = 0;
  cacheDevices();

  while (!abortRequested) {
    // Get indexed files from all roots
    const batch: { id: number; sourceRoot: string; relPath: string }[] = [];
    for (const root of roots) {
      const items = nextIndexedFiles(root, ANALYZE_BATCH - batch.length);
      batch.push(...items);
      if (batch.length >= ANALYZE_BATCH) break;
    }
    if (!batch.length) break;

    // Process batch in parallel
    await Promise.all(batch.map(async (item) => {
      if (abortRequested) return;
      const root = item.sourceRoot as 'fotos' | 'videos';
      const base = rootBase(root);
      const abs = path.join(base, item.relPath);
      state.currentFile = `${root}/${item.relPath}`;
      try {
        const stat = await fs.promises.stat(abs);
        if (stat.isFile()) {
          await analyzeLibraryFile(root, base, {
            absPath: abs,
            relPath: item.relPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
          });
        }
      } catch (err) {
        const msg = `${root}/${item.relPath}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        logger.error('scan', msg);
      }
      state.scanned++;
      await scanPace();
    }));

    analyzed += batch.length;
    state.analyzed = analyzed;
    if (analyzed % 20 === 0) persistTargetProgress(`${ANALYZE_MARKER}:${analyzed}`);
    await scanPace();
  }
  clearDeviceCache();
}

async function runTargetScanInternal(resume: boolean): Promise<void> {
  const roots = ['fotos', 'videos'] as const;
  try {
    // Phase 1: Walk (if not already done)
    if (state.phase === 'walk') {
      const walkOk = await runWalkPhase(roots, resume);
      if (!walkOk || abortRequested) {
        state.status = 'aborted';
        finishTargetScan();
        return;
      }
      state.phase = 'analyze';
      let totalIndexed = 0;
      for (const root of roots) totalIndexed += indexedCount(root);
      state.indexed = totalIndexed;
      state.analyzed = 0;
      if (totalIndexed === 0) {
        state.status = 'completed';
        finishTargetScan();
        return;
      }
    }

    // Phase 2: Analyze
    await runAnalyzePhase(roots);

    state.status = abortRequested ? 'aborted' : 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Zielordner-Scan fehlgeschlagen: ${msg}`);
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
