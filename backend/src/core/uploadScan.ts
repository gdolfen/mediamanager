import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  getFileBySource,
  saveScanProgress,
  getScanProgress,
  clearScanProgress,
  resetScanQueue,
  enqueueScanFile,
  nextPendingScanFiles,
  markScanFileDone,
  pendingScanCount,
  startRun,
  updateRun,
} from '../db/daos.js';
import { scanUpload } from './scanner.js';
import { evaluateFile, isSettledFile } from './evaluator.js';
import { validatePaths } from './transfer.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';

export interface UploadScanState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  runId: number | null;
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
}

const state: UploadScanState = {
  status: 'idle',
  runId: null,
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  indexed: 0,
  skipped: 0,
  problems: 0,
  currentFile: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;

const WALK_MARKER = 'walk:upload';

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
  const resume = Boolean(opts?.resume && (getScanProgress('upload')?.status === 'running' || getScanProgress('upload')?.status === 'aborted'));
  if (resume) {
    const p = getScanProgress('upload')!;
    const run = p.runId != null ? { id: p.runId } : startRun('uploadScan');
    state.status = 'running';
    state.runId = run.id;
    state.totalDirs = p.totalDirs;
    state.totalFiles = p.totalFiles;
    state.scanned = p.scanned;
    state.indexed = p.indexed;
    state.skipped = p.skipped;
    state.problems = p.problems;
    state.currentFile = null;
    state.errors = [];
    state.startedAt = p.startedAt;
    state.finishedAt = null;
    logger.info('scan', `Upload-Scan wird fortgesetzt (${p.scanned} gescannt, ${p.indexed} indexiert, ${p.skipped} übersprungen, ${pendingScanCount('upload')} ausstehend).`);
  } else {
    resetScanQueue('upload');
    const run = startRun('uploadScan');
    saveScanProgress('upload', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, indexed: 0, skipped: 0, problems: 0, current: null, runId: run.id });
    state.status = 'running';
    state.runId = run.id;
    state.totalDirs = 0;
    state.totalFiles = 0;
    state.scanned = 0;
    state.indexed = 0;
    state.skipped = 0;
    state.problems = 0;
    state.currentFile = null;
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
    updateRun(state.runId, { scanned: state.scanned, indexed: state.indexed, skipped: state.skipped, problems: state.problems });
  }
}

function finishUploadScan(resultDirs: number, resultFiles: number): void {
  state.currentFile = null;
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, scanned: state.scanned, indexed: state.indexed, skipped: state.skipped, problems: state.problems });
    state.runId = null;
  }
  if (state.status === 'completed') {
    clearScanProgress('upload');
    resetScanQueue('upload');
    logger.info('scan', `Upload-Scan abgeschlossen: ${resultDirs} Ordner, ${resultFiles} Dateien, ${state.scanned} gescannt, ${state.indexed} indexiert, ${state.skipped} übersprungen, ${state.problems} Probleme.`);
  } else {
    saveScanProgress('upload', { status: 'aborted', finishedAt: new Date().toISOString(), indexed: state.indexed, skipped: state.skipped, problems: state.problems });
    logger.warn('scan', `Upload-Scan abgebrochen: ${state.scanned} gescannt, ${state.indexed} indexiert, ${state.skipped} übersprungen. Fortsetzen möglich.`);
  }
  release('uploadScan');
}

async function runUploadScanInternal(resume: boolean): Promise<void> {
  const uploadBase = rootBase('upload');
  let resultDirs = 0;
  let resultFiles = 0;
  try {
    let walkDone = false;
    let skipDirsBefore: string | undefined;
    if (resume) {
      const cur = getScanProgress('upload')?.current ?? null;
      if (cur === 'walked' || cur?.startsWith('file:')) {
        walkDone = true; // Walk war abgeschlossen – direkt zur Abarbeitung der Queue.
      } else if (cur?.startsWith(`${WALK_MARKER}@`)) {
        const d = cur.slice(WALK_MARKER.length + 1);
        if (d) skipDirsBefore = d; // Walk ab diesem Verzeichnis fortsetzen.
      }
      // current == null oder 'walk:upload' → Walk von Anfang (bereits eingereihte Dateien dedupliziert die Queue).
    }
    if (!walkDone) {
      const result = await scanUpload(uploadBase, async (f, stats) => {
        if (abortRequested) return;
        state.totalDirs = stats.dirs;
        state.totalFiles = stats.files;
        state.currentFile = f.relPath;
        enqueueScanFile('upload', 'upload', f.relPath);
        if (state.totalFiles % 50 === 0) {
          persistUploadProgress(`${WALK_MARKER}@${dirOf(f.relPath)}`);
          await scanPace();
        }
      }, () => abortRequested, {
        skipDirsBefore,
        onDir: (relDir) => persistUploadProgress(`${WALK_MARKER}@${relDir}`),
      });
      resultDirs = result.dirs;
      resultFiles = result.files;
      state.totalDirs = resultDirs;
      state.totalFiles = resultFiles;
      persistUploadProgress('walked');
      if (abortRequested) {
        state.status = 'aborted';
        finishUploadScan(resultDirs, resultFiles);
        return;
      }
      if (pendingScanCount('upload') === 0) {
        state.status = 'completed';
        finishUploadScan(resultDirs, resultFiles);
        return;
      }
    }
    while (!abortRequested) {
      const batch = nextPendingScanFiles('upload', 10);
      if (!batch.length) break;
      for (const item of batch) {
        if (abortRequested) break;
        const abs = path.join(uploadBase, item.relPath);
        state.currentFile = item.relPath;
        try {
          const stat = await fs.promises.stat(abs);
          if (!stat.isFile()) {
            state.scanned++;
            markScanFileDone(item.id);
            await scanPace();
            continue;
          }
          const nowMtime = Math.floor(stat.mtimeMs);
          if (isSettledFile(getFileBySource(item.relPath), stat.size, nowMtime)) {
            // Bereits vollständig übertragen und unverändert – beim erneuten Scan überspringen.
            state.skipped++;
            state.scanned++;
            markScanFileDone(item.id);
            await scanPace();
            continue;
          }
          const scanned = {
            absPath: abs,
            relPath: item.relPath,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
          };
          const evaluation = await evaluateFile(scanned, {
            onProblem: (_fileId, _type, _message, isNew) => {
              if (isNew) state.problems++;
            },
          });
          if (abortRequested) break;
          if (evaluation.reason === 'duplicate' || evaluation.reason === 'already-transferred') {
            state.skipped++;
          } else {
            state.indexed++;
          }
        } catch (err) {
          const msg = `${item.relPath}: ${err instanceof Error ? err.message : String(err)}`;
          state.errors.push(msg);
          logger.error('scan', msg);
        }
        state.scanned++;
        markScanFileDone(item.id);
        if (state.scanned % 25 === 0) persistUploadProgress(`file:${state.currentFile}`);
        await scanPace();
      }
    }
    state.status = abortRequested ? 'aborted' : 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Upload-Scan fehlgeschlagen: ${msg}`);
  }
  finishUploadScan(resultDirs, resultFiles);
}