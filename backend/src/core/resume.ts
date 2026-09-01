import { getScanProgress, clearScanProgress } from '../db/daos.js';
import { startTargetScan } from './libraryScan.js';
import { startUploadScan } from './uploadScan.js';
import { startRecheck } from './recheck.js';
import { isUploadScanRunning } from './uploadScan.js';
import { isTargetScanRunning } from './libraryScan.js';
import { isRecheckRunning } from './recheck.js';
import { hasActiveScans } from './active.js';
import { logger } from '../db/logger.js';

const CHECK_INTERVAL_MS = 5000;
const SCAN_ORDER = ['target', 'upload', 'recheck'] as const;
type ScanType = (typeof SCAN_ORDER)[number];

let timer: NodeJS.Timeout | null = null;

function startFor(scanType: ScanType): { ok: boolean; error?: string } {
  switch (scanType) {
    case 'target': return startTargetScan({ resume: true });
    case 'upload': return startUploadScan({ resume: true });
    case 'recheck': return startRecheck({ resume: true });
  }
}

function isRunningInMemory(scanType: ScanType): boolean {
  switch (scanType) {
    case 'target': return isTargetScanRunning();
    case 'upload': return isUploadScanRunning();
    case 'recheck': return isRecheckRunning();
  }
}

function tick(): void {
  const pending = SCAN_ORDER.filter((t) => { const s = getScanProgress(t)?.status; return s === 'running' || s === 'aborted'; });
  if (!pending.length) {
    stopResumeLoop();
    return;
  }
  for (const scanType of pending) {
    // Bereits fortgesetzte Scans nicht erneut starten.
    if (isRunningInMemory(scanType)) continue;
    // Die Neubewertung ist exklusiv und wartet, bis die (parallelen) Scans fertig sind.
    if (scanType === 'recheck' && hasActiveScans()) continue;
    const result = startFor(scanType);
    if (result.ok) {
      logger.info('scan', `Unterbrochener ${scanType}-Scan wird nach Neustart fortgesetzt.`);
    } else if (result.error?.includes('läuft gerade')) {
      // Aktuell blockiert (z. B. exklusiver Transfer) – beim nächsten Tick erneut versuchen.
      logger.info('scan', `${scanType}-Scan kann derzeit nicht fortgesetzt werden: ${result.error}`);
    } else {
      // Dauerhaft nicht startbar (z. B. ungültige Pfade) – nicht endlos wiederholen.
      clearScanProgress(scanType);
      logger.warn('scan', `${scanType}-Scan konnte nicht fortgesetzt werden: ${result.error}`);
    }
  }
}

/**
 * Nach einem Neustart alle laufend persistierten Scans fortsetzen.
 * Ziel- und Upload-Scan werden parallel fortgesetzt (sofern das System sie
 * erlaubt); die Neubewertung wartet, bis keine Scans mehr aktiv sind.
 * Startet bewusst erst nach einer Wartezeit, damit der Server vollständig
 * hochgefahren ist und der Neustart nicht durch sofortige Scan-Arbeit blockiert wird.
 */
export function resumeInterruptedScans(delayMs = 10_000): void {
  stopResumeLoop();
  timer = setTimeout(() => {
    timer = setInterval(tick, CHECK_INTERVAL_MS);
    tick();
  }, delayMs);
}

export function stopResumeLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}