import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardActionArea,
  CardContent,
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
import { MediaGrid, type SortKey, type SortDir } from '../components/MediaGrid';
import type { FileRecord, LibraryGroup } from '../types';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function LibraryPage({ onOpenImage, onOpenDevice }: {
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
}) {
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [type, setType] = useState<string>('');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('takenAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      setGroups(await api.libraryGroups());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.libraryFiles({ year: year ?? undefined, month: month ?? undefined, day: day ?? undefined, type: type || undefined, search: search || undefined, sort: sortKey, sortDir, page, limit: 120 });
      setFiles(res.rows);
      setFilesTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [year, month, day, type, search, page, sortKey, sortDir]);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const navigate = (y: number | null, m: number | null, d: number | null) => {
    setYear(y); setMonth(m); setDay(d); setPage(1);
  };

  const years = [...new Set(groups.map((g) => g.year))];
  const months = year !== null ? [...new Set(groups.filter((g) => g.year === year).map((g) => g.month))] : [];
  const days = year !== null && month !== null ? groups.filter((g) => g.year === year && g.month === month).map((g) => g.day) : [];

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
            <Link component="button" underline="hover" color={!year ? 'text.primary' : 'inherit'} onClick={() => navigate(null, null, null)}>Jahre</Link>
            {year !== null && <Link component="button" underline="hover" color={!month ? 'text.primary' : 'inherit'} onClick={() => navigate(year, null, null)}>{year}</Link>}
            {month !== null && <Link component="button" underline="hover" color={!day ? 'text.primary' : 'inherit'} onClick={() => navigate(year, month, null)}>{MONTH_NAMES[month - 1]}</Link>}
            {day !== null && <Typography color="text.primary">{day}</Typography>}
          </Breadcrumbs>
          <Box sx={{ flexGrow: 1 }} />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Typ</InputLabel>
            <Select value={type} label="Typ" onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <MenuItem value="">Alle</MenuItem>
              <MenuItem value="image">Bilder</MenuItem>
              <MenuItem value="video">Videos</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" label="Suche" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </Stack>
      </Grid>

      <Grid item xs={12}>
        {year === null && <YearGrid years={years} groups={groups} type={type} onPick={(y) => navigate(y, null, null)} />}
        {year !== null && month === null && <MonthGrid year={year} months={months} groups={groups} type={type} onPick={(m) => navigate(year, m, null)} />}
        {year !== null && month !== null && day === null && <DayGrid year={year} month={month} days={days} groups={groups} type={type} onPick={(d) => navigate(year, month, d)} />}
        <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
          {year === null ? 'Alle Medien' : month === null ? `Jahr ${year}` : day === null ? `${MONTH_NAMES[month - 1]} ${year}` : `${day}. ${MONTH_NAMES[month - 1]} ${year}`}
        </Typography>
        <MediaGrid files={files} total={filesTotal} page={page} onPage={setPage} onOpenImage={onOpenImage} onOpenDevice={onOpenDevice} sortKey={sortKey} sortDir={sortDir} onSortChange={(k, d) => { setSortKey(k); setSortDir(d); setPage(1); }} />
      </Grid>
    </Grid>
  );
}

function CountText({ images, videos, type }: { images: number; videos: number; type: string }) {
  if (type === 'image') return <Typography variant="body2" color="text.secondary">{images.toLocaleString('de-DE')} Fotos</Typography>;
  if (type === 'video') return <Typography variant="body2" color="text.secondary">{videos.toLocaleString('de-DE')} Videos</Typography>;
  return <Typography variant="body2" color="text.secondary">{images.toLocaleString('de-DE')} Fotos · {videos.toLocaleString('de-DE')} Videos</Typography>;
}

function YearGrid({ years, groups, type, onPick }: { years: number[]; groups: LibraryGroup[]; type: string; onPick: (y: number) => void }) {
  return (
    <Grid container spacing={2}>
      {years.map((y) => {
        const yearGroups = groups.filter((g) => g.year === y);
        const images = yearGroups.reduce((s, g) => s + (g.images ?? 0), 0);
        const videos = yearGroups.reduce((s, g) => s + (g.videos ?? 0), 0);
        return (
          <Grid item xs={6} sm={4} md={3} key={y}>
            <Card>
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

function MonthGrid({ year, months, groups, type, onPick }: { year: number; months: number[]; groups: LibraryGroup[]; type: string; onPick: (m: number) => void }) {
  return (
    <Grid container spacing={2}>
      {months.map((m) => {
        const monthGroups = groups.filter((g) => g.year === year && g.month === m);
        const images = monthGroups.reduce((s, g) => s + (g.images ?? 0), 0);
        const videos = monthGroups.reduce((s, g) => s + (g.videos ?? 0), 0);
        return (
          <Grid item xs={6} sm={4} md={3} key={m}>
            <Card>
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

function DayGrid({ year, month, days, groups, type, onPick }: { year: number; month: number; days: number[]; groups: LibraryGroup[]; type: string; onPick: (d: number) => void }) {
  return (
    <Grid container spacing={2}>
      {days.map((d) => {
        const g = groups.find((grp) => grp.year === year && grp.month === month && grp.day === d);
        return (
          <Grid item xs={6} sm={4} md={3} key={d}>
            <Card>
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