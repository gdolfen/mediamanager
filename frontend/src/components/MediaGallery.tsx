import React, { useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import GridViewIcon from '@mui/icons-material/GridView';
import ViewListIcon from '@mui/icons-material/ViewList';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SearchIcon from '@mui/icons-material/Search';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { Thumbnail } from './Thumbnail';
import { FullscreenGallery } from './FullscreenGallery';
import { TYPE_META } from '../pages/ProblemsPage';
import { formatDate, formatDateTime } from '../utils/date';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function formatMetaValue(v: string): string {
  if (ISO_DATE_RE.test(v)) return formatDateTime(v);
  return v;
}
import type { FileRecord } from '../types';

export type SortKey = 'takenAt' | 'originalName' | 'sourceSize' | 'status' | 'deviceName';
export type SortDir = 'asc' | 'desc';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'takenAt', label: 'Datum' },
  { key: 'originalName', label: 'Dateiname' },
  { key: 'sourceSize', label: 'Größe' },
  { key: 'status', label: 'Status' },
  { key: 'deviceName', label: 'Gerät' },
];

export function deviceName(f: FileRecord): string {
  if (f.deviceMappedName) return f.devicePerson ? `${f.deviceMappedName} von ${f.devicePerson}` : f.deviceMappedName;
  return '';
}

export function sortFiles(files: FileRecord[], key: SortKey, dir: SortDir): FileRecord[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...files].sort((a, b) => {
    let r = 0;
    switch (key) {
      case 'takenAt': r = (a.takenAt ?? '').localeCompare(b.takenAt ?? ''); break;
      case 'originalName': r = a.originalName.localeCompare(b.originalName, 'de', { numeric: true, sensitivity: 'base' }); break;
      case 'sourceSize': r = (a.sourceSize ?? -1) - (b.sourceSize ?? -1); break;
      case 'status': r = a.status.localeCompare(b.status); break;
      case 'deviceName': r = deviceName(a).localeCompare(deviceName(b), 'de'); break;
    }
    return r * mul;
  });
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '–';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusChip(status: FileRecord['status']) {
  const map: Record<string, { color: 'info' | 'success' | 'warning'; label: string }> = {
    indexed: { color: 'info', label: 'indexiert' },
    pending: { color: 'warning', label: 'offen' },
    transferred: { color: 'success', label: 'übertragen' },
  };
  const m = map[status] ?? { color: 'info', label: status };
  return <Chip size="small" color={m.color} label={m.label} variant="outlined" />;
}

function problemBadge(f: FileRecord): React.ReactNode {
  if (!f.problems || f.problems.length === 0) return null;
  if (f.problems.some((p) => p.severity === 'error')) return <ErrorOutlineIcon fontSize="small" sx={{ color: 'error.main' }} />;
  if (f.problems.some((p) => p.severity === 'warning')) return <WarningAmberIcon fontSize="small" sx={{ color: 'warning.main' }} />;
  return <InfoOutlinedIcon fontSize="small" sx={{ color: 'info.main' }} />;
}

function MediaTile({ file, size, onClick, onOpenDevice, onMouseEnter, onMouseLeave, renderAction, onOpenInfo }: {
  file: FileRecord;
  size: number;
  onClick: () => void;
  onOpenDevice?: (deviceId: number) => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  renderAction?: (file: FileRecord) => React.ReactNode;
  onOpenInfo?: (file: FileRecord, anchor: HTMLElement) => void;
}) {
  const indicators = (
    <>
      {file.status === 'transferred' && <CheckCircleIcon fontSize="small" sx={{ color: 'success.main', opacity: 0.8 }} />}
      {file.status === 'indexed' && <SearchIcon fontSize="small" sx={{ color: 'info.main', opacity: 0.8 }} />}
      {file.status === 'pending' && <ScheduleIcon fontSize="small" sx={{ color: 'warning.main', opacity: 0.8 }} />}
      {problemBadge(file)}
    </>
  );
  return (
    <Paper
      elevation={1}
      sx={{ p: 0.5, cursor: 'pointer', position: 'relative', '&:hover': { bgcolor: 'action.hover' } }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Box sx={{ position: 'relative' }}>
        <Thumbnail fileId={file.id} fileType={file.fileType} size={size} noDialog />
        <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
          <Tooltip title="Datei-Informationen">
            <Box component="span" onClick={(e) => { e.stopPropagation(); onOpenInfo?.(file, e.currentTarget); }} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, cursor: 'pointer' }}>
              {indicators}
            </Box>
          </Tooltip>
          {renderAction?.(file)}
        </Box>
      </Box>
      <Box sx={{ px: 0.5, pb: 0.5 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="caption" display="block" noWrap title={file.originalName} sx={{ flexGrow: 1 }}>{file.originalName}</Typography>
          {file.isWhatsApp && <Chip size="small" variant="outlined" color="success" label="WA" title="WhatsApp-Datei" sx={{ height: 18, fontSize: 10 }} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block">
          {formatDate(file.takenAt)}
          {file.fileType === 'video' ? ' · Video' : ''}
        </Typography>
        {deviceName(file) && onOpenDevice && file.deviceId != null && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            noWrap
            component="span"
            sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
            onClick={(e) => { e.stopPropagation(); onOpenDevice(file.deviceId!); }}
            title="Alle Bilder dieses Geräts anzeigen"
          >
            {deviceName(file)}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

export function MediaGallery({ files, total, page, onPage, onOpenImage, onOpenDevice, customTile, renderAction, disableHoverPreview, sortKey = 'takenAt', sortDir = 'desc', onSortChange }: {
  files: FileRecord[];
  total?: number;
  page?: number;
  onPage?: (p: number) => void;
  onOpenImage: (id: number) => void;
  onOpenDevice?: (id: number) => void;
  customTile?: (file: FileRecord) => React.ReactNode;
  renderAction?: (file: FileRecord) => React.ReactNode;
  /** Kein Info-Popover bei Hover (Details/Aktionen nur per Status-Icon-Klick). */
  disableHoverPreview?: boolean;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
}) {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<{ file: FileRecord; anchor: HTMLElement } | null>(null);
  const [selected, setSelected] = useState<{ file: FileRecord; anchor: HTMLElement } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHover = (file: FileRecord, anchor: HTMLElement) => {
    if (selected) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover({ file, anchor });
  };
  const hideHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(null), 150);
  };

  const toggleSort = (key: SortKey) => {
    const newDir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    onSortChange?.(key, newDir);
  };

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)}>
          <ToggleButton value="grid" title="Kachelansicht"><GridViewIcon fontSize="small" /></ToggleButton>
          <ToggleButton value="list" title="Listenansicht"><ViewListIcon fontSize="small" /></ToggleButton>
        </ToggleButtonGroup>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Sortieren</InputLabel>
          <Select
            label="Sortieren"
            value={sortKey}
            onChange={(e) => onSortChange?.(e.target.value as SortKey, 'desc')}
          >
            {SORT_OPTIONS.map((o) => <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
        <IconButton size="small" title={sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'} onClick={() => onSortChange?.(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}>
          {sortDir === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
        </IconButton>
        {total != null && <Typography variant="body2" color="text.secondary">{total} gesamt</Typography>}
      </Stack>

      {view === 'grid' ? (
        <Grid container spacing={1.5}>
          {files.map((f, i) => (
            <Grid item key={f.id} xs={6} sm={4} md={3} lg={2}>
              {customTile ? (
                <Box sx={{ cursor: 'pointer' }} onClick={() => setOpenIndex(i)}>
                  {customTile(f)}
                </Box>
              ) : (
                <MediaTile
                  file={f}
                  size={160}
                  onClick={() => setOpenIndex(i)}
                  onOpenDevice={onOpenDevice}
                  onMouseEnter={disableHoverPreview ? undefined : (e) => showHover(f, e.currentTarget)}
                  onMouseLeave={disableHoverPreview ? undefined : hideHover}
                  renderAction={renderAction}
                  onOpenInfo={(file, anchor) => setSelected({ file, anchor })}
                />
              )}
            </Grid>
          ))}
          {files.length === 0 && <Grid item xs={12}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Keine Medien gefunden.</Typography></Grid>}
        </Grid>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Vorschau</TableCell>
                <TableCell sortDirection={sortKey === 'takenAt' ? sortDir : false}>
                  <TableSortLabel active={sortKey === 'takenAt'} direction={sortKey === 'takenAt' ? sortDir : 'asc'} onClick={() => toggleSort('takenAt')}>Datum</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortKey === 'originalName' ? sortDir : false}>
                  <TableSortLabel active={sortKey === 'originalName'} direction={sortKey === 'originalName' ? sortDir : 'asc'} onClick={() => toggleSort('originalName')}>Dateiname</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortKey === 'deviceName' ? sortDir : false}>
                  <TableSortLabel active={sortKey === 'deviceName'} direction={sortKey === 'deviceName' ? sortDir : 'asc'} onClick={() => toggleSort('deviceName')}>Gerät</TableSortLabel>
                </TableCell>
                <TableCell>Typ</TableCell>
                <TableCell align="right" sortDirection={sortKey === 'sourceSize' ? sortDir : false}>
                  <TableSortLabel active={sortKey === 'sourceSize'} direction={sortKey === 'sourceSize' ? sortDir : 'asc'} onClick={() => toggleSort('sourceSize')}>Größe</TableSortLabel>
                </TableCell>
                <TableCell sortDirection={sortKey === 'status' ? sortDir : false}>
                  <TableSortLabel active={sortKey === 'status'} direction={sortKey === 'status' ? sortDir : 'asc'} onClick={() => toggleSort('status')}>Status</TableSortLabel>
                </TableCell>
                <TableCell>Probleme</TableCell>
                {renderAction && <TableCell>Aktion</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {files.map((f, i) => (
                <TableRow key={f.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpenIndex(i)}>
                  <TableCell sx={{ p: 0.5 }}>
                    <Box onClick={(e) => { e.stopPropagation(); setOpenIndex(i); }}>
                      <Thumbnail fileId={f.id} fileType={f.fileType} size={48} noDialog />
                    </Box>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(f.takenAt)}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    <Typography variant="body2" noWrap title={f.originalName}>
                      {f.originalName}
                      {f.isWhatsApp && <Chip size="small" variant="outlined" color="success" label="WA" title="WhatsApp-Datei" sx={{ height: 18, fontSize: 10, ml: 0.75 }} />}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    {deviceName(f) && onOpenDevice && f.deviceId != null ? (
                      <Typography
                        variant="body2"
                        noWrap
                        component="span"
                        title="Alle Bilder dieses Geräts anzeigen"
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                        onClick={(e) => { e.stopPropagation(); onOpenDevice(f.deviceId!); }}
                      >
                        {deviceName(f)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.secondary">–</Typography>
                    )}
                  </TableCell>
                  <TableCell>{f.fileType === 'video' ? 'Video' : 'Bild'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatSize(f.sourceSize)}</TableCell>
                  <TableCell>{statusChip(f.status)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {problemBadge(f)}
                      {f.problems && f.problems.length > 0 && (
                        <Typography variant="caption" color="text.secondary">{f.problems.length}</Typography>
                      )}
                    </Stack>
                  </TableCell>
                  {renderAction && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {renderAction(f)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {files.length === 0 && (
                <TableRow><TableCell colSpan={renderAction ? 9 : 8}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Keine Medien gefunden.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {total != null && total > 120 && page != null && onPage && (
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2 }}>
          <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>Zurück</Button>
          <Typography variant="body2">Seite {page} · {total} gesamt</Typography>
          <Button disabled={page * 120 >= total} onClick={() => onPage(page + 1)}>Weiter</Button>
        </Stack>
      )}

      <Popover
        open={Boolean(hover || selected)}
        anchorEl={hover?.anchor ?? selected?.anchor}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClose={() => { setHover(null); setSelected(null); }}
        onMouseEnter={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
        onMouseLeave={hideHover}
        slotProps={{ paper: { sx: { maxHeight: 480, overflow: 'auto' } } }}
      >
        {(hover ?? selected) && <FileInfoCard file={(hover ?? selected)!.file} />}
      </Popover>

      {openIndex != null && files.length > 0 && (
        <FullscreenGallery
          files={files}
          index={Math.min(openIndex, files.length - 1)}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onOpenDetails={(id) => { setOpenIndex(null); onOpenImage(id); }}
        />
      )}
    </Box>
  );
}

export function FileInfoCard({ file }: { file: FileRecord }) {
  const fmtSize = (bytes: number | null) => bytes == null ? '–' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const fileRows: { key: string; value: string }[] = [];
  fileRows.push({ key: 'Datei', value: file.originalName });
  if (file.fileType) fileRows.push({ key: 'Typ', value: file.fileType === 'video' ? 'Video' : 'Bild' });
  fileRows.push({ key: 'Status', value: file.status });
  if (file.sourceSize != null) fileRows.push({ key: 'Größe', value: fmtSize(file.sourceSize) });
  if (file.sourceMtime != null) fileRows.push({ key: 'Letzte Änderung', value: formatDateTime(new Date(file.sourceMtime).toISOString()) });
  fileRows.push({ key: 'Indexiert', value: formatDateTime(file.createdAt) });
  fileRows.push({ key: 'Quelle', value: `${file.sourceRoot}: ${file.sourceRelPath}` });
  if (file.targetRoot && file.targetRelPath) fileRows.push({ key: 'Ziel', value: `${file.targetRoot}: ${file.targetRelPath}` });

  const metaEntries = Object.entries(file.meta ?? {});

  return (
    <Paper sx={{ p: 1.5, minWidth: 280, maxWidth: 420, maxHeight: 480, overflow: 'auto' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Datei-Informationen</Typography>
      <Stack spacing={0.25} sx={{ mb: metaEntries.length > 0 ? 1.5 : 0 }}>
        {fileRows.map((r) => (
          <Stack key={r.key} direction="row" spacing={1} sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 0.25 }}>
            <Box component="span" sx={{ minWidth: 130, flexShrink: 0, fontWeight: 600, color: 'text.secondary', fontSize: 12 }}>{r.key}</Box>
            <Box component="span" sx={{ wordBreak: 'break-word', fontSize: 12 }}>{r.value}</Box>
          </Stack>
        ))}
      </Stack>
      {metaEntries.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Meta-Informationen (EXIF)</Typography>
          <Stack spacing={0.25}>
            {metaEntries.map(([key, value]) => {
              if (value == null) return null;
              const v = typeof value === 'object' ? JSON.stringify(value) : formatMetaValue(String(value));
              return (
                <Stack key={key} direction="row" spacing={1} sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 0.25 }}>
                  <Box component="span" sx={{ minWidth: 130, flexShrink: 0, fontWeight: 600, color: 'text.secondary', fontSize: 12 }}>{key}</Box>
                  <Box component="span" sx={{ wordBreak: 'break-word', fontSize: 12 }}>{v}</Box>
                </Stack>
              );
            })}
          </Stack>
        </>
      )}
      {file.problems && file.problems.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>Probleme</Typography>
          {file.problems.map((p) => (
            <Stack key={p.id} direction="row" spacing={0.75} alignItems="flex-start">
              <Box component="span" sx={{ minWidth: 130, flexShrink: 0, fontSize: 12 }}>{TYPE_META[p.type]?.label ?? p.type}</Box>
              <Box component="span" sx={{ fontSize: 12 }}>{p.message}</Box>
            </Stack>
          ))}
        </>
      )}
    </Paper>
  );
}