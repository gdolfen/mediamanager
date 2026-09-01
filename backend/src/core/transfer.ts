import fs from 'node:fs';
import path from 'node:path';
import { getPaths, rootBase } from '../db/database.js';
import {
  getFileBySource,
  listProblemsForFile,
  resolveProblemsForFile,
  startRun,
  updateFile,
  updateRun,
} from '../db/daos.js';
import { scanUpload, type ScannedFile } from './scanner.js';
import { resolveBase } from './paths.js';
import { evaluateFile, isSettledFile, type EvaluationResult } from './evaluator.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { logger } from '../db/logger.js';

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

const state: TransferState = {
  runId: null,
  status: 'idle',
  totalDirs: 0,
  totalFiles: 0,
  scanned: 0,
  transferred: 0,
  skipped: 0,
  problems: 0,
  currentFile: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;

export function getTransferState(): TransferState {
  return { ...state };
}

export function isRunning(): boolean {
  return state.status === 'running';
}

export function requestAbort(): boolean {
  if (!isRunning()) return false;
  abortRequested = true;
  return true;
}

export function validatePaths(): { ok: boolean; errors: string[] } {
  const paths = getPaths();
  const errors: string[] = [];
  for (const [key, dir] of Object.entries(paths) as [string, string][]) {
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      errors.push(`Ordner "${key}" existiert nicht: ${dir}`);
      continue;
    }
    if (!stat.isDirectory()) {
      errors.push(`"${key}" ist kein Verzeichnis: ${dir}`);
      continue;
    }
    if (key === 'upload') {
      try {
        fs.accessSync(dir, fs.constants.R_OK);
      } catch {
        errors.push(`Upload-Ordner ist nicht lesbar: ${dir}`);
      }
    } else {
      try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      } catch {
        errors.push(`Ziel-Ordner "${key}" ist nicht les-/schreibbar: ${dir}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function startTransfer(): Promise<{ ok: boolean; error?: string; runId?: number }> {
  if (isRunning()) return { ok: false, error: 'Ein Transfer läuft bereits.' };
  if (!tryAcquire('transfer')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  const validation = validatePaths();
  if (!validation.ok) {
    release('transfer');
    return { ok: false, error: validation.errors.join('; ') };
  }
  abortRequested = false;
  const run = startRun();
  state.runId = run.id;
  state.status = 'running';
  state.totalDirs = 0;
  state.totalFiles = 0;
  state.scanned = 0;
  state.transferred = 0;
  state.skipped = 0;
  state.problems = 0;
  state.currentFile = null;
  state.errors = [];
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  logger.info('transfer', 'Transfer gestartet.');
  void runTransferInternal(run.id);
  return { ok: true, runId: run.id };
}

function countProblem(isNew: boolean): void {
  if (isNew) state.problems++;
}

async function runTransferInternal(runId: number): Promise<void> {
  const uploadBase = rootBase('upload');
  try {
    const result = await scanUpload(uploadBase, async (file, stats) => {
      if (abortRequested) return;
      state.totalDirs = stats.dirs;
      state.totalFiles = stats.files;
      state.currentFile = file.relPath;
      const nowMtime = Math.floor(file.mtimeMs);
      if (isSettledFile(getFileBySource(file.relPath), file.size, nowMtime)) {
        // Bereits vollständig übertragen und unverändert – beim erneuten Scan überspringen.
        state.skipped++;
        state.scanned++;
        updateRun(runId, { scanned: state.scanned, transferred: state.transferred, skipped: state.skipped, problems: state.problems });
        await scanPace();
        return;
      }
      try {
        const evaluation = await evaluateFile(file, {
          onProblem: (_fileId, _type, _message, isNew) => countProblem(isNew),
        });
        if (abortRequested) return;
        await transferFile(file, evaluation);
      } catch (err) {
        const msg = `${file.relPath}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        logger.error('transfer', msg);
      }
      state.scanned++;
      updateRun(runId, {
        scanned: state.scanned,
        transferred: state.transferred,
        skipped: state.skipped,
        problems: state.problems,
      });
      await scanPace();
    }, () => abortRequested);
    state.currentFile = null;
    const finished = abortRequested ? 'aborted' : 'completed';
    state.status = finished;
    updateRun(runId, { status: finished });
    if (finished === 'completed') {
      logger.info('transfer', `Transfer abgeschlossen: ${result.dirs} Ordner, ${result.files} Dateien, ${state.scanned} gescannt, ${state.transferred} übertragen, ${state.skipped} übersprungen, ${state.problems} Probleme.`);
    } else {
      logger.warn('transfer', `Transfer abgebrochen: ${state.scanned} gescannt, ${state.transferred} übertragen.`);
    }
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('transfer', `Transfer-Lauf fehlgeschlagen: ${msg}`);
    updateRun(runId, { status: 'aborted' });
  }
  state.finishedAt = new Date().toISOString();
  updateRun(runId, { problems: state.problems });
  release('transfer');
}

async function transferFile(file: ScannedFile, evaluation: EvaluationResult): Promise<void> {
  if (evaluation.reason === 'duplicate' || evaluation.reason === 'already-transferred') {
    state.skipped++;
    return;
  }
  if (evaluation.reason !== 'ready') {
    // problems already reported by the evaluator
    return;
  }
  const { fileId, targetInfo, targetAbs, takenAt, dateSource, deviceId, deviceRaw } = evaluation;
  if (!targetInfo || !targetAbs) return;

  /* ---- copy atomically ---- */
  const targetDir = path.dirname(targetAbs);
  const tmp = path.join(targetDir, `.${targetInfo.filename}.part-${process.pid}-${Date.now()}`);
  try {
    await fs.promises.mkdir(targetDir, { recursive: true });
    await fs.promises.copyFile(file.absPath, tmp);
    await fs.promises.rename(tmp, targetAbs);
  } catch (err) {
    try { await fs.promises.rm(tmp, { force: true }); } catch { /* ignore */ }
    countProblem(true);
    return;
  }

  /* ---- success ---- */
  updateFile(fileId, {
    status: 'transferred',
    targetRoot: targetInfo.root,
    targetRelPath: targetInfo.relPath,
    deviceId,
    deviceRaw,
    takenAt,
    dateSource,
    transferredAt: new Date().toISOString(),
  });
  const problems = listProblemsForFile(fileId);
  const openTypes = problems.filter((p) => !p.resolved).map((p) => p.type);
  // FILE_MTIME_BEFORE_BIRTHTIME ist eine dauerhafte Datei-Eigenschaft und wird
  // durch die Übertragung nicht behoben – sie bleibt zur Prüfung in der Liste.
  const resolvable = openTypes.filter((t) => t !== 'FILE_MTIME_BEFORE_BIRTHTIME');
  if (resolvable.length) resolveProblemsForFile(fileId, resolvable);
  state.transferred++;
}