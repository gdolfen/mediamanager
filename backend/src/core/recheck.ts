import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  listFilesWithProblems,
  listProblemsForFile,
  resolveProblemsForFile,
  saveScanProgress,
  getScanProgress,
  clearScanProgress,
  startRun,
  updateRun,
} from '../db/daos.js';
import { evaluateFile } from './evaluator.js';
import { analyzeLibraryFile } from './libraryScan.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { pathExists } from './paths.js';
import { logger } from '../db/logger.js';
import type { FileRecord, ProblemType } from '../types.js';

export interface RecheckState {
  status: 'idle' | 'running' | 'completed' | 'aborted';
  runId: number | null;
  total: number;
  checked: number;
  created: number;
  resolved: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const state: RecheckState = {
  status: 'idle',
  runId: null,
  total: 0,
  checked: 0,
  created: 0,
  resolved: 0,
  currentFile: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;
let userAborted = false;

export function getRecheckState(): RecheckState {
  return { ...state };
}

export function isRecheckRunning(): boolean {
  return state.status === 'running';
}

export function requestRecheckAbort(): boolean {
  if (!isRecheckRunning()) return false;
  abortRequested = true;
  userAborted = true;
  return true;
}

export function wasRecheckUserAborted(): boolean { return userAborted; }

export function startRecheck(opts?: { resume?: boolean }): { ok: boolean; error?: string } {
  if (isRecheckRunning()) return { ok: false, error: 'Eine Neubewertung läuft bereits.' };
  if (!tryAcquire('recheck')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  abortRequested = false;
  userAborted = false;
  const run = startRun('recheck');
  const resume = Boolean(opts?.resume && getScanProgress('recheck')?.status === 'running');
  if (resume) {
    const p = getScanProgress('recheck')!;
    state.status = 'running';
    state.runId = run.id;
    state.total = p.scanned;
    state.checked = p.scanned;
    state.created = 0;
    state.resolved = 0;
    state.currentFile = null;
    state.errors = [];
    state.startedAt = p.startedAt;
    state.finishedAt = null;
    logger.info('scan', `Probleme-Neubewertung wird fortgesetzt (${p.scanned} geprüft).`);
  } else {
    saveScanProgress('recheck', { status: 'running', startedAt: new Date().toISOString(), totalDirs: 0, totalFiles: 0, scanned: 0, current: null });
    state.status = 'running';
    state.runId = run.id;
    state.total = 0;
    state.checked = 0;
    state.created = 0;
    state.resolved = 0;
    state.currentFile = null;
    state.errors = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    logger.info('scan', 'Probleme-Neubewertung gestartet.');
  }
  void runRecheckInternal(resume);
  return { ok: true };
}

function persistRecheckProgress(fileId: number): void {
  saveScanProgress('recheck', {
    status: 'running',
    totalDirs: 0,
    totalFiles: 0,
    scanned: state.checked,
    current: String(fileId),
  });
}

function finishRecheck(): void {
  state.currentFile = null;
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, scanned: state.checked, transferred: state.resolved, newFiles: state.created, problems: state.created });
    state.runId = null;
  }
  clearScanProgress('recheck');
  if (state.status === 'completed') {
    logger.info('scan', `Probleme-Neubewertung abgeschlossen: ${state.checked} Dateien geprüft, ${state.created} Probleme neu, ${state.resolved} gelöst.`);
  } else {
    logger.warn('scan', `Probleme-Neubewertung abgebrochen: ${state.checked} Dateien geprüft.`);
  }
  release('recheck');
}

async function runRecheckInternal(resume: boolean): Promise<void> {
  try {
    const files = listFilesWithProblems();
    state.total = files.length;
    const resumeFrom = resume && getScanProgress('recheck')?.current ? Number(getScanProgress('recheck')!.current) : 0;
    for (const file of files) {
      if (abortRequested) break;
      if (file.id <= resumeFrom) continue;
      state.currentFile = file.sourceRelPath;
      try {
        await recheckFile(file);
      } catch (err) {
        const msg = `${file.sourceRoot}/${file.sourceRelPath}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        logger.error('scan', msg);
      }
      state.checked++;
      if (state.checked % 25 === 0) persistRecheckProgress(file.id);
      await scanPace();
    }
    state.status = abortRequested ? 'aborted' : 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Probleme-Neubewertung fehlgeschlagen: ${msg}`);
  }
  finishRecheck();
}

async function recheckFile(file: FileRecord): Promise<void> {
  const base = rootBase(file.sourceRoot as 'upload' | 'fotos' | 'videos');
  const absPath = path.join(base, file.sourceRelPath);

  const activeTypes = listProblemsForFile(file.id)
    .filter((p) => !p.resolved)
    .map((p) => p.type);

  if (!(await pathExists(absPath))) {
    if (activeTypes.length) resolveProblemsForFile(file.id, activeTypes);
    state.resolved += activeTypes.length;
    return;
  }

  const stat = await fs.promises.stat(absPath);
  const scanned = { absPath, relPath: file.sourceRelPath, size: stat.size, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null };
  const reported = new Set<ProblemType>();

  if (file.sourceRoot === 'upload') {
    await evaluateFile(scanned, {
      onProblem: (fileId, type, _msg, isNew) => {
        reported.add(type);
        if (isNew) state.created++;
      },
    });
  } else {
    await analyzeLibraryFile(file.sourceRoot as 'fotos' | 'videos', base, scanned, (fileId: number, type: ProblemType, _msg: string, isNew: boolean) => {
      reported.add(type);
      if (isNew) state.created++;
    });
  }

  const stale = activeTypes.filter((t) => !reported.has(t));
  if (stale.length) {
    resolveProblemsForFile(file.id, stale);
    state.resolved += stale.length;
  }
}