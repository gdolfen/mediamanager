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

  const etaUpload = useEta(uploadScan?.scanned ?? 0, uploadScan?.totalFiles ?? 0, uploadRunning);
  const etaTarget = useEta(targetScan?.scanned ?? 0, targetScan?.totalFiles ?? 0, targetRunning);

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
                Gestartet: {formatDate(transfer.startedAt)}{transfer.finishedAt ? ` · Beendet: ${formatDate(transfer.finishedAt)}` : ''}
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
              <Chip label={STATUS_LABEL[uploadScan?.status ?? 'idle']} color={uploadRunning ? 'warning' : uploadScan?.status === 'completed' ? 'success' : uploadScan?.status === 'aborted' ? 'error' : 'default'} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Indiziert neue Dateien im Upload-Ordner (Hashes, Metadaten, Probleme) – kann parallel zum Zielordner-Scan laufen.
            </Typography>
            {uploadRunning && <LinearProgress sx={{ mt: 2 }} />}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Metric label="Gescannt" value={uploadScan?.scanned ?? 0} />
                <Metric label="Indexiert" value={uploadScan?.indexed ?? 0} />
                <Metric label="Übersprungen" value={uploadScan?.skipped ?? 0} />
                <Metric label="Probleme" value={uploadScan?.problems ?? 0} />
              </Grid>
            </Box>
            {uploadScan && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {uploadScan.scanned.toLocaleString('de-DE')} von {uploadScan.totalFiles.toLocaleString('de-DE')} Dateien · {uploadScan.totalDirs.toLocaleString('de-DE')} Ordner
                {uploadRunning && uploadScan.scanned > 0 ? ` · Restzeit ${formatEta(etaUpload)}` : ''}
              </Typography>
            )}
            {uploadScan?.currentFile && uploadRunning && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>Aktuell: {uploadScan.currentFile}</Typography>
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
              <Chip label={STATUS_LABEL[targetScan?.status ?? 'idle']} color={targetRunning ? 'warning' : targetScan?.status === 'completed' ? 'success' : targetScan?.status === 'aborted' ? 'error' : 'default'} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Durchsucht die Zielordner (Fotos/Videos) und aktualisiert die Bibliothek – kann parallel zum Upload-Scan laufen.
            </Typography>
            {targetRunning && <LinearProgress sx={{ mt: 2 }} />}
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Metric label="Gescannt" value={targetScan?.scanned ?? 0} />
                <Metric label="Verknüpft" value={targetScan?.linked ?? 0} />
                <Metric label="Neu" value={targetScan?.newFiles ?? 0} />
                <Metric label="Probleme" value={targetScan?.problems ?? 0} />
              </Grid>
            </Box>
            {targetScan && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {targetScan.scanned.toLocaleString('de-DE')} von {targetScan.totalFiles.toLocaleString('de-DE')} Dateien · {targetScan.totalDirs.toLocaleString('de-DE')} Ordner
                {targetRunning && targetScan.scanned > 0 ? ` · Restzeit ${formatEta(etaTarget)}` : ''}
              </Typography>
            )}
            {targetScan?.currentFile && targetRunning && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>Aktuell: {targetScan.currentFile}</Typography>
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
                    <TableCell>{formatDate(r.startedAt)}</TableCell>
                    <TableCell>{r.finishedAt ? formatDate(r.finishedAt) : '–'}</TableCell>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE');
}