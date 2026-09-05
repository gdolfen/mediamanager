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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import BlockIcon from '@mui/icons-material/Block';
import FolderOffIcon from '@mui/icons-material/FolderOff';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import PersonIcon from '@mui/icons-material/Person';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '../api/client';
import { useHashRoute } from '../hooks/useHashRoute';
import { useActivity } from '../hooks/useActivity';
import { MediaGallery, FileInfoCard, type SortKey, type SortDir } from '../components/MediaGallery';
import { Thumbnail } from '../components/Thumbnail';
import { RescanButton } from '../components/RescanButton';
import { deviceName as fileDeviceName } from '../components/MediaGallery';
import { formatDate } from '../utils/date';
import type { FileRecord, FileStatus, RescanInput, UploadGroup, IgnoredItem } from '../types';
import type { PageKey } from '../components/Layout';

type ViewLevel = 'persons' | 'devices' | 'years' | 'files';

function statusIcon(status: FileStatus) {
  switch (status) {
    case 'transferred': return <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />;
    case 'indexed': return <HourglassEmptyIcon fontSize="small" sx={{ color: 'info.main' }} />;
    case 'pending': return <HourglassEmptyIcon fontSize="small" sx={{ color: 'warning.main' }} />;
  }
}

export function UploadPage({ onOpenImage, onOpenDevice, onNavigate }: {
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onNavigate: (p: PageKey) => void;
}) {
  const [, hashParams, setHash] = useHashRoute();

  const selectedPerson = hashParams.person || null;
  const selectedDeviceKey = hashParams.device || null;
  const selectedYear = hashParams.year || null;
  const level: ViewLevel = !selectedPerson ? 'persons' : !selectedDeviceKey ? 'devices' : !selectedYear ? 'years' : 'files';

  const [groups, setGroups] = useState<UploadGroup[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  // Filter-State wird direkt aus der URL abgeleitet (Single Source of Truth),
  // damit Filter-Klicks und Deep-Links die UI sofort aktualisieren.
  const page = Number(hashParams.page) || 1;
  const type = hashParams.type || '';
  const status = hashParams.status || '';
  const search = hashParams.search || '';
  const showIgnored = hashParams.ignored === '1';
  const sortKey = (hashParams.sort as SortKey) || 'takenAt';
  const sortDir = (hashParams.sortDir as SortDir) || 'desc';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ignoredDialog, setIgnoredDialog] = useState(false);
  const [ignoredItems, setIgnoredItems] = useState<IgnoredItem[]>([]);
  const [transferTarget, setTransferTarget] = useState<FileRecord | null>(null);
  const busy = useActivity();

  const updateHash = useCallback((updates: Record<string, string | undefined>) => {
    const current: Record<string, string> = {};
    hashParams && Object.assign(current, hashParams);
    Object.assign(current, updates);
    Object.keys(current).forEach(k => { if (current[k] === '' || current[k] === undefined) delete current[k]; });
    setHash('upload', current);
  }, [hashParams, setHash]);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const common = {
        status: status || undefined,
        type: type || undefined,
        search: search || undefined,
      };
      if (level === 'persons') {
        setGroups(await api.uploadGroups(1, common));
      } else if (level === 'devices') {
        setGroups(await api.uploadGroups(2, { person: selectedPerson || undefined, ...common }));
      } else if (level === 'years') {
        setGroups(await api.uploadGroups(3, {
          person: selectedPerson || undefined,
          deviceKey: selectedDeviceKey || undefined,
          ...common,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [level, selectedPerson, selectedDeviceKey, status, type, search]);

  const filterActive = Boolean(status || type || search);
  const visibleGroups = filterActive ? groups.filter((g) => g.count > 0) : groups;
  const rescanFilters = { status: status || undefined, type: type || undefined, search: search || undefined };

  const loadFiles = useCallback(async () => {
    if (level !== 'files') return;
    try {
      setLoading(true);
      const res = await api.listFiles({
        sourceRoot: 'upload',
        status: status ? status as FileStatus : undefined,
        type: type || undefined,
        search: search || undefined,
        includeIgnored: showIgnored,
        excludeUnsupported: true,
        year: selectedYear && selectedYear !== 'Unbekannt' ? Number(selectedYear) : undefined,
        yearNull: selectedYear === 'Unbekannt' ? true : undefined,
        person: selectedPerson || undefined,
        deviceKey: selectedDeviceKey || undefined,
        sort: sortKey,
        sortDir,
        page,
        limit: 120,
      });
      setFiles(res.rows);
      setFilesTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [level, selectedYear, selectedPerson, selectedDeviceKey, status, type, search, page, showIgnored, sortKey, sortDir]);

  useEffect(() => { if (level !== 'files') loadGroups(); }, [loadGroups, level]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Navigation erhält aktive Filter (status/type/search/sort) – nur die
  // Navigationsebene und Seite werden angepasst.
  const navigatePersons = () => updateHash({ person: undefined, device: undefined, year: undefined, page: undefined });

  const navigateDevices = (person: string) => updateHash({ person, device: undefined, year: undefined, page: undefined });

  const navigateYears = (_person: string, deviceKey: string) => updateHash({ person: selectedPerson || undefined, device: deviceKey, year: undefined, page: undefined });

  const navigateFiles = (_person: string, _deviceKey: string, year: string) => updateHash({ person: selectedPerson || undefined, device: selectedDeviceKey || undefined, year, page: '1' });

  const navigateWithFilters = (updates: Record<string, string | undefined>) => {
    updateHash({ ...updates, page: '1' });
  };

  const loadIgnored = async () => {
    try { setIgnoredItems(await api.ignored()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

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

  const handleToggleIgnoreFile = async (path: string) => {
    try { await api.toggleIgnoreFile(path); loadFiles(); loadGroups(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const breadcrumbs = [
    <Link key="root" component="button" underline="hover" color={level === 'persons' ? 'text.primary' : 'inherit'} onClick={navigatePersons}>Personen</Link>,
  ];
  if (selectedPerson) {
    breadcrumbs.push(
      <Link key="person" component="button" underline="hover" color={level === 'devices' ? 'text.primary' : 'inherit'} onClick={() => navigateDevices(selectedPerson)}>{selectedPerson}</Link>
    );
  }
  if (selectedDeviceKey) {
    const deviceLabel = groups.find((g) => g.key === selectedDeviceKey)?.label ?? selectedDeviceKey;
    breadcrumbs.push(
      <Link key="device" component="button" underline="hover" color={level === 'years' ? 'text.primary' : 'inherit'} onClick={() => navigateYears(selectedPerson!, selectedDeviceKey)}>{deviceLabel}</Link>
    );
  }
  if (selectedYear) {
    breadcrumbs.push(<Typography key="year" color="text.primary">{selectedYear}</Typography>);
  }

  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" gutterBottom>Upload</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<FolderOffIcon />} onClick={() => { loadIgnored(); setIgnoredDialog(true); }}>
              Ignorierte
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => { loadGroups(); loadFiles(); }}>
              Aktualisieren
            </Button>
          </Stack>
        </Stack>
      </Grid>

      {error && <Grid item xs={12}><Alert severity="error" onClose={() => setError(null)}>{error}</Alert></Grid>}

      {loading && <Grid item xs={12}><Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box></Grid>}

      <Grid item xs={12}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}>{breadcrumbs}</Breadcrumbs>
          <Box sx={{ flexGrow: 1 }} />
          <Chip size="small" label="Alle" color={status === '' ? 'primary' : 'default'} onClick={() => navigateWithFilters({ status: '' })} />
          <Chip size="small" label="Indexiert" color={status === 'indexed' ? 'primary' : 'default'} onClick={() => navigateWithFilters({ status: 'indexed' })} />
          <Chip size="small" label="Offen" color={status === 'pending' ? 'warning' : 'default'} onClick={() => navigateWithFilters({ status: 'pending' })} />
          <Chip size="small" label="Übertragen" color={status === 'transferred' ? 'success' : 'default'} onClick={() => navigateWithFilters({ status: 'transferred' })} />
          {level === 'files' && (
            <>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Typ</InputLabel>
                <Select value={type} label="Typ" onChange={(e) => navigateWithFilters({ type: e.target.value })}>
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="image">Bilder</MenuItem>
                  <MenuItem value="video">Videos</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" label="Suche" value={search} onChange={(e) => navigateWithFilters({ search: e.target.value })} sx={{ minWidth: 160 }} />
              <Tooltip title={showIgnored ? 'Ignorierte anzeigen' : 'Ignorierte ausblenden'}>
                <IconButton onClick={() => updateHash({ ignored: showIgnored ? undefined : '1', page: '1' })}>
                  {showIgnored ? <VisibilityIcon /> : <VisibilityOffIcon />}
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      </Grid>

      <Grid item xs={12}>
        {level === 'persons' && (
          <GroupGrid
            groups={visibleGroups}
            icon={<PersonIcon />}
            emptyText="Noch keine Dateien im Upload-Ordner. Führe zuerst einen Upload-Scan durch."
            onPick={(key) => navigateDevices(key)}
            rescanDisabled={busy}
            onRescan={(key) => startRescan({ upload: { person: key, ...rescanFilters } })}
            rescanTitle={(g) => `Alle Dateien von ${g.label} erneut scannen`}
          />
        )}
        {level === 'devices' && (
          <GroupGrid
            groups={visibleGroups}
            icon={<PhotoCameraIcon />}
            emptyText="Keine Geräte für diese Person gefunden."
            onPick={(key) => navigateYears(selectedPerson!, key)}
            rescanDisabled={busy}
            onRescan={(key) => startRescan({ upload: { person: selectedPerson!, deviceKey: key, ...rescanFilters } })}
            rescanTitle={(g) => `Alle Dateien von ${g.label} erneut scannen`}
          />
        )}
        {level === 'years' && (
          <GroupGrid
            groups={visibleGroups}
            icon={<CalendarMonthIcon />}
            emptyText="Keine Jahre für dieses Gerät gefunden."
            onPick={(key) => navigateFiles(selectedPerson!, selectedDeviceKey!, key)}
            rescanDisabled={busy}
            onRescan={(key) => startRescan({ upload: { person: selectedPerson!, deviceKey: selectedDeviceKey!, ...(key === 'Unbekannt' ? { yearNull: true } : { year: Number(key) }), ...rescanFilters } })}
            rescanTitle={(g) => `Alle Dateien von ${g.label} erneut scannen`}
          />
        )}
        {level === 'files' && (
          <MediaGallery
            files={files}
            total={filesTotal}
            page={page}
            onPage={(p) => updateHash({ page: String(p) })}
            onOpenImage={onOpenImage}
            onOpenDevice={onOpenDevice}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={(k, d) => updateHash({ sort: k, sortDir: d, page: '1' })}
            customTile={(file) => (
              <UploadMediaTile
                file={file}
                onOpenImage={onOpenImage}
                onOpenDevice={onOpenDevice}
                onToggleIgnore={handleToggleIgnoreFile}
                onTransfer={setTransferTarget}
                rescanDisabled={busy}
                onRescanFile={(id) => startRescan({ fileIds: [id] })}
              />
            )}
          />
        )}
      </Grid>

      <Dialog open={ignoredDialog} onClose={() => setIgnoredDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Ignorierte Ordner & Dateien</DialogTitle>
        <DialogContent>
          {ignoredItems.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>Keine ignorierten Elemente.</Typography>
          ) : (
            <List dense>
              {ignoredItems.map((item) => (
                <ListItem key={item.id} secondaryAction={
                  <Button size="small" onClick={() => {
                    if (item.scope === 'file') handleToggleIgnoreFile(item.path);
                    else { api.toggleIgnoreFolder(item.path).then(() => loadFiles()).catch(() => {}); }
                    setIgnoredItems((prev) => prev.filter((i) => i.id !== item.id));
                  }}>Entfernen</Button>
                }>
                  <ListItemIcon>{item.scope === 'folder' ? <FolderOffIcon /> : <BlockIcon />}</ListItemIcon>
                  <ListItemText primary={item.path} secondary={item.scope === 'folder' ? 'Ordner' : 'Datei'} />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIgnoredDialog(false)}>Schließen</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!transferTarget} onClose={() => setTransferTarget(null)} maxWidth="xs">
        <DialogTitle>Übernahme starten</DialogTitle>
        <DialogContent>
          <Typography>Möchtest du „{transferTarget?.originalName}" in die Bibliothek übernehmen?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTransferTarget(null)}>Abbrechen</Button>
          <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => setTransferTarget(null)}>Übernehmen</Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}

function GroupGrid({ groups, icon, emptyText, onPick, rescanDisabled, onRescan, rescanTitle }: {
  groups: UploadGroup[];
  icon: React.ReactNode;
  emptyText: string;
  onPick: (key: string) => void;
  rescanDisabled?: boolean;
  onRescan?: (key: string) => void;
  rescanTitle?: (group: UploadGroup) => string;
}) {
  return (
    <Grid container spacing={2}>
      {groups.map((g) => (
        <Grid item xs={6} sm={4} md={3} key={g.key}>
          <Card sx={{ position: 'relative' }}>
            {onRescan && (
              <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
                <RescanButton title={rescanTitle?.(g) ?? `Alle Dateien von ${g.label} erneut scannen`} disabled={rescanDisabled} onRescan={() => onRescan(g.key)} />
              </Box>
            )}
            <CardActionArea onClick={() => onPick(g.key)}>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center">
                  {icon}
                  <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>{g.label}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" noWrap title={g.path} sx={{ mt: 0.5 }}>
                  {g.path}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                  {g.images > 0 && <Chip size="small" label={`${g.images} Fotos`} color="primary" variant="outlined" />}
                  {g.videos > 0 && <Chip size="small" label={`${g.videos} Videos`} color="secondary" variant="outlined" />}
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
      {groups.length === 0 && (
        <Grid item xs={12}>
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>{emptyText}</Typography>
        </Grid>
      )}
    </Grid>
  );
}

function UploadMediaTile({ file, onOpenImage, onOpenDevice, onToggleIgnore, onTransfer, rescanDisabled, onRescanFile }: {
  file: FileRecord;
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onToggleIgnore: (path: string) => void;
  onTransfer: (file: FileRecord) => void;
  rescanDisabled?: boolean;
  onRescanFile?: (id: number) => void;
}) {
  const dName = fileDeviceName(file);
  const [infoAnchor, setInfoAnchor] = useState<HTMLElement | null>(null);
  return (
    <Paper elevation={1} sx={{ p: 0.5, cursor: 'pointer', position: 'relative', '&:hover': { bgcolor: 'action.hover' } }}>
      <Box sx={{ position: 'relative' }}>
        <Thumbnail fileId={file.id} fileType={file.fileType} size={160} noDialog />
        <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Tooltip title="Datei-Informationen">
            <Box component="span" onClick={(e) => { e.stopPropagation(); setInfoAnchor(e.currentTarget); }} sx={{ cursor: 'pointer', display: 'flex', opacity: 0.9 }}>
              {statusIcon(file.status)}
            </Box>
          </Tooltip>
          {onRescanFile && (
            <RescanButton title="Datei erneut scannen" disabled={rescanDisabled} onRescan={() => onRescanFile(file.id)} />
          )}
          {file.status === 'pending' && (
            <Tooltip title="In Bibliothek übernehmen">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onTransfer(file); }} sx={{ padding: '3px', bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }}>
                <PlayArrowIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Datei ignorieren">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onToggleIgnore(file.sourceRelPath); }} sx={{ padding: '3px', bgcolor: 'rgba(0,0,0,0.5)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}>
              <BlockIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
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
        {dName && file.deviceId != null && (
          <Typography
            variant="caption" color="text.secondary" display="block" noWrap component="span"
            sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
            onClick={(e) => { e.stopPropagation(); onOpenDevice(file.deviceId!); }}
          >{dName}</Typography>
        )}
      </Box>
      <Popover
        open={Boolean(infoAnchor)}
        anchorEl={infoAnchor}
        onClose={() => setInfoAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxHeight: 480, overflow: 'auto' } } }}
      >
        <FileInfoCard file={file} />
      </Popover>
    </Paper>
  );
}
