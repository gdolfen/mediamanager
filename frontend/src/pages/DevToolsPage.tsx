import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  Tabs,
  Tab,
  TextField,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TableChartIcon from '@mui/icons-material/TableChart';
import BarChartIcon from '@mui/icons-material/BarChart';
import { api } from '../api/client';

interface SqlResult {
  rows: Record<string, unknown>[];
  count: number;
  changes?: number;
  lastInsertRowid?: number | null;
  error?: string;
}

interface TableInfo {
  columns: { name: string; type: string; notnull: boolean; pk: boolean }[];
  count: number;
}

interface PerfEntry {
  ts: string;
  source: string;
  message: string;
}

export function DevToolsPage() {
  const [tab, setTab] = useState(0);
  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Typography variant="h4" gutterBottom>Entwicklerwerkzeuge</Typography>
      </Grid>
      <Grid item xs={12}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab icon={<TableChartIcon />} label="SQL-Editor" />
          <Tab icon={<BarChartIcon />} label="Performance" />
        </Tabs>
      </Grid>
      <Grid item xs={12}>
        {tab === 0 && <SqlEditor />}
        {tab === 1 && <PerformanceStats />}
      </Grid>
    </Grid>
  );
}

function SqlEditor() {
  const [sql, setSql] = useState('SELECT COUNT(*) AS total FROM files');
  const [result, setResult] = useState<SqlResult | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTables = useCallback(async () => {
    try {
      setTables(await api.devTables());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);

  const loadTable = async (name: string) => {
    setSelectedTable(name);
    try {
      const info = await api.devTableInfo(name);
      setTableInfo(info);
      setSql(`SELECT * FROM ${name} LIMIT 100`);
    } catch { setTableInfo(null); }
  };

  const execute = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.devSql(sql);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const columns = result?.rows?.length ? Object.keys(result.rows[0]) : [];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
            <Typography variant="h6">Tabellen</Typography>
            {tables.map((t) => (
              <Chip key={t} label={t} size="small" color={selectedTable === t ? 'primary' : 'default'} onClick={() => loadTable(t)} />
            ))}
          </Stack>
          {tableInfo && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {selectedTable}: {tableInfo.count} Zeilen, {tableInfo.columns.length} Spalten
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {tableInfo.columns.map((c) => `${c.name} (${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''})`).join(', ')}
              </Typography>
            </Box>
          )}
          <TextField
            multiline
            minRows={3}
            maxRows={8}
            fullWidth
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            sx={{ fontFamily: 'monospace', mb: 1 }}
            placeholder="SELECT * FROM files LIMIT 10 -- auch INSERT, UPDATE, DELETE erlaubt"
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={execute} disabled={loading || !sql.trim()}>
              Ausführen
            </Button>
            <Typography variant="caption" color="warning.main">
              INSERT/UPDATE/DELETE wirken direkt auf die produktive DB.
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {result && (
        <Card>
          <CardContent>
            {result.changes !== undefined ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {result.changes} Zeile(n) betroffen
                {result.lastInsertRowid != null && ` · letzte ID: ${result.lastInsertRowid}`}
              </Typography>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {result.count} Zeilen
                </Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {columns.map((c) => <TableCell key={c} sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{c}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.rows.map((row, i) => (
                        <TableRow key={i}>
                          {columns.map((c) => <TableCell key={c} sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(row[c] ?? '')}>{String(row[c] ?? 'NULL')}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

function PerformanceStats() {
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.logs({ level: undefined, page: 1, limit: 500 });
      const perf = res.rows.filter((r) => r.source === 'scan' || r.source === 'transfer' || r.source === 'perf');
      setEntries(perf.map((r) => ({ ts: r.ts, source: r.source, message: r.message })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Scan/Transfer Logs</Typography>
          <Box sx={{ maxHeight: 500, overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 170 }}>Zeit</TableCell>
                  <TableCell sx={{ width: 100 }}>Quelle</TableCell>
                  <TableCell>Meldung</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.ts}</TableCell>
                    <TableCell><Chip size="small" label={e.source} /></TableCell>
                    <TableCell sx={{ fontSize: 12, wordBreak: 'break-word' }}>{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
