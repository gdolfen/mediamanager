import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  getFileBySource,
  saveScanProgress,
  getScanProgress,
  clearScanProgress,
  resetScanQueue,
  indexedCount,
  createBatchUpsert,
  flushFormats,
  startRun,
  updateRun,
} from '../db/daos.js';
import { scanUpload } from './scanner.js';
import { evaluateFile, isSettledFile } from './evaluator.js';
import { cacheDevices, clearDeviceCache } from './devices.js';
import { validatePaths } from './transfer.js';
import { tryAcquire, release } from './active.js';
import { detectFileType, extOf } from './naming.js';
import { isWhatsAppFilename } from './dates.js';
import { isSupportedExt } from '../types.js';
import { runAnalyzePhase as runAnalyzePhaseShared } from './analyzePhase.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';

export interface UploadScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'stopped';
  runId: number | null;
  phase: 'walk' | 'analyze';
  totalDirs: number;
  totalFiles: number;
  scanned: number;
  indexed: number;
  analyzed: number;
  skipped: number;
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
  phase: 'walk',
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  indexed: 0,
  analyzed: 0,
  skipped: 0,
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
  const validation = validatePaths();
  if (!validation.ok) {
    release('uploadScan');
    return { ok: false, error: validation.errors.join('; ') };
  }
  abortRequested = false;
  const resume = Boolean(opts?.resume && ['running', 'aborted', 'stopped'].includes(getScanProgress('upload')?.status ?? ''));
  if (resume) {
    const p = getScanProgress('upload')!;
    const run = p.runId != null ? { id: p.runId } : startRun('uploadScan');
    state.status = 'running';
    state.runId = run.id;
    state.phase = p.current?.startsWith(ANALYZE_MARKER) ? 'analyze' : 'walk';
    state.totalDirs = p.totalDirs;
    state.totalFiles = p.totalFiles;
    state.scanned = p.scanned;
    state.indexed = p.indexed;
    state.analyzed = 0;
    // Im Analyse-Phase die tatsaechliche Anzahl indexierter Datei aus der DB neu zaehlen
    if (state.phase === 'analyze') {
      state.indexed = indexedCount('upload');
    }
    state.skipped = p.skipped;
    state.problems = p.problems;
    state.currentFile = null;
    state.currentDirs = [];
    state.errors = [];
    state.startedAt = p.startedAt;
    state.finishedAt = null;
    logger.info('scan', `Upload-Scan wird fortgesetzt (Phase: ${state.phase}, ${p.scanned} gescannt, ${p.indexed} indexiert, ${p.skipped} übersprungen).`);
  } else {
    resetScanQueue('upload');
    const run = startRun('uploadScan');
    saveScanProgress('upload', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, indexed: 0, skipped: 0, problems: 0, current: null, runId: run.id });
    state.status = 'running';
    state.runId = run.id;
    state.phase = 'walk';
    state.totalDirs = 0;
    state.totalFiles = 0;
    state.scanned = 0;
    state.indexed = 0;
    state.analyzed = 0;
    state.skipped = 0;
    state.problems = 0;
    state.currentFile = null;
    state.currentDirs = [];
    state.errors = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    logger.info('scan', 'Upload-Scan gestartet.');
  }
  void runUploadScanInternal(resume);
  return { ok: true };
}

function persistUploadProgress(current: string | null): void {
  saveScanProgress('upload', {
    status: 'running',
    totalDirs: state.totalDirs,
    totalFiles: state.totalFiles,
    scanned: state.scanned,
    indexed: state.indexed,
    skipped: state.skipped,
    problems: state.problems,
    current,
  });
  if (state.runId != null) {
    updateRun(state.runId, { totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, indexed: state.indexed, skipped: state.skipped, problems: state.problems });
  }
}

function finishUploadScan(resultDirs: number, resultFiles: number): void {
  state.currentFile = null;
  state.currentDirs = [];
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : state.status === 'stopped' ? 'stopped' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, totalDirs: state.totalDirs, totalFiles: state.totalFiles, scanned: state.scanned, indexed: state.indexed, skipped: state.skipped, problems: state.problems });
    state.runId = null;
  }
  if (state.status === 'completed') {
    clearScanProgress('upload');
    logger.info('scan', `Upload-Scan abgeschlossen: ${resultDirs} Ordner, ${resultFiles} Dateien, ${state.scanned} gescannt, ${state.indexed} indexiert, ${state.analyzed} analysiert, ${state.skipped} übersprungen, ${state.problems} Probleme.`);
  } else {
    saveScanProgress('upload', { status: finished, finishedAt: new Date().toISOString(), indexed: state.indexed, skipped: state.skipped, problems: state.problems });
    logger.warn('scan', `Upload-Scan beendet (${finished}): ${state.scanned} gescannt, ${state.indexed} indexiert, ${state.analyzed} analysiert, ${state.skipped} übersprungen.`);
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
  persistUploadProgress(`${ANALYZE_MARKER}:0`);
  return !abortRequested;
}

/** Phase 2: Analyze indexed files (hash, EXIF, device, thumbnail). */
async function runAnalyzePhase(): Promise<void> {
  cacheDevices();

  await runAnalyzePhaseShared(['upload'], {
    shouldAbort: () => abortRequested,
    onFile: async (item, file) => {
      state.currentFile = item.relPath;
      const nowMtime = Math.floor(file.mtimeMs);
      if (isSettledFile(getFileBySource(item.relPath), file.size, nowMtime)) {
        state.skipped++;
        return;
      }
      const evaluation = await evaluateFile(file, {
        onProblem: (_fileId, _type, _message, isNew) => {
          if (isNew) state.problems++;
        },
      });
      if (evaluation.reason === 'duplicate' || evaluation.reason === 'already-transferred') {
        state.skipped++;
      } else {
        state.analyzed++;
      }
    },
    onProgress: (analyzed) => {
      if (analyzed % 20 === 0) {
        state.indexed = indexedCount('upload');
        persistUploadProgress(`${ANALYZE_MARKER}:${analyzed}`);
      }
    },
    onError: (msg) => {
      state.errors.push(msg);
      logger.error('scan', msg);
    },
    onScanned: () => { state.scanned++; },
  });

  clearDeviceCache();
}

async function runUploadScanInternal(resume: boolean): Promise<void> {
  const uploadBase = rootBase('upload');
  let resultDirs = 0;
  let resultFiles = 0;
  try {
    // Phase 1: Walk (if not already done)
    if (state.phase === 'walk') {
      const walkOk = await runWalkPhase(uploadBase, resume);
      if (!walkOk || abortRequested) {
        if (state.status !== 'stopped') state.status = 'aborted';
        finishUploadScan(resultDirs, resultFiles);
        return;
      }
      state.phase = 'analyze';
      state.indexed = indexedCount('upload');
      state.analyzed = 0;
      if (state.indexed === 0) {
        state.status = 'completed';
        finishUploadScan(resultDirs, resultFiles);
        return;
      }
    }

    // Phase 2: Analyze
    await runAnalyzePhase();

    if (abortRequested && state.status !== 'stopped') state.status = 'aborted';
    else if (state.status !== 'stopped') state.status = 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Upload-Scan fehlgeschlagen: ${msg}`);
  }
  finishUploadScan(resultDirs, resultFiles);
}
