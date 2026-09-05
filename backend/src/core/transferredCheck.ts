import {
  findLibraryByOriginalName,
  listUploadForTransferredCheck,
  startRun,
  updateFile,
  updateRun,
  type TransferredCandidate,
} from '../db/daos.js';
import { tryAcquire, release } from './active.js';
import { yieldToEventLoop } from './pace.js';
import { logger } from '../db/logger.js';

export interface TransferredCheckState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'stopped';
  runId: number | null;
  total: number;
  checked: number;
  /** Per md5 bestätigte Treffer (als übertragen verknüpft). */
  transferred: number;
  /** Dateiname in Bibliothek gefunden, aber unentschieden (md5 fehlt oder weicht ab). */
  undecided: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

const state: TransferredCheckState = {
  status: 'idle',
  runId: null,
  total: 0,
  checked: 0,
  transferred: 0,
  undecided: 0,
  currentFile: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;

export function getTransferredCheckState(): TransferredCheckState {
  return { ...state, errors: [...state.errors] };
}

export function isTransferredCheckRunning(): boolean {
  return state.status === 'running';
}

export function requestTransferredCheckAbort(): boolean {
  if (!isTransferredCheckRunning()) return false;
  abortRequested = true;
  state.status = 'stopped';
  return true;
}

export function startTransferredCheck(): { ok: boolean; error?: string; total?: number } {
  if (isTransferredCheckRunning()) return { ok: false, error: 'Ein Transferred-Check läuft bereits.' };
  if (!tryAcquire('transferredCheck')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  try {
    const files = listUploadForTransferredCheck();
    if (files.length === 0) {
      return { ok: false, error: 'Keine offenen Upload-Dateien gefunden.' };
    }
    abortRequested = false;
    const run = startRun('transferredCheck');
    state.status = 'running';
    state.runId = run.id;
    state.total = files.length;
    state.checked = 0;
    state.transferred = 0;
    state.undecided = 0;
    state.currentFile = null;
    state.errors = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    logger.info('scan', `Transferred-Check gestartet: ${files.length.toLocaleString('de-DE')} Upload-Datei(en).`);
    void runTransferredCheckInternal(files);
    return { ok: true, total: files.length };
  } catch (err) {
    state.status = 'idle';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('scan', `Transferred-Check konnte nicht gestartet werden: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    // Lock nur behalten, wenn der Job wirklich läuft – sonst Geister-Sperre.
    if (state.status !== 'running') release('transferredCheck');
  }
}

function finishTransferredCheck(): void {
  state.currentFile = null;
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : state.status === 'stopped' ? 'stopped' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, totalFiles: state.total, scanned: state.checked, transferred: state.transferred });
    state.runId = null;
  }
  if (state.status === 'completed') {
    logger.info('scan', `Transferred-Check abgeschlossen: ${state.checked} geprüft, ${state.transferred} als übertragen verknüpft, ${state.undecided} Namens-Treffer offen.`);
  } else {
    logger.warn('scan', `Transferred-Check beendet (${finished}): ${state.checked} geprüft.`);
  }
  release('transferredCheck');
}

async function runTransferredCheckInternal(files: TransferredCandidate[]): Promise<void> {
  try {
    for (const file of files) {
      if (abortRequested) break;
      state.currentFile = `upload/${file.sourceRelPath}`;
      try {
        checkFile(file);
      } catch (err) {
        const msg = `upload/${file.sourceRelPath}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        logger.error('scan', msg);
      }
      state.checked++;
      if (state.checked % 500 === 0) {
        if (state.runId != null) {
          updateRun(state.runId, { scanned: state.checked, transferred: state.transferred });
        }
        await yieldToEventLoop();
      }
    }
    if (abortRequested && state.status !== 'stopped') state.status = 'aborted';
    else if (state.status !== 'stopped') state.status = 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Transferred-Check fehlgeschlagen: ${msg}`);
  }
  finishTransferredCheck();
}

/**
 * Prüft eine Upload-Datei gegen die Bibliothek – nur über die DB:
 * 1. Dateiname in der Bibliothek suchen.
 * 2. Treffer + md5 auf beiden Seiten vorhanden + gleich → als übertragen verknüpft
 *    (kein zweiter Transfer nötig).
 * 3. Sonst (md5 fehlt oder weicht ab) → Status bleibt unverändert (pending).
 */
function checkFile(file: TransferredCandidate): void {
  const matches = findLibraryByOriginalName(file.originalName);
  if (matches.length === 0) return;
  if (file.md5) {
    const hit = matches.find((m) => m.md5 != null && m.md5 === file.md5);
    if (hit) {
      updateFile(file.id, {
        status: 'transferred',
        targetRoot: hit.targetRoot ?? hit.sourceRoot,
        targetRelPath: hit.targetRelPath ?? hit.sourceRelPath,
        transferredAt: new Date().toISOString(),
      });
      state.transferred++;
      logger.info('scan', `Als übertragen erkannt: upload/${file.sourceRelPath} = ${hit.sourceRoot}/${hit.sourceRelPath} (md5-gleich), verknüpft.`);
      return;
    }
  }
  state.undecided++;
}
