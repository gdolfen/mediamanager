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
import { MediaGallery } from '../components/MediaGallery';
import { Thumbnail } from '../components/Thumbnail';
import { deviceName as fileDeviceName } from '../components/MediaGallery';
import { formatDate } from '../utils/date';
import type { FileRecord, FileStatus, UploadGroup, IgnoredItem } from '../types';

type ViewLevel = 'persons' | 'devices' | 'years' | 'files';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Bereit',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  aborted: 'Abgebrochen',
};

function statusIcon(status: FileStatus) {
  switch (status) {
    case 'transferred': return <CheckCircleIcon fontSize="small" sx={{ color: 'success.main' }} />;
    case 'indexed': return <HourglassEmptyIcon fontSize="small" sx={{ color: 'info.main' }} />;
    case 'pending': return <HourglassEmptyIcon fontSize="small" sx={{ color: 'warning.main' }} />;
  }
}

export function UploadPage({ onOpenImage, onOpenDevice }: {
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
}) {
  const [level, setLevel] = useState<ViewLevel>('persons');
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  const [groups, setGroups] = useState<UploadGroup[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoredDialog, setIgnoredDialog] = useState(false);
  const [ignoredItems, setIgnoredItems] = useState<IgnoredItem[]>([]);
  const [transferTarget, setTransferTarget] = useState<FileRecord | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      if (level === 'persons') {
        setGroups(await api.uploadGroups(1));
      } else if (level === 'devices') {
        setGroups(await api.uploadGroups(2, selectedPerson ? { person: selectedPerson } : undefined));
      } else if (level === 'years') {
        setGroups(await api.uploadGroups(3, {
          person: selectedPerson || undefined,
          deviceKey: selectedDeviceKey || undefined,
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [level, selectedPerson, selectedDeviceKey]);

  const loadFiles = useCallback(async () => {
    if (level !== 'files') return;
    try {
      const res = await api.listFiles({
        sourceRoot: 'upload',
        status: status ? status as FileStatus : undefined,
        type: type || undefined,
        search: search || undefined,
        includeIgnored: showIgnored,
        year: selectedYear && selectedYear !== 'Unbekannt' ? Number(selectedYear) : undefined,
        yearNull: selectedYear === 'Unbekannt' ? true : undefined,
        person: selectedPerson || undefined,
        deviceKey: selectedDeviceKey || undefined,
        page,
        limit: 120,
      });
      setFiles(res.rows);
      setFilesTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [level, selectedYear, selectedPerson, selectedDeviceKey, status, type, search, page, showIgnored]);

  useEffect(() => { if (level !== 'files') loadGroups(); }, [loadGroups, level]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  const navigatePersons = () => {
    setLevel('persons');
    setSelectedPerson(null);
    setSelectedDeviceKey(null);
    setSelectedYear(null);
    setPage(1);
    setType('');
    setStatus('');
    setSearch('');
  };

  const navigateDevices = (person: string) => {
    setLevel('devices');
    setSelectedPerson(person);
    setSelectedDeviceKey(null);
    setSelectedYear(null);
    setPage(1);
    setType('');
    setStatus('');
    setSearch('');
  };

  const navigateYears = (person: string, deviceKey: string) => {
    setLevel('years');
    setSelectedPerson(person);
    setSelectedDeviceKey(deviceKey);
    setSelectedYear(null);
    setPage(1);
    setType('');
    setStatus('');
    setSearch('');
  };

  const navigateFiles = (person: string, deviceKey: string, year: string) => {
    setLevel('files');
    setSelectedPerson(person);
    setSelectedDeviceKey(deviceKey);
    setSelectedYear(year);
    setPage(1);
    setType('');
    setStatus('');
    setSearch('');
  };

  const loadIgnored = async () => {
    try { setIgnoredItems(await api.ignored()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const handleToggleIgnoreFile = async (path: string) => {
    try { await api.toggleIgnoreFile(path); loadFiles(); loadGroups(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const handleToggleIgnoreFolder = async (path: string) => {
    try { await api.toggleIgnoreFolder(path); loadFiles(); loadGroups(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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

      <Grid item xs={12}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}>{breadcrumbs}</Breadcrumbs>
          <Box sx={{ flexGrow: 1 }} />
          {level === 'files' && (
            <>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>Typ</InputLabel>
                <Select value={type} label="Typ" onChange={(e) => { setType(e.target.value); setPage(1); }}>
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="image">Bilder</MenuItem>
                  <MenuItem value="video">Videos</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Status</InputLabel>
                <Select value={status} label="Status" onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="indexed">indexiert</MenuItem>
                  <MenuItem value="pending">offen</MenuItem>
                  <MenuItem value="transferred">übertragen</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" label="Suche" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} sx={{ minWidth: 160 }} />
              <Tooltip title={showIgnored ? 'Ignorierte anzeigen' : 'Ignorierte ausblenden'}>
                <IconButton onClick={() => { setShowIgnored(!showIgnored); setPage(1); }}>
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
            groups={groups}
            icon={<PersonIcon />}
            emptyText="Noch keine Dateien im Upload-Ordner. Führe zuerst einen Upload-Scan durch."
            onPick={(key) => navigateDevices(key)}
          />
        )}
        {level === 'devices' && (
          <GroupGrid
            groups={groups}
            icon={<PhotoCameraIcon />}
            emptyText="Keine Geräte für diese Person gefunden."
            onPick={(key) => navigateYears(selectedPerson!, key)}
          />
        )}
        {level === 'years' && (
          <GroupGrid
            groups={groups}
            icon={<CalendarMonthIcon />}
            emptyText="Keine Jahre für dieses Gerät gefunden."
            onPick={(key) => navigateFiles(selectedPerson!, selectedDeviceKey!, key)}
          />
        )}
        {level === 'files' && (
          <MediaGallery
            files={files}
            total={filesTotal}
            page={page}
            onPage={setPage}
            onOpenImage={onOpenImage}
            onOpenDevice={onOpenDevice}
            customTile={(file) => (
              <UploadMediaTile
                file={file}
                onOpenImage={onOpenImage}
                onOpenDevice={onOpenDevice}
                onToggleIgnore={handleToggleIgnoreFile}
                onTransfer={setTransferTarget}
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
                    else handleToggleIgnoreFolder(item.path);
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

function GroupGrid({ groups, icon, emptyText, onPick }: {
  groups: UploadGroup[];
  icon: React.ReactNode;
  emptyText: string;
  onPick: (key: string) => void;
}) {
  return (
    <Grid container spacing={2}>
      {groups.map((g) => (
        <Grid item xs={6} sm={4} md={3} key={g.key}>
          <Card>
            <CardActionArea onClick={() => onPick(g.key)}>
              <CardContent>
                <Stack direction="row" spacing={1} alignItems="center">
                  {icon}
                  <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0 }} noWrap>{g.label}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" noWrap title={g.path} sx={{ mt: 0.5 }}>
                  {g.path}
                </Typography>
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

function UploadMediaTile({ file, onOpenImage, onOpenDevice, onToggleIgnore, onTransfer }: {
  file: FileRecord;
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onToggleIgnore: (path: string) => void;
  onTransfer: (file: FileRecord) => void;
}) {
  const dName = fileDeviceName(file);
  return (
    <Paper elevation={1} sx={{ p: 0.5, cursor: 'pointer', position: 'relative', '&:hover': { bgcolor: 'action.hover' } }}>
      <Box sx={{ position: 'relative' }}>
        <Thumbnail fileId={file.id} fileType={file.fileType} size={160} noDialog />
        <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.5 }}>
          {statusIcon(file.status)}
          {file.status === 'pending' && (
            <Tooltip title="In Bibliothek übernehmen">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onTransfer(file); }} sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }}>
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Datei ignorieren">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onToggleIgnore(file.sourceRelPath); }} sx={{ bgcolor: 'rgba(0,0,0,0.5)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}>
              <BlockIcon fontSize="small" />
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
    </Paper>
  );
}
