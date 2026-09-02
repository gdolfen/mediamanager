import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../api/client';
import { Thumbnail } from '../components/Thumbnail';
import { formatDateTime } from '../utils/date';
import type { Problem, ProblemType, RecheckState } from '../types';

export const TYPE_META: Record<ProblemType, { label: string; color: 'error' | 'warning' | 'info' | 'default' }> = {
  UNKNOWN_DEVICE: { label: 'Unbekanntes Gerät', color: 'error' },
  NO_META_DATE: { label: 'Keine Metadaten (Datum aus Datei)', color: 'warning' },
  DATE_MISMATCH_META: { label: 'Meta-Datum weicht ab', color: 'warning' },
  DATE_MISMATCH_FILENAME: { label: 'Datum im Dateinamen weicht ab', color: 'error' },
  TARGET_EXISTS: { label: 'Zieldatei existiert', color: 'error' },
  UNSUPPORTED_FORMAT: { label: 'Nicht unterstützt', color: 'warning' },
  READ_ERROR: { label: 'Nicht lesbar', color: 'error' },
  DEVICE_PERIOD_DEVIATION: { label: 'Außerhalb Nutzungszeit', color: 'info' },
  FILE_MTIME_BEFORE_BIRTHTIME: { label: 'Änderungszeit vor Erstellzeit', color: 'info' },
  LIBRARY_META_FILENAME_MISMATCH: { label: 'Bibliothek: Meta vs. Dateiname', color: 'info' },
  LIBRARY_META_FILETIME_MISMATCH: { label: 'Bibliothek: Meta vs. Dateizeit', color: 'info' },
  LIBRARY_FILENAME_FILETIME_MISMATCH: { label: 'Bibliothek: Dateiname vs. Dateizeit', color: 'warning' },
  LIBRARY_PATH_MISMATCH: { label: 'Bibliothek: Pfad passt nicht', color: 'warning' },
};

const ACTION_LABELS: Record<string, string> = {
  accept_file_date: 'Dateizeit übernehmen',
  accept_meta_date: 'Meta-Datum akzeptieren',
  accept_filename_date: 'Dateinamen-Datum übernehmen',
  ignore: 'Ignorieren',
  create_device: 'Gerät anlegen / zuordnen',
};

export function ProblemsPage({ onStartTransfer }: { onStartTransfer: () => Promise<boolean> }) {
  const [rows, setRows] = useState<Problem[]>([]);
  const [total, setTotal] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [severity, setSeverity] = useState<'error' | 'warning' | 'info' | ''>('');
  const [scope, setScope] = useState<'upload' | 'library' | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [deviceDialog, setDeviceDialog] = useState<Problem | null>(null);
  const [recheck, setRecheck] = useState<RecheckState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listProblems({ resolved: showResolved ? undefined : false, severity: severity || undefined, scope: scope || undefined, limit: 100 });
      setRows(res.rows);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [showResolved, severity, scope]);

  useEffect(() => { load(); }, [load]);

  const recheckProblems = async () => {
    setError(null);
    try {
      const start = await api.startRecheck();
      if (!start.ok) {
        setError(start.error ?? 'Neubewertung konnte nicht gestartet werden.');
        return;
      }
      setRecheck(await api.recheckStatus());
      await new Promise<void>((resolve) => {
        const timer = setInterval(async () => {
          const s = await api.recheckStatus();
          setRecheck(s);
          if (s.status !== 'running') {
            clearInterval(timer);
            resolve();
          }
        }, 1000);
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecheck(null);
    }
  };

  const applyAction = async (problem: Problem, action: string) => {
    if (action === 'create_device') {
      setDeviceDialog(problem);
      return;
    }
    setBusy(problem.id);
    try {
      await api.resolveProblem(problem.id, action);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" gutterBottom>Problemliste</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={recheckProblems} disabled={!!recheck && recheck.status === 'running'}>
              {recheck?.status === 'running' ? 'Bewerte neu…' : 'Aktualisieren'}
            </Button>
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={async () => { if (await onStartTransfer()) { /* stays */ } }}>
              Übertragung starten
            </Button>
          </Stack>
        </Stack>
      </Grid>

      {recheck?.status === 'running' && (
        <Grid item xs={12}>
          <Alert severity="info" icon={false}>
            Bewerte Probleme neu: {recheck.checked}/{recheck.total} Dateien (aktuell: {recheck.currentFile ?? '–'}) · {recheck.resolved} gelöst, {recheck.created} neu
          </Alert>
        </Grid>
      )}
      {recheck && recheck.status !== 'running' && recheck.status !== 'idle' && (
        <Grid item xs={12}>
          <Alert severity={recheck.status === 'completed' ? 'success' : 'warning'} onClose={() => setRecheck(null)}>
            Neubewertung {recheck.status === 'completed' ? 'abgeschlossen' : 'abgebrochen'}: {recheck.checked}/{recheck.total} Dateien geprüft, {recheck.resolved} Probleme gelöst, {recheck.created} neu.
          </Alert>
        </Grid>
      )}

      {error && (
        <Grid item xs={12}>
          <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
        </Grid>
      )}

      <Grid item xs={12}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Chip label={`Offen (${total})`} color="error" variant={showResolved ? 'outlined' : 'filled'} onClick={() => setShowResolved(false)} />
          <Chip label="Alle inkl. gelöst" variant={showResolved ? 'filled' : 'outlined'} onClick={() => setShowResolved(true)} />
          <Box sx={{ width: 16 }} />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Schweregrad</InputLabel>
            <Select value={severity} label="Schweregrad" onChange={(e) => setSeverity(e.target.value as typeof severity)}>
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="error">Fehler</MenuItem>
              <MenuItem value="warning">Warnung</MenuItem>
              <MenuItem value="info">Info</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Bereich</InputLabel>
            <Select value={scope} label="Bereich" onChange={(e) => setScope(e.target.value as typeof scope)}>
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="upload">Upload (Windows-IDE)</MenuItem>
              <MenuItem value="library">Medienbibliothek</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent sx={{ p: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 2 }}>Vorschau</TableCell>
                  <TableCell>Datei</TableCell>
                  <TableCell>Problem</TableCell>
                  <TableCell>Gerät</TableCell>
                  <TableCell>Datum</TableCell>
                  <TableCell>Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id} sx={{ opacity: p.resolved ? 0.5 : 1 }}>
                    <TableCell sx={{ pl: 2 }}>
                      {p.file && p.file.fileType !== 'other' ? (
                        <Thumbnail fileId={p.file.id} fileType={p.file.fileType} />
                      ) : (
                        <Box sx={{ width: 56, height: 56 }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{p.file?.originalName ?? '–'}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                        {p.file?.sourceRelPath ?? ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" color={TYPE_META[p.type].color} label={TYPE_META[p.type].label} />
                        {p.scope && (
                          <Chip
                            size="small"
                            variant="outlined"
                            color={p.scope === 'upload' ? 'primary' : 'secondary'}
                            label={p.scope === 'upload' ? 'Upload' : 'Bibliothek'}
                            title={p.scope === 'upload' ? 'Datei aus dem Upload-Bereich' : 'Datei aus der Medienbibliothek'}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5, maxWidth: 320 }}>
                        {p.message}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <span>{p.file?.deviceMappedName ?? '–'}</span>
                        {p.file?.devicePerson && <span>von {p.file.devicePerson}</span>}
                        {p.file?.isWhatsApp && <Chip size="small" variant="outlined" color="success" label="WA" title="WhatsApp-Datei" sx={{ height: 18, fontSize: 10 }} />}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.file?.takenAt ? formatDateTime(p.file.takenAt) : '–'}</TableCell>
                    <TableCell>
                      {p.resolved ? (
                        <Chip size="small" color="success" label="Gelöst" />
                      ) : (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {p.actionLabel.map((label) => {
                            const action = p.actionType;
                            if (label !== ACTION_LABELS[action ?? '']) return null;
                            return (
                              <Button key={label} size="small" variant="outlined" disabled={busy === p.id} onClick={() => applyAction(p, action!)}>
                                {label}
                              </Button>
                            );
                          })}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}>Keine Probleme gefunden.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>

      {deviceDialog && <DeviceDialog problem={deviceDialog} onClose={() => setDeviceDialog(null)} onSaved={load} />}
    </Grid>
  );
}

function DeviceDialog({ problem, onClose, onSaved }: { problem: Problem; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mappedName, setMappedName] = useState('');
  const [kind, setKind] = useState<'exif' | 'filename'>(problem.file?.deviceMappedName ? 'exif' : 'filename');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (problem.file) {
      const base = problem.file.originalName.replace(/\.[^.]+$/, '');
      const us = base.indexOf('_');
      setValue(us > 0 ? base.slice(0, us + 1) : base);
    }
  }, [problem]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createDeviceForProblem(problem.id, { mappedName, identifierKind: kind, identifierValue: value });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Gerät anlegen / zuordnen</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {problem.file?.originalName}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Gerätename (angezeigt im Dateinamen)" value={mappedName} onChange={(e) => setMappedName(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>Identifier-Typ</InputLabel>
            <Select value={kind} label="Identifier-Typ" onChange={(e) => setKind(e.target.value as 'exif' | 'filename')}>
              <MenuItem value="exif">EXIF Make + Model</MenuItem>
              <MenuItem value="filename">Dateinamen-Präfix</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Identifier-Wert" value={value} onChange={(e) => setValue(e.target.value)} fullWidth
            helperText={kind === 'filename' ? 'z.B. IMG_ für alle Dateien, die mit IMG_ beginnen' : 'z.B. Apple iPhone 12'} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={saving || !mappedName.trim() || !value.trim()}>Speichern</Button>
      </DialogActions>
    </Dialog>
  );
}