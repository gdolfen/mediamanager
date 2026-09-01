import { getSetting, setSetting } from '../db/database.js';
import { startUploadScan } from './uploadScan.js';
import { startTransfer } from './transfer.js';
import { logger } from '../db/logger.js';

const CHECK_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 24 * 60;

export type ScheduleMode = 'scan' | 'scan_and_transfer';

export interface ScheduleConfig {
  enabled: boolean;
  intervalMinutes: number;
  mode: ScheduleMode;
}

export interface ScheduleState extends ScheduleConfig {
  lastRunAt: string | null;
  nextRunAt: string | null;
}

let timer: NodeJS.Timeout | null = null;
let lastRunAt: number | null = null;

export function loadScheduleConfig(): ScheduleConfig {
  const rawInterval = parseInt(getSetting('schedule.intervalMinutes') ?? '60', 10);
  const intervalMinutes = Number.isFinite(rawInterval)
    ? Math.min(Math.max(rawInterval, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES)
    : 60;
  return {
    enabled: getSetting('schedule.enabled') === '1',
    intervalMinutes,
    mode: getSetting('schedule.mode') === 'scan_and_transfer' ? 'scan_and_transfer' : 'scan',
  };
}

export function saveScheduleConfig(cfg: ScheduleConfig): ScheduleConfig {
  setSetting('schedule.enabled', cfg.enabled ? '1' : '0');
  setSetting('schedule.intervalMinutes', String(Math.min(Math.max(cfg.intervalMinutes, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES)));
  setSetting('schedule.mode', cfg.mode);
  const saved = loadScheduleConfig();
  logger.info('schedule', saved.enabled
    ? `Automatisches Scannen aktiviert: alle ${saved.intervalMinutes} min (${saved.mode === 'scan_and_transfer' ? 'Scan + Übertragung' : 'nur Scan'}).`
    : 'Automatisches Scannen deaktiviert.');
  refreshScheduler();
  return saved;
}

export function getScheduleState(): ScheduleState {
  const cfg = loadScheduleConfig();
  const lastRunAtIso = lastRunAt ? new Date(lastRunAt).toISOString() : null;
  let nextRunAtIso: string | null = null;
  if (cfg.enabled) {
    nextRunAtIso = lastRunAt != null
      ? new Date(lastRunAt + cfg.intervalMinutes * 60_000).toISOString()
      : new Date(Date.now() + CHECK_INTERVAL_MS).toISOString();
  }
  return { ...cfg, lastRunAt: lastRunAtIso, nextRunAt: nextRunAtIso };
}

export function startScheduler(): void {
  stopScheduler();
  timer = setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function refreshScheduler(): void {
  startScheduler();
}

async function tick(): Promise<void> {
  const cfg = loadScheduleConfig();
  if (!cfg.enabled) return;
  const now = Date.now();
  if (lastRunAt && now - lastRunAt < cfg.intervalMinutes * 60_000) return;
  const result = cfg.mode === 'scan_and_transfer' ? await startTransfer() : await startUploadScan();
  if (result.ok) {
    lastRunAt = now;
    logger.info('schedule', `Automatischer ${cfg.mode === 'scan_and_transfer' ? 'Transfer' : 'Scan'} gestartet (alle ${cfg.intervalMinutes} min).`);
  }
}