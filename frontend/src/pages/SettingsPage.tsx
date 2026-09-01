import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { api } from '../api/client';
import { formatDateTime } from '../utils/date';
import type { FormatInfo, ScheduleMode, ScheduleState } from '../types';

export function SettingsPage({ onOpenFormat }: { onOpenFormat?: (ext: string) => void }) {
  const [upload, setUpload] = useState('');
  const [fotos, setFotos] = useState('');
  const [videos, setVideos] = useState('');
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [schedule, setSchedule] = useState<ScheduleState | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('scan');
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setUpload(s.paths.upload);
      setFotos(s.paths.fotos);
      setVideos(s.paths.videos);
      setFormats(await api.formats());
      const sc = await api.getSchedule();
      setSchedule(sc);
      setScheduleEnabled(sc.enabled);
      setIntervalMinutes(sc.intervalMinutes);
      setScheduleMode(sc.mode);
    } catch (e) {
      setMessage({ severity: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.putSettings({ paths: { upload: upload.trim(), fotos: fotos.trim(), videos: videos.trim() } });
      setMessage({ severity: 'success', text: 'Einstellungen gespeichert.' });
    } catch (e) {
      setMessage({ severity: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    setScheduleSaving(true);
    setMessage(null);
    try {
      const sc = await api.putSchedule({ enabled: scheduleEnabled, intervalMinutes, mode: scheduleMode });
      setSchedule(sc);
      setMessage({ severity: 'success', text: 'Zeitplan gespeichert.' });
    } catch (e) {
      setMessage({ severity: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h4" gutterBottom>Einstellungen</Typography>
      </Grid>

      {message && <Grid item xs={12}><Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert></Grid>}

      <Grid item xs={12} md={7}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Verzeichnisse</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Pfade werden in der Datenbank gespeichert und sind damit pro Deployment konfigurierbar (z.B. Windows-IDE vs. Docker).
            </Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              <TextField label="Upload-Verzeichnis (read-only)" value={upload} onChange={(e) => setUpload(e.target.value)} fullWidth
                helperText="Wird nur gelesen. Dateien bleiben dort liegen; erneute Übertragung wird über Datei-Hash verhindert." />
              <TextField label="Fotos-Ziel" value={fotos} onChange={(e) => setFotos(e.target.value)} fullWidth />
              <TextField label="Videos-Ziel" value={videos} onChange={(e) => setVideos(e.target.value)} fullWidth />
              <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving || !upload.trim() || !fotos.trim() || !videos.trim()}>
                Speichern
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ScheduleIcon fontSize="small" /> Automatischer Zeitplan
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Lässt den Upload-Ordner periodisch automatisch scannen. Wird auf dem Server ausgeführt, unabhängig davon ob das Frontend geöffnet ist.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
              <FormControlLabel
                control={<Switch checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />}
                label="Automatisches Scannen aktiviert"
              />
              <TextField
                label="Intervall (Minuten)"
                type="number"
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value)))}
                disabled={!scheduleEnabled}
                inputProps={{ min: 1, max: 24 * 60 }}
                sx={{ width: 180 }}
              />
              <FormControl sx={{ minWidth: 240 }} disabled={!scheduleEnabled}>
                <InputLabel>Ausführung</InputLabel>
                <Select value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value as ScheduleMode)} label="Ausführung">
                  <MenuItem value="scan">Nur Scannen (indexieren)</MenuItem>
                  <MenuItem value="scan_and_transfer">Scannen und übertragen</MenuItem>
                </Select>
              </FormControl>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={saveSchedule} disabled={scheduleSaving}>
                Zeitplan speichern
              </Button>
            </Stack>

            {schedule && (
              <Stack direction="row" spacing={2} sx={{ mt: 2 }} flexWrap="wrap">
                <Chip
                  size="small"
                  label={schedule.enabled ? 'Aktiv' : 'Deaktiviert'}
                  color={schedule.enabled ? 'success' : 'default'}
                />
                <Chip size="small" label={`Intervall: ${schedule.intervalMinutes} min`} />
                <Chip size="small" label={schedule.mode === 'scan_and_transfer' ? 'Scan + Übertragung' : 'Nur Scan'} />
                {schedule.lastRunAt && <Chip size="small" label={`Letzter Lauf: ${formatDateTime(schedule.lastRunAt)}`} />}
                {schedule.nextRunAt && schedule.enabled && <Chip size="small" label={`Nächster Lauf: ${formatDateTime(schedule.nextRunAt)}`} />}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Gefundene Dateiformate</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Wird beim letzten Scan ermittelt. Nicht unterstützte Formate können nicht einsortiert werden.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Format</TableCell>
                  <TableCell align="right">Anzahl</TableCell>
                  <TableCell>Unterstützt</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {formats.map((f) => (
                  <TableRow key={f.ext}>
                    <TableCell>
                      <Typography
                        component="span"
                        sx={{ fontFamily: 'monospace', cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                        title="Alle Dateien dieses Formats anzeigen"
                        onClick={() => onOpenFormat?.(f.ext)}
                      >
                        {f.ext}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{f.count}</TableCell>
                    <TableCell>{f.supported ? <Chip size="small" color="success" label="Ja" /> : <Chip size="small" color="warning" label="Nein" />}</TableCell>
                  </TableRow>
                ))}
                {formats.length === 0 && (
                  <TableRow><TableCell colSpan={3} align="center">Noch kein Scan durchgeführt.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

