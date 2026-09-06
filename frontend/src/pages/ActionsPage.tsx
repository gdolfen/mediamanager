import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FastForwardIcon from '@mui/icons-material/FastForward';
import StopIcon from '@mui/icons-material/Stop';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import ImageIcon from '@mui/icons-material/Image';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { formatDateTime } from '../utils/date';
import type { TransferredCheckState, ScanWorkerState, ScanJobInfo, ActiveScanFile, RunKind, RunRecord, TargetScanState, ThumbnailStatus, TransferState, UploadScanState } from '../types';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Bereit',
  queued: 'Warteschlange',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  aborted: 'Abgebrochen',
  stopped: 'Gestoppt',
};

const KIND_LABEL: Record<RunKind, string> = {
  transfer: 'Übertragung',
  uploadScan: 'Upload-Scan',
  targetScan: 'Zielordner-Scan',
  recheck: 'Neubewertung',
  scan: 'Scan',
  transferredCheck: 'Transferred-Check',
};

export function ActionsPage() {
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [uploadScan, setUploadScan] = useState<UploadScanState | null>(null);
  const [targetScan, setTargetScan] = useState<TargetScanState | null>(null);
  const [scan, setScan] = useState<ScanWorkerState | null>(null);
  const [scanJobs, setScanJobs] = useState<ScanJobInfo[]>([]);
  const [transferredCheck, setTransferredCheck] = useState<TransferredCheckState | null>(null);
  const [activeKinds, setActiveKinds] = useState<RunKind[]>([]);
  const [thumbnails, setThumbnails] = useState<ThumbnailStatus | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async () => {
    const [t, u, ta, sc, sj, dc, st, th, r] = await Promise.allSettled([
      api.transferStatus(),
      api.uploadScanStatus(),
      api.targetScanStatus(),
      api.scanStatus(),
      api.scanJobs(),
      api.transferredCheckStatus(),
      api.stats(),
      api.thumbnailStatus(),
      api.runHistory(),
    ]);
    if (t.status === 'fulfilled') setTransfer(t.value);
    if (u.status === 'fulfilled') setUploadScan(u.value);
    if (ta.status === 'fulfilled') setTargetScan(ta.value);
    if (sc.status === 'fulfilled') setScan(sc.value);
    if (sj.status === 'fulfilled') setScanJobs(sj.value);
    if (dc.status === 'fulfilled') setTransferredCheck(dc.value);
    if (st.status === 'fulfilled') setActiveKinds(st.value.active ?? []);
    if (th.status === 'fulfilled') setThumbnails(th.value);
    if (r.status === 'fulfilled') setRuns(r.value);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const transferRunning = transfer?.status === 'running';
  const uploadRunning = uploadScan?.status === 'running';
  const targetRunning = targetScan?.status === 'running';
  const scanRunning = scan?.running === true;
  const transferredCheckRunning = transferredCheck?.status === 'running';
  const thumbPending = (thumbnails?.pending ?? 0) > 0;
  const anythingActive = transferRunning || uploadRunning || targetRunning || scanRunning || transferredCheckRunning || thumbPending;

  usePolling(loadStatus, 2000, anythingActive);

  const runAction = async (fn: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>) => {
    setError(null);
    try {
      const res = await fn();
      if (!res.ok && 'error' in res && res.error) setError(res.error);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startTransfer = () => { setStarting(true); runAction(api.startTransfer).finally(() => setStarting(false)); };
  const startUploadScan = () => runAction(api.startUploadScan);
  const startTargetScan = () => runAction(api.startTargetScan);

  const deleteRun = async (r: RunRecord) => {
    try {
      await api.deleteRun(r.id);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h4" gutterBottom sx={{ mb: 0 }}>Aktionen</Typography>
          {activeKinds.length > 0 && (
            <Chip
              size="small"
              color="warning"
              label={`Aktiv: ${activeKinds.map((k) => KIND_LABEL[k] ?? k).join(', ')}`}
              title="Laufende Prozesse (Sperren). Falls hier etwas hängt, Server neu starten."
            />
          )}
        </Stack>
      </Grid>

      {error && (
        <Grid item xs={12}>
          <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
        </Grid>
      )}

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={startTransfer} disabled={transferRunning || starting}>
                Übertragung starten
              </Button>
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortTransfer(); }} disabled={!transferRunning}>
                Abbrechen
              </Button>
              <Chip label={STATUS_LABEL[transfer?.status ?? 'idle']} color={transferRunning ? 'warning' : transfer?.status === 'completed' ? 'success' : transfer?.status === 'aborted' ? 'error' : 'default'} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Übertragt offene Dateien aus dem Upload-Ordner in die Zielordner.
            </Typography>
            {transferRunning && <LinearProgress sx={{ mt: 2 }} />}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Metric label="Gescannt" value={transfer?.scanned ?? 0} />
                <Metric label="Übertragen" value={transfer?.transferred ?? 0} />
                <Metric label="Übersprungen" value={transfer?.skipped ?? 0} />
                <Metric label="Probleme" value={transfer?.problems ?? 0} />
              </Grid>
            </Box>
            {transfer?.startedAt && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Gestartet: {formatDateTime(transfer.startedAt)}{transfer.finishedAt ? ` · Beendet: ${formatDateTime(transfer.finishedAt)}` : ''}
              </Typography>
            )}
            {transfer && transfer.errors.length > 0 && <ErrorList errors={transfer.errors} title="Fehler im letzten Lauf:" />}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              {uploadScan?.canResume ? (
                <Button variant="contained" startIcon={<FastForwardIcon />} onClick={() => runAction(() => api.startUploadScan(true))} disabled={uploadRunning}>
                  Fortsetzen
                </Button>
              ) : (
              <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={startUploadScan} disabled={uploadRunning}>
                Upload-Ordner indexieren
              </Button>
              )}
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortUploadScan(); }} disabled={!uploadRunning}>
                Abbrechen
              </Button>
              {uploadRunning && (
                <Chip label="Indexierung" color="info" />
              )}
              {!uploadRunning && (
                <Chip label={STATUS_LABEL[uploadScan?.status ?? 'idle']} color={uploadScan?.status === 'completed' ? 'success' : uploadScan?.status === 'aborted' ? 'error' : 'default'} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Durchsucht den Upload-Ordner und indexiert Dateien. Die Analyse läuft anschließend automatisch als Scan-Prozess.
            </Typography>
            {uploadRunning && (
              <LinearProgress
                variant={(uploadScan?.totalFiles ?? 0) > 0 ? 'determinate' : 'indeterminate'}
                value={(uploadScan?.totalFiles ?? 0) > 0 ? Math.round(((uploadScan?.scanned ?? 0) / (uploadScan?.totalFiles ?? 1)) * 100) : undefined}
                sx={{ mt: 2 }}
              />
            )}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Metric label="Gescannt" value={uploadScan?.scanned ?? 0} />
                <Metric label="Dateien" value={uploadScan?.totalFiles ?? 0} />
                <Metric label="Ordner" value={uploadScan?.totalDirs ?? 0} />
                {(uploadScan?.errors.length ?? 0) > 0 && <Metric label="Fehler" value={uploadScan!.errors.length} />}
              </Grid>
            </Box>
            {uploadScan?.currentDirs && uploadScan.currentDirs.length > 0 && uploadRunning && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Aktive Verzeichnisse:</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2, listStyle: 'none' }}>
                  {uploadScan.currentDirs.filter(Boolean).map((d, i) => (
                    <li key={i}><Typography variant="caption" color="text.secondary" noWrap display="block" title={d}>{d}</Typography></li>
                  ))}
                </Box>
              </Box>
            )}
            {uploadScan && uploadScan.errors.length > 0 && <ErrorList errors={uploadScan.errors} title={uploadRunning ? 'Fehler bislang:' : 'Fehler im letzten Scan:'} />}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              {targetScan?.canResume ? (
                <Button variant="contained" startIcon={<FastForwardIcon />} onClick={() => runAction(() => api.startTargetScan(true))} disabled={targetRunning}>
                  Fortsetzen
                </Button>
              ) : (
                <Button variant="contained" startIcon={<SearchIcon />} onClick={startTargetScan} disabled={targetRunning}>
                  Zielordner indexieren
                </Button>
              )}
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortTargetScan(); }} disabled={!targetRunning}>
                Abbrechen
              </Button>
              {targetRunning && (
                <Chip label="Indexierung" color="info" />
              )}
              {!targetRunning && (
                <Chip label={STATUS_LABEL[targetScan?.status ?? 'idle']} color={targetScan?.status === 'completed' ? 'success' : targetScan?.status === 'aborted' ? 'error' : 'default'} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Durchsucht die Zielordner (Fotos/Videos) und indexiert neue Dateien. Die Analyse läuft anschließend automatisch als Scan-Prozess.
            </Typography>
            {targetRunning && (
              <LinearProgress
                variant={(targetScan?.totalFiles ?? 0) > 0 ? 'determinate' : 'indeterminate'}
                value={(targetScan?.totalFiles ?? 0) > 0 ? Math.round(((targetScan?.scanned ?? 0) / (targetScan?.totalFiles ?? 1)) * 100) : undefined}
                sx={{ mt: 2 }}
              />
            )}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Metric label="Gescannt" value={targetScan?.scanned ?? 0} />
                <Metric label="Dateien" value={targetScan?.totalFiles ?? 0} />
                <Metric label="Ordner" value={targetScan?.totalDirs ?? 0} />
                {(targetScan?.errors.length ?? 0) > 0 && <Metric label="Fehler" value={targetScan!.errors.length} />}
              </Grid>
            </Box>
            {targetScan?.currentDirs && targetScan.currentDirs.length > 0 && targetRunning && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Aktive Verzeichnisse:</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2, listStyle: 'none' }}>
                  {targetScan.currentDirs.filter(Boolean).map((d, i) => (
                    <li key={i}><Typography variant="caption" color="text.secondary" noWrap display="block" title={d}>{d}</Typography></li>
                  ))}
                </Box>
              </Box>
            )}
            {targetScan && targetScan.errors.length > 0 && <ErrorList errors={targetScan.errors} title={targetRunning ? 'Fehler bislang:' : 'Fehler im letzten Scan:'} />}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <RefreshIcon color="primary" />
              <Typography variant="h6">Scan</Typography>
              <Chip label={scanRunning ? 'Läuft' : scan && scan.lastStatus !== 'idle' ? STATUS_LABEL[scan.lastStatus] : 'Bereit'} color={scanRunning ? 'warning' : scan?.lastStatus === 'completed' ? 'success' : scan && scan.lastStatus !== 'idle' ? 'error' : 'default'} />
              {(scan?.openJobs ?? 0) > 0 && (
                <Chip size="small" variant="outlined" label={`${scan!.openJobs} offene Aufgabe${scan!.openJobs === 1 ? '' : 'n'} (${scan!.openFiles.toLocaleString('de-DE')} Dateien)`} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Analysiert Dateien aus der Warteschlange (Hash, Metadaten, Gerät, Vorschaubild) – gespeist aus Kachel-Aktionen und abgeschlossener Indexierung. Mehrere Aufgaben werden nacheinander abgearbeitet.
            </Typography>
            {scan?.current && (
              <>
                <LinearProgress variant="determinate" value={scan.current.total > 0 ? Math.round((scan.current.checked / scan.current.total) * 100) : 0} sx={{ mt: 2 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {scan.current.label}: {scan.current.checked.toLocaleString('de-DE')} von {scan.current.total.toLocaleString('de-DE')} geprüft
                </Typography>
                {scan.remainingMs != null && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Restzeit {formatDuration(scan.remainingMs)}
                  </Typography>
                )}
              </>
            )}
            {scanRunning && (
              <ActiveFilesList title="Aktive Dateien" files={scan.activeFiles ?? []} />
            )}
            {scan && !scanRunning && scan.lastFinishedAt && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Letzter Lauf: {formatDateTime(scan.lastFinishedAt)} · {scan.lastChecked.toLocaleString('de-DE')} geprüft{scan.lastRemoved > 0 && <>, <span style={{ color: '#d32f2f' }}>{scan.lastRemoved.toLocaleString('de-DE')} fehlende entfernt</span></>}
              </Typography>
            )}
            {scan && scan.errors.length > 0 && <ErrorList errors={scan.errors} title={scanRunning ? 'Fehler bislang:' : 'Fehler im letzten Lauf:'} />}
            {scanJobs.filter((j) => j.status !== 'completed').length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Aufgaben</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Auftrag</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Geprüft</TableCell>
                      <TableCell align="right">Gesamt</TableCell>
                      <TableCell align="right">Aktion</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {scanJobs.filter((j) => j.status !== 'completed').map((j) => (
                      <TableRow key={j.id} hover>
                        <TableCell sx={{ maxWidth: 260 }}><Typography variant="body2" noWrap title={`#${j.id} ${j.label}`}>#{j.id} {j.label}</Typography></TableCell>
                        <TableCell><Chip size="small" label={STATUS_LABEL[j.status] ?? j.status} color={j.status === 'running' ? 'warning' : j.status === 'completed' ? 'success' : j.status === 'queued' ? 'info' : 'error'} /></TableCell>
                        <TableCell align="right">{j.checked.toLocaleString('de-DE')}</TableCell>
                        <TableCell align="right">{j.total.toLocaleString('de-DE')}</TableCell>
                        <TableCell align="right">
                          {j.status === 'running' && (
                            <Tooltip title="Auftrag abbrechen">
                              <IconButton size="small" color="error" onClick={async () => { await api.abortScan(); await loadStatus(); }}>
                                <StopIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {(j.status === 'stopped' || j.status === 'aborted') && (
                            <Tooltip title="Auftrag fortsetzen">
                              <IconButton size="small" onClick={() => runAction(() => api.resumeScanJob(j.id))}>
                                <PlayArrowIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {j.status === 'queued' && (
                            <Tooltip title="Auftrag löschen">
                              <IconButton size="small" color="error" onClick={() => runAction(() => api.deleteScanJob(j.id))}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <FileCopyIcon color="primary" />
              <Typography variant="h6">Transferred-Check</Typography>
              <Chip label={STATUS_LABEL[transferredCheck?.status ?? 'idle']} color={transferredCheckRunning ? 'warning' : transferredCheck?.status === 'completed' ? 'success' : transferredCheck?.status === 'aborted' || transferredCheck?.status === 'stopped' ? 'error' : 'default'} />
              <Box sx={{ flexGrow: 1 }} />
              {!transferredCheckRunning && (
                <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => runAction(api.startTransferredCheck)} disabled={starting}>
                  Prüfung starten
                </Button>
              )}
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortTransferredCheck(); await loadStatus(); }} disabled={!transferredCheckRunning}>
                Abbrechen
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Prüft rein über die Datenbank, ob Upload-Dateien bereits in der Bibliothek liegen: zuerst per Dateiname, bei Treffer per md5. Gefundene Dateien werden als übertragen markiert; ohne md5 bleibt der Status pending.
            </Typography>
            {(transferredCheckRunning || (transferredCheck && transferredCheck.status !== 'idle' && transferredCheck.total > 0)) && (
              <>
                <LinearProgress variant="determinate" value={transferredCheck && transferredCheck.total > 0 ? Math.round((transferredCheck.checked / transferredCheck.total) * 100) : 0} sx={{ mt: 2 }} />
                <Box sx={{ mt: 2 }}>
                  <Grid container spacing={2}>
                    <Metric label="Geprüft" value={transferredCheck?.checked ?? 0} />
                    <Metric label="Übertragen" value={transferredCheck?.transferred ?? 0} />
                    <Metric label="Offen" value={transferredCheck?.undecided ?? 0} />
                  </Grid>
                </Box>
              </>
            )}
            {transferredCheck?.currentFile && transferredCheckRunning && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>
                {transferredCheck.currentFile}
              </Typography>
            )}
            {transferredCheck?.startedAt && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Gestartet: {formatDateTime(transferredCheck.startedAt)}{transferredCheck.finishedAt ? ` · Beendet: ${formatDateTime(transferredCheck.finishedAt)}` : ''}
              </Typography>
            )}
            {transferredCheck && transferredCheck.errors.length > 0 && <ErrorList errors={transferredCheck.errors} title={transferredCheckRunning ? 'Fehler bislang:' : 'Fehler im letzten Lauf:'} />}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <ImageIcon color="primary" />
              <Typography variant="h6">Vorschaubilder</Typography>
              <Chip label={thumbPending ? 'Wird generiert' : 'Bereit'} color={thumbPending ? 'warning' : 'success'} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Miniaturen werden für neue Fotos und Videos automatisch im Hintergrund erzeugt (mit reduzierter Auslastung, damit Scans nicht ausgebremst werden).
            </Typography>
            {thumbPending && <LinearProgress variant="determinate" value={thumbProgress(thumbnails)} sx={{ mt: 2 }} />}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {thumbnails
                ? `${(thumbnails.total - thumbnails.pending).toLocaleString('de-DE')} von ${thumbnails.total.toLocaleString('de-DE')} generiert`
                : '–'}
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" gutterBottom>Historie (Scans & Übertragungen)</Typography>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadStatus}>Aktualisieren</Button>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Art</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Gestartet</TableCell>
                  <TableCell>Beendet</TableCell>
                  <TableCell align="right">Gescannt</TableCell>
                  <TableCell align="right">Dateien</TableCell>
                  <TableCell align="right">Ordner</TableCell>
                  <TableCell align="right">Übersprungen</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{r.id}</TableCell>
                    <TableCell>{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                    <TableCell><Chip size="small" label={STATUS_LABEL[r.status]} color={r.status === 'completed' ? 'success' : r.status === 'aborted' ? 'error' : 'default'} /></TableCell>
                    <TableCell>{formatDateTime(r.startedAt)}</TableCell>
                    <TableCell>{r.finishedAt ? formatDateTime(r.finishedAt) : '–'}</TableCell>
                    <TableCell align="right">{r.scanned.toLocaleString('de-DE')}</TableCell>
                    <TableCell align="right">{r.totalFiles.toLocaleString('de-DE')}</TableCell>
                    <TableCell align="right">{r.totalDirs.toLocaleString('de-DE')}</TableCell>
                    <TableCell align="right">{r.skipped.toLocaleString('de-DE')}</TableCell>
                    <TableCell>
                      <IconButton size="small" title="Lauf löschen" color="error" onClick={() => deleteRun(r)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && (
                  <TableRow><TableCell colSpan={10} align="center">Noch keine Läufe.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function thumbProgress(t: ThumbnailStatus | null): number {
  if (!t || t.total === 0) return 0;
  return Math.round(((t.total - t.pending) / t.total) * 100);
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatElapsed(startedAt: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `ca. ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `ca. ${m} min ${s % 60} s`;
  return `ca. ${Math.floor(m / 60)} h ${m % 60} min`;
}

function ActiveFilesList({ title, files }: { title: string; files: ActiveScanFile[] }) {
  if (!files || files.length === 0) return null;
  // Neueste zuerst: oben die zuletzt begonnene, unten die längste laufende Datei.
  const ordered = [...files].reverse();
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">{title} ({files.length}):</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2, listStyle: 'none', maxHeight: 160, overflow: 'auto' }}>
        {ordered.map((f, i) => (
          <li key={i}><Typography variant="caption" color="text.secondary" noWrap display="block" title={`${f.file} · ${formatBytes(f.sizeBytes)} · seit ${formatElapsed(f.startedAt)} · ETA ${formatDuration(f.etaMs)}`}>{f.file} · {formatBytes(f.sizeBytes)} · {formatElapsed(f.startedAt)} · ETA {formatDuration(f.etaMs)}</Typography></li>
        ))}
      </Box>
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Grid item xs={6} sm={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Grid>
  );
}

function ErrorList({ errors, title }: { errors: string[]; title: string }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" gutterBottom>{title}</Typography>
      <List dense sx={{ maxHeight: 240, overflow: 'auto', bgcolor: '#fdecea', borderRadius: 1 }}>
        {errors.map((e, i) => (
          <ListItem key={i}><ListItemText primary={e} primaryTypographyProps={{ variant: 'body2' }} /></ListItem>
        ))}
      </List>
    </Box>
  );
}

