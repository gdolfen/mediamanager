import fs from 'node:fs';
import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  createScanJob,
  updateScanJob,
  nextScanJob,
  getScanJob,
  deleteScanJob,
  requeueScanJob,
  listScanJobFiles,
  removeScanJobFiles,
  remainingScanWork,
  countScanJobFiles,
  countOpenScanJobs,
  pruneScanJobs,
  recoverStuckScanJobs,
  deleteFileRecord,
  getFileById,
  listFiles,
  listLibraryFiles,
  refreshFormatCounts,
  startRun,
  updateRun,
  type ScanJob,
} from '../db/daos.js';
import { evaluateFile } from './evaluator.js';
import { analyzeLibraryFile } from './libraryScan.js';
import { cacheDevices, clearDeviceCache } from './devices.js';
import { thumbnailCachePath } from '../media/media.js';
import { tryAcquire, release } from './active.js';
import { pathExists, resolveBase } from './paths.js';
import { logger } from '../db/logger.js';
import type { FileRecord } from '../types.js';
import type { ScannedFile } from './scanner.js';

/**
 * Analyse-Engine (Scan Phase 2): verarbeitet Datei-Listen parallel, egal ob sie
 * aus Kachel-Scans oder aus der Indexierung (Walk) stammen. Mehrere Aufträge
 * landen in der Queue-Tabelle und werden nacheinander abgearbeitet.
 */

/** Parallele Worker – gleiche Größenordnung wie die frühere Analyse-Phase. */
export const ANALYZE_CONCURRENCY = 20;

import { estimateFileMs, recordSample, flushCalibration, loadCalibration, calibrationSummary } from './etaCalibration.js';

export interface ScanUploadScope {
  person?: string;
  deviceKey?: string;
  year?: number;
  yearNull?: boolean;
  status?: 'indexed' | 'pending' | 'transferred';
  type?: 'image' | 'video';
  search?: string;
  excludeUnsupported?: boolean;
}

export interface ScanLibraryScope {
  year?: number;
  yearNull?: boolean;
  month?: number;
  day?: number;
  status?: string;
  type?: string;
  search?: string;
  excludeUnsupported?: boolean;
}

export interface ScanEnqueueInput {
  fileIds?: number[];
  upload?: ScanUploadScope;
  library?: ScanLibraryScope;
}

export interface ActiveScanFile {
  file: string;
  sizeBytes: number | null;
  startedAt: string;
  /** Geschätzte Gesamtdauer in ms (Typ + Größe, kalibriert 2026-09: ~55 MB/s NAS). */
  etaMs: number;
}

export interface ScanJobProgress {
  id: number;
  label: string;
  total: number;
  checked: number;
  removed: number;
  startedAt: string | null;
}

export interface ScanWorkerState {
  running: boolean;
  current: ScanJobProgress | null;
  activeFiles: ActiveScanFile[];
  openJobs: number;
  openFiles: number;
  /** Geschätzte Restzeit des aktiven Auftrags in ms (Summe über offene Dateien). */
  remainingMs: number | null;
  errors: string[];
  lastFinishedAt: string | null;
  lastStatus: 'idle' | 'completed' | 'aborted' | 'stopped';
  lastTotal: number;
  lastChecked: number;
  lastRemoved: number;
}

const worker = {
  running: false,
  jobId: null as number | null,
  label: '',
  total: 0,
  checked: 0,
  removed: 0,
  startedAt: null as string | null,
  activeFiles: [] as ActiveScanFile[],
  errors: [] as string[],
  lastFinishedAt: null as string | null,
  lastStatus: 'idle' as 'idle' | 'completed' | 'aborted' | 'stopped',
  lastTotal: 0,
  lastChecked: 0,
  lastRemoved: 0,
};

let abortRequested = false;
let timer: NodeJS.Timeout | null = null;
const warnedBases = new Set<string>();

export function getScanWorkerState(): ScanWorkerState {
  const open = countOpenScanJobs();
  let remainingMs: number | null = null;
  if (worker.jobId != null) {
    remainingMs = 0;
    for (const g of remainingScanWork(worker.jobId)) {
      // Linear im Modell: count × Schätzung(Ø-Größe) — exakt fürs Fallback, Näherung für kalibrierte Buckets.
      remainingMs += g.count * estimateFileMs(g.fileType, g.count > 0 ? g.bytes / g.count : null);
    }
    remainingMs = Math.round(remainingMs);
  }
  return {
    running: worker.running,
    current: worker.jobId != null
      ? { id: worker.jobId, label: worker.label, total: worker.total, checked: worker.checked, removed: worker.removed, startedAt: worker.startedAt }
      : null,
    activeFiles: worker.activeFiles.map((f) => ({ ...f })),
    openJobs: open.jobs,
    openFiles: open.files,
    remainingMs,
    errors: [...worker.errors],
    lastFinishedAt: worker.lastFinishedAt,
    lastStatus: worker.lastStatus,
    lastTotal: worker.lastTotal,
    lastChecked: worker.lastChecked,
    lastRemoved: worker.lastRemoved,
  };
}

export function isScanWorkerRunning(): boolean {
  return worker.running;
}

export function requestScanAbort(): boolean {
  if (!worker.running) return false;
  abortRequested = true;
  return true;
}

/** Auftrag einreihen (blockiert nie – auch bei laufendem Prozess). */
export function enqueueScan(label: string, fileIds: number[]): ScanJob {
  const job = createScanJob(label, fileIds);
  logger.info('scan', `Scan-Auftrag #${job.id} eingereiht: ${label} (${job.total} Dateien).`);
  kickScanWorker();
  return job;
}

/** Angehaltenen Auftrag fortsetzen (übrige Dateien bleiben erhalten). */
export function resumeScanJob(id: number): { ok: boolean; error?: string } {
  const job = getScanJob(id);
  if (!job) return { ok: false, error: 'Auftrag nicht gefunden.' };
  if (job.status !== 'stopped' && job.status !== 'aborted') {
    return { ok: false, error: 'Nur angehaltene Aufträge können fortgesetzt werden.' };
  }
  if (!requeueScanJob(id)) return { ok: false, error: 'Auftrag konnte nicht fortgesetzt werden.' };
  logger.info('scan', `Scan-Auftrag #${id} wird fortgesetzt.`);
  kickScanWorker();
  return { ok: true };
}

/** Wartenden Auftrag samt eingereihter Dateien löschen. */
export function removeScanJob(id: number): { ok: boolean; error?: string } {
  const job = getScanJob(id);
  if (!job) return { ok: false, error: 'Auftrag nicht gefunden.' };
  if (job.status !== 'queued') return { ok: false, error: 'Nur wartende Aufträge können gelöscht werden.' };
  deleteScanJob(id);
  logger.info('scan', `Scan-Auftrag #${id} gelöscht (${job.label}).`);
  return { ok: true };
}

export function startScanWorker(intervalMs = 3000): void {
  if (timer) return;
  // Abgestürzte Läufe ('running' aus früherem Prozess) wieder freigeben.
  try {
    recoverStuckScanJobs();
  } catch (err) {
    logger.warn('scan', `Scan-Aufträge konnten nicht wiederhergestellt werden: ${err instanceof Error ? err.message : String(err)}`);
  }
  loadCalibration();
  timer = setInterval(() => {
    void pump();
  }, intervalMs);
}

export function stopScanWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function kickScanWorker(): void {
  void pump();
}

async function pump(): Promise<void> {
  if (worker.running) return;
  const job = nextScanJob();
  if (!job) return;
  if (!tryAcquire('scan')) return;
  worker.running = true;
  abortRequested = false;
  let progressed = false;
  try {
    progressed = await processJob(job);
  } finally {
    worker.running = false;
    release('scan');
  }
  // Bei Fortschritt sofort weiter (nächster Auftrag); sonst wartet der Tick
  // (z. B. Ablage offline oder Sperre durch anderen Prozess).
  if (progressed) void pump();
}

async function processJob(job: ScanJob): Promise<boolean> {
  const run = startRun('scan');
  worker.jobId = job.id;
  worker.label = job.label;
  worker.total = job.total;
  worker.checked = job.checked;
  worker.removed = job.removed;
  worker.startedAt = new Date().toISOString();
  worker.activeFiles = [];
  worker.errors = [];
  warnedBases.clear();
  updateScanJob(job.id, { status: 'running', startedAt: worker.startedAt });
  logger.info('scan', `Scan-Auftrag #${job.id} gestartet: ${job.label} (${job.total} Dateien).`);
  const active = new Map<string, ActiveScanFile>();
  const syncActive = () => {
    worker.activeFiles = [...active.values()];
  };
  // Worker-Pool ohne Barriere: Jeder freie Worker nimmt sofort die nächste Datei.
  // Anders als Promise.all über Chunks blockiert keine langsame Datei die anderen.
  const ids = listScanJobFiles(job.id);
  let cursor = 0;
  let progressed = false;
  let outcome: 'completed' | 'aborted' | 'stopped' = 'completed';
  const nextId = (): number | undefined => {
    if (abortRequested) return undefined;
    return cursor < ids.length ? ids[cursor++] : undefined;
  };
  try {
    const workers = Array.from({ length: ANALYZE_CONCURRENCY }, async () => {
      for (;;) {
        const id = nextId();
        if (id === undefined) break;
        const file = getFileById(id);
        if (!file) {
          removeScanJobFiles(job.id, [id]);
          continue;
        }
        const label = `${file.sourceRoot}/${file.sourceRelPath}`;
        active.set(label, {
          file: label,
          sizeBytes: file.sourceSize ?? null,
          startedAt: new Date().toISOString(),
          etaMs: estimateFileMs(file.fileType, file.sourceSize),
        });
        syncActive();
        try {
          const tFile0 = performance.now();
          const r = await processFile(file);
          if (r === 'skipped') continue;
          if (r === 'ok') recordSample(file.fileType, file.sourceSize, performance.now() - tFile0);
          if (r === 'removed') worker.removed++;
          worker.checked++;
          progressed = true;
          removeScanJobFiles(job.id, [id]);
          if (worker.checked % 25 === 0) {
            updateScanJob(job.id, { checked: worker.checked, removed: worker.removed });
            updateRun(run.id, { scanned: worker.checked });
          }
          if (worker.checked % 250 === 0) {
            try {
              flushCalibration();
            } catch (err) {
              logger.warn('scan', `Kalibrierung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch (err) {
          const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
          worker.errors.push(msg);
          logger.error('scan', msg);
          worker.checked++;
          progressed = true;
          removeScanJobFiles(job.id, [id]);
        } finally {
          active.delete(label);
          syncActive();
        }
      }
    });
    await Promise.all(workers);
    if (abortRequested) outcome = 'stopped';
  } catch (err) {
    outcome = 'aborted';
    const msg = err instanceof Error ? err.message : String(err);
    worker.errors.push(msg);
    logger.error('scan', `Scan-Auftrag #${job.id} fehlgeschlagen: ${msg}`);
  }
  const finishedAt = new Date().toISOString();
  const remaining = countScanJobFiles(job.id);
  if (outcome === 'completed' && remaining > 0) {
    // Nicht alles verarbeitet (z. B. Ablage zeitweise offline) – Auftrag zurück
    // in die Warteschlange statt als abgeschlossen zu markieren.
    updateScanJob(job.id, { status: 'queued', checked: worker.checked, removed: worker.removed });
    logger.warn('scan', `Scan-Auftrag #${job.id}: ${remaining} Dateien bleiben eingereiht, Auftrag wartet erneut.`);
  } else {
    updateScanJob(job.id, { status: outcome, checked: worker.checked, removed: worker.removed, finishedAt });
  }
  updateRun(run.id, { status: outcome, totalFiles: worker.total, scanned: worker.checked, problems: worker.errors.length });
  try {
    refreshFormatCounts();
  } catch (err) {
    logger.warn('scan', `Format-Zähler konnten nicht aktualisiert werden: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    flushCalibration();
  } catch (err) {
    logger.warn('scan', `Kalibrierung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
  }
  pruneScanJobs();
  worker.lastFinishedAt = finishedAt;
  worker.lastStatus = outcome;
  worker.lastTotal = worker.total;
  worker.lastChecked = worker.checked;
  worker.lastRemoved = worker.removed;
  worker.jobId = null;
  worker.activeFiles = [];
  if (outcome === 'completed') {
    logger.info(
      'scan',
      `Scan-Auftrag #${job.id} abgeschlossen: ${worker.checked} geprüft${worker.removed > 0 ? `, ${worker.removed} fehlende entfernt` : ''}.`,
    );
    logger.info('scan', `ETA-Kalibrierung: ${calibrationSummary()}`);
  } else {
    logger.warn('scan', `Scan-Auftrag #${job.id} beendet (${outcome}): ${worker.checked} geprüft.`);
  }
  return progressed;
}

/**
 * Analysiert eine einzelne Datei (Hash, EXIF, Gerät, Thumbnail).
 * 'removed': Datei verschwunden → Datensatz + Thumbnail gelöscht.
 * 'skipped': Ablage nicht erreichbar → bleibt eingereiht, kein Fortschritt.
 */
async function processFile(file: FileRecord): Promise<'ok' | 'removed' | 'skipped'> {
  const base = rootBase(file.sourceRoot as 'upload' | 'fotos' | 'videos');
  const absPath = path.join(base, file.sourceRelPath);
  if (!(await pathExists(absPath))) {
    // Übertragene Datei, deren Ziel noch existiert: Quelle wurde aufgeräumt –
    // Datensatz behalten (dokumentiert die Übertragung).
    if (file.targetRoot && file.targetRelPath) {
      const targetAbs = resolveBase(rootBase(file.targetRoot as 'fotos' | 'videos'), file.targetRelPath);
      if (await pathExists(targetAbs)) return 'ok';
    }
    // Nicht von "Ablage offline" (dann läge ein Ausfall, kein Löschen vor) unterscheiden:
    // Basis frisch prüfen, bevor Zeilen gelöscht werden.
    if (!(await pathExists(base))) {
      if (!warnedBases.has(base)) {
        warnedBases.add(base);
        logger.warn('scan', `Ablage nicht erreichbar (${base}) – ${file.sourceRoot}/${file.sourceRelPath} bleibt eingereiht.`);
      }
      return 'skipped';
    }
    deleteFileRecord(file.id);
    try {
      fs.rmSync(thumbnailCachePath(file.id), { force: true });
    } catch {
      /* ignore */
    }
    logger.warn('scan', `${file.sourceRoot}/${file.sourceRelPath}: Datei nicht gefunden, aus Datenbank entfernt.`);
    return 'removed';
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
  return 'ok';
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

/** Löst eine Kachel-/Filter-Auswahl in_label + Datei-IDs auf (für Routen). */
export function resolveScanScope(input: ScanEnqueueInput): { label: string; fileIds: number[]; error?: string } {
  const LIMIT = 100000;
  if (Array.isArray(input.fileIds) && input.fileIds.length > 0) {
    const ids = [...new Set(input.fileIds.filter((n) => Number.isInteger(n)))];
    const files: FileRecord[] = [];
    for (const id of ids) {
      const f = getFileById(id);
      if (f) files.push(f);
    }
    if (files.length === 0) return { label: '', fileIds: [], error: 'Keine gültigen Dateien gefunden.' };
    return { label: 'Auswahl', fileIds: files.map((f) => f.id) };
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
      excludeUnsupported: f.excludeUnsupported === true ? true : undefined,
      limit: LIMIT + 1,
      offset: 0,
    });
    if (total > LIMIT) {
      return { label: '', fileIds: [], error: `Zu viele Dateien (${total.toLocaleString('de-DE')}).` };
    }
    if (rows.length === 0) return { label: '', fileIds: [], error: 'Keine Dateien in dieser Auswahl gefunden.' };
    return { label: describeUploadScope(f), fileIds: rows.map((r) => r.id) };
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
      excludeUnsupported: f.excludeUnsupported === true ? true : undefined,
      limit: LIMIT + 1,
      offset: 0,
    });
    if (total > LIMIT) {
      return { label: '', fileIds: [], error: `Zu viele Dateien (${total.toLocaleString('de-DE')}).` };
    }
    if (rows.length === 0) return { label: '', fileIds: [], error: 'Keine Dateien in dieser Auswahl gefunden.' };
    return { label: describeLibraryScope(f), fileIds: rows.map((r) => r.id) };
  }
  return { label: '', fileIds: [], error: 'Keine Dateien ausgewählt.' };
}

function describeUploadScope(f: ScanUploadScope): string {
  const parts = [f.person, f.deviceKey, f.year != null ? String(f.year) : f.yearNull ? 'Unbekannt' : undefined].filter(Boolean);
  return `Upload: ${parts.join('/') || 'alle'}`;
}

function describeLibraryScope(f: ScanLibraryScope): string {
  if (f.yearNull) return 'Bibliothek: Sonstige';
  const parts = [
    f.year != null ? String(f.year) : undefined,
    f.month != null ? String(f.month).padStart(2, '0') : undefined,
    f.day != null ? String(f.day).padStart(2, '0') : undefined,
  ].filter(Boolean);
  return `Bibliothek: ${parts.join('/') || 'alle'}`;
}

export interface ScanEnqueueInput {
  fileIds?: number[];
  upload?: ScanUploadScope;
  library?: ScanLibraryScope;
}

export interface ScanUploadScope {
  person?: string;
  deviceKey?: string;
  year?: number;
  yearNull?: boolean;
  status?: 'indexed' | 'pending' | 'transferred';
  type?: 'image' | 'video';
  search?: string;
  excludeUnsupported?: boolean;
}

export interface ScanLibraryScope {
  year?: number;
  yearNull?: boolean;
  month?: number;
  day?: number;
  status?: string;
  type?: string;
  search?: string;
  excludeUnsupported?: boolean;
}
