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
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DeviceUnknownIcon from '@mui/icons-material/DeviceUnknown';
import FolderIcon from '@mui/icons-material/FolderOpen';
import { api } from '../api/client';
import { Thumbnail } from '../components/Thumbnail';
import { formatDate } from '../utils/date';
import type { Device, DeviceIdentifier, UnknownDeviceCandidate } from '../types';

export function DevicesPage({ onOpenImage, onOpenDevice, onOpenIdentifier }: {
  onOpenImage: (id: number) => void;
  onOpenDevice: (id: number) => void;
  onOpenIdentifier: (kind: 'exif' | 'path', value: string) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [candidates, setCandidates] = useState<UnknownDeviceCandidate[]>([]);
  const [adoptNames, setAdoptNames] = useState<Record<string, string>>({});
  const [adoptPersons, setAdoptPersons] = useState<Record<string, string>>({});
  const [adoptTargets, setAdoptTargets] = useState<Record<string, number>>({});
  const [adopting, setAdopting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; device: Device | null }>({ open: false, device: null });

  const load = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([api.listDevices(), api.listUnknownDevices()]);
      setDevices(d);
      setCandidates(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (d: Device) => {
    if (!confirm(`Gerät "${deviceDisplayName(d)}" löschen?`)) return;
    try { await api.deleteDevice(d.id); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const adopt = async (c: UnknownDeviceCandidate) => {
    const key = candidateKey(c);
    const target = adoptTargets[key] ?? 0;
    setAdopting(key);
    setError(null);
    try {
      if (target === 0) {
        const name = (adoptNames[key] ?? suggestedName(c)).trim();
        if (!name) return;
        await api.adoptDevice({
          mappedName: name,
          identifierValue: c.identifierValue,
          identifierKind: c.identifierKind,
          person: (adoptPersons[key] ?? c.person ?? '').trim() || null,
        });
      } else {
        await api.adoptDevice({
          identifierValue: c.identifierValue,
          identifierKind: c.identifierKind,
          deviceId: target,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdopting(null);
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" gutterBottom>Geräteverwaltung</Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, device: null })}>
            Gerät anlegen
          </Button>
        </Stack>
      </Grid>

      {error && <Grid item xs={12}><Alert severity="error" onClose={() => setError(null)}>{error}</Alert></Grid>}

      {candidates.length > 0 && (
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DeviceUnknownIcon fontSize="small" /> Unbekannte Geräte
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Diese Dateien tragen Geräte-Informationen (EXIF oder Upload-Ordnerpfad), haben aber noch keine
                Geräte-Zuordnung. Sie erscheinen deshalb nicht in der Problemliste und werden erst nach Übernahme übertragen.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Identifikator</TableCell>
                    <TableCell align="right">Dateien</TableCell>
                    <TableCell>Beispiel</TableCell>
                    <TableCell>Gerätename</TableCell>
                    <TableCell>Person</TableCell>
                    <TableCell align="right">Aktion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {candidates.map((c) => {
                    const key = candidateKey(c);
                    const target = adoptTargets[key] ?? 0;
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          {c.identifierKind === 'exif'
                            ? <Chip size="small" variant="outlined" label={`EXIF: ${c.identifierValue}`}
                                onClick={() => onOpenIdentifier('exif', c.identifierValue)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }} title="Alle Dateien mit diesem Identifikator anzeigen" />
                            : <Chip size="small" variant="outlined" color="info" icon={<FolderIcon />} label={`Ordner: ${c.identifierValue}`}
                                onClick={() => onOpenIdentifier('path', c.identifierValue)} sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }} title="Alle Dateien in diesem Ordner anzeigen" />}
                        </TableCell>
                        <TableCell align="right">{c.count}</TableCell>
                        <TableCell>
                          <Box
                            sx={{ cursor: c.sampleFileId ? 'pointer' : 'default', '&:hover': { opacity: 0.8 } }}
                            onClick={() => c.sampleFileId && onOpenImage(c.sampleFileId)}
                            title={c.sampleFileId ? 'Beispielbild öffnen' : undefined}
                          >
                            {c.sampleFileId != null && <Thumbnail fileId={c.sampleFileId} fileType="image" size={64} />}
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.identifierKind === 'exif' ? c.sampleName : c.samplePath}
                            </Typography>
                          </Box>
                        </TableCell>
                        {target === 0 ? (
                          <>
                            <TableCell>
                              <TextField
                                size="small"
                                fullWidth
                                value={adoptNames[key] ?? suggestedName(c)}
                                onChange={(e) => setAdoptNames((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                fullWidth
                                placeholder="optional"
                                value={adoptPersons[key] ?? c.person ?? ''}
                                onChange={(e) => setAdoptPersons((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                            </TableCell>
                          </>
                        ) : (
                          <TableCell colSpan={2}>
                            <Typography variant="body2" color="text.secondary">
                              Indikator wird dem Gerät {(() => { const t = devices.find((dd) => dd.id === target); return t ? deviceDisplayName(t) : '?'; })()} hinzugefügt
                            </Typography>
                          </TableCell>
                        )}
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                            <FormControl size="small" sx={{ minWidth: 200 }}>
                              <InputLabel>Gerät</InputLabel>
                              <Select
                                value={target}
                                label="Gerät"
                                onChange={(e) => setAdoptTargets((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                              >
                                <MenuItem value={0}>Neues Gerät anlegen</MenuItem>
                                {devices.map((d) => <MenuItem key={d.id} value={d.id}>{deviceDisplayName(d)}</MenuItem>)}
                              </Select>
                            </FormControl>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => adopt(c)}
                              disabled={adopting === key || (target === 0 && !(adoptNames[key] ?? suggestedName(c)).trim())}
                            >
                              {adopting === key ? '…' : target === 0 ? 'Übernehmen' : 'Hinzufügen'}
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      )}

      <Grid item xs={12}>
        <Card>
          <CardContent sx={{ p: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Identifikatoren</TableCell>
                  <TableCell>Nutzungszeitraum (automatisch)</TableCell>
                  <TableCell align="right">Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Typography
                        variant="body1"
                        fontWeight={600}
                        onClick={() => onOpenDevice(d.id)}
                        sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                        title="Alle Bilder dieses Geräts anzeigen"
                      >
                        {deviceDisplayName(d)}
                      </Typography>
                      {d.person && <Typography variant="caption" color="text.secondary">Person: {d.person}</Typography>}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {d.identifiers.map((i) => (
                          <Chip
                            key={i.id}
                            size="small"
                            variant="outlined"
                            label={`${identifierKindLabel(i.kind)}: ${i.value}`}
                            onClick={() => i.kind === 'filename' ? onOpenDevice(d.id) : onOpenIdentifier(i.kind, i.value)}
                            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                            title="Alle Dateien mit diesem Identifikator anzeigen"
                          />
                        ))}
                        {d.identifiers.length === 0 && <Typography variant="caption" color="text.secondary">Keine</Typography>}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {d.usagePeriod ? (
                        <Box>
                          <Typography variant="body2" display="block">{formatDate(d.usagePeriod.min)}</Typography>
                          <Typography variant="body2" color="text.secondary">bis</Typography>
                          <Typography variant="body2" display="block">{formatDate(d.usagePeriod.max)}</Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">Noch keine Dateien zugeordnet</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Bearbeiten"><IconButton onClick={() => setDialog({ open: true, device: d })}><EditIcon /></IconButton></Tooltip>
                      <Tooltip title="Löschen"><IconButton color="error" onClick={() => remove(d)}><DeleteIcon /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {devices.length === 0 && (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}>Noch keine Geräte angelegt. Ohne Geräte-Zuordnung werden keine Dateien übertragen.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>

      {dialog.open && <DeviceDialog device={dialog.device} onClose={() => setDialog({ open: false, device: null })} onSaved={load} />}
    </Grid>
  );
}

export function deviceDisplayName(d: Pick<Device, 'mappedName' | 'person'>): string {
  return d.person ? `${d.mappedName} von ${d.person}` : d.mappedName;
}

function candidateKey(c: UnknownDeviceCandidate): string {
  return `${c.identifierKind}:${c.identifierValue}`;
}

function suggestedName(c: UnknownDeviceCandidate): string {
  if (c.identifierKind === 'path') return c.identifierValue.split('/').filter(Boolean).pop() ?? c.identifierValue;
  return c.identifierValue;
}

function identifierKindLabel(kind: DeviceIdentifier['kind']): string {
  switch (kind) {
    case 'exif': return 'EXIF';
    case 'filename': return 'Dateiname';
    case 'path': return 'Ordner';
  }
}



function DeviceDialog({ device, onClose, onSaved }: { device: Device | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mappedName, setMappedName] = useState(device?.mappedName ?? '');
  const [person, setPerson] = useState(device?.person ?? '');
  const [identifiers, setIdentifiers] = useState<{ kind: DeviceIdentifier['kind']; value: string }[]>(
    device?.identifiers.map((i) => ({ kind: i.kind, value: i.value })) ?? [{ kind: 'filename', value: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const cleaned = identifiers.filter((i) => i.value.trim());
      const payload = { mappedName: mappedName.trim(), person: person.trim() || null, identifiers: cleaned };
      if (device) {
        await api.updateDevice(device.id, payload);
      } else {
        await api.createDevice(payload);
      }
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
      <DialogTitle>{device ? 'Gerät bearbeiten' : 'Gerät anlegen'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Gerätename" value={mappedName} onChange={(e) => setMappedName(e.target.value)} fullWidth
            helperText="Wird im Ziel-Dateinamen verwendet, z.B. iPhone13" />
          <TextField label="Person" value={person} onChange={(e) => setPerson(e.target.value)} fullWidth
            helperText="Optional – Anzeigename wird dann „&lt;Gerät&gt; von &lt;Person&gt;“" />
          <Typography variant="subtitle2">Identifikatoren</Typography>
          {identifiers.map((ident, idx) => (
            <Stack key={idx} direction="row" spacing={1} alignItems="center">
              <FormControl sx={{ width: 180 }}>
                <InputLabel>Typ</InputLabel>
                <Select value={ident.kind} label="Typ" onChange={(e) => setIdentifiers((prev) => prev.map((x, i) => i === idx ? { ...x, kind: e.target.value as DeviceIdentifier['kind'] } : x))}>
                  <MenuItem value="exif">EXIF Make + Model</MenuItem>
                  <MenuItem value="filename">Dateinamen-Präfix</MenuItem>
                  <MenuItem value="path">Upload-Ordner</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Wert" value={ident.value} fullWidth
                onChange={(e) => setIdentifiers((prev) => prev.map((x, i) => i === idx ? { ...x, value: e.target.value } : x))}
                placeholder={ident.kind === 'filename' ? 'z.B. IMG_' : ident.kind === 'path' ? 'z.B. Guido/Sony Alpha 6400' : 'z.B. Apple iPhone 12'} />
              <IconButton onClick={() => setIdentifiers((prev) => prev.filter((_, i) => i !== idx))} disabled={identifiers.length <= 1}><DeleteIcon /></IconButton>
            </Stack>
          ))}
          <Button variant="text" onClick={() => setIdentifiers((prev) => [...prev, { kind: 'filename', value: '' }])}>Weiteren Identifikator hinzufügen</Button>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={saving || !mappedName.trim()}>Speichern</Button>
      </DialogActions>
    </Dialog>
  );
}