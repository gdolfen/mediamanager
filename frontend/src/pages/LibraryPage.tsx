import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../api/client';
import { useHashRoute } from '../hooks/useHashRoute';
import { useActivity } from '../hooks/useActivity';
import { RescanButton } from '../components/RescanButton';
import { MediaGrid, type SortKey, type SortDir } from '../components/MediaGrid';
import type { FileRecord, LibraryGroup, RescanInput } from '../types';
import type { PageKey } from '../components/Layout';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function LibraryPage({ onOpenImage, onOpenDevice, onNavigate }: {
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onNavigate: (p: PageKey) => void;
}) {
  const [, hashParams, setHash] = useHashRoute();

  const year = hashParams.year ? Number(hashParams.year) : null;
  const month = hashParams.month ? Number(hashParams.month) : null;
  const day = hashParams.day ? Number(hashParams.day) : null;
  const noYear = hashParams.noYear === '1';

  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  // Filter-State wird direkt aus der URL abgeleitet (Single Source of Truth).
  const type = hashParams.type || '';
  const status = hashParams.status || '';
  const search = hashParams.search || '';
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const page = Number(hashParams.page) || 1;
  const sortKey = (hashParams.sort as SortKey) || 'takenAt';
  const sortDir = (hashParams.sortDir as SortDir) || 'desc';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useActivity();

  const updateHash = useCallback((updates: Record<string, string | number | undefined>) => {
    const current: Record<string, string | number> = {};
    hashParams && Object.assign(current, hashParams);
    Object.assign(current, updates);
    Object.keys(current).forEach(k => {
      const v = (current as Record<string, unknown>)[k];
      if (v === '' || v === undefined || v === null) delete (current as Record<string, unknown>)[k];
    });
    setHash('library', current);
  }, [hashParams, setHash]);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      setGroups(await api.libraryGroups({ status: status || undefined, type: type || undefined, search: search || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, type, search]);

  const filterActive = Boolean(status || type || search);
  const visibleGroups = filterActive ? groups.filter((g) => g.count > 0) : groups;
  const rescanFilters = { status: status || undefined, type: type || undefined, search: search || undefined };

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.libraryFiles({ year: year ?? undefined, yearNull: noYear || undefined, month: month ?? undefined, day: day ?? undefined, type: type || undefined, status: status || undefined, search: search || undefined, sort: sortKey, sortDir, page, limit: 120 });
      setFiles(res.rows);
      setFilesTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [year, month, day, noYear, type, status, search, page, sortKey, sortDir]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const navigateTo = (y: number | null, m: number | null, d: number | null) => {
    const updates: Record<string, string | number | undefined> = {};
    updates.year = y !== null ? y : undefined;
    updates.month = m !== null ? m : undefined;
    updates.day = d !== null ? d : undefined;
    updates.noYear = undefined;
    updates.page = 1;
    updateHash(updates);
  };

  const navigateNoYear = () => updateHash({ noYear: '1', page: 1 });

  const startRescan = async (input: RescanInput) => {
    try {
      const res = await api.startRescan(input);
      if (!res.ok) {
        setError(res.error ?? 'Erneuter Scan konnte nicht gestartet werden.');
        return;
      }
      onNavigate('actions');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const navigateWithFilters = (updates: Record<string, string | number | undefined>) => {
    updateHash({ ...updates, page: 1 });
  };

  const years = [...new Set(visibleGroups.filter((g) => g.year !== 0).map((g) => g.year))];
  const noYearGroup = visibleGroups.find((g) => g.year === 0);
  const months = year !== null ? [...new Set(visibleGroups.filter((g) => g.year === year).map((g) => g.month))] : [];
  const days = year !== null && month !== null ? visibleGroups.filter((g) => g.year === year && g.month === month).map((g) => g.day) : [];

  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" gutterBottom>Medienbibliothek</Typography>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { loadGroups(); loadFiles(); }}>Aktualisieren</Button>
        </Stack>
      </Grid>

      {error && <Grid item xs={12}><Alert severity="error" onClose={() => setError(null)}>{error}</Alert></Grid>}

      {loading && <Grid item xs={12}><Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box></Grid>}

      <Grid item xs={12}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Breadcrumbs>
            <Link component="button" underline="hover" color={!year ? 'text.primary' : 'inherit'} onClick={() => navigateTo(null, null, null)}>Jahre</Link>
            {year !== null && <Link component="button" underline="hover" color={!month ? 'text.primary' : 'inherit'} onClick={() => navigateTo(year, null, null)}>{year}</Link>}
            {month !== null && <Link component="button" underline="hover" color={!day ? 'text.primary' : 'inherit'} onClick={() => navigateTo(year, month, null)}>{MONTH_NAMES[month - 1]}</Link>}
            {day !== null && <Typography color="text.primary">{day}</Typography>}
            {noYear && <Typography color="text.primary">Sonstige</Typography>}
          </Breadcrumbs>
          <Box sx={{ flexGrow: 1 }} />
          <Chip size="small" label="Alle" color={status === '' ? 'primary' : 'default'} onClick={() => navigateWithFilters({ status: '' })} />
          <Chip size="small" label="Indexiert" color={status === 'indexed' ? 'primary' : 'default'} onClick={() => navigateWithFilters({ status: 'indexed' })} />
          <Chip size="small" label="Offen" color={status === 'pending' ? 'warning' : 'default'} onClick={() => navigateWithFilters({ status: 'pending' })} />
          <Chip size="small" label="Übertragen" color={status === 'transferred' ? 'success' : 'default'} onClick={() => navigateWithFilters({ status: 'transferred' })} />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Typ</InputLabel>
            <Select value={type} label="Typ" onChange={(e) => navigateWithFilters({ type: e.target.value })}>
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="image">Bilder</MenuItem>
              <MenuItem value="video">Videos</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" label="Suche" value={search} onChange={(e) => navigateWithFilters({ search: e.target.value })} />
        </Stack>
      </Grid>

      <Grid item xs={12}>
        {year === null && !noYear && <YearGrid years={years} groups={visibleGroups} type={type} onPick={(y) => navigateTo(y, null, null)} rescanDisabled={busy} onRescan={(y) => startRescan({ library: { year: y, ...rescanFilters } })} />}
        {year === null && !noYear && noYearGroup && (noYearGroup.count ?? 0) > 0 && (
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={6} sm={4} md={3}>
              <Card sx={{ position: 'relative' }}>
                <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                    <RescanButton title="Alle Dateien ohne Jahr erneut scannen" disabled={busy} onRescan={() => startRescan({ library: { yearNull: true, ...rescanFilters } })} />
                </Box>
                <CardActionArea onClick={navigateNoYear}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight={600}>Sonstige</Typography>
                    <CountText images={noYearGroup.images ?? 0} videos={noYearGroup.videos ?? 0} type={type} />
                    <Typography variant="caption" color="text.secondary">ohne Jahr</Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          </Grid>
        )}
        {year !== null && month === null && <MonthGrid year={year} months={months} groups={visibleGroups} type={type} onPick={(m) => navigateTo(year, m, null)} rescanDisabled={busy} onRescan={(m) => startRescan({ library: { year, month: m, ...rescanFilters } })} />}
        {year !== null && month !== null && day === null && <DayGrid year={year} month={month} days={days} groups={visibleGroups} type={type} onPick={(d) => navigateTo(year, month, d)} rescanDisabled={busy} onRescan={(d) => startRescan({ library: { year, month, day: d, ...rescanFilters } })} />}
        <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
          {noYear ? 'Sonstige (ohne Jahr)' : year === null ? 'Alle Medien' : month === null ? `Jahr ${year}` : day === null ? `${MONTH_NAMES[month - 1]} ${year}` : `${day}. ${MONTH_NAMES[month - 1]} ${year}`}
        </Typography>
        <MediaGrid files={files} total={filesTotal} page={page} onPage={(p) => updateHash({ page: p })} onOpenImage={onOpenImage} onOpenDevice={onOpenDevice} sortKey={sortKey} sortDir={sortDir} onSortChange={(k, d) => updateHash({ sort: k, sortDir: d, page: 1 })} disableHoverPreview renderAction={(f) => <RescanButton title="Datei erneut scannen" disabled={busy} onRescan={() => startRescan({ fileIds: [f.id] })} />} />
      </Grid>
    </Grid>
  );
}

function CountText({ images, videos, type }: { images: number; videos: number; type: string }) {
  if (type === 'image') return <Typography variant="body2" color="text.secondary">{images.toLocaleString('de-DE')} Fotos</Typography>;
  if (type === 'video') return <Typography variant="body2" color="text.secondary">{videos.toLocaleString('de-DE')} Videos</Typography>;
  return <Typography variant="body2" color="text.secondary">{images.toLocaleString('de-DE')} Fotos · {videos.toLocaleString('de-DE')} Videos</Typography>;
}

function YearGrid({ years, groups, type, onPick, rescanDisabled, onRescan }: { years: number[]; groups: LibraryGroup[]; type: string; onPick: (y: number) => void; rescanDisabled?: boolean; onRescan?: (y: number) => void }) {
  return (
    <Grid container spacing={2}>
      {years.map((y) => {
        const yearGroups = groups.filter((g) => g.year === y);
        const images = yearGroups.reduce((s, g) => s + (g.images ?? 0), 0);
        const videos = yearGroups.reduce((s, g) => s + (g.videos ?? 0), 0);
        return (
          <Grid item xs={6} sm={4} md={3} key={y}>
            <Card sx={{ position: 'relative' }}>
              {onRescan && (
                <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                  <RescanButton title={`Alle Dateien aus ${y} erneut scannen`} disabled={rescanDisabled} onRescan={() => onRescan(y)} />
                </Box>
              )}
              <CardActionArea onClick={() => onPick(y)}>
                <CardContent>
                  <Typography variant="h3" sx={{ fontWeight: 700 }}>{y}</Typography>
                  <CountText images={images} videos={videos} type={type} />
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
      {years.length === 0 && <Grid item xs={12}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Noch keine Medien in der Bibliothek. Führe zuerst einen Zielordner-Scan durch.</Typography></Grid>}
    </Grid>
  );
}

function MonthGrid({ year, months, groups, type, onPick, rescanDisabled, onRescan }: { year: number; months: number[]; groups: LibraryGroup[]; type: string; onPick: (m: number) => void; rescanDisabled?: boolean; onRescan?: (m: number) => void }) {
  return (
    <Grid container spacing={2}>
      {months.map((m) => {
        const monthGroups = groups.filter((g) => g.year === year && g.month === m);
        const images = monthGroups.reduce((s, g) => s + (g.images ?? 0), 0);
        const videos = monthGroups.reduce((s, g) => s + (g.videos ?? 0), 0);
        return (
          <Grid item xs={6} sm={4} md={3} key={m}>
            <Card sx={{ position: 'relative' }}>
              {onRescan && (
                <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                  <RescanButton title={`Alle Dateien aus ${MONTH_NAMES[m - 1]} ${year} erneut scannen`} disabled={rescanDisabled} onRescan={() => onRescan(m)} />
                </Box>
              )}
              <CardActionArea onClick={() => onPick(m)}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight={600}>{MONTH_NAMES[m - 1]}</Typography>
                  <CountText images={images} videos={videos} type={type} />
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
      {months.length === 0 && <Grid item xs={12}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Keine Medien in diesem Jahr.</Typography></Grid>}
    </Grid>
  );
}

function DayGrid({ year, month, days, groups, type, onPick, rescanDisabled, onRescan }: { year: number; month: number; days: number[]; groups: LibraryGroup[]; type: string; onPick: (d: number) => void; rescanDisabled?: boolean; onRescan?: (d: number) => void }) {
  return (
    <Grid container spacing={2}>
      {days.map((d) => {
        const g = groups.find((grp) => grp.year === year && grp.month === month && grp.day === d);
        return (
          <Grid item xs={6} sm={4} md={3} key={d}>
            <Card sx={{ position: 'relative' }}>
              {onRescan && (
                <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                  <RescanButton title={`Alle Dateien vom ${d}. ${MONTH_NAMES[month - 1]} ${year} erneut scannen`} disabled={rescanDisabled} onRescan={() => onRescan(d)} />
                </Box>
              )}
              <CardActionArea onClick={() => onPick(d)}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight={700}>{d}.</Typography>
                  <Typography variant="body2">{MONTH_NAMES[month - 1]} {year}</Typography>
                  <CountText images={g?.images ?? 0} videos={g?.videos ?? 0} type={type} />
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        );
      })}
      {days.length === 0 && <Grid item xs={12}><Typography color="text.secondary" align="center" sx={{ py: 4 }}>Keine Medien in diesem Monat.</Typography></Grid>}
    </Grid>
  );
}
