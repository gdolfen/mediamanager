import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DevicesIcon from '@mui/icons-material/Devices';
import { api, mediaUrl } from '../api/client';
import { RescanButton } from '../components/RescanButton';
import { MediaGrid, FileInfoCard } from '../components/MediaGrid';
import { deviceDisplayName } from './DevicesPage';
import type { Device, FileRecord, RescanInput } from '../types';
import type { PageKey } from '../components/Layout';

function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1 }}>
      {label}
    </Button>
  );
}

export function FormatPage({ ext, onBack, onOpenImage, onOpenDevice, onNavigate }: {
  ext: string;
  onBack: () => void;
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onNavigate: (p: PageKey) => void;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listFiles({ ext, page, limit: 120 });
      setFiles(res.rows);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [ext, page]);

  useEffect(() => { load(); }, [load]);

  const startRescan = async (input: RescanInput) => {
    try {
      const res = await api.startScan(input);
      if (!res.ok) {
        setError(res.error ?? 'Erneuter Scan konnte nicht gestartet werden.');
        return;
      }
      onNavigate('actions');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Box>
      <BackButton label="Zurück" onBack={onBack} />
      <Typography variant="h5" sx={{ mb: 1 }}>
        Dateiformat <Chip size="small" sx={{ fontFamily: 'monospace', ml: 0.5 }} label={ext} />
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {total} Dateien mit diesem Format
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <MediaGrid files={files} total={total} page={page} onPage={setPage} onOpenImage={onOpenImage} onOpenDevice={onOpenDevice} disableHoverPreview renderAction={(f) => <RescanButton title="Datei erneut scannen" onRescan={() => startRescan({ fileIds: [f.id] })} />} />
    </Box>
  );
}

export function DevicePage({ deviceId, onBack, onOpenImage }: {
  deviceId: number;
  onBack: () => void;
  onOpenImage: (id: number) => void;
}) {
  const [device, setDevice] = useState<Device | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([api.getDevice(deviceId), api.deviceFiles(deviceId)]);
      setDevice(d);
      setFiles(f);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <BackButton label="Zurück" onBack={onBack} />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <DevicesIcon color="primary" />
        <Typography variant="h5">{device ? deviceDisplayName(device) : 'Gerät…'}</Typography>
        {device?.identifiers.map((i) => (
          <Chip key={i.id} size="small" variant="outlined" label={`${i.kind === 'exif' ? 'EXIF' : i.kind === 'path' ? 'Ordner' : 'Dateiname'}: ${i.value}`} />
        ))}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {files.length} Medien
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <MediaGrid files={files} onOpenImage={onOpenImage} />
    </Box>
  );
}

export function IdentifierPage({ identifierKind, identifierValue, onBack, onOpenImage, onOpenDevice }: {
  identifierKind: 'exif' | 'path';
  identifierValue: string;
  onBack: () => void;
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listFiles({ identifierKind, identifierValue, limit: 5000 });
      setFiles(res.rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [identifierKind, identifierValue]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <BackButton label="Zurück" onBack={onBack} />
      <Typography variant="h5" sx={{ mb: 1 }}>
        {identifierKind === 'exif' ? `EXIF: ${identifierValue}` : `Ordner: ${identifierValue}`}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {files.length} Dateien mit diesem Identifikator
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <MediaGrid files={files} onOpenImage={onOpenImage} onOpenDevice={onOpenDevice} />
    </Box>
  );
}

export function ImagePage({ fileId, onBack, onOpenDevice }: {
  fileId: number;
  onBack: () => void;
  onOpenDevice: (id: number) => void;
}) {
  const [file, setFile] = useState<(FileRecord & { problems?: FileRecord['problems'] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getFile(fileId).then(setFile).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [fileId]);

  return (
    <Box>
      <BackButton label="Zurück" onBack={onBack} />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {file && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Paper sx={{ p: 1, flexGrow: 1, minWidth: 0 }}>
            {file.fileType === 'video' ? (
              <Box sx={{ textAlign: 'center' }}>
                <img src={mediaUrl.thumbnail(fileId)} alt={file.originalName} style={{ maxWidth: '100%', maxHeight: 560 }} />
                <Typography variant="body2" color="text.secondary">Video – keine Vorschau verfügbar</Typography>
              </Box>
            ) : (
              <img src={mediaUrl.file(fileId)} alt={file.originalName} style={{ display: 'block', maxWidth: '100%', maxHeight: 560, margin: '0 auto' }} />
            )}
            <Typography variant="caption" color="text.secondary" display="block" align="center" sx={{ mt: 1 }}>
              {file.originalName}
            </Typography>
          </Paper>
          <Box sx={{ maxWidth: 520, flexShrink: 0 }}>
            <FileInfoCard file={file} />
            {file.deviceId != null && (
              <Button sx={{ mt: 1 }} onClick={() => onOpenDevice(file.deviceId!)}>
                Alle Bilder dieses Geräts anzeigen
              </Button>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  );
}