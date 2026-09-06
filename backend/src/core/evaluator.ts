import path from 'node:path';
import { rootBase } from '../db/database.js';
import {
  getFileByHash,
  getFileBySource,
  resolveProblemsForFile,
  updateFile,
  upsertFile,
  upsertProblem,
  enqueueThumbnail,
} from '../db/daos.js';
import { hashFile } from './hash.js';
import { readImageMeta, readVideoMeta } from './metadata.js';
import { resolveDevice, deviceDisplayName } from './devices.js';
import { buildTargetInfo, detectFileType, extOf, targetFilenameCandidates } from './naming.js';
import { parseDateFromFilename, differsByDay, localDateKey, toLocalIso, isWhatsAppFilename } from './dates.js';
import type { ScannedFile } from './scanner.js';
import { problemTypeDef } from './problemCatalog.js';
import { resolveBase, pathExists } from './paths.js';
import { perfStart, perfMark, perfLog } from './perf.js';
import type { FileRecord, FileStatus, ProblemType } from '../types.js';

export const PROBLEM_DEVIATION_MARGIN_DAYS = 30;

/**
 * Toleranz für die Plausibilitätsprüfung "Änderungszeit >= Erstellzeit".
 * Windows-Kopien (CopyFileEx) übernehmen die Änderungszeit der Quelle und setzen
 * die Erstellzeit auf "jetzt" – dadurch liegt mtime wenige Millisekunden vor
 * birthtime. Echte Anomalien (kopierte Dateien mit altem mtime) liegen Stunden/Tage auseinander.
 */
export const BIRTHTIME_TOLERANCE_MS = 60 * 1000;

/** True when the file was fully transferred before and is unchanged on disk –
 *  it can safely be skipped on a re-scan. Files still pending or in a problem
 *  state are never skipped so that e.g. device adoption or problem resolution
 *  get picked up on the next run. */
export function isSettledFile(existing: FileRecord | null, size: number, mtimeMs: number): boolean {
  return existing !== null
    && existing.status === 'transferred'
    && existing.sourceSize === size
    && existing.sourceMtime === mtimeMs;
}

export type EvaluationReason =
  | 'unsupported'
  | 'duplicate'
  | 'already-transferred'
  | 'device'
  | 'filename-date'
  | 'target-exists'
  | 'ready';

export interface TargetInfo {
  root: 'fotos' | 'videos';
  relPath: string;
  filename: string;
}

export interface EvaluationResult {
  fileId: number;
  reason: EvaluationReason;
  status: FileStatus;
  hash: string | null;
  md5: string | null;
  targetInfo: TargetInfo | null;
  targetAbs: string | null;
  takenAt: string | null;
  dateSource: FileRecord['dateSource'];
  deviceId: number | null;
  deviceRaw: string | null;
  make: string | null;
  model: string | null;
  fileType: 'image' | 'video' | 'other';
}

export interface EvaluationCallbacks {
  onProblem?: (fileId: number, type: ProblemType, message: string, isNew: boolean) => void;
}

interface BaseFields {
  hash: string | null;
  md5: string | null;
  sourceRelPath: string;
  sourceSize: number;
  sourceMtime: number;
  fileType: 'image' | 'video' | 'other';
  ext: string;
  originalName: string;
  targetRoot: null;
  targetRelPath: null;
  deviceId: null;
  deviceRaw: null;
  make: null;
  model: null;
  takenAt: null;
  dateSource: 'file';
  overrideDate: null;
  overrideSource: null;
  status: FileStatus;
  isWhatsApp: boolean;
}

function baseFields(
  file: ScannedFile,
  fileType: 'image' | 'video' | 'other',
  ext: string,
  originalName: string,
  nowMtime: number,
  isWhatsApp: boolean,
): BaseFields {
  return {
    hash: null,
    md5: null,
    sourceRelPath: file.relPath,
    sourceSize: file.size,
    sourceMtime: nowMtime,
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
    status: 'pending',
    isWhatsApp,
  };
}

/** Meldet eine unplausible Zeitspanne: Änderungszeit liegt vor der Erstellzeit. */
function reportBirthtimeAnomaly(
  fileId: number,
  file: ScannedFile,
  birthMs: number | null,
  report: (fileId: number, type: ProblemType, message: string) => void,
): void {
  if (birthMs == null || file.mtimeMs >= birthMs - BIRTHTIME_TOLERANCE_MS) return;
  report(fileId, 'FILE_MTIME_BEFORE_BIRTHTIME', `Die Datei-Änderungszeit (${localDateKey(toLocalIso(new Date(file.mtimeMs)))}) liegt vor der Datei-Erstellzeit (${localDateKey(toLocalIso(new Date(birthMs)))}).`);
}

/** Evaluates a scanned upload file: indexes it, determines status and target path, reports problems.
 *  Does NOT copy anything. The transfer run uses the result to copy, the scan run only indexes.
 *  Der zurückgegebene Status wird immer in die DB zurückgeschrieben, damit analysierte
 *  Dateien nicht auf 'indexed' stehen bleiben ('indexed' = nur Walk, noch nicht analysiert). */
export async function evaluateFile(file: ScannedFile, cb: EvaluationCallbacks = {}): Promise<EvaluationResult> {
  const result = await evaluateFileInner(file, cb);
  updateFile(result.fileId, { status: result.status });
  return result;
}

async function evaluateFileInner(file: ScannedFile, cb: EvaluationCallbacks = {}): Promise<EvaluationResult> {
  const perf = perfStart();
  const report = (fileId: number, type: ProblemType, message: string) => {
    const tDb = performance.now();
    try {
      const def = problemTypeDef(type);
      const { active } = upsertProblem({
        fileId,
        type,
        severity: def.severity,
        message,
        actionType: def.actions[0]?.id ?? null,
      });
      cb.onProblem?.(fileId, type, message, active);
    } finally {
      perf.db += performance.now() - tDb;
    }
  };

  const existing = getFileBySource(file.relPath);
  const originalName = path.basename(file.absPath).replace(/\\/g, '/');
  const ext = extOf(originalName);
  const nowMtime = Math.floor(file.mtimeMs);
  const birthMs = file.birthtimeMs != null && file.birthtimeMs > 0 ? file.birthtimeMs : null;
  const reusable = existing != null && existing.sourceSize === file.size && existing.sourceMtime === nowMtime;
  const isWhatsApp = isWhatsAppFilename(originalName);
  const relDir = path.posix.dirname(file.relPath) === '.' ? '' : path.posix.dirname(file.relPath);

  const fileType = detectFileType(ext);

  if (!fileType) {
    const id = existing?.id ?? upsertFile({ ...baseFields(file, 'other', ext, originalName, nowMtime, isWhatsApp), status: 'pending' });
    report(id, 'UNSUPPORTED_FORMAT', `Dateiformat ".${ext}" wird nicht unterstützt und kann nicht einsortiert werden.`);
    perfLog('upload', file.relPath, perf, 'unsupported');
    return { fileId: id, reason: 'unsupported', status: 'pending', hash: null, md5: null, targetInfo: null, targetAbs: null, takenAt: null, dateSource: 'file', deviceId: null, deviceRaw: null, make: null, model: null, fileType: 'other' };
  }

  /* ---- hash (dedup) ---- */
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
  const duplicate = await perfMark(perf, 'db', () => getFileByHash(hash));
  if (duplicate && duplicate.id !== existing?.id) {
    const id = existing?.id ?? upsertFile({ ...baseFields(file, fileType, ext, originalName, nowMtime, isWhatsApp), hash, md5, status: 'transferred' });
    reportBirthtimeAnomaly(id, file, birthMs, report);
    enqueueThumbnail(id);
    updateFile(id, { targetRoot: duplicate.targetRoot, targetRelPath: duplicate.targetRelPath, hash, md5, status: 'transferred', isWhatsApp, transferredAt: new Date().toISOString() });
    perfLog('upload', file.relPath, perf, 'duplicate');
    return {
      fileId: id,
      reason: 'duplicate',
      status: 'transferred',
      hash,
      md5,
      targetInfo: duplicate.targetRoot && duplicate.targetRelPath ? { root: duplicate.targetRoot as 'fotos' | 'videos', relPath: duplicate.targetRelPath, filename: path.posix.basename(duplicate.targetRelPath) } : null,
      targetAbs: null,
      takenAt: null,
      dateSource: 'file',
      deviceId: null,
      deviceRaw: null,
      make: null,
      model: null,
      fileType,
    };
  }

  /* ---- already transferred? ---- */
  if (existing && existing.status === 'transferred') {
    if (existing.targetRoot && existing.targetRelPath) {
      const targetAbs = resolveBase(rootBase(existing.targetRoot as 'fotos' | 'videos'), existing.targetRelPath);
      if (await pathExists(targetAbs)) {
        reportBirthtimeAnomaly(existing.id, file, birthMs, report);
        perfLog('upload', file.relPath, perf, 'already-transferred');
        return {
          fileId: existing.id,
          reason: 'already-transferred',
          status: 'transferred',
          hash,
          md5,
          targetInfo: { root: existing.targetRoot as 'fotos' | 'videos', relPath: existing.targetRelPath, filename: path.posix.basename(existing.targetRelPath) },
          targetAbs,
          takenAt: existing.takenAt,
          dateSource: existing.dateSource,
          deviceId: existing.deviceId,
          deviceRaw: existing.deviceRaw,
          make: existing.make,
          model: existing.model,
          fileType,
        };
      }
    }
  }

  /* ---- metadata ---- */
  let make: string | null = reusable ? existing.make : null;
  let model: string | null = reusable ? existing.model : null;
  let metaDate: string | null = reusable && existing.dateSource !== 'file' ? existing.takenAt : null;
  let meta: Record<string, unknown> | null = existing?.meta ?? null;
  if (!reusable || (existing != null && existing.meta == null)) {
    // Metadaten nachlesen, wenn die Datei noch keinen Blob hat (Backfill vor meta_json).
    if (fileType === 'image') {
      const m = await perfMark(perf, 'exif', () => readImageMeta(file.absPath));
      make = m.make;
      model = m.model;
      metaDate = m.takenAt;
      meta = m.meta;
    } else {
      const m = await perfMark(perf, 'exif', () => readVideoMeta(file.absPath));
      make = m.make;
      model = m.model;
      metaDate = m.takenAt;
      meta = m.meta;
    }
  }

  /* ---- device resolution ---- */
  const deviceResolution = await perfMark(perf, 'device', () => resolveDevice({ filename: originalName, exifMake: make, exifModel: model, exifRaw: null, relDir }));
  const fileId = existing?.id ?? await perfMark(perf, 'db', () => upsertFile({ ...baseFields(file, fileType, ext, originalName, nowMtime, isWhatsApp), hash, md5, make, model, status: 'pending', meta }));
  if (existing) await perfMark(perf, 'db', () => updateFile(fileId, { make, model, hash, md5, isWhatsApp, meta }));
  await perfMark(perf, 'thumb', () => enqueueThumbnail(fileId));

  if (!deviceResolution.device) {
    const hasExifInfo = !!(make || model);
    // Nested upload folders (person/device, e.g. "Guido/Sony Alpha 6400") without EXIF
    // are offered as path candidates on the device page – not as a problem.
    const pathCandidate = !hasExifInfo && deviceResolution.pathInfo.person != null;
      if (!hasExifInfo && !pathCandidate) {
        const raw = deviceResolution.raw ?? 'unbekannt';
        report(fileId, 'UNKNOWN_DEVICE', `Kein Gerät für "${raw}" zugeordnet. Ohne Geräte-Zuordnung wird die Datei nicht übertragen.`);
        perfLog('upload', file.relPath, perf, 'device-blocked');
        return { fileId, reason: 'device', status: 'pending', hash, md5, targetInfo: null, targetAbs: null, takenAt: null, dateSource: 'file', deviceId: null, deviceRaw: null, make, model, fileType };
      }
    // EXIF-Geräteinfo oder Pfad-Kandidat: Keine Problem-Meldung – die Datei bleibt
    // blockiert (pending) und wird auf der Geräteseite als unbekanntes Gerät zum Übernehmen angeboten.
    const exifRaw = deviceResolution.raw ?? `${make ?? ''} ${model ?? ''}`.replace(/\s+/g, ' ').trim();
    await perfMark(perf, 'db', () => updateFile(fileId, { deviceRaw: exifRaw }));
    if (existing) await perfMark(perf, 'db', () => resolveProblemsForFile(fileId, ['UNKNOWN_DEVICE']));
    perfLog('upload', file.relPath, perf, 'device-pending');
    return { fileId, reason: 'device', status: 'pending', hash, md5, targetInfo: null, targetAbs: null, takenAt: null, dateSource: 'file', deviceId: null, deviceRaw: exifRaw, make, model, fileType };
  }

  /* ---- date determination ---- */
  const override = existing?.overrideDate ?? null;
  const filenameDate = parseDateFromFilename(originalName);
  let takenAt: string;
  let dateSource: FileRecord['dateSource'];
  // Referenz für die Problemanalyse ist die Datei-Erstellzeit (birthtime),
  // nicht die Änderungszeit (mtime). Fallback auf mtime, falls die
  // Erstellzeit vom Dateisystem nicht geliefert wird.
  const fileDate = new Date(birthMs ?? nowMtime);
  const fileDateIso = toLocalIso(fileDate);

  /* Plausibilität: Änderungszeit darf nicht vor der Erstellzeit liegen. */
  reportBirthtimeAnomaly(fileId, file, birthMs, report);

  if (override) {
    takenAt = override;
    dateSource = 'override';
  } else if (metaDate) {
    takenAt = metaDate;
    dateSource = fileType === 'image' ? 'exif' : 'quicktime';
  } else if (filenameDate) {
    // Keine verlässlichen Metadaten (auch WhatsApp IMG/VID-yyyymmdd-WAxxxx):
    // Das Datum im Dateinamen ist verlässlicher als die Datei-Erstellzeit.
    takenAt = toLocalIso(filenameDate);
    dateSource = 'filename';
  } else {
    takenAt = fileDateIso;
    dateSource = 'file';
    report(fileId, 'NO_META_DATE', 'Keine Aufnahmezeit in den Metadaten gefunden – es wird die Datei-Erstellzeit verwendet.');
  }

  /* meta vs. file date deviation (non-blocking) */
  if (!override && metaDate && dateSource !== 'file') {
    if (differsByDay(metaDate, fileDateIso)) {
      report(fileId, 'DATE_MISMATCH_META', `Meta-Datum (${localDateKey(metaDate)}) weicht von der Datei-Erstellzeit (${localDateKey(fileDateIso)}) ab.`);
    }
  }

  /* filename date check (blocking unless override/decision exists) */
  if (filenameDate && !override) {
    const filenameDateIso = toLocalIso(filenameDate);
    if (differsByDay(takenAt, filenameDateIso)) {
      report(fileId, 'DATE_MISMATCH_FILENAME', `Datum im Dateinamen (${localDateKey(filenameDateIso)}) weicht vom ermittelten Datum (${localDateKey(takenAt)}) ab.`);
      perfLog('upload', file.relPath, perf, 'filename-date');
      return { fileId, reason: 'filename-date', status: 'pending', hash, md5, targetInfo: null, targetAbs: null, takenAt, dateSource, deviceId: null, deviceRaw: null, make, model, fileType };
    }
  }

  /* device period deviation (info, non-blocking) */
  if (deviceResolution.device.usagePeriod && !override) {
    const { min, max } = deviceResolution.device.usagePeriod;
    const marginMs = PROBLEM_DEVIATION_MARGIN_DAYS * 24 * 60 * 60 * 1000;
    const t = new Date(`${takenAt}T00:00:00`).getTime();
    const minT = min ? new Date(`${min}T00:00:00`).getTime() : -Infinity;
    const maxT = max ? new Date(`${max}T00:00:00`).getTime() : Infinity;
    if (t < minT - marginMs || t > maxT + marginMs) {
      report(fileId, 'DEVICE_PERIOD_DEVIATION', `Datum liegt außerhalb der bekannten Nutzungszeit des Geräts (${min ? localDateKey(min) : '?'} – ${max ? localDateKey(max) : '?'}).`);
    }
  }

  /* ---- build target name & path (Originalname, Kollision → "_<gerät>") ---- */
  let targetInfo: TargetInfo | null = null;
  let targetAbs: string | null = null;
  try {
    const displayName = deviceDisplayName(deviceResolution.device);
    const candidates = targetFilenameCandidates({ originalName, ext, deviceMappedName: displayName });
    let last: TargetInfo | null = null;
    for (const cand of candidates) {
      const trial = buildTargetInfo(takenAt, fileType, cand, displayName, ext);
      last = trial;
      const abs = resolveBase(rootBase(trial.root), trial.relPath);
      if (!(await pathExists(abs))) {
        targetInfo = { root: trial.root, relPath: trial.relPath, filename: cand };
        targetAbs = abs;
        break;
      }
    }
    if (!targetInfo) {
      // Alle Namenskandidaten sind bereits vergeben.
      report(fileId, 'TARGET_EXISTS', `Zieldatei existiert bereits: ${last?.relPath}`);
      perfLog('upload', file.relPath, perf, 'target-exists');
      return { fileId, reason: 'target-exists', status: 'pending', hash, md5, targetInfo: last, targetAbs: null, takenAt, dateSource, deviceId: null, deviceRaw: null, make, model, fileType };
    }
  } catch (err) {
    report(fileId, 'READ_ERROR', `Zielname konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`);
    perfLog('upload', file.relPath, perf, 'target-error');
    return { fileId, reason: 'target-exists', status: 'pending', hash, md5, targetInfo: null, targetAbs: null, takenAt, dateSource, deviceId: null, deviceRaw: null, make, model, fileType };
  }

  /* ---- ready ---- */
  const device = deviceResolution.device;
  await perfMark(perf, 'db', () => updateFile(fileId, { takenAt, dateSource, deviceId: device.id, deviceRaw: deviceResolution.raw }));
  perfLog('upload', file.relPath, perf, 'ready');
  return {
    fileId,
    reason: 'ready',
    status: 'pending',
    hash,
    md5,
    targetInfo,
    targetAbs,
    takenAt,
    dateSource,
    deviceId: deviceResolution.device.id,
    deviceRaw: deviceResolution.raw,
    make,
    model,
    fileType,
  };
}