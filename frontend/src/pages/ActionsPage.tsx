import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
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
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FastForwardIcon from '@mui/icons-material/FastForward';
import StopIcon from '@mui/icons-material/Stop';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ImageIcon from '@mui/icons-material/Image';
import { api } from '../api/client';
import { useEta, formatEta } from '../hooks/useEta';
import { formatDateTime } from '../utils/date';
import type { RunKind, RunRecord, TargetScanState, ThumbnailStatus, TransferState, UploadScanState } from '../types';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Bereit',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  aborted: 'Abgebrochen',
};

const KIND_LABEL: Record<RunKind, string> = {
  transfer: 'Übertragung',
  uploadScan: 'Upload-Scan',
  targetScan: 'Zielordner-Scan',
  recheck: 'Neubewertung',
};

export function ActionsPage() {
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const [uploadScan, setUploadScan] = useState<UploadScanState | null>(null);
  const [targetScan, setTargetScan] = useState<TargetScanState | null>(null);
  const [thumbnails, setThumbnails] = useState<ThumbnailStatus | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    try { setTransfer(await api.transferStatus()); } catch { /* ignore */ }
    try { setUploadScan(await api.uploadScanStatus()); } catch { /* ignore */ }
    try { setTargetScan(await api.targetScanStatus()); } catch { /* ignore */ }
    try { setThumbnails(await api.thumbnailStatus()); } catch { /* ignore */ }
    try { setRuns(await api.runHistory()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const transferRunning = transfer?.status === 'running';
  const uploadRunning = uploadScan?.status === 'running';
  const targetRunning = targetScan?.status === 'running';
  const thumbPending = (thumbnails?.pending ?? 0) > 0;
  const anythingActive = transferRunning || uploadRunning || targetRunning || thumbPending;

  const etaUpload = useEta(
    uploadScan?.phase === 'analyze' ? (uploadScan?.analyzed ?? 0) : (uploadScan?.scanned ?? 0),
    uploadScan?.phase === 'analyze' ? (uploadScan?.indexed ?? 0) : (uploadScan?.totalFiles ?? 0),
    uploadRunning
  );
  const etaTarget = useEta(
    targetScan?.phase === 'analyze' ? (targetScan?.analyzed ?? 0) : (targetScan?.scanned ?? 0),
    targetScan?.phase === 'analyze' ? (targetScan?.indexed ?? 0) : (targetScan?.totalFiles ?? 0),
    targetRunning
  );

  useEffect(() => {
    if (anythingActive && !pollRef.current) {
      pollRef.current = setInterval(loadStatus, 1000);
    } else if (!anythingActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [anythingActive, loadStatus]);

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

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h4" gutterBottom>Aktionen</Typography>
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
                  Upload-Ordner scannen
                </Button>
              )}
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortUploadScan(); }} disabled={!uploadRunning}>
                Abbrechen
              </Button>
              {uploadRunning && (
                <Chip
                  label={uploadScan?.phase === 'analyze' ? 'Phase 2: Analysieren' : 'Phase 1: Durchsuchen'}
                  color={uploadScan?.phase === 'analyze' ? 'secondary' : 'info'}
                />
              )}
              {!uploadRunning && (
                <Chip label={STATUS_LABEL[uploadScan?.status ?? 'idle']} color={uploadScan?.status === 'completed' ? 'success' : uploadScan?.status === 'aborted' ? 'error' : 'default'} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Dateien im Upload-Ordner durchsuchen und indexieren.
            </Typography>
            {uploadRunning && (
              <LinearProgress
                variant={etaUpload != null ? 'determinate' : 'indeterminate'}
                value={etaUpload != null
                  ? (uploadScan?.phase === 'analyze'
                    ? (uploadScan.indexed > 0 ? Math.round((uploadScan.analyzed / uploadScan.indexed) * 100) : 0)
                    : (uploadScan?.totalFiles ?? 0) > 0 ? Math.round(((uploadScan?.scanned ?? 0) / (uploadScan?.totalFiles ?? 1)) * 100) : 0)
                  : undefined
                }
                sx={{ mt: 2 }}
              />
            )}
            <Box sx={{ mt: 2 }}>
              {uploadScan?.phase === 'analyze' ? (
                <Typography variant="body2" color="text.secondary">
                  {uploadScan.analyzed.toLocaleString('de-DE')} von {uploadScan.indexed.toLocaleString('de-DE')} analysiert
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  <Metric label="Gescannt" value={uploadScan?.scanned ?? 0} />
                  <Metric label="Dateien" value={uploadScan?.totalFiles ?? 0} />
                  <Metric label="Ordner" value={uploadScan?.totalDirs ?? 0} />
                </Grid>
              )}
            </Box>
            {uploadScan?.currentDirs && uploadScan.currentDirs.length > 0 && uploadRunning && uploadScan.phase === 'walk' && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Aktive Verzeichnisse:</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2, listStyle: 'none' }}>
                  {uploadScan.currentDirs.filter(Boolean).map((d, i) => (
                    <li key={i}><Typography variant="caption" color="text.secondary" noWrap display="block" title={d}>{d}</Typography></li>
                  ))}
                </Box>
              </Box>
            )}
            {uploadScan?.currentFile && uploadRunning && uploadScan.phase === 'analyze' && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>
                {uploadScan.currentFile}
              </Typography>
            )}
            {uploadRunning && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Restzeit {formatEta(etaUpload)}
              </Typography>
            )}
            {uploadScan && uploadScan.errors.length > 0 && <ErrorList errors={uploadScan.errors} title="Fehler im letzten Scan:" />}
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
                  Zielordner scannen
                </Button>
              )}
              <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={async () => { await api.abortTargetScan(); }} disabled={!targetRunning}>
                Abbrechen
              </Button>
              {targetRunning && (
                <Chip
                  label={targetScan?.phase === 'analyze' ? 'Phase 2: Analysieren' : 'Phase 1: Durchsuchen'}
                  color={targetScan?.phase === 'analyze' ? 'secondary' : 'info'}
                />
              )}
              {!targetRunning && (
                <Chip label={STATUS_LABEL[targetScan?.status ?? 'idle']} color={targetScan?.status === 'completed' ? 'success' : targetScan?.status === 'aborted' ? 'error' : 'default'} />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Durchsucht die Zielordner (Fotos/Videos) und aktualisiert die Bibliothek.
            </Typography>
            {targetRunning && (
              <LinearProgress
                variant={etaTarget != null ? 'determinate' : 'indeterminate'}
                value={etaTarget != null
                  ? (targetScan?.phase === 'analyze'
                    ? (targetScan.indexed > 0 ? Math.round((targetScan.analyzed / targetScan.indexed) * 100) : 0)
                    : (targetScan?.totalFiles ?? 0) > 0 ? Math.round(((targetScan?.scanned ?? 0) / (targetScan?.totalFiles ?? 1)) * 100) : 0)
                  : undefined
                }
                sx={{ mt: 2 }}
              />
            )}
            <Box sx={{ mt: 2 }}>
              {targetScan?.phase === 'analyze' ? (
                <Typography variant="body2" color="text.secondary">
                  {targetScan.analyzed.toLocaleString('de-DE')} von {targetScan.indexed.toLocaleString('de-DE')} analysiert
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  <Metric label="Gescannt" value={targetScan?.scanned ?? 0} />
                  <Metric label="Dateien" value={targetScan?.totalFiles ?? 0} />
                  <Metric label="Ordner" value={targetScan?.totalDirs ?? 0} />
                </Grid>
              )}
            </Box>
            {targetScan?.currentDirs && targetScan.currentDirs.length > 0 && targetRunning && targetScan.phase === 'walk' && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Aktive Verzeichnisse:</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2, listStyle: 'none' }}>
                  {targetScan.currentDirs.filter(Boolean).map((d, i) => (
                    <li key={i}><Typography variant="caption" color="text.secondary" noWrap display="block" title={d}>{d}</Typography></li>
                  ))}
                </Box>
              </Box>
            )}
            {targetScan?.currentFile && targetRunning && targetScan.phase === 'analyze' && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>
                {targetScan.currentFile}
              </Typography>
            )}
            {targetRunning && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Restzeit {formatEta(etaTarget)}
              </Typography>
            )}
            {targetScan && targetScan.errors.length > 0 && <ErrorList errors={targetScan.errors} title="Fehler im letzten Scan:" />}
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
                  <TableCell align="right">Fortschritt</TableCell>
                  <TableCell align="right">Übersprungen</TableCell>
                  <TableCell align="right">Probleme</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.id}</TableCell>
                    <TableCell>{KIND_LABEL[r.kind] ?? r.kind}</TableCell>
                    <TableCell><Chip size="small" label={STATUS_LABEL[r.status]} color={r.status === 'completed' ? 'success' : r.status === 'aborted' ? 'error' : 'warning'} /></TableCell>
                    <TableCell>{formatDateTime(r.startedAt)}</TableCell>
                    <TableCell>{r.finishedAt ? formatDateTime(r.finishedAt) : '–'}</TableCell>
                    <TableCell align="right">{r.scanned.toLocaleString('de-DE')}</TableCell>
                    <TableCell align="right">{progressLabel(r)}</TableCell>
                    <TableCell align="right">{r.skipped.toLocaleString('de-DE')}</TableCell>
                    <TableCell align="right">{r.problems.toLocaleString('de-DE')}</TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && (
                  <TableRow><TableCell colSpan={9} align="center">Noch keine Läufe.</TableCell></TableRow>
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

function progressLabel(r: RunRecord): string {
  switch (r.kind) {
    case 'transfer': return `${r.transferred.toLocaleString('de-DE')} übertragen`;
    case 'uploadScan': return `${r.indexed.toLocaleString('de-DE')} indexiert`;
    case 'targetScan': return `${r.transferred.toLocaleString('de-DE')} verknüpft${r.newFiles > 0 ? ` · ${r.newFiles.toLocaleString('de-DE')} neu` : ''}`;
    case 'recheck': return `${r.transferred.toLocaleString('de-DE')} gelöst${r.newFiles > 0 ? ` · ${r.newFiles.toLocaleString('de-DE')} neu` : ''}`;
  }
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
      <List dense sx={{ maxHeight: 140, overflow: 'auto', bgcolor: '#fdecea', borderRadius: 1 }}>
        {errors.map((e, i) => (
          <ListItem key={i}><ListItemText primary={e} primaryTypographyProps={{ variant: 'body2' }} /></ListItem>
        ))}
      </List>
    </Box>
  );
}

