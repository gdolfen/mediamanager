import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api/client';
import type { LogEntry, LogLevel, LogPage, LogStats } from '../types';

const LEVEL_COLOR: Record<LogLevel, 'success' | 'warning' | 'error' | 'default'> = {
  info: 'default',
  warn: 'warning',
  error: 'error',
};

const SOURCE_LABEL: Record<string, string> = {
  app: 'App',
  transfer: 'Übertragung',
  scan: 'Scan',
  schedule: 'Zeitplan',
  settings: 'Einstellungen',
  devices: 'Geräte',
  problems: 'Probleme',
  logs: 'Logs',
};

export function LogsPage() {
  const [page, setPage] = useState(1);
  const [limit] = useState(100);
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [data, setData] = useState<LogPage | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      const [logs, s] = await Promise.all([api.logs({ page, limit, level: level || undefined }), api.logStats()]);
      setData(logs);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, [page, level]);

  useEffect(() => {
    if (!paused && !pollRef.current) {
      pollRef.current = setInterval(() => { load(); }, 3000);
    } else if (paused && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [paused, page, level]);

  const clear = async () => {
    try {
      await api.clearLogs();
      setPage(1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4">Anwendungslogs</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />} onClick={() => setPaused(!paused)}>
              {paused ? 'Aktualisieren' : 'Pause'}
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteSweepIcon />} onClick={clear}>
              Logs löschen
            </Button>
          </Stack>
        </Stack>
      </Grid>

      {error && (
        <Grid item xs={12}>
          <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
        </Grid>
      )}

      <Grid item xs={12}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
              <Chip size="small" label={`Gesamt: ${stats?.total ?? 0}`} />
              <Chip size="small" color="error" label={`Fehler: ${stats?.error ?? 0}`} />
              <Chip size="small" color="warning" label={`Warnungen: ${stats?.warn ?? 0}`} />
              <Chip size="small" label={`Info: ${stats?.info ?? 0}`} />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Level</InputLabel>
                <Select value={level} onChange={(e) => { setPage(1); setLevel(e.target.value as LogLevel | ''); }} label="Level">
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="info">Info</MenuItem>
                  <MenuItem value="warn">Warnung</MenuItem>
                  <MenuItem value="error">Fehler</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <Table size="small" sx={{ tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 170 }}>Zeit</TableCell>
                  <TableCell sx={{ width: 110 }}>Level</TableCell>
                  <TableCell sx={{ width: 140 }}>Quelle</TableCell>
                  <TableCell>Meldung</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.rows ?? []).map((row: LogEntry) => (
                  <TableRow key={row.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{formatTime(row.ts)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.level} color={LEVEL_COLOR[row.level]} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{SOURCE_LABEL[row.source] ?? row.source}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{row.message}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.rows ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">Noch keine Logs vorhanden.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                <Pagination count={totalPages} page={page} onChange={(_e, p) => setPage(p)} color="primary" />
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE');
}