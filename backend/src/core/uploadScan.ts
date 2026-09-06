import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
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
import { scanUpload } from './scanner.js';
import { validatePaths } from './transfer.js';
import { tryAcquire, release } from './active.js';
import { detectFileType, extOf } from './naming.js';
import { isWhatsAppFilename } from './dates.js';
import { isSupportedExt } from '../types.js';
import { enqueueScan, kickScanWorker } from './analyze.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';

export interface UploadScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'stopped';
  runId: number | null;
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  indexed: number;
  problems: number;
  currentFile: string | null;
  currentDirs: string[];
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const state: UploadScanState = {
  status: 'idle',
  runId: null,
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  indexed: 0,
  problems: 0,
  currentFile: null,
  currentDirs: [],
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;

const WALK_MARKER = 'walk:upload';
const ANALYZE_MARKER = 'analyze';

/** Relatives Verzeichnis (posix) einer Datei; '' für die Wurzel. */
function dirOf(rel: string): string {
  const d = path.posix.dirname(rel);
  return d === '.' ? '' : d;
}

export function getUploadScanState(): UploadScanState {
  return { ...state };
}

export function isUploadScanRunning(): boolean {
  return state.status === 'running';
}

export function requestUploadScanAbort(): boolean {
  if (!isUploadScanRunning()) return false;
  abortRequested = true;
  state.status = 'stopped';
  return true;
}

export function startUploadScan(opts?: { resume?: boolean }): { ok: boolean; error?: string } {
  if (isUploadScanRunning()) return { ok: false, error: 'Ein Upload-Scan läuft bereits.' };
  if (!tryAcquire('uploadScan')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  try {
    const validation = validatePaths();
    if (!validation.ok) {
      return { ok: false, error: validation.errors.join('; ') };
    }
    abortRequested = false;
    const resume = Boolean(opts?.resume && ['running', 'aborted', 'stopped'].includes(getScanProgress('upload')?.status ?? ''));
    if (resume) {
      const p = getScanProgress('upload')!;
      const run = p.runId != null ? { id: p.runId } : startRun('uploadScan');
      state.status = 'running';
      state.runId = run.id;
      state.totalDirs = p.totalDirs;
      state.totalFiles = p.totalFiles;
      state.scanned = p.scanned;
      state.indexed = p.indexed;
      state.problems = p.problems;
      state.currentFile = null;
      state.currentDirs = [];
      state.errors = [];
      state.startedAt = p.startedAt;
      state.finishedAt = null;
      logger.info('scan', `Upload-Indexierung wird fortgesetzt (${p.scanned} gescannt, ${p.indexed} indexiert).`);
    } else {
      resetScanQueue('upload');
      const run = startRun('uploadScan');
      saveScanProgress('upload', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, indexed: 0, problems: 0, current: null, runId: run.id });
      state.status = 'running';
      state.runId = run.id;
      state.totalDirs = 0;
      state.totalFiles = 0;
      state.scanned = 0;
      state.indexed = 0;
      state.problems = 0;
      state.currentFile = null;
      state.currentDirs = [];
      state.errors = [];
      state.startedAt = new Date().toISOString();
      state.finishedAt = null;
      logger.info('scan', 'Upload-Indexierung gestartet.');
    }
    void runUploadScanInternal(resume);
    return { ok: true };
  } catch (err) {
    state.status = 'idle';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('scan', `Upload-Scan konnte nicht gestartet werden: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    // Lock nur behalten, wenn der Job wirklich läuft – sonst Geister-Sperre.
    if (state.status !== 'running') release('uploadScan');
  }
}

function persistUploadProgress(current: string | null): void {
  saveScanProgress('upload', {
    status: 'running',
    totalDirs: state.totalDirs,
    totalFiles: state.totalFiles,
    scanned: state.scanned,
    indexed: state.indexed,
    problems: state.problems,
    current,
  });
  if (state.runId != null) {
    updateRun(state.runId, { totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, indexed: state.indexed, problems: state.problems });
  }
}

function finishUploadScan(resultDirs: number, resultFiles: number): void {
  state.currentFile = null;
  state.currentDirs = [];
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : state.status === 'stopped' ? 'stopped' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, indexed: state.indexed, problems: state.problems });
    state.runId = null;
  }
  if (state.status === 'completed') {
    clearScanProgress('upload');
    logger.info('scan', `Upload-Indexierung abgeschlossen: ${resultDirs} Ordner, ${resultFiles} Dateien, ${state.scanned} gescannt, ${state.indexed} indexiert, ${state.problems} Probleme.`);
  } else {
    saveScanProgress('upload', { status: finished, finishedAt: new Date().toISOString(), indexed: state.indexed, problems: state.problems });
    logger.warn('scan', `Upload-Indexierung beendet (${finished}): ${state.scanned} gescannt, ${state.indexed} indexiert.`);
  }
  release('uploadScan');
}

/** Phase 1: Walk the filesystem and index files (fast metadata only). */
async function runWalkPhase(uploadBase: string, resume: boolean): Promise<boolean> {
  let skipDirsBefore: string | undefined;
  if (resume) {
    const cur = getScanProgress('upload')?.current ?? null;
    if (cur?.startsWith(`${WALK_MARKER}@`)) {
      const d = cur.slice(WALK_MARKER.length + 1);
      if (d) skipDirsBefore = d;
    }
  }

  const batch = createBatchUpsert();
  const result = await scanUpload(uploadBase, async (f, stats) => {
    if (abortRequested) return;
    state.totalDirs = stats.dirs;
    state.totalFiles = stats.files;
    state.currentFile = f.relPath;

    // Fast metadata: stat data already available from walkTree
    const ext = extOf(path.basename(f.absPath));
    const fileType = detectFileType(ext);
    const originalName = path.basename(f.absPath).replace(/\\/g, '/');
    const isWhatsApp = isWhatsAppFilename(originalName);

    // Upsert with status='indexed' – no hash, no EXIF, no thumbnail yet
    batch.add({
      sourceRoot: 'upload',
      hash: null,
      md5: null,
      sourceRelPath: f.relPath,
      sourceSize: f.size,
      sourceMtime: Math.floor(f.mtimeMs),
      fileType: fileType ?? 'other',
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
      status: isSupportedExt(ext) ? 'indexed' : 'pending',
      isWhatsApp,
      meta: null,
    });

    state.indexed++;
    if (state.totalFiles % 50 === 0) {
      persistUploadProgress(`${WALK_MARKER}@${dirOf(f.relPath)}`);
      await scanPace();
    }
  }, () => abortRequested, {
    skipDirsBefore,
    concurrency: 4,
    onDir: (relDir) => persistUploadProgress(`${WALK_MARKER}@${relDir}`),
    onWorkerDir: (workerIdx, relDir) => {
      state.currentDirs[workerIdx] = relDir || '(root)';
    },
  });

  batch.flush();
  flushFormats();
  state.totalDirs = result.dirs;
  state.totalFiles = result.files;
  return !abortRequested;
}

async function runUploadScanInternal(resume: boolean): Promise<void> {
  const uploadBase = rootBase('upload');
  let resultDirs = 0;
  let resultFiles = 0;
  try {
    // Indexierung überspringen, wenn ein früherer Lauf bereits analysiert
    // (der Walk ist dann längst fertig, nur die Analyse steht noch aus).
    const skipWalk = resume && (getScanProgress('upload')?.current ?? '').startsWith(ANALYZE_MARKER);
    if (!skipWalk) {
      const t0 = Date.now();
      const walkOk = await runWalkPhase(uploadBase, resume);
      const walkMs = Date.now() - t0;
      logger.info('scan', `[TRACE] Walk-Phase: ${walkMs}ms, ${state.totalDirs} Ordner, ${state.totalFiles} Dateien, ${state.scanned} gescannt`);
      if (!walkOk || abortRequested) {
        if (state.status !== 'stopped') state.status = 'aborted';
        finishUploadScan(resultDirs, resultFiles);
        return;
      }
    }

    // Indexierung fertig → Analyse als Scan-Auftrag einreihen (eigener Prozess in der Scan-Kachel).
    const ids = listIndexedFileIds(['upload'], true);
    if (ids.length > 0) {
      const job = enqueueScan(`Upload-Analyse (${ids.length.toLocaleString('de-DE')} Dateien)`, ids);
      logger.info('scan', `Upload-Indexierung abgeschlossen: ${ids.length.toLocaleString('de-DE')} Dateien zur Analyse eingereiht (Auftrag #${job.id}).`);
    } else {
      logger.info('scan', 'Upload-Indexierung abgeschlossen: keine neuen Dateien zu analysieren.');
    }

    if (abortRequested && state.status !== 'stopped') state.status = 'aborted';
    else if (state.status !== 'stopped') state.status = 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Upload-Indexierung fehlgeschlagen: ${msg}`);
  }
  finishUploadScan(resultDirs, resultFiles);
}
