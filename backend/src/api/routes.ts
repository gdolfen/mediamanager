import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getPaths, setPaths } from '../db/database.js';
import {
  addDeviceIdentifier,
  assignDeviceToFiles,
  countFilesByStatus,
  createDevice,
  deleteDevice,
  findDeviceByIdentifier,
  findFileIdsByIdentifier,
  getDeviceById,
  getFileById,
  getProblemById,
  getScanProgress,
  listDevices,
  listFiles,
  listFilesByIdentifier,
  listFilesByDevice,
  listFilesByExt,
  listFormats,
  listIgnored,
  listLibraryFiles,
  listLibraryGroups,
  listProblems,
  listProblemsForFile,
  listRuns,
  listUnknownDeviceCandidates,
  toggleIgnoreFile,
  toggleIgnoreFolder,
  listUploadHierarchy,
  resolveProblem,
  resolveProblemsForFile,
  updateDevice,
  updateFile,
} from '../db/daos.js';
import { getTransferState, isRunning, requestAbort, startTransfer } from '../core/transfer.js';
import {
  getUploadScanState,
  isUploadScanRunning,
  requestUploadScanAbort,
  startUploadScan,
} from '../core/uploadScan.js';
import {
  getTargetScanState,
  isTargetScanRunning,
  requestTargetScanAbort,
  startTargetScan,
} from '../core/libraryScan.js';
import {
  getRecheckState,
  isRecheckRunning,
  requestRecheckAbort,
  startRecheck,
} from '../core/recheck.js';
import {
  getScheduleState,
  saveScheduleConfig,
} from '../core/scheduler.js';
import { resolveDevice, exifIdentifier } from '../core/devices.js';
import { parseDateFromFilename, toLocalIso } from '../core/dates.js';
import { getOrCreateThumbnail, mimeFor, resolveFileAbsolute } from '../media/media.js';
import { thumbnailQueueStatus } from '../media/thumbnailWorker.js';
import { problemTypeDef } from '../core/problemCatalog.js';
import { deviceSchema, settingsSchema, scheduleSchema, identifierKindSchema } from './validation.js';
import { clearLogs, countLogs, listLogs, logger, type LogLevel } from '../db/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const api = Router();

function getVersion(): string {
  try {
    const versionFile = path.resolve(__dirname, '../../../version.txt');
    if (fs.existsSync(versionFile)) {
      return fs.readFileSync(versionFile, 'utf-8').trim();
    }
  } catch {}
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'));
    return pkg.version ?? 'dev';
  } catch {
    return 'dev';
  }
}

api.get('/version', (_req, res) => {
  res.json({ version: getVersion() });
});

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#37474f"/><text x="50%" y="50%" fill="#eceff1" font-family="sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">Kein Vorschaubild</text></svg>`;

function asyncRoute(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };
}

/* ---------- settings ---------- */

api.get('/settings', (_req, res) => {
  res.json({ paths: getPaths() });
});

api.put('/settings', (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ungültige Konfiguration', details: parsed.error.flatten() });
    return;
  }
  setPaths(parsed.data.paths);
  logger.info('settings', `Verzeichnisse geändert: upload=${parsed.data.paths.upload}, fotos=${parsed.data.paths.fotos}, videos=${parsed.data.paths.videos}`);
  res.json({ paths: getPaths() });
});

/* ---------- logs ---------- */

api.get('/logs', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
  const level = typeof req.query.level === 'string' && ['info', 'warn', 'error'].includes(req.query.level) ? (req.query.level as LogLevel) : undefined;
  const { rows, total, limit: l, offset } = listLogs({ limit, offset: (page - 1) * limit, level });
  res.json({ rows, total, page, limit: l, offset });
});

api.delete('/logs', (_req, res) => {
  clearLogs();
  logger.info('logs', 'Alle Logs gelöscht.');
  res.json({ ok: true });
});

api.get('/logs/stats', (_req, res) => {
  res.json({ total: countLogs(), error: countLogs('error'), warn: countLogs('warn'), info: countLogs('info') });
});

/* ---------- schedule ---------- */

api.get('/schedule', (_req, res) => {
  res.json(getScheduleState());
});

api.put('/schedule', (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ungültige Zeitplan-Konfiguration', details: parsed.error.flatten() });
    return;
  }
  res.json(saveScheduleConfig(parsed.data));
});

/* ---------- devices ---------- */

api.get('/devices', (_req, res) => {
  res.json(listDevices());
});

api.post('/devices', (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ungültige Gerätedaten', details: parsed.error.flatten() });
    return;
  }
  const { mappedName, identifiers, person } = parsed.data;
  const device = createDevice(mappedName, identifiers, person ?? null);
  logger.info('devices', `Gerät angelegt: "${mappedName}" (${identifiers.length} Identifikatoren)`);
  res.status(201).json(device);
});

api.put('/devices/:id', (req, res) => {
  const id = Number(req.params.id);
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ungültige Gerätedaten', details: parsed.error.flatten() });
    return;
  }
  const device = updateDevice(id, parsed.data.mappedName, parsed.data.identifiers, parsed.data.person ?? null);
  if (!device) {
    res.status(404).json({ error: 'Gerät nicht gefunden' });
    return;
  }
  logger.info('devices', `Gerät aktualisiert: "${parsed.data.mappedName}" (${parsed.data.identifiers.length} Identifikatoren)`);
  res.json(device);
});

api.delete('/devices/:id', (req, res) => {
  const id = Number(req.params.id);
  deleteDevice(id);
  logger.info('devices', `Gerät gelöscht (ID ${id})`);
  res.status(204).end();
});

/* ---------- unknown devices (EXIF/path candidates) ---------- */

api.get('/devices/unknown', (_req, res) => {
  res.json(listUnknownDeviceCandidates());
});

api.post('/devices/adopt', asyncRoute(async (req, res) => {
  const body = z.object({
    mappedName: z.string().min(1).max(100).optional(),
    identifierValue: z.string().min(1).max(200),
    identifierKind: z.enum(['exif', 'path']).default('exif'),
    person: z.string().max(100).nullable().optional(),
    deviceId: z.number().int().positive().optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Ungültige Angaben', details: body.error.flatten() });
    return;
  }
  const { mappedName, identifierValue, identifierKind, person, deviceId } = body.data;

  /* Indikator an ein BESTEHENDES Gerät anhängen */
  if (deviceId) {
    const target = getDeviceById(deviceId);
    if (!target) {
      res.status(404).json({ error: 'Gerät nicht gefunden' });
      return;
    }
    const owner = listDevices().find((d) =>
      d.id !== deviceId && d.identifiers.some((i) => i.kind === identifierKind && i.value.toLowerCase() === identifierValue.toLowerCase()),
    );
    if (owner) {
      res.status(409).json({ error: `Der Indikator gehört bereits zu Gerät "${owner.mappedName}".` });
      return;
    }
    addDeviceIdentifier(deviceId, identifierKind, identifierValue);
    const fileIds = findFileIdsByIdentifier(identifierKind, identifierValue);
    if (fileIds.length) {
      assignDeviceToFiles(deviceId, identifierValue, fileIds);
      for (const id of fileIds) resolveProblemsForFile(id, ['UNKNOWN_DEVICE']);
    }
    logger.info('devices', `Indikator "${identifierValue}" zu Gerät "${target.mappedName}" hinzugefügt (${fileIds.length} Dateien verknüpft).`);
    res.json({ ok: true, device: getDeviceById(deviceId), assigned: fileIds.length, added: true });
    return;
  }

  /* neuen Indikator übernehmen (Gerät ggf. neu anlegen) */
  if (!mappedName) {
    res.status(400).json({ error: 'Gerätename erforderlich' });
    return;
  }
  const fileIds = findFileIdsByIdentifier(identifierKind, identifierValue);
  let device = findDeviceByIdentifier(identifierKind, identifierValue);
  if (!device) {
    device = createDevice(mappedName, [{ kind: identifierKind, value: identifierValue }], person ?? null);
    logger.info('devices', `Unbekanntes Gerät übernommen: "${mappedName}" (${identifierKind} "${identifierValue}", ${fileIds.length} Dateien)`);
  } else {
    logger.info('devices', `Gerät "${device.mappedName}" (${identifierKind} "${identifierValue}") mit ${fileIds.length} Dateien verknüpft.`);
  }
  if (fileIds.length) {
    assignDeviceToFiles(device.id, identifierValue, fileIds);
    for (const id of fileIds) resolveProblemsForFile(id, ['UNKNOWN_DEVICE']);
  }
  res.json({ ok: true, device, assigned: fileIds.length, added: false });
}));

api.get('/devices/:id', (req, res) => {
  const device = getDeviceById(Number(req.params.id));
  if (!device) {
    res.status(404).json({ error: 'Gerät nicht gefunden' });
    return;
  }
  res.json(device);
});

api.get('/devices/:id/files', (req, res) => {
  const device = getDeviceById(Number(req.params.id));
  if (!device) {
    res.status(404).json({ error: 'Gerät nicht gefunden' });
    return;
  }
  res.json(listFilesByDevice(device.id));
});

/* ---------- files ---------- */

api.get('/files', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const status = typeof req.query.status === 'string' ? req.query.status as 'pending' | 'transferred' | 'problem' : undefined;
  const root = typeof req.query.root === 'string' ? req.query.root as 'upload' | 'fotos' | 'videos' : undefined;
  const sourceRoot = typeof req.query.sourceRoot === 'string' ? req.query.sourceRoot as 'upload' | 'fotos' | 'videos' : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type as 'image' | 'video' : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const ext = typeof req.query.ext === 'string' ? req.query.ext : undefined;
  const identifierKind = typeof req.query.identifierKind === 'string' ? req.query.identifierKind as 'exif' | 'path' : undefined;
  const identifierValue = typeof req.query.identifierValue === 'string' ? req.query.identifierValue : undefined;
  if (identifierKind && identifierValue) {
    const matched = listFilesByIdentifier(identifierKind, identifierValue);
    res.json({ rows: matched, total: matched.length, page: 1, limit });
    return;
  }
  if (ext) {
    const matched = listFilesByExt(ext, limit, (page - 1) * limit);
    res.json({ rows: matched.rows, total: matched.total, page, limit });
    return;
  }
  const year = req.query.year != null ? Number(req.query.year) : undefined;
  const yearNull = req.query.year === 'null';
  const deviceKey = typeof req.query.deviceKey === 'string' ? req.query.deviceKey : undefined;
  const deviceId = req.query.deviceId != null ? Number(req.query.deviceId) : undefined;
  const deviceNull = req.query.deviceId === 'null';
  const person = typeof req.query.person === 'string' && req.query.person !== 'null' ? req.query.person : undefined;
  const personNull = req.query.person === 'null';
  const { rows, total } = listFiles({ status, root, sourceRoot, type, search, includeIgnored: req.query.includeIgnored === '1', year, yearNull, deviceKey, deviceId, deviceNull, person, personNull, limit, offset: (page - 1) * limit });
  res.json({ rows, total, page, limit });
});

api.get('/files/:id', (req, res) => {
  const file = getFileById(Number(req.params.id));
  if (!file) {
    res.status(404).json({ error: 'Datei nicht gefunden' });
    return;
  }
  const fileProblems = listProblemsForFile(file.id).filter((p) => !p.resolved);
  res.json({ ...file, problems: fileProblems });
});

/* ---------- ignored ---------- */

api.get('/ignored', (_req, res) => {
  res.json(listIgnored());
});

api.post('/ignored/file', (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : undefined;
  if (!path) { res.status(400).json({ error: 'path erforderlich' }); return; }
  res.json(toggleIgnoreFile(path));
});

api.post('/ignored/folder', (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : undefined;
  if (!path) { res.status(400).json({ error: 'path erforderlich' }); return; }
  res.json(toggleIgnoreFolder(path));
});

/* ---------- upload grouping ---------- */

api.get('/upload/groups', (req, res) => {
  const level = [1, 2, 3].includes(Number(req.query.level)) ? Number(req.query.level) as 1 | 2 | 3 : 1;
  const person = typeof req.query.person === 'string' ? req.query.person : undefined;
  const deviceKey = typeof req.query.deviceKey === 'string' ? req.query.deviceKey : undefined;
  res.json(listUploadHierarchy(level, { person, deviceKey }));
});

/* ---------- problems ---------- */

api.get('/problems', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const severity = typeof req.query.severity === 'string' ? req.query.severity as 'error' | 'warning' | 'info' : undefined;
  const scope = typeof req.query.scope === 'string' ? req.query.scope as 'upload' | 'library' : undefined;
  const { rows, total } = listProblems({ resolved, type, severity, scope, limit, offset: (page - 1) * limit });
  const out = rows.map((p) => {
    const file = getFileById(p.fileId);
    return { ...p, actionLabel: problemTypeDef(p.type).actions.map((a) => a.label), scope: file ? (file.sourceRoot === 'upload' ? 'upload' : 'library') : null, file: file ? {
      id: file.id,
      originalName: file.originalName,
      sourceRelPath: file.sourceRelPath,
      targetRelPath: file.targetRelPath,
      fileType: file.fileType,
      takenAt: file.takenAt,
      status: file.status,
      isWhatsApp: file.isWhatsApp,
      deviceMappedName: file.deviceMappedName,
      devicePerson: file.devicePerson,
    } : null };
  });
  res.json({ rows: out, total, page, limit });
});

/* ---------- problem re-evaluation ---------- */

api.post('/problems/recheck', (_req, res) => {
  const result = startRecheck();
  res.status(result.ok ? 202 : 409).json(result);
});

api.post('/problems/recheck/abort', (_req, res) => {
  res.json({ ok: requestRecheckAbort() });
});

api.get('/problems/recheck/status', (_req, res) => {
  res.json(getRecheckState());
});

/** Apply a solution action to a problem. */
api.post('/problems/:id/resolve', asyncRoute(async (req, res) => {
  const problem = getProblemById(Number(req.params.id));
  if (!problem) {
    res.status(404).json({ error: 'Problem nicht gefunden' });
    return;
  }
  const file = getFileById(problem.fileId);
  if (!file) {
    res.status(404).json({ error: 'Datei nicht gefunden' });
    return;
  }
  const action = z.enum(['accept_file_date', 'accept_meta_date', 'accept_filename_date', 'ignore']).safeParse(req.body?.action);
  if (!action.success) {
    res.status(400).json({ error: 'Ungültige Aktion' });
    return;
  }
  switch (action.data) {
    case 'accept_file_date': {
      if (file.sourceMtime) {
        updateFile(file.id, { overrideDate: toLocalIso(new Date(file.sourceMtime)), overrideSource: 'file' });
      }
      break;
    }
    case 'accept_meta_date': {
      const d = file.takenAt ?? (file.sourceMtime ? toLocalIso(new Date(file.sourceMtime)) : null);
      if (d) updateFile(file.id, { overrideDate: d, overrideSource: file.takenAt ? 'meta' : 'file' });
      break;
    }
    case 'accept_filename_date': {
      const d = parseDateFromFilename(file.originalName);
      if (d) updateFile(file.id, { overrideDate: toLocalIso(d), overrideSource: 'filename' });
      break;
    }
    case 'ignore':
      break;
  }
  resolveProblem(problem.id);
  logger.info('problems', `Problem #${problem.id} (${problem.type}) an Datei "${file.originalName}" gelöst via ${action.data}.`);
  res.json({ ok: true });
}));

/** Create/attach a device mapping for an UNKNOWN_DEVICE problem. */
api.post('/problems/:id/device', asyncRoute(async (req, res) => {
  const problem = getProblemById(Number(req.params.id));
  if (!problem) {
    res.status(404).json({ error: 'Problem nicht gefunden' });
    return;
  }
  const body = z.object({
    mappedName: z.string().min(1).max(100),
    identifierKind: z.enum(['exif', 'filename']).optional(),
    identifierValue: z.string().min(1).max(200).optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'Ungültige Angaben' });
    return;
  }
  const file = getFileById(problem.fileId);
  if (!file) {
    res.status(404).json({ error: 'Datei nicht gefunden' });
    return;
  }
  let identValue = body.data.identifierValue?.trim() ?? null;
  let identKind: 'exif' | 'filename' = body.data.identifierKind ?? 'exif';
  if (!identValue) {
    if (file.make && file.model) {
      identValue = exifIdentifier(file.make, file.model)!;
    } else if (file.make) {
      identValue = file.make;
    } else {
      identKind = 'filename';
      const base = file.originalName.replace(/\.[^.]+$/, '');
      const underscoreIdx = base.indexOf('_');
      identValue = underscoreIdx > 0 ? base.slice(0, underscoreIdx + 1) : base;
    }
  }
  const existing = listDevices().find((d) => d.identifiers.some((i) => i.kind === identKind && i.value.toLowerCase() === identValue!.toLowerCase()));
  let device = existing;
  if (!device) {
    device = createDevice(body.data.mappedName, [{ kind: identKind, value: identValue }]);
  }
  updateFile(file.id, { deviceId: device.id, status: 'pending' });
  resolveProblem(problem.id);
  logger.info('devices', `Gerät "${device.mappedName}" an Problem #${problem.id} (Datei "${file.originalName}") zugeordnet.`);
  res.json({ ok: true, device });
}));

/* ---------- transfer ---------- */

api.post('/transfer', asyncRoute(async (_req, res) => {
  const result = await startTransfer();
  if (!result.ok) {
    res.status(409).json({ error: result.error ?? 'Transfer konnte nicht gestartet werden.' });
    return;
  }
  res.status(202).json(result);
}));

api.post('/transfer/abort', (_req, res) => {
  const ok = requestAbort();
  res.json({ ok });
});

api.get('/transfer/status', (_req, res) => {
  res.json(getTransferState());
});

api.get('/transfer/runs', (_req, res) => {
  res.json(listRuns());
});

api.get('/runs', (_req, res) => {
  res.json(listRuns());
});

/* ---------- upload scan ---------- */

api.post('/scan/upload', asyncRoute(async (req, res) => {
  const resume = Boolean(req.body?.resume);
  const result = await startUploadScan(resume ? { resume: true } : undefined);
  if (!result.ok) {
    res.status(409).json({ error: result.error ?? 'Scan konnte nicht gestartet werden.' });
    return;
  }
  res.status(202).json(result);
}));

api.post('/scan/upload/abort', (_req, res) => {
  res.json({ ok: requestUploadScanAbort() });
});

api.get('/scan/upload/status', (_req, res) => {
  const state = getUploadScanState();
  const progress = getScanProgress('upload');
  const canResume = state.status === 'aborted' || progress?.status === 'aborted';
  res.json({ ...state, canResume });
});

/* ---------- library ---------- */

api.get('/library/groups', (_req, res) => {
  res.json(listLibraryGroups());
});

api.get('/library', (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const year = req.query.year !== undefined ? Number(req.query.year) : undefined;
  const month = req.query.month !== undefined ? Number(req.query.month) : undefined;
  const day = req.query.day !== undefined ? Number(req.query.day) : undefined;
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const search = typeof req.query.search === 'string' && req.query.search ? req.query.search : undefined;
  const { rows, total } = listLibraryFiles({ year, month, day, type, search, limit, offset: (page - 1) * limit });
  res.json({ rows, total, page, limit });
});

/* ---------- target scan ---------- */

api.post('/scan/targets', asyncRoute(async (req, res) => {
  const resume = Boolean(req.body?.resume);
  const result = startTargetScan(resume ? { resume: true } : undefined);
  if (!result.ok) {
    res.status(409).json({ error: result.error ?? 'Scan konnte nicht gestartet werden.' });
    return;
  }
  res.status(202).json(result);
}));

api.post('/scan/targets/abort', (_req, res) => {
  res.json({ ok: requestTargetScanAbort() });
});

api.get('/scan/targets/status', (_req, res) => {
  const state = getTargetScanState();
  const progress = getScanProgress('target');
  const canResume = state.status === 'aborted' || progress?.status === 'aborted';
  res.json({ ...state, canResume });
});

/* ---------- formats ---------- */

api.get('/formats', (_req, res) => {
  res.json(listFormats());
});

/* ---------- stats ---------- */

api.get('/stats', (_req, res) => {
  res.json({
    counts: countFilesByStatus(),
    openProblems: listProblems({ resolved: false, limit: 1, offset: 0 }).total,
    devices: listDevices().length,
    formats: listFormats().length,
    running: isRunning() || isUploadScanRunning() || isTargetScanRunning() || isRecheckRunning(),
    paths: getPaths(),
    schedule: getScheduleState(),
    thumbnailsPending: thumbnailQueueStatus().pending,
  });
});

/* ---------- thumbnails ---------- */

api.get('/thumbnails/status', (_req, res) => {
  res.json(thumbnailQueueStatus());
});

/* ---------- media ---------- */

api.get('/media/thumbnail/:fileId', asyncRoute(async (req, res) => {
  const fileId = Number(req.params.fileId);
  if (!Number.isFinite(fileId)) {
    res.status(400).end();
    return;
  }
  const thumb = await getOrCreateThumbnail(fileId);
  if (!thumb) {
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(PLACEHOLDER_SVG);
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(thumb));
}));

api.get('/media/file/:fileId', asyncRoute(async (req, res) => {
  const fileId = Number(req.params.fileId);
  if (!Number.isFinite(fileId)) {
    res.status(400).end();
    return;
  }
  const file = getFileById(fileId);
  if (!file) {
    res.status(404).json({ error: 'Datei nicht gefunden' });
    return;
  }
  const abs = await resolveFileAbsolute(file);
  if (!abs) {
    res.status(404).json({ error: 'Datei ist nicht verfügbar' });
    return;
  }
  const stat = await fs.promises.stat(abs);
  const mime = mimeFor(path.extname(abs).slice(1));
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime);

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(abs, { start, end }).pipe(res);
        return;
      }
    }
  }
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(abs).pipe(res);
}));