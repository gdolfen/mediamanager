import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  deleteFileRecord,
  getFileById,
  listFiles,
  listLibraryFiles,
  startRun,
  updateRun,
} from '../db/daos.js';
import { evaluateFile } from './evaluator.js';
import { analyzeLibraryFile } from './libraryScan.js';
import { thumbnailCachePath } from '../media/media.js';
import { tryAcquire, release } from './active.js';
import { scanPace } from './pace.js';
import { pathExists, resolveBase } from './paths.js';
import { logger } from '../db/logger.js';
import type { FileRecord } from '../types.js';
import type { ScannedFile } from './scanner.js';

export interface RescanState {
  status: 'idle' | 'running' | 'completed' | 'aborted' | 'stopped';
  runId: number | null;
  total: number;
  checked: number;
  removed: number;
  currentFile: string | null;
  errors: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RescanUploadFilter {
  person?: string;
  deviceKey?: string;
  year?: number;
  yearNull?: boolean;
  status?: 'indexed' | 'pending' | 'transferred';
  type?: 'image' | 'video';
  search?: string;
}

export interface RescanLibraryFilter {
  year?: number;
  yearNull?: boolean;
  month?: number;
  day?: number;
  status?: string;
  type?: string;
  search?: string;
}

export interface RescanInput {
  fileIds?: number[];
  upload?: RescanUploadFilter;
  library?: RescanLibraryFilter;
}

/** Schutz vor absurd großen Läufen (z. B. Kachel mit zehntausenden Dateien). */
const MAX_RESCAN_FILES = 50000;

const state: RescanState = {
  status: 'idle',
  runId: null,
  total: 0,
  checked: 0,
  removed: 0,
  currentFile: null,
  errors: [],
  startedAt: null,
  finishedAt: null,
};

let abortRequested = false;

export function getRescanState(): RescanState {
  return { ...state, errors: [...state.errors] };
}

export function isRescanRunning(): boolean {
  return state.status === 'running';
}

export function requestRescanAbort(): boolean {
  if (!isRescanRunning()) return false;
  abortRequested = true;
  state.status = 'stopped';
  return true;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function asYear(v: unknown): number | undefined {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 1900 && n < 3000 ? n : undefined;
}

function asStatus(v: unknown): 'indexed' | 'pending' | 'transferred' | undefined {
  return v === 'indexed' || v === 'pending' || v === 'transferred' ? v : undefined;
}

function asMediaType(v: unknown): 'image' | 'video' | undefined {
  return v === 'image' || v === 'video' ? v : undefined;
}

function resolveFiles(input: RescanInput): { files: FileRecord[]; error?: string } {
  if (Array.isArray(input.fileIds) && input.fileIds.length > 0) {
    const ids = [...new Set(input.fileIds.filter((n) => Number.isInteger(n)))].slice(0, MAX_RESCAN_FILES + 1);
    const files: FileRecord[] = [];
    for (const id of ids) {
      const f = getFileById(id);
      if (f) files.push(f);
    }
    if (files.length === 0) return { files, error: 'Keine gültigen Dateien gefunden.' };
    return { files };
  }
  if (input.upload) {
    const f = input.upload;
    const { rows, total } = listFiles({
      sourceRoot: 'upload',
      person: asString(f.person),
      deviceKey: asString(f.deviceKey),
      year: asYear(f.year),
      yearNull: f.yearNull === true ? true : undefined,
      status: asStatus(f.status),
      type: asMediaType(f.type),
      search: asString(f.search),
      limit: MAX_RESCAN_FILES + 1,
      offset: 0,
    });
    if (total > MAX_RESCAN_FILES) return { files: [], error: `Zu viele Dateien (${total.toLocaleString('de-DE')}, max. ${MAX_RESCAN_FILES.toLocaleString('de-DE')}).` };
    if (rows.length === 0) return { files: [], error: 'Keine Dateien in dieser Auswahl gefunden.' };
    return { files: rows };
  }
  if (input.library) {
    const f = input.library;
    const { rows, total } = listLibraryFiles({
      year: asYear(f.year),
      yearNull: f.yearNull === true ? true : undefined,
      month: typeof f.month === 'number' && Number.isInteger(f.month) && f.month >= 1 && f.month <= 12 ? f.month : undefined,
      day: typeof f.day === 'number' && Number.isInteger(f.day) && f.day >= 1 && f.day <= 31 ? f.day : undefined,
      status: asString(f.status),
      type: asMediaType(f.type),
      search: asString(f.search),
      limit: MAX_RESCAN_FILES + 1,
      offset: 0,
    });
    if (total > MAX_RESCAN_FILES) return { files: [], error: `Zu viele Dateien (${total.toLocaleString('de-DE')}, max. ${MAX_RESCAN_FILES.toLocaleString('de-DE')}).` };
    if (rows.length === 0) return { files: [], error: 'Keine Dateien in dieser Auswahl gefunden.' };
    return { files: rows };
  }
  return { files: [], error: 'Keine Dateien ausgewählt.' };
}

export function startRescan(input: RescanInput): { ok: boolean; error?: string; total?: number } {
  if (isRescanRunning()) return { ok: false, error: 'Ein erneuter Scan läuft bereits.' };
  if (!tryAcquire('rescan')) return { ok: false, error: 'Ein anderer Scan/Transfer läuft gerade.' };
  try {
    const { files, error } = resolveFiles(input ?? {});
    if (error || files.length === 0) {
      return { ok: false, error: error ?? 'Keine Dateien ausgewählt.' };
    }
    abortRequested = false;
    const run = startRun('rescan');
    state.status = 'running';
    state.runId = run.id;
    state.total = files.length;
    state.checked = 0;
    state.removed = 0;
    state.currentFile = null;
    state.errors = [];
    state.startedAt = new Date().toISOString();
    state.finishedAt = null;
    logger.info('scan', `Erneuter Scan gestartet: ${files.length.toLocaleString('de-DE')} Datei(en).`);
    void runRescanInternal(files);
    return { ok: true, total: files.length };
  } catch (err) {
    state.status = 'idle';
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('scan', `Erneuter Scan konnte nicht gestartet werden: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    // Lock nur behalten, wenn der Job wirklich läuft – sonst Geister-Sperre.
    if (state.status !== 'running') release('rescan');
  }
}

function finishRescan(): void {
  state.currentFile = null;
  state.finishedAt = new Date().toISOString();
  const finished = state.status === 'completed' ? 'completed' : state.status === 'stopped' ? 'stopped' : 'aborted';
  if (state.runId != null) {
    updateRun(state.runId, { status: finished, totalFiles: state.total, scanned: state.checked, problems: state.errors.length });
    state.runId = null;
  }
  if (state.status === 'completed') {
    logger.info('scan', `Erneuter Scan abgeschlossen: ${state.checked} Dateien geprüft${state.removed > 0 ? `, ${state.removed} fehlende entfernt` : ''}.`);
  } else {
    logger.warn('scan', `Erneuter Scan beendet (${finished}): ${state.checked} Dateien geprüft.`);
  }
  release('rescan');
}

async function runRescanInternal(files: FileRecord[]): Promise<void> {
  try {
    for (const file of files) {
      if (abortRequested) break;
      state.currentFile = `${file.sourceRoot}/${file.sourceRelPath}`;
      try {
        await rescanFile(file);
      } catch (err) {
        const msg = `${file.sourceRoot}/${file.sourceRelPath}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        logger.error('scan', msg);
      }
      state.checked++;
      if (state.checked % 25 === 0 && state.runId != null) {
        updateRun(state.runId, { scanned: state.checked });
      }
      await scanPace();
    }
    if (abortRequested && state.status !== 'stopped') state.status = 'aborted';
    else if (state.status !== 'stopped') state.status = 'completed';
  } catch (err) {
    state.status = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    state.errors.push(msg);
    logger.error('scan', `Erneuter Scan fehlgeschlagen: ${msg}`);
  }
  finishRescan();
}

async function rescanFile(file: FileRecord): Promise<void> {
  const base = rootBase(file.sourceRoot as 'upload' | 'fotos' | 'videos');
  const absPath = path.join(base, file.sourceRelPath);
  if (!(await pathExists(absPath))) {
    // Übertragene Datei, deren Ziel noch existiert: Quelle wurde aufgeräumt –
    // Datensatz behalten (dokumentiert die Übertragung).
    if (file.targetRoot && file.targetRelPath) {
      const targetAbs = resolveBase(rootBase(file.targetRoot as 'fotos' | 'videos'), file.targetRelPath);
      if (await pathExists(targetAbs)) return;
    }
    // Wirklich verschwunden: Datensatz (inkl. Probleme/Queue per CASCADE) und Thumbnail entfernen.
    deleteFileRecord(file.id);
    try {
      fs.rmSync(thumbnailCachePath(file.id), { force: true });
    } catch { /* ignore */ }
    state.removed++;
    logger.warn('scan', `${file.sourceRoot}/${file.sourceRelPath}: Datei nicht gefunden, aus Datenbank entfernt.`);
    return;
  }
  const stat = await fs.promises.stat(absPath);
  const scanned: ScannedFile = {
    absPath,
    relPath: file.sourceRelPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    birthtimeMs: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
  };
  if (file.sourceRoot === 'upload') {
    await evaluateFile(scanned, {});
  } else {
    await analyzeLibraryFile(file.sourceRoot as 'fotos' | 'videos', base, scanned);
  }
}
